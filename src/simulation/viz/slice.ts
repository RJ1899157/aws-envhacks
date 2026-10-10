import type { GridInfo } from '../voxel/analysis';
import { mapValue, type ColorScale } from './colormap';

/** A 2D slice of a cell field; `values[row * width + col]`, NaN where solid. */
export interface FieldSlice {
  width: number;
  height: number;
  values: Float32Array;
  /** Grid index of the sliced layer */
  layer: number;
}

const clampIndex = (v: number, n: number) => Math.min(n - 1, Math.max(0, v));

/**
 * Horizontal slice through height y: width nx (columns = +x), height nz (rows = +z, i.e. row 0 is
 * the northernmost row).
 */
export function horizontalSlice(grid: GridInfo, field: ArrayLike<number>, y: number): FieldSlice {
  const { nx, ny, nz, dx, origin } = grid;
  const j = clampIndex(Math.floor((y - origin[1]) / dx), ny);
  const values = new Float32Array(nx * nz);
  for (let k = 0; k < nz; k++) for (let i = 0; i < nx; i++) values[k * nx + i] = field[i + nx * (j + ny * k)]!;
  return { width: nx, height: nz, values, layer: j };
}

/**
 * Vertical slice: axis 'z' cuts at z = pos (columns = +x, rows = +y from the floor); axis 'x' cuts
 * at x = pos (columns = +z, rows = +y).
 */
export function verticalSlice(grid: GridInfo, field: ArrayLike<number>, axis: 'x' | 'z', pos: number): FieldSlice {
  const { nx, ny, nz, dx, origin } = grid;
  if (axis === 'z') {
    const k = clampIndex(Math.floor((pos - origin[2]) / dx), nz);
    const values = new Float32Array(nx * ny);
    for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) values[j * nx + i] = field[i + nx * (j + ny * k)]!;
    return { width: nx, height: ny, values, layer: k };
  }
  const i = clampIndex(Math.floor((pos - origin[0]) / dx), nx);
  const values = new Float32Array(nz * ny);
  for (let j = 0; j < ny; j++) for (let k = 0; k < nz; k++) values[j * nz + k] = field[i + nx * (j + ny * k)]!;
  return { width: nz, height: ny, values, layer: i };
}

/** |u| per cell from a cell-centred velocity field; NaN outside fluid. */
export function speedField(velocity: ArrayLike<number>, fluid: ArrayLike<number>): Float32Array {
  const out = new Float32Array(fluid.length);
  for (let c = 0; c < fluid.length; c++) {
    out[c] = fluid[c] ? Math.hypot(velocity[3 * c]!, velocity[3 * c + 1]!, velocity[3 * c + 2]!) : NaN;
  }
  return out;
}

/**
 * RGBA bytes for a slice. Transparent texels (solids, outdoors) take the colour of their nearest
 * valid neighbour (alpha stays 0), so bilinear filtering blends edges without dark fringes.
 * `flipRows` writes the last slice row first (texture v = 0 at the bottom).
 */
export function sliceToRGBA(slice: FieldSlice, scale: ColorScale, alpha = 180, flipRows = false): Uint8Array<ArrayBuffer> {
  const { width, height, values } = slice;
  const out = new Uint8Array(width * height * 4);
  const rgba: [number, number, number, number] = [0, 0, 0, 0];
  const filled = new Uint8Array(width * height);
  for (let r = 0; r < height; r++) {
    const src = flipRows ? height - 1 - r : r;
    for (let c = 0; c < width; c++) {
      mapValue(scale, values[src * width + c]!, alpha, rgba);
      out.set(rgba, (r * width + c) * 4);
      if (rgba[3] > 0) filled[r * width + c] = 1;
    }
  }
  // Two passes of colour bleeding into transparent texels
  for (let pass = 0; pass < 2; pass++) {
    const next = Uint8Array.from(filled);
    for (let r = 0; r < height; r++)
      for (let c = 0; c < width; c++) {
        const t = r * width + c;
        if (filled[t]) continue;
        for (const [dr, dc] of [[0, 1], [0, -1], [1, 0], [-1, 0]] as const) {
          const rr = r + dr;
          const cc = c + dc;
          if (rr < 0 || cc < 0 || rr >= height || cc >= width || !filled[rr * width + cc]) continue;
          const s = (rr * width + cc) * 4;
          out[t * 4] = out[s]!;
          out[t * 4 + 1] = out[s + 1]!;
          out[t * 4 + 2] = out[s + 2]!;
          next[t] = 1;
          break;
        }
      }
    filled.set(next);
  }
  return out;
}

