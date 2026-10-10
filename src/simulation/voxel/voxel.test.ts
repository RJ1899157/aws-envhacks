import { describe, expect, it } from 'vitest';
import type { Room } from '../../core/schema';
import { device, opening, rectRoom } from '../../test/simulationFixtures';
import { PM25_DEPOSITION_RATE_PER_S, VOXEL_DIVERGENCE_TOL } from '../constants';
import type { VoxelWorkerResponse } from './protocol';
import { runVoxelSimulation, type VoxelSimInput, type VoxelSimResult } from './solver';
import { createVoxelWorkerHandler } from './workerHandler';

const TIMEOUT = 60_000;
const quick = { snapshotTimesS: [0], durationS: 60 };

/** 4 × 3 × 2.5 m room; windows centred on the north (z = 0) and south (z = 3) walls at x 1.5–2.5. */
const crossRoom = (extra: Partial<Room> = {}) =>
  rectRoom(4, 3, 2.5, { openings: [opening('north', 0, { offset: 1.5 }), opening('south', 2, { offset: 1.5 })], ...extra });

/** Mean of a grid field over fluid cells whose centres satisfy `pred`. */
function regionMean(r: VoxelSimResult, field: Float32Array, pred: (x: number, y: number, z: number) => boolean): number {
  const { nx, ny, nz, dx, origin } = r.grid;
  let s = 0;
  let n = 0;
  for (let k = 0; k < nz; k++)
    for (let j = 0; j < ny; j++)
      for (let i = 0; i < nx; i++) {
        const v = field[i + nx * (j + ny * k)]!;
        if (!Number.isFinite(v)) continue;
        if (!pred(origin[0] + (i + 0.5) * dx, origin[1] + (j + 0.5) * dx, origin[2] + (k + 0.5) * dx)) continue;
        s += v;
        n++;
      }
  return s / n;
}

async function compareWithNetwork(label: string, input: VoxelSimInput) {
  const r = await runVoxelSimulation({ ...quick, ...input });
  const d = r.summary.networkDifference;
  console.info(`[voxel vs network] ${label}: voxel ${r.summary.volumeMeanPm25Steady.toFixed(1)} vs network ${r.summary.networkMeanPm25.toFixed(1)} µg/m³ (${(d * 100).toFixed(1)}%)`);
  return r;
}

