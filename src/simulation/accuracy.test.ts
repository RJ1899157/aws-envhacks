import { describe, expect, it } from 'vitest';
import { RoomSchema, type Room } from '../core/schema';
import { device, opening, rectRoom } from '../test/simulationFixtures';
import { DISCHARGE_COEFFICIENT, GRAVITY, INFILTRATION_PENETRATION, INSECT_MESH_LOSS_K, INTERZONAL_DELTA_T_K, PM25_DEPOSITION_RATE_PER_S } from './constants';
import { simulateHouseNetwork } from './house/network';
import { runVoxelSimulation } from './voxel/solver';

/**
 * Accuracy against closed-form solutions and textbook formulas (not just self-consistency):
 * well-mixed mass balance, exponential decay, purifier and exhaust balances, stack and cross
 * ventilation (CIBSE AM10 / BS 5925), mass conservation between rooms, and the voxel solver's room
 * volumes.
 */

const TIMEOUT = 60_000;
const K = PM25_DEPOSITION_RATE_PER_S;
const LAM = 0.5 / 3600; // default infiltration
const P = INFILTRATION_PENETRATION;
const env = { exposure: 'urbanDense' as const, outdoorUgM3: 100 };
const V = 4 * 3 * 2.5;
const source = (rate: number) => device('src', 'pm25-incense', { role: 'none', position: [2, 0, 1.5], elevation: 0.6, size: [0.1, 0.3, 0.1], emissionRateUgMin: rate });
const rel = (a: number, b: number) => Math.abs(a - b) / Math.abs(b);

