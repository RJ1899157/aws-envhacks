import { describe, expect, it } from 'vitest';
import { createBedroomSample, createStudioSample } from '../../core/samples';
import { device, opening, rectRoom } from '../../test/simulationFixtures';
import { devicesIn } from '../devices';
import type { GridInfo } from '../voxel/analysis';
import { createDemoScenario, createStandinHouse } from '../house/demoHouse';
import { simulateHouseNetwork } from '../house/network';
import {
  AQI_BAND_RANGES,
  AQI_BOUNDARIES,
  AQI_PM25_BANDS,
  AQI_SCALE_MAX,
  aqiBand,
  aqiColor,
  fieldDomain,
  hexToRgb,
  mapValue,
  motionTimeScale,
  isLogScale,
  pm25Band,
  rampCss,
  scalePosition,
  STATUS_COLORS,
  VIRIDIS,
  viridis,
  YLORRD,
  type ColorScale,
} from './colormap';
import { explainRoom } from './explain';
import { cellIndexAt, sampleScalar, sampleVector } from './sampling';
import { fillSolids, horizontalSlice, marchingSquares, sliceRegions, sliceToRGBA, speedField, verticalSlice } from './slice';
import { isResultStale, simulationInputKey } from './staleness';

/** 3 × 2 × 4 grid at 1 m, origin (10, 0, 20); value = i + 10·j + 100·k. */
const grid: GridInfo = { nx: 3, ny: 2, nz: 4, dx: 1, origin: [10, 0, 20] };
const n = 3 * 2 * 4;
const field = Float32Array.from({ length: n }, (_, c) => (c % 3) + 10 * (Math.floor(c / 3) % 2) + 100 * Math.floor(c / 6));