describe('voxel solver', () => {
  it('cross ventilation: wind pressures drive a divergence-free flow inlet → outlet matching the network', async () => {
    const r = await runVoxelSimulation({
      room: crossRoom(),
      env: { exposure: 'open', infiltrationAch: 0, windSpeed: 2, windDirDeg: 0, indoorTempC: 25, outdoorTempC: 25, outdoorPm25UgM3: 100 },
      ...quick,
    });
    expect(r.diagnostics.divergenceResidual).toBeLessThan(VOXEL_DIVERGENCE_TOL);
    const north = r.paths.find((o) => o.id === 'north')!;
    const south = r.paths.find((o) => o.id === 'south')!;
    // Paths are signed room → outdoors: the windward north window takes air in
    expect(north.voxelFlowM3s).toBeLessThan(0);
    expect(south.voxelFlowM3s).toBeGreaterThan(0);
    expect(north.voxelFlowM3s + south.voxelFlowM3s).toBeCloseTo(0, 4);
    // Aligned windows 3 m apart: the inlet jet carries its momentum to the outlet, so the voxel flow
    // exceeds the series-orifice network (which loses the inlet's dynamic head) by up to √2
    const ratio = north.voxelFlowM3s / north.networkFlowM3s;
    expect(ratio).toBeGreaterThan(0.9);
    expect(ratio).toBeLessThan(1.5);
    // Mean z-velocity along the line between the windows points south (+Z)
    const w = r.velocity.cell.filter((_, i) => i % 3 === 2);
    expect(regionMean(r, Float32Array.from(w), (x, y) => Math.abs(x - 2) < 0.5 && y > 1 && y < 2)).toBeGreaterThan(0.05);
  }, TIMEOUT);

  it('stack effect through one door: cold air in at the bottom, warm air out at the top', async () => {
    const room = rectRoom(4, 3, 2.7, { openings: [opening('door', 0, { type: 'door', offset: 1.5, sill: 0, height: 2.1, width: 1 })] });
    const r = await runVoxelSimulation({ room, env: { windSpeed: 0, indoorTempC: 25, outdoorTempC: 5, infiltrationAch: 0 }, ...quick });
    const w = r.velocity.cell.filter((_, i) => i % 3 === 2); // +z = into the room from the north door
    const low = regionMean(r, Float32Array.from(w), (x, y, z) => Math.abs(x - 2) < 0.5 && y < 0.6 && z < 0.4);
    const high = regionMean(r, Float32Array.from(w), (x, y, z) => Math.abs(x - 2) < 0.5 && y > 1.6 && y < 2.1 && z < 0.4);
    expect(low).toBeGreaterThan(0.01);
    expect(high).toBeLessThan(-0.01);
    const door = r.paths.find((p) => p.id === 'door')!;
    expect(door.voxelExchangeM3s / door.networkExchangeM3s).toBeGreaterThan(0.5);
    expect(door.voxelExchangeM3s / door.networkExchangeM3s).toBeLessThan(2);
  }, TIMEOUT);

  it('two rooms through an open interior door: flows and PM2.5 follow the network', async () => {
    const a = rectRoom(4, 3, 2.5, {
      id: 'a',
      name: 'A',
      openings: [opening('win-n', 0, { offset: 1.5 }), opening('door', 1, { type: 'door', subType: 'single-door', offset: 1, width: 0.9, height: 2.1, sill: 0, role: 'inlet', openFraction: 1 })],
    });
    const b = rectRoom(4, 3, 2.5, { id: 'b', name: 'B', outline: [[4.15, 0], [8.15, 0], [8.15, 3], [4.15, 3]], openings: [opening('win-s', 2, { offset: 1.5 })] });
    const r = await runVoxelSimulation({ rooms: [a, b], env: { windSpeed: 2, windDirDeg: 0, exposure: 'open', ...{ indoorTempC: 25, outdoorTempC: 25 }, outdoorPm25UgM3: 150 }, ...quick });
    const door = r.paths.find((p) => p.id === 'door')!;
    expect(door.voxelFlowM3s).toBeGreaterThan(0.02); // A → B
    expect(Math.abs(door.voxelFlowM3s / door.networkFlowM3s - 1)).toBeLessThan(0.25);
    for (const z of r.zones) expect(Math.abs(z.voxelPm25Steady / z.networkPm25Steady - 1)).toBeLessThan(0.25);
  }, TIMEOUT);

  it('closed box without sources, devices or infiltration conserves PM2.5 apart from deposition', async () => {
    const r = await runVoxelSimulation({
      room: rectRoom(4, 3, 2.5),
      env: { infiltrationAch: 0, outdoorPm25UgM3: 0 },
      initialUgM3: 100,
      durationS: 4 * 3600,
      snapshotTimesS: [0, 3600, 4 * 3600],
    });
    for (const snap of r.pm25.snapshots) {
      const expected = 100 * Math.exp(-PM25_DEPOSITION_RATE_PER_S * snap.tS);
      expect(Math.abs(snap.mean - expected) / expected).toBeLessThan(0.01);
    }
    expect(r.diagnostics.transientMassBalanceError).toBeLessThan(1e-6);
  }, TIMEOUT);

  it('steady volume-mean PM2.5 is within 25% of the network model', async () => {
    const env = { outdoorPm25UgM3: 150, windSpeed: 2, indoorTempC: 25, outdoorTempC: 30 };
    const purifier = device('purifier', 'air-purifier', { position: [2, 0, 1.5], cadrM3h: 300 });
    const cases: [string, Room][] = [
      ['cross ventilation', crossRoom()],
      ['closed + purifier', rectRoom(4, 3, 2.5, { objects: [purifier] })],
      ['window ajar + purifier', rectRoom(4, 3, 2.5, { openings: [opening('ajar', 0, { offset: 1.5, openFraction: 0.2 })], objects: [purifier] })],
    ];
    // A window opened 20 % is one 0.2 m cell wide, so its two-way stack exchange is under-resolved
    const tolerance: Record<string, number> = { 'window ajar + purifier': 0.5 };
    for (const [label, room] of cases) {
      const r = await compareWithNetwork(label, { room, env });
      expect(Math.abs(r.summary.networkDifference)).toBeLessThan(tolerance[label] ?? 0.25);
      expect(r.diagnostics.steadyMassBalanceError).toBeLessThan(1e-6);
    }
  }, TIMEOUT);

  it('age of air is higher in far corners than on the inlet → outlet line', async () => {
    const r = await runVoxelSimulation({
      room: crossRoom(),
      env: { exposure: 'open', infiltrationAch: 0, windSpeed: 2, windDirDeg: 0, indoorTempC: 25, outdoorTempC: 25 },
      ...quick,
    });
    const age = r.ageMinutes!;
    const onLine = regionMean(r, age, (x, y) => Math.abs(x - 2) < 0.4 && Math.abs(y - 1.5) < 0.4);
    const corners = regionMean(r, age, (x, y) => (x < 0.5 || x > 3.5) && (y < 0.5 || y > 2));
    expect(corners).toBeGreaterThan(onLine * 1.2);
  }, TIMEOUT);

  it('PM2.5 near a purifier is lower than far from it', async () => {
    const r = await runVoxelSimulation({
      room: rectRoom(4, 3, 2.5, { objects: [device('p', 'air-purifier', { position: [0.6, 0, 0.6], cadrM3h: 300 })] }),
      env: { outdoorPm25UgM3: 150 },
      ...quick,
    });
    const near = regionMean(r, r.pm25.steady, (x, y, z) => Math.hypot(x - 0.6, z - 0.6) < 0.7 && y < 1);
    const far = regionMean(r, r.pm25.steady, (x, y, z) => Math.hypot(x - 3.4, z - 2.4) < 0.7 && y < 1);
    expect(near).toBeLessThan(far);
  }, TIMEOUT);
});

