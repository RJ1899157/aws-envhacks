import type { VelocityField } from './flow';
import type { VoxelDomain } from './grid';

/** Grid description shared by every field in a voxel result. Cell (i, j, k) is index i + nx·(j + ny·k). */
export interface GridInfo {
  nx: number;
  ny: number;
  nz: number;
  dx: number;
  origin: [number, number, number];
}

export interface FieldStats {
  mean: number;
  min: number;
  max: number;
  p90: number;
  cells: number;
}

export interface Hotspot {
  /** Mean position of the cluster's cells, world [x, y, z] (m) */
  centroid: [number, number, number];
  /** Axis-aligned bounds of the cluster's cells, world (m) */
  boundsMin: [number, number, number];
  boundsMax: [number, number, number];
  volumeM3: number;
  cells: number;
  mean: number;
  max: number;
}

/** Cell-centred velocity (m/s), 3 floats per cell; zero in non-fluid cells. */
export function cellCentredVelocity(domain: VoxelDomain, field: VelocityField): Float32Array {
  const { nx, ny, nz, fluid } = domain;
  const out = new Float32Array(nx * ny * nz * 3);
  for (let k = 0; k < nz; k++)
    for (let j = 0; j < ny; j++)
      for (let i = 0; i < nx; i++) {
        const c = i + nx * (j + ny * k);
        if (!fluid[c]) continue;
        out[3 * c] = 0.5 * (field.u[i + (nx + 1) * (j + ny * k)]! + field.u[i + 1 + (nx + 1) * (j + ny * k)]!);
        out[3 * c + 1] = 0.5 * (field.v[i + nx * (j + (ny + 1) * k)]! + field.v[i + nx * (j + 1 + (ny + 1) * k)]!);
        out[3 * c + 2] = 0.5 * (field.w[i + nx * (j + ny * k)]! + field.w[i + nx * (j + ny * (k + 1))]!);
      }
  return out;
}

/** Block-averages a 3-component cell field over fluid cells by `factor` in each direction. */
export function downsampleVector(domain: VoxelDomain, data: Float32Array, factor: number): GridInfo & { factor: number; data: Float32Array } {
  const { nx, ny, nz, dx, origin, fluid } = domain;
  const mx = Math.ceil(nx / factor);
  const my = Math.ceil(ny / factor);
  const mz = Math.ceil(nz / factor);
  const out = new Float32Array(mx * my * mz * 3);
  const count = new Uint16Array(mx * my * mz);
  for (let k = 0; k < nz; k++)
    for (let j = 0; j < ny; j++)
      for (let i = 0; i < nx; i++) {
        const c = i + nx * (j + ny * k);
        if (!fluid[c]) continue;
        const d = Math.floor(i / factor) + mx * (Math.floor(j / factor) + my * Math.floor(k / factor));
        out[3 * d] = out[3 * d]! + data[3 * c]!;
        out[3 * d + 1] = out[3 * d + 1]! + data[3 * c + 1]!;
        out[3 * d + 2] = out[3 * d + 2]! + data[3 * c + 2]!;
        count[d] = count[d]! + 1;
      }
  for (let d = 0; d < count.length; d++) {
    if (count[d]! > 0) for (let a = 0; a < 3; a++) out[3 * d + a] = out[3 * d + a]! / count[d]!;
  }
  return { nx: mx, ny: my, nz: mz, dx: dx * factor, origin, factor, data: out };
}

/** Expands per-fluid-row values to a full grid field; non-fluid cells are NaN. */
export function toGridField(domain: VoxelDomain, cellOfRow: Int32Array, rows: Float64Array, scale = 1): Float32Array {
  const out = new Float32Array(domain.nx * domain.ny * domain.nz).fill(NaN);
  for (let r = 0; r < rows.length; r++) out[cellOfRow[r]!] = rows[r]! * scale;
  return out;
}

export function fieldStats(values: ArrayLike<number>): FieldStats {
  const v: number[] = [];
  for (let i = 0; i < values.length; i++) if (Number.isFinite(values[i]!)) v.push(values[i]!);
  if (v.length === 0) return { mean: NaN, min: NaN, max: NaN, p90: NaN, cells: 0 };
  v.sort((a, b) => a - b);
  const mean = v.reduce((s, x) => s + x, 0) / v.length;
  return { mean, min: v[0]!, max: v[v.length - 1]!, p90: v[Math.min(v.length - 1, Math.floor(0.9 * (v.length - 1)))]!, cells: v.length };
}

