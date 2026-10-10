import { describe, expect, it } from 'vitest';
import { RoomSchema } from '../core/schema';
import { device, rectRoom } from '../test/simulationFixtures';
import { PM25_SOURCE_PRESETS } from './constants';
import { deviceFor, deviceKindOf } from './devices';
import { simulateHouseNetwork } from './house/network';
import { placedSourceParams, roomPm25Sources, sourceActiveAt, sourceEvents } from './sources';
import { runVoxelSimulation } from './voxel/solver';

const TIMEOUT = 60_000;
/** Closed, leak-free, deposition-free box: emitted mass can only accumulate. */
const sealed = { infiltrationAch: 0, outdoorPm25UgM3: 0, depositionPerS: 0 };
const incense = (overrides = {}) => device('stick', 'pm25-incense', { role: 'none', size: [0.12, 0.3, 0.12], position: [1.2, 0, 1.4], ...overrides });

describe('placed PM2.5 sources', () => {
  it('resolve from the preset, with object overrides; they are not air-handling devices', () => {
    const obj = incense();
    expect(deviceKindOf(obj)).toBe('pm25Source');
    expect(deviceFor(obj)).toBeNull();
    // Emits from where it rests: the stick's tip 0.3 m above the floor here, the preset's 0.9 m at
    // its usual 0.6 m shelf height, higher on a 0.8 m sideboard
    expect(placedSourceParams(obj)).toMatchObject({ preset: 'incense', rateUgMin: PM25_SOURCE_PRESETS.incense.rateUgMin, enabled: true });
    expect(placedSourceParams(obj)!.heightM).toBeCloseTo(0.3);
    expect(placedSourceParams(incense({ elevation: 0.6 }))!.heightM).toBeCloseTo(PM25_SOURCE_PRESETS.incense.heightM);
    expect(placedSourceParams(incense({ elevation: 0.8 }))!.heightM).toBeCloseTo(1.1);
    const custom = incense({ emissionRateUgMin: 50, emissionHeightM: 1.4, sourceSchedule: [{ startMin: 5, durationMin: 10 }] });
    const [src] = roomPm25Sources(rectRoom(4, 3, 2.5, { objects: [custom] }));
    expect(src).toMatchObject({ emissionRateUgMin: 50, position: [1.2, 1.4, 1.4], schedule: [{ startMin: 5, durationMin: 10 }] });
    // Disabled sources and plain furniture emit nothing
    expect(roomPm25Sources(rectRoom(4, 3, 2.5, { objects: [incense({ enabled: false }), device('sofa', 'sofa-3-seater', { role: 'solid' })] }))).toEqual([]);
  });

  it('keep room-level sources and old designs working', () => {
    const room = rectRoom(4, 3, 2.5, { params: { pm25Sources: [{ id: 'cook', emissionRateUgMin: 1000 }] } as never });
    expect(roomPm25Sources(room).map((s) => s.id)).toEqual(['cook']);
    // A Phase 1 object parses unchanged and is not a source
    const parsed = RoomSchema.parse({ outline: [[0, 0], [3, 0], [3, 3], [0, 3]], objects: [{ id: 'a', assetId: 'sofa', name: 'Sofa', position: [1, 0, 1], size: [2, 0.8, 0.9] }] });
    expect(parsed.objects[0]!.sourcePreset).toBeUndefined();
    expect(roomPm25Sources(parsed)).toEqual([]);
  });

  it('schedules: active inside their windows; the steady state counts every source as on', () => {
    const src = { schedule: [{ startMin: 10, durationMin: 20 }] };
    expect(sourceActiveAt(src, 9 * 60)).toBe(false);
    expect(sourceActiveAt(src, 10 * 60)).toBe(true);
    expect(sourceActiveAt(src, 30 * 60)).toBe(false);
    expect(sourceActiveAt(src, null)).toBe(true);
    const events = sourceEvents([rectRoom(4, 3, 2.5, { objects: [incense({ name: 'Frying', sourceSchedule: [{ startMin: 10, durationMin: 45 }] })] })], 4 * 3600);
    expect(events.map((e) => [e.tS, e.label])).toEqual([
      [600, 'Frying starts'],
      [3300, 'Frying stops'],
    ]);
  });

  it('voxel solver: emitted mass in a sealed box equals rate × time within 2 %', async () => {
    const rate = 1200; // µg/min
    const durationS = 30 * 60;
    const room = rectRoom(4, 3, 2.5, { objects: [incense({ emissionRateUgMin: rate })] });
    const r = await runVoxelSimulation({ room, env: sealed, initialUgM3: 0, durationS, snapshotTimesS: [0, 600, durationS] });
    // Mass = mean × the room's true volume (4 × 3 × 2.5 m), not the grid's cell count
    for (const snap of r.pm25.snapshots) {
      const mass = snap.mean * 4 * 3 * 2.5;
      const expected = (rate * snap.tS) / 60;
      if (expected === 0) expect(mass).toBe(0);
      else expect(Math.abs(mass - expected) / expected).toBeLessThan(0.02);
    }
    // Emitted into a small volume at the source's height, not spread through the room
    const { nx, ny, dx, origin } = r.grid;
    const j = Math.floor((0.9 - origin[1]) / dx);
    const at = (x: number, z: number) => r.pm25.snapshots[1]!.field[Math.floor((x - origin[0]) / dx) + nx * (j + ny * Math.floor((z - origin[2]) / dx))]!;
    expect(at(1.2, 1.4)).toBeGreaterThan(2 * at(3.6, 0.3));
  }, TIMEOUT);

  it('voxel solver: a scheduled source emits only inside its window', async () => {
    const rate = 600;
    const room = rectRoom(4, 3, 2.5, { objects: [incense({ emissionRateUgMin: rate, sourceSchedule: [{ startMin: 5, durationMin: 10 }] })] });
    const r = await runVoxelSimulation({ room, env: sealed, initialUgM3: 0, durationS: 30 * 60, snapshotTimesS: [0, 300, 1800] });
    const mass = (i: number) => r.pm25.snapshots[i]!.mean * 4 * 3 * 2.5;
    expect(mass(1)).toBeLessThan(1e-6);
    expect(Math.abs(mass(2) - rate * 10) / (rate * 10)).toBeLessThan(0.02);
  }, TIMEOUT);

  it('network model: a placed source adds its emission to its zone (sealed box: C·V = rate × t)', () => {
    const rate = 1200;
    const room = rectRoom(4, 3, 2.5, { objects: [incense({ emissionRateUgMin: rate })] });
    const net = simulateHouseNetwork([room], { infiltrationAch: 0, outdoorUgM3: 0 }, { depositionPerS: 0, durationS: 1800, dtS: 600, initialUgM3: 0 });
    // The network keeps a tiny envelope leak for solvability; with no wind or stack it carries no flow
    const z = net.zones[0]!;
    const last = z.series[z.series.length - 1]!;
    expect(Math.abs(last.c * z.volumeM3 - rate * 30) / (rate * 30)).toBeLessThan(0.02);
  });
});