describe('colour mapping', () => {
  const pm: ColorScale = { field: 'pm25', domain: [0, 0] };

  it('puts PM2.5 on the absolute Indian AQI bands (green → yellow → orange → red → purple → maroon)', () => {
    expect(AQI_PM25_BANDS.map((b) => b.label)).toEqual(['Good', 'Satisfactory', 'Moderate', 'Poor', 'Very poor', 'Severe']);
    expect(AQI_PM25_BANDS.map((b) => b.max)).toEqual([30, 60, 90, 120, 250, Infinity]);
    // Each band keeps its hue: the band colour lies on the gradient between its two ends
    const dist = (a: number[], b: number[]) => Math.hypot(a[0]! - b[0]!, a[1]! - b[1]!, a[2]! - b[2]!);
    AQI_BAND_RANGES.forEach(([lo, hi], i) => {
      const mid = aqiColor((lo + hi) / 2);
      const own = dist(mid, hexToRgb(AQI_PM25_BANDS[i]!.color));
      for (const [j, other] of AQI_PM25_BANDS.entries()) if (j !== i) expect(own).toBeLessThan(dist(mid, hexToRgb(other.color)));
    });
    // A continuous gradient inside a band (20 and 28 differ; lighter at the low end) …
    expect(dist(aqiColor(20), aqiColor(28))).toBeGreaterThan(15);
    const lum = (c: number[]) => 0.2126 * c[0]! + 0.7152 * c[1]! + 0.0722 * c[2]!;
    expect(lum(aqiColor(0))).toBeGreaterThan(lum(aqiColor(29)));
    // … and a visible step at each band boundary
    for (const b of AQI_BOUNDARIES) expect(dist(aqiColor(b), aqiColor(b + 0.5))).toBeGreaterThan(40);
    expect(aqiColor(1000)).toEqual(aqiColor(AQI_SCALE_MAX));
    expect(aqiBand(61).label).toBe('Moderate');
    expect(aqiBand(400).label).toBe('Severe');
    // The scale is absolute: the same value maps to the same colour whatever the field holds
    expect(fieldDomain('pm25', [1, 2, 3], true)).toEqual([0, AQI_SCALE_MAX]);
    expect(mapValue(pm, 45, 200)).toEqual([...aqiColor(45), 200]);
    // Relative: YlOrRd stretched over the domain, never the AQI hues
    const rel = { field: 'pm25' as const, domain: [40, 240] as [number, number], relative: true };
    expect(mapValue(rel, 40).slice(0, 3)).toEqual(hexToRgb(YLORRD[0]!));
    expect(mapValue(rel, 240).slice(0, 3)).toEqual(hexToRgb(YLORRD[YLORRD.length - 1]!));
    expect(rampCss('pm25-relative')).toContain(YLORRD[0]!);
  });

  it('uses viridis for age and speed, with auto contrast stretching to the field', () => {
    expect(viridis(0)).toEqual(hexToRgb(VIRIDIS[0]!));
    expect(viridis(1)).toEqual(hexToRgb(VIRIDIS[VIRIDIS.length - 1]!));
    expect(viridis(-1)).toEqual(viridis(0));
    const ages = Array.from({ length: 101 }, (_, i) => 10 + i * 0.05); // 10–15 min
    expect(fieldDomain('age', ages, false)).toEqual([0, 120]);
    const [lo, hi] = fieldDomain('age', ages, true);
    expect(lo).toBeCloseTo(10.1, 1);
    expect(hi).toBeCloseTo(14.9, 1);
    // With auto contrast a 10 → 15 min gradient spans (almost) the whole ramp
    const scale: ColorScale = { field: 'age', domain: [lo, hi] };
    expect(mapValue(scale, 10).slice(0, 3)).toEqual(viridis(0));
    expect(mapValue(scale, 15).slice(0, 3)).toEqual(viridis(1));
  });

  it('maps age on a log scale when it spans more than a decade', () => {
    expect(isLogScale('age', [2, 119])).toBe(true);
    expect(isLogScale('age', [2, 8])).toBe(false);
    expect(isLogScale('speed', [0.01, 1])).toBe(false);
    const scale: ColorScale = { field: 'age', domain: [2, 200], log: true };
    // 20 min is a decade above 2 and a decade below 200: the middle of the ramp
    expect(scalePosition(scale, 20)).toBeCloseTo(0.5);
    expect(mapValue(scale, 20).slice(0, 3)).toEqual(viridis(0.5));
    // A living room's 2 → 8 min spread covers 30 % of the ramp instead of 3 %
    expect(scalePosition(scale, 8) - scalePosition(scale, 2)).toBeGreaterThan(0.29);
  });

  it('is monotonic in lightness along viridis', () => {
    const lum = (t: number) => {
      const [r, g, b] = viridis(t);
      return 0.2126 * r + 0.7152 * g + 0.0722 * b;
    };
    for (let t = 0.05; t <= 1; t += 0.05) expect(lum(t)).toBeGreaterThanOrEqual(lum(t - 0.05) - 1);
  });

  it('makes solids (NaN) fully transparent', () => {
    expect(mapValue(pm, NaN)).toEqual([0, 0, 0, 0]);
  });

  it('bands PM2.5 cards against WHO 15 and NAAQS 60', () => {
    expect(pm25Band(12).level).toBe('good');
    expect(pm25Band(40)).toMatchObject({ level: 'warning', color: STATUS_COLORS.warning });
    expect(pm25Band(61).level).toBe('critical');
  });
});