/** Values of fluid cells whose centres lie in the height band [y0, y1]. */
export function bandValues(grid: GridInfo, field: Float32Array, y0: number, y1: number): number[] {
  const { nx, ny, nz, dx, origin } = grid;
  const out: number[] = [];
  for (let j = 0; j < ny; j++) {
    const y = origin[1] + (j + 0.5) * dx;
    if (y < y0 || y > y1) continue;
    for (let k = 0; k < nz; k++)
      for (let i = 0; i < nx; i++) {
        const val = field[i + nx * (j + ny * k)]!;
        if (Number.isFinite(val)) out.push(val);
      }
  }
  return out;
}

/** 6-connected clusters of fluid cells above `threshold`, largest first. */
export function findHotspots(grid: GridInfo, field: Float32Array, threshold: number, minVolumeM3: number, limit = 10): Hotspot[] {
  const { nx, ny, nz, dx, origin } = grid;
  const n = nx * ny * nz;
  const seen = new Uint8Array(n);
  const clusters: Hotspot[] = [];
  const cellVol = dx * dx * dx;
  for (let start = 0; start < n; start++) {
    if (seen[start] || !(field[start]! > threshold)) continue;
    const stack = [start];
    seen[start] = 1;
    let count = 0;
    let sx = 0;
    let sy = 0;
    let sz = 0;
    let sum = 0;
    let max = -Infinity;
    const lo = [Infinity, Infinity, Infinity];
    const hi = [-Infinity, -Infinity, -Infinity];
    while (stack.length) {
      const c = stack.pop()!;
      const i = c % nx;
      const j = Math.floor(c / nx) % ny;
      const k = Math.floor(c / (nx * ny));
      count++;
      lo[0] = Math.min(lo[0]!, i);
      lo[1] = Math.min(lo[1]!, j);
      lo[2] = Math.min(lo[2]!, k);
      hi[0] = Math.max(hi[0]!, i);
      hi[1] = Math.max(hi[1]!, j);
      hi[2] = Math.max(hi[2]!, k);
      sx += i;
      sy += j;
      sz += k;
      sum += field[c]!;
      max = Math.max(max, field[c]!);
      const nbs = [
        i > 0 ? c - 1 : -1,
        i < nx - 1 ? c + 1 : -1,
        j > 0 ? c - nx : -1,
        j < ny - 1 ? c + nx : -1,
        k > 0 ? c - nx * ny : -1,
        k < nz - 1 ? c + nx * ny : -1,
      ];
      for (const nb of nbs) {
        if (nb >= 0 && !seen[nb] && field[nb]! > threshold) {
          seen[nb] = 1;
          stack.push(nb);
        }
      }
    }
    const volumeM3 = count * cellVol;
    if (volumeM3 + 1e-12 < minVolumeM3) continue;
    clusters.push({
      centroid: [origin[0] + (sx / count + 0.5) * dx, origin[1] + (sy / count + 0.5) * dx, origin[2] + (sz / count + 0.5) * dx],
      boundsMin: [origin[0] + lo[0]! * dx, origin[1] + lo[1]! * dx, origin[2] + lo[2]! * dx],
      boundsMax: [origin[0] + (hi[0]! + 1) * dx, origin[1] + (hi[1]! + 1) * dx, origin[2] + (hi[2]! + 1) * dx],
      volumeM3,
      cells: count,
      mean: sum / count,
      max,
    });
  }
  return clusters.sort((a, b) => b.volumeM3 - a.volumeM3).slice(0, limit);
}

const RAMP = ' .:-=+*#%@';

/**
 * ASCII map of the horizontal slice through height y, north (−Z) up and east (+X) right, as in the
 * plan view. Fluid cells map linearly from `lo` (' ') to `hi` ('@'); solid cells print '▓'.
 */
export function asciiSlice(grid: GridInfo, field: Float32Array, y: number, lo: number, hi: number): string[] {
  const { nx, ny, nz, dx, origin } = grid;
  const j = Math.min(ny - 1, Math.max(0, Math.floor((y - origin[1]) / dx)));
  const lines: string[] = [];
  for (let k = 0; k < nz; k++) {
    let line = '';
    for (let i = 0; i < nx; i++) {
      const v = field[i + nx * (j + ny * k)]!;
      if (!Number.isFinite(v)) {
        line += '▓';
        continue;
      }
      const t = hi > lo ? (v - lo) / (hi - lo) : 0;
      line += RAMP[Math.max(0, Math.min(RAMP.length - 1, Math.round(t * (RAMP.length - 1))))];
    }
    lines.push(line);
  }
  return lines;
}