describe('voxel worker protocol', () => {
  it('returns a result with transferable arrays', async () => {
    const messages: { msg: VoxelWorkerResponse; transfer?: Transferable[] }[] = [];
    const handle = createVoxelWorkerHandler((msg, transfer) => messages.push({ msg, transfer }));
    await handle({ type: 'start', id: 'a', input: { room: rectRoom(2, 2, 2.4), env: { outdoorPm25UgM3: 50 }, ...quick } });
    const last = messages[messages.length - 1]!;
    expect(last.msg.type).toBe('result');
    expect(messages.some((m) => m.msg.type === 'progress')).toBe(true);
    expect(last.transfer!.length).toBeGreaterThan(5);
    expect(last.transfer!.every((b) => b instanceof ArrayBuffer)).toBe(true);
  }, TIMEOUT);

  it('a cancel message stops the run', async () => {
    const messages: VoxelWorkerResponse[] = [];
    let onVelocity: () => void = () => {};
    const velocityStarted = new Promise<void>((resolve) => (onVelocity = resolve));
    const handle = createVoxelWorkerHandler((msg) => {
      messages.push(msg);
      if (msg.type === 'progress' && msg.phase === 'velocity') onVelocity();
    });
    const run = handle({ type: 'start', id: 'b', input: { room: crossRoom(), env: { exposure: 'open', windSpeed: 2 }, maxVelocitySteps: 100_000 } });
    await velocityStarted;
    await handle({ type: 'cancel', id: 'b' });
    await run;
    expect(messages[messages.length - 1]!.type).toBe('cancelled');
    expect(messages.some((m) => m.type === 'result')).toBe(false);
  }, TIMEOUT);
});
