import type { GridInfo } from '../voxel/analysis';

/** Index of the cell containing (x, y, z), or −1 outside the grid. */
export function cellIndexAt(grid: GridInfo, x: number, y: number, z: number): number {
  const i = Math.floor((x - grid.origin[0]) / grid.dx);
  const j = Math.floor((y - grid.origin[1]) / grid.dx);
  const k = Math.floor((z - grid.origin[2]) / grid.dx);
  if (i < 0 || j < 0 || k < 0 || i >= grid.nx || j >= grid.ny || k >= grid.nz) return -1;
  return i + grid.nx * (j + grid.ny * k);
}

/** Lower corner cell and weights for trilinear interpolation between cell centres. */
function corner(grid: GridInfo, x: number, y: number, z: number) {
  const fx = Math.min(Math.max((x - grid.origin[0]) / grid.dx - 0.5, 0), grid.nx - 1);
  const fy = Math.min(Math.max((y - grid.origin[1]) / grid.dx - 0.5, 0), grid.ny - 1);
  const fz = Math.min(Math.max((z - grid.origin[2]) / grid.dx - 0.5, 0), grid.nz - 1);
  const i = Math.min(Math.floor(fx), Math.max(0, grid.nx - 2));
  const j = Math.min(Math.floor(fy), Math.max(0, grid.ny - 2));
  const k = Math.min(Math.floor(fz), Math.max(0, grid.nz - 2));
  return { i, j, k, tx: grid.nx > 1 ? fx - i : 0, ty: grid.ny > 1 ? fy - j : 0, tz: grid.nz > 1 ? fz - k : 0 };
}

/**
 * Trilinear sample of a cell-centred scalar field. NaN cells (solids) are left out and the
 * remaining weights renormalised; NaN if every neighbour is solid.
 */
export function sampleScalar(grid: GridInfo, field: ArrayLike<number>, x: number, y: number, z: number): number {
  const { i, j, k, tx, ty, tz } = corner(grid, x, y, z);
  let sum = 0;
  let wsum = 0;
  for (let c = 0; c < 8; c++) {
    const di = c & 1;
    const dj = (c >> 1) & 1;
    const dk = (c >> 2) & 1;
    const ii = Math.min(i + di, grid.nx - 1);
    const jj = Math.min(j + dj, grid.ny - 1);
    const kk = Math.min(k + dk, grid.nz - 1);
    const v = field[ii + grid.nx * (jj + grid.ny * kk)]!;
    if (!Number.isFinite(v)) continue;
    const w = (di ? tx : 1 - tx) * (dj ? ty : 1 - ty) * (dk ? tz : 1 - tz);
    sum += w * v;
    wsum += w;
  }
  return wsum > 1e-12 ? sum / wsum : NaN;
}

/** Trilinear sample of a cell-centred vector field (3 floats per cell); solids count as zero. */
export function sampleVector(grid: GridInfo, data: ArrayLike<number>, x: number, y: number, z: number, out: [number, number, number] = [0, 0, 0]): [number, number, number] {
  const { i, j, k, tx, ty, tz } = corner(grid, x, y, z);
  out[0] = 0;
  out[1] = 0;
  out[2] = 0;
  for (let c = 0; c < 8; c++) {
    const di = c & 1;
    const dj = (c >> 1) & 1;
    const dk = (c >> 2) & 1;
    const ii = Math.min(i + di, grid.nx - 1);
    const jj = Math.min(j + dj, grid.ny - 1);
    const kk = Math.min(k + dk, grid.nz - 1);
    const w = (di ? tx : 1 - tx) * (dj ? ty : 1 - ty) * (dk ? tz : 1 - tz);
    const base = 3 * (ii + grid.nx * (jj + grid.ny * kk));
    out[0] += w * data[base]!;
    out[1] += w * data[base + 1]!;
    out[2] += w * data[base + 2]!;
  }
  return out;
}