describe('field sampling', () => {
  it('returns the cell value at a cell centre and interpolates linearly between centres', () => {
    expect(sampleScalar(grid, field, 10.5, 0.5, 20.5)).toBeCloseTo(0);
    expect(sampleScalar(grid, field, 11.5, 1.5, 22.5)).toBeCloseTo(1 + 10 + 200);
    expect(sampleScalar(grid, field, 11.0, 0.5, 20.5)).toBeCloseTo(0.5);
    expect(sampleScalar(grid, field, 10.5, 1.0, 21.0)).toBeCloseTo(5 + 50);
  });

  it('skips NaN neighbours and returns NaN only when every neighbour is solid', () => {
    const f = Float32Array.from(field);
    f[1] = NaN;
    expect(sampleScalar(grid, f, 11.0, 0.5, 20.5)).toBeCloseTo(0);
    expect(sampleScalar(grid, new Float32Array(n).fill(NaN), 11, 1, 21)).toBeNaN();
  });

  it('interpolates vectors and locates cells', () => {
    const vel = new Float32Array(3 * n);
    for (let c = 0; c < n; c++) vel[3 * c] = c % 3; // u = i
    expect(sampleVector(grid, vel, 11.0, 0.5, 20.5)[0]).toBeCloseTo(0.5);
    expect(cellIndexAt(grid, 12.9, 1.9, 23.9)).toBe(n - 1);
    expect(cellIndexAt(grid, 9.9, 0.5, 20.5)).toBe(-1);
  });
});

describe('slice extraction', () => {
  it('extracts a horizontal layer with rows north → south', () => {
    const s = horizontalSlice(grid, field, 1.2);
    expect([s.width, s.height, s.layer]).toEqual([3, 4, 1]);
    expect(s.values[0]).toBe(10); // i 0, k 0
    expect(s.values[3 * 3 + 2]).toBe(2 + 10 + 300); // i 2, k 3
  });

  it('extracts vertical cuts along either axis', () => {
    const z = verticalSlice(grid, field, 'z', 22.5);
    expect([z.width, z.height, z.layer]).toEqual([3, 2, 2]);
    expect(z.values[1 * 3 + 1]).toBe(1 + 10 + 200);
    const x = verticalSlice(grid, field, 'x', 12.2);
    expect([x.width, x.height, x.layer]).toEqual([4, 2, 2]);
    expect(x.values[0 * 4 + 3]).toBe(2 + 300);
  });

  it('converts slices to RGBA with transparent solids, bleeding colour into them for bilinear filtering', () => {
    const s = horizontalSlice(grid, Float32Array.from(field, (v, i) => (i === 0 ? NaN : v)), 0.5);
    const scale: ColorScale = { field: 'pm25', domain: [0, 0] };
    const rgba = sliceToRGBA(s, scale, 255);
    expect(rgba[3]).toBe(0); // first cell solid
    expect(Array.from(rgba.slice(0, 3))).toEqual(Array.from(rgba.slice(4, 7))); // takes its neighbour's colour
    expect(rgba[7]).toBe(255);
    const flipped = sliceToRGBA(s, scale, 255, true);
    expect(flipped[3 * 3 * 4 + 3]).toBe(0); // solid cell moved to the last row
  });

  it('traces iso-lines with marching squares and finds connected regions', () => {
    // 4 × 4 slice with a 2 × 2 block of high values in the middle
    const values = new Float32Array(16).fill(0);
    for (const i of [5, 6, 9, 10]) values[i] = 2;
    const slice = { width: 4, height: 4, values, layer: 0 };
    const segs = marchingSquares(slice, 1);
    expect(segs.length).toBeGreaterThanOrEqual(8);
    // Every segment endpoint lies halfway between a low and a high cell centre (level 1 of 0 → 2)
    for (const [x0, y0] of segs) {
      expect([1, 1.5, 2, 2.5, 3]).toContain(x0);
      expect([1, 1.5, 2, 2.5, 3]).toContain(y0);
    }
    const regions = sliceRegions(slice, 1, new Float32Array(16).fill(7));
    expect(regions).toHaveLength(1);
    expect(regions[0]).toMatchObject({ cells: 4, centroid: [2, 2], meanLabel: 7 });
  });

  it('computes speed with NaN outside fluid', () => {
    const sp = speedField([3, 4, 0, 1, 1, 1], [1, 0]);
    expect(sp[0]).toBeCloseTo(5);
    expect(sp[1]).toBeNaN();
  });
});