/** A line segment in slice coordinates (column, row; cell centres at integer + 0.5). */
export type Segment = [number, number, number, number];

/**
 * Marching squares on cell-centred slice values: segments of the iso-line at `level`. By default
 * NaN cells count as below the level, so contours close along walls (region outlines); with
 * `skipNaN` squares touching a NaN cell are skipped, so iso-lines of a field stop at walls instead
 * of tracing them.
 */
export function marchingSquares(slice: FieldSlice, level: number, skipNaN = false): Segment[] {
  const { width, height, values } = slice;
  const v = (c: number, r: number) => {
    const x = values[r * width + c]!;
    return Number.isFinite(x) ? x : skipNaN ? NaN : -Infinity;
  };
  const segs: Segment[] = [];
  const lerpT = (a: number, b: number) => (Number.isFinite(a) && Number.isFinite(b) && b !== a ? (level - a) / (b - a) : 0.5);
  for (let r = 0; r < height - 1; r++)
    for (let c = 0; c < width - 1; c++) {
      const a = v(c, r); // top-left
      const b = v(c + 1, r); // top-right
      const d = v(c, r + 1); // bottom-left
      const e = v(c + 1, r + 1); // bottom-right
      if (skipNaN && (Number.isNaN(a) || Number.isNaN(b) || Number.isNaN(d) || Number.isNaN(e))) continue;
      const idx = (a > level ? 8 : 0) | (b > level ? 4 : 0) | (e > level ? 2 : 0) | (d > level ? 1 : 0);
      if (idx === 0 || idx === 15) continue;
      const x0 = c + 0.5;
      const y0 = r + 0.5;
      const top: [number, number] = [x0 + lerpT(a, b), y0];
      const right: [number, number] = [x0 + 1, y0 + lerpT(b, e)];
      const bottom: [number, number] = [x0 + lerpT(d, e), y0 + 1];
      const left: [number, number] = [x0, y0 + lerpT(a, d)];
      const add = (p: [number, number], q: [number, number]) => segs.push([p[0], p[1], q[0], q[1]]);
      switch (idx) {
        case 1: case 14: add(left, bottom); break;
        case 2: case 13: add(bottom, right); break;
        case 3: case 12: add(left, right); break;
        case 4: case 11: add(top, right); break;
        case 6: case 9: add(top, bottom); break;
        case 7: case 8: add(left, top); break;
        case 5: add(left, top); add(bottom, right); break;
        case 10: add(top, right); add(left, bottom); break;
      }
    }
  return segs;
}

export interface SliceRegion {
  /** Cell count and centroid (column, row) */
  cells: number;
  centroid: [number, number];
  /** Mean of `labelValues` over the region */
  meanLabel: number;
}

/** 4-connected regions of slice cells above `level`, largest first; mean of `labelValues` per region. */
export function sliceRegions(slice: FieldSlice, level: number, labelValues: ArrayLike<number>, minCells = 1): SliceRegion[] {
  const { width, height, values } = slice;
  const seen = new Uint8Array(width * height);
  const out: SliceRegion[] = [];
  for (let s = 0; s < width * height; s++) {
    if (seen[s] || !(values[s]! > level)) continue;
    const stack = [s];
    seen[s] = 1;
    let n = 0;
    let sc = 0;
    let sr = 0;
    let sum = 0;
    let cnt = 0;
    while (stack.length) {
      const t = stack.pop()!;
      const c = t % width;
      const r = Math.floor(t / width);
      n++;
      sc += c + 0.5;
      sr += r + 0.5;
      const lv = labelValues[t]!;
      if (Number.isFinite(lv)) {
        sum += lv;
        cnt++;
      }
      for (const nb of [c > 0 ? t - 1 : -1, c < width - 1 ? t + 1 : -1, r > 0 ? t - width : -1, r < height - 1 ? t + width : -1]) {
        if (nb >= 0 && !seen[nb] && values[nb]! > level) {
          seen[nb] = 1;
          stack.push(nb);
        }
      }
    }
    if (n >= minCells) out.push({ cells: n, centroid: [sc / n, sr / n], meanLabel: cnt > 0 ? sum / cnt : NaN });
  }
  return out.sort((a, b) => b.cells - a.cells);
}