describe('simulation accuracy against analytic solutions', () => {
  it('sealed room with a source: C = (λ·P·C_out + E/V) / (λ + k), in both models', async () => {
    const room = rectRoom(4, 3, 2.5, { objects: [source(600)] });
    const want = (LAM * P * 100 + 600 / 60 / V) / (LAM + K);
    expect(rel(simulateHouseNetwork([room], env).zones[0]!.cssUgM3, want)).toBeLessThan(0.005);
    // The voxel grid's room is bigger than the room (½ wall, ceiling rounding); the scalar balance must not be
    const vox = await runVoxelSimulation({ rooms: [room], env, resolution: 'live' });
    expect(rel(vox.summary.volumeMeanPm25Steady, want)).toBeLessThan(0.01);
  }, TIMEOUT);

  it('closed room decays as C_ss + (C0 − C_ss)·e^(−(λ+k)t)', () => {
    const css = (LAM * P * 100) / (LAM + K);
    const z = simulateHouseNetwork([rectRoom(4, 3, 2.5)], env, { durationS: 4 * 3600, dtS: 60 }).zones[0]!;
    for (const tMin of [30, 120, 240]) {
      const c = z.series.find((s) => Math.abs(s.tS - tMin * 60) < 1)!.c;
      expect(rel(c, css + (100 - css) * Math.exp(-(LAM + K) * tMin * 60))).toBeLessThan(0.01);
    }
    expect(z.ageMinutes).toBeCloseTo(1 / LAM / 60, 1);
  });

  it('purifier and exhaust fan balances', () => {
    const pur = rectRoom(4, 3, 2.5, { objects: [device('p', 'air-purifier', { position: [1, 0, 1], size: [0.38, 0.6, 0.38], cadrM3h: 300 })] });
    expect(rel(simulateHouseNetwork([pur], env).zones[0]!.cssUgM3, (LAM * P * 100) / (LAM + K + 300 / 3600 / V))).toBeLessThan(0.005);
    const ex = rectRoom(4, 3, 2.5, { objects: [device('e', 'exhaust-fan', { position: [2, 2, 0.1], size: [0.3, 0.3, 0.15], wallMounted: true, exhaustFlowM3h: 250 })] });
    const z = simulateHouseNetwork([ex], env).zones[0]!;
    expect(z.outdoorInflowM3s * 3600).toBeCloseTo(250, 0); // make-up air = exhaust
    const lam = 250 / 3600 / V + LAM;
    expect(rel(z.cssUgM3, (lam * P * 100) / (lam + K))).toBeLessThan(0.02);
  });

  it('an exhaust fan turned round blows outdoor air in: room pressurised, C = (Q·C_out + λVP·C_out)/(Q + λV + kV)', async () => {
    const Q = 250;
    const fan = (dir?: 'in' | 'out') => rectRoom(4, 3, 2.5, { objects: [device('ex', 'exhaust-fan', { position: [2, 2, 0.1], size: [0.3, 0.3, 0.15], wallMounted: true, exhaustFlowM3h: Q, ...(dir && { flowDirection: dir }) })] });
    const inNet = simulateHouseNetwork([fan('in')], env);
    const outNet = simulateHouseNetwork([fan('out')], env);
    const z = inNet.zones[0]!;
    expect(z.pressurePa).toBeGreaterThan(0); // blowing in pressurises; extracting depressurises
    expect(outNet.zones[0]!.pressurePa).toBeLessThan(0);
    expect(z.supplyM3s * 3600).toBeCloseTo(Q, 3);
    expect(z.exhaustM3s).toBe(0);
    const q = Q / 3600;
    const want = (q * 100 + LAM * V * P * 100) / (q + LAM * V + K * V);
    expect(rel(z.cssUgM3, want)).toBeLessThan(0.005);
    // The voxel solver agrees on the room mean and conserves mass
    const vox = await runVoxelSimulation({ rooms: [fan('in')], env, resolution: 'live' });
    expect(rel(vox.summary.volumeMeanPm25Steady, want)).toBeLessThan(0.05);
    expect(vox.diagnostics.steadyMassBalanceError).toBeLessThan(1e-4);
    expect(vox.diagnostics.divergenceResidual).toBeLessThan(1e-3);
  }, TIMEOUT);

  it('stack flow (warm inside) enters low, leaves high, at Cd·A*·sqrt(2gΔhΔT/T)', () => {
    const room = rectRoom(4, 3, 2.5, { openings: [opening('low', 0, { offset: 1, width: 0.6, height: 0.4, sill: 0.2 }), opening('high', 2, { offset: 1, width: 0.6, height: 0.4, sill: 2 })] });
    const net = simulateHouseNetwork([room], { ...env, windSpeed: 0, indoorTempC: 22, outdoorTempC: 5 });
    const into = (id: string) => {
      const p = net.paths.find((q) => q.openingId === id)!;
      return p.to === 0 ? p.flowM3s : -p.flowM3s;
    };
    expect(into('low')).toBeGreaterThan(0);
    expect(into('high')).toBeLessThan(0);
    const aStar = 0.24 / Math.SQRT2;
    expect(rel(into('low'), DISCHARGE_COEFFICIENT * aStar * Math.sqrt((2 * GRAVITY * 1.8 * 17) / (273.15 + 13.5)))).toBeLessThan(0.05);
  });

  it('wind: windward window is the inlet; cross flow = Cd·A*·U·sqrt(ΔCp)', () => {
    const room = rectRoom(4, 3, 2.5, { openings: [opening('n', 0, { offset: 1.5 }), opening('s', 2, { offset: 1.5 })] });
    const net = simulateHouseNetwork([room], { ...env, windSpeed: 3, windDirDeg: 0 });
    const p = net.paths.find((q) => q.openingId === 'n')!;
    const into = p.to === 0 ? p.flowM3s : -p.flowM3s;
    const uLocal = 3 * 0.21 * Math.pow(10, 0.33); // BS 5925 city terrain at 10 m
    expect(rel(into, DISCHARGE_COEFFICIENT * Math.SQRT1_2 * uLocal * Math.sqrt(0.2 + 0.25))).toBeLessThan(0.02);
  });

  it('an open interior door mixes two rooms (buoyant doorway exchange) and conserves mass', () => {
    const door = opening('door', 1, { type: 'door', offset: 1, width: 0.9, height: 2.1, sill: 0, role: 'outlet', openFraction: 1 });
    const a = RoomSchema.parse({ ...rectRoom(4, 3, 2.5), id: 'A', name: 'A', openings: [door], objects: [source(1000)] });
    const b = RoomSchema.parse({ ...rectRoom(3, 3, 2.5), id: 'B', name: 'B', outline: [[4.15, 0], [7.15, 0], [7.15, 3], [4.15, 3]] });
    const net = simulateHouseNetwork([a, b] as Room[], { ...env, outdoorUgM3: 0 });
    const [za, zb] = net.zones;
    // Exchange each way through a 0.9 × 2.1 m door at ΔT = INTERZONAL_DELTA_T_K
    const q = (DISCHARGE_COEFFICIENT / 3) * 0.9 * Math.sqrt((GRAVITY * 2.1 ** 3 * INTERZONAL_DELTA_T_K) / (273.15 + 25));
    // Room B is fed only through the door: q·(C_A − C_B) = (λ + k)·V_B·C_B
    expect(rel(q * (za!.cssUgM3 - zb!.cssUgM3), (LAM + K) * zb!.volumeM3 * zb!.cssUgM3)).toBeLessThan(0.02);
    expect(zb!.cssUgM3).toBeGreaterThan(0.5 * za!.cssUgM3);
    // Everything emitted is removed: deposition + infiltration (C_out = 0)
    const removed = net.zones.reduce((s, z) => s + (K + LAM) * z.volumeM3 * z.cssUgM3, 0);
    expect(rel(removed, 1000 / 60)).toBeLessThan(0.01);
    // A closed door leaves B with outdoor air only
    const closed = RoomSchema.parse({ ...a, openings: [{ ...door, role: 'closed', openFraction: 0 }] });
    expect(simulateHouseNetwork([closed, b] as Room[], { ...env, outdoorUgM3: 0 }).zones[1]!.cssUgM3).toBeLessThan(1);
  });

  describe('home details: floor, surroundings, window type and mesh', () => {
    const cross = (params: Record<string, unknown> = {}, windowExtra: Record<string, unknown> = {}) => {
      const room = rectRoom(4, 3, 2.5, { openings: [opening('n', 0, { offset: 1.5, ...windowExtra }), opening('s', 2, { offset: 1.5, ...windowExtra })], params: { windSpeed: 3, windDirDeg: 0, ...params } as never });
      const p = simulateHouseNetwork([room], { outdoorUgM3: 100 }).paths.find((q) => q.openingId === 'n')!;
      return p.to === 0 ? p.flowM3s : -p.flowM3s;
    };
    const base = cross();

    it('sliding windows open half the frame, louvres ~40 %; flow scales with open area', () => {
      expect(cross({}, { windowStyle: 'sliding' }) / base).toBeCloseTo(0.5, 3);
      expect(cross({}, { windowStyle: 'louvre' }) / base).toBeCloseTo(0.4, 3);
      expect(cross({}, { windowStyle: 'casement' }) / base).toBeCloseTo(1, 3);
    });

    it('insect mesh in series: flow × 1/sqrt(1 + K·Cd²)', () => {
      expect(cross({}, { mesh: true }) / base).toBeCloseTo(1 / Math.sqrt(1 + INSECT_MESH_LOSS_K * DISCHARGE_COEFFICIENT ** 2), 3);
    });

    it("the home's window defaults apply unless a window sets its own", () => {
      const defaults = { windowDefaults: { style: 'sliding', mesh: false } };
      expect(cross(defaults) / base).toBeCloseTo(0.5, 3);
      expect(cross(defaults, { windowStyle: 'casement' }) / base).toBeCloseTo(1, 3);
    });

    it('wind is taken at the floor of the home (power law of the terrain)', () => {
      // urbanDense (city): U ∝ z^0.33; ground floor windows at 1.5 m, 10th floor at 31.5 m
      expect(cross({ floorLevel: 0 }) / base).toBeCloseTo(Math.pow(1.5 / 10, 0.33), 3);
      expect(cross({ floorLevel: 10 }) / base).toBeCloseTo(Math.pow(31.5 / 10, 0.33), 3);
      // Open surroundings: more wind and stronger pressure coefficients than a packed city block
      expect(cross({ exposure: 'open' })).toBeGreaterThan(2 * base);
    });

    it('the voxel solver sees the same reduction for a sliding window with mesh', async () => {
      const mk = (extra: Record<string, unknown>) =>
        rectRoom(4, 3, 2.5, { openings: [opening('n', 0, { offset: 1, width: 1.2, height: 1.2, sill: 0.9, ...extra }), opening('s', 2, { offset: 1, width: 1.2, height: 1.2, sill: 0.9, ...extra })] });
      const flow = async (room: Room) => {
        const r = await runVoxelSimulation({ rooms: [room], env: { outdoorUgM3: 100, windSpeed: 3 }, resolution: 'live', durationS: 600 });
        return Math.abs(r.paths.find((p) => p.id === 'n')!.voxelFlowM3s);
      };
      const ratio = (await flow(mk({ windowStyle: 'sliding', mesh: true }))) / (await flow(mk({})));
      expect(ratio).toBeGreaterThan(0.3);
      expect(ratio).toBeLessThan(0.5);
    }, TIMEOUT);
  });
});