describe('stale-result detection', () => {
  const settings = { durationS: 4 * 3600, resolution: 'live' as const };
  const room = createBedroomSample();
  const key = simulationInputKey(room, [], settings);

  it('ignores cosmetic edits', () => {
    const recoloured = { ...room, name: 'Renamed', floorMaterial: 'tile', objects: room.objects.map((o) => ({ ...o, color: '#000000', isLocked: true })) };
    expect(simulationInputKey(recoloured, [], settings)).toBe(key);
    expect(isResultStale(key, simulationInputKey(recoloured, [], settings))).toBe(false);
  });

  it('flags design, input and setting changes', () => {
    const moved = { ...room, objects: room.objects.map((o, i) => (i === 0 ? { ...o, position: [o.position[0] + 0.5, 0, o.position[2]] as [number, number, number] } : o)) };
    const opened = { ...room, openings: room.openings.map((o, i) => (i === 0 ? { ...o, openFraction: 0.2 } : o)) };
    const smoggier = { ...room, params: { ...room.params, outdoorPm25: { valueUgM3: 300, source: 'manual' as const } } };
    for (const changed of [moved, opened, smoggier]) expect(isResultStale(key, simulationInputKey(changed, [], settings))).toBe(true);
    expect(isResultStale(key, simulationInputKey(room, [], { ...settings, resolution: 'full' }))).toBe(true);
    expect(isResultStale(key, simulationInputKey(room, [createStudioSample()], settings))).toBe(true);
    expect(isResultStale(null, key)).toBe(false); // nothing to be stale yet
  });
});

describe('plain-language explanation', () => {
  it('says the room tracks outdoor air when the windows are wide open', () => {
    const room = rectRoom(4, 3, 2.5, { openings: [opening('a', 0), opening('b', 2)] });
    const net = simulateHouseNetwork([room], { outdoorUgM3: 150, exposure: 'open', windSpeed: 3 });
    expect(explainRoom(net, 0, devicesIn(room.objects))).toMatch(/near outdoor levels/);
  });

  it('credits the purifier when the room is closed', () => {
    const room = rectRoom(4, 3, 2.5, { objects: [device('p', 'air-purifier', { cadrM3h: 300 })] });
    const net = simulateHouseNetwork([room], { outdoorUgM3: 150 });
    expect(explainRoom(net, 0, devicesIn(room.objects))).toMatch(/purifier keeps this room/);
  });

  it('names the room PM2.5 drifts in from', () => {
    const rooms = createDemoScenario(createStandinHouse(createBedroomSample()));
    const net = simulateHouseNetwork(rooms);
    const living = net.zones.findIndex((z) => z.name === 'Living Room');
    expect(explainRoom(net, living, devicesIn(rooms[living]!.objects))).toMatch(/drifts in from the Kitchen/);
    const kitchen = net.zones.findIndex((z) => z.name === 'Kitchen');
    expect(explainRoom(net, kitchen, devicesIn(rooms[kitchen]!.objects))).toMatch(/frying/i);
  });
});

describe('smooth heatmap slices', () => {
  const slice = (width: number, height: number, vals: number[]) => ({ width, height, values: Float32Array.from(vals), layer: 0 });

  it('fills solid (NaN) cells from the surrounding air', () => {
    const filled = fillSolids(slice(3, 3, [1, 1, 1, 1, NaN, 1, 1, 1, 1]));
    expect(filled.values[4]).toBeCloseTo(1);
    const deep = fillSolids(slice(5, 1, [2, NaN, NaN, NaN, 4]));
    expect([...deep.values].every((v) => !Number.isNaN(v))).toBe(true);
  });

});

describe('flow animation speed', () => {
  it('keeps gentle draughts sped up but caps fan jets, never below real time', () => {
    expect(motionTimeScale(0.3, 20)).toBe(20); // window draught: 0.3 × 20 = 6 m/s on screen
    expect(motionTimeScale(1.8, 20)).toBeCloseTo(6 / 1.8); // pedestal fan: ~3.3×
    expect(motionTimeScale(8, 20)).toBe(1); // very fast: real time, not slower
    expect(motionTimeScale(0, 20)).toBe(20);
  });
});
