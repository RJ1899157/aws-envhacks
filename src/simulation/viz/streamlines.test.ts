import { describe, expect, it } from 'vitest';
import type { GridInfo } from '../voxel/analysis';
import { computeStreamlines, joinTraces, traceStreamline, type FaceVelocities } from './streamlines';

/** n × 1 × n grid of 0.2 m cells, all fluid, with face velocities from a function of the face centre. */
function field(n: number, f: (axis: 0 | 2, x: number, z: number) => number, ny = 1) {
  const dx = 0.2;
  const grid: GridInfo = { nx: n, ny, nz: n, dx, origin: [0, 0, 0] };
  const u = new Float64Array((n + 1) * ny * n);
  const v = new Float64Array(n * (ny + 1) * n);
  const w = new Float64Array(n * ny * (n + 1));
  for (let k = 0; k < n; k++) for (let j = 0; j < ny; j++) for (let i = 0; i <= n; i++) u[i + (n + 1) * (j + ny * k)] = f(0, i * dx, (k + 0.5) * dx);
  for (let k = 0; k <= n; k++) for (let j = 0; j < ny; j++) for (let i = 0; i < n; i++) w[i + n * (j + ny * k)] = f(2, (i + 0.5) * dx, k * dx);
  const fluid = new Uint8Array(n * ny * n).fill(1);
  return { grid, faces: { u, v, w } as FaceVelocities, fluid };
}

describe('streamline integration (Pollock)', () => {
  it('follows a uniform flow in a straight line at the right speed, ending where it leaves the fluid', () => {
    const { grid, faces, fluid } = field(10, (axis) => (axis === 0 ? 0.5 : 0));
    const s = traceStreamline(grid, fluid, faces, [0.3, 0.1, 0.9])!;
    const n = s.times.length;
    for (let p = 0; p < n; p++) {
      expect(s.points[3 * p + 2]).toBeCloseTo(0.9, 6);
      expect(s.speeds[p]).toBeCloseTo(0.5, 6);
      // x(t) = x0 + 0.5 t
      expect(s.points[3 * p]!).toBeCloseTo(0.3 + 0.5 * s.times[p]!, 6);
    }
    expect(s.points[3 * (n - 1)]).toBeCloseTo(2.0, 6); // the domain's east edge
    expect(s.times[n - 1]).toBeCloseTo(1.7 / 0.5, 6);
  });

  it('traces upstream with negative times and joins both halves through the seed', () => {
    const { grid, faces, fluid } = field(10, (axis) => (axis === 0 ? 0.5 : 0));
    const seed: [number, number, number] = [1.0, 0.1, 1.0];
    const back = traceStreamline(grid, fluid, faces, seed, { direction: -1 })!;
    expect(back.points[3 * (back.times.length - 1)]).toBeCloseTo(0, 6);
    expect(back.times[back.times.length - 1]).toBeCloseTo(-2, 6);
    const line = joinTraces(back, traceStreamline(grid, fluid, faces, seed))!;
    for (let p = 1; p < line.times.length; p++) {
      expect(line.times[p]!).toBeGreaterThan(line.times[p - 1]!);
      expect(line.points[3 * p]!).toBeGreaterThan(line.points[3 * (p - 1)]!);
    }
  });

  it('keeps the radius of a solid-body rotation (divergence-free) within 3 % over a revolution', () => {
    const c = 1.0;
    const omega = 0.5; // rad/s
    const { grid, faces, fluid } = field(10, (axis, x, z) => (axis === 0 ? -omega * (z - c) : omega * (x - c)));
    const r0 = 0.6;
    const s = traceStreamline(grid, fluid, faces, [c + r0, 0.1, c], { maxTimeS: (1.2 * 2 * Math.PI) / omega, maxLengthM: 100, pointsPerCell: 4 })!;
    let worst = 0;
    for (let p = 0; p < s.times.length; p++) worst = Math.max(worst, Math.abs(Math.hypot(s.points[3 * p]! - c, s.points[3 * p + 2]! - c) - r0) / r0);
    expect(worst).toBeLessThan(0.03);
    // The path closes: after half a turn it passes back within 2 cm of the seed (the discrete
    // field's period differs a little from 2π/ω, so compare positions, not times)
    let closest = Infinity;
    for (let p = 0; p < s.times.length; p++) if (s.times[p]! > Math.PI / omega) closest = Math.min(closest, Math.hypot(s.points[3 * p]! - (c + r0), s.points[3 * p + 2]! - c));
    expect(closest).toBeLessThan(0.02);
  });

  it('never crosses a closed face: air heading into a wall stops in front of it', () => {
    const wallX = 1.0;
    // Flow towards +x that slows to zero at a closed face at x = 1.0 (a wall); faces beyond are 0
    const { grid, faces, fluid } = field(10, (axis, x) => (axis === 0 ? (x < wallX ? 0.5 * (wallX - x) : 0) : 0));
    const s = traceStreamline(grid, fluid, faces, [0.1, 0.1, 1.0], { maxTimeS: 600 })!;
    for (let p = 0; p < s.times.length; p++) expect(s.points[3 * p]!).toBeLessThanOrEqual(wallX);
    // It creeps up to the wall and stops there
    expect(s.points[3 * (s.times.length - 1)]!).toBeGreaterThan(wallX - 0.05);
  });

  it('seeds an even grid per room and skips columns an earlier line already covered', () => {
    const { grid, faces, fluid } = field(20, (axis) => (axis === 0 ? 0.3 : 0));
    const zoneOf = new Int16Array(fluid.length);
    const lines = computeStreamlines({ ...grid, fluid, zoneOf }, faces, new Float32Array(), { spacingM: 0.6, heightsM: [0.1] });
    // Uniform x-flow: one line per row of seed columns, each crossing the whole domain
    expect(lines.length).toBe(Math.ceil(20 / 3));
    for (const l of lines) expect(l.points[3 * (l.times.length - 1)]! - l.points[0]!).toBeCloseTo(4, 5);
  });
});
