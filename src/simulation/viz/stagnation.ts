import { STALE_HIGHLIGHT_NORMALISED_AGE } from '../constants';
import type { GridInfo } from '../voxel/analysis';
import { percentile } from './colormap';
import { pointInPolygon } from './layout';
import { horizontalSlice, marchingSquares } from './slice';

/** A stale-air zone to highlight: outline segments and label position in world XZ. */
export interface StaleZone {
  /** Label anchor (region cell nearest its centroid, so it is inside the zone) */
  anchor: [number, number];
  areaM2: number;
  meanAgeMinutes: number;
  meanNormalisedAge: number;
  /** Closed outline as world segments [x0, z0, x1, z1] */
  segments: [number, number, number, number][];
}

export interface StaleZoneOptions {
  /** Normalised age a cell must exceed (default STALE_HIGHLIGHT_NORMALISED_AGE) */
  threshold?: number;
  /** Share of the house's air (by area of the sampled layer) that counts as "worst" (default 0.2) */
  worstShare?: number;
  /** At most this many zones (default 3) */
  max?: number;
  /** Smaller patches are ignored (m², default 0.5) */
  minAreaM2?: number;
  /**
   * Room index of each slice cell (−1 outside every room). Zones never cross between rooms: thin
   * walls block faces, not cells, so the slice alone can't tell neighbouring rooms apart.
   */
  cellRoom?: Int32Array;
}

/**
 * The genuinely worst air of the house on the layer at height y: cells whose normalised age is
 * above the stagnant threshold AND in the oldest `worstShare` of the layer, grouped into
 * 4-connected zones, ranked by mean age, at most `max`. Empty when nothing qualifies.
 */
/** Room index of each cell of a horizontal slice (cell centres tested against the outlines). */
export function sliceCellRooms(grid: GridInfo, outlines: readonly (readonly (readonly [number, number])[])[]): Int32Array {
  const out = new Int32Array(grid.nx * grid.nz).fill(-1);
  for (let k = 0; k < grid.nz; k++)
    for (let i = 0; i < grid.nx; i++) {
      const p: [number, number] = [grid.origin[0] + (i + 0.5) * grid.dx, grid.origin[2] + (k + 0.5) * grid.dx];
      out[k * grid.nx + i] = outlines.findIndex((o) => o.length >= 3 && pointInPolygon(p, o));
    }
  return out;
}

export function pickStaleZones(grid: GridInfo, ageNormalised: ArrayLike<number>, ageMinutes: ArrayLike<number>, y: number, opts: StaleZoneOptions = {}): StaleZone[] {
  const { threshold = STALE_HIGHLIGHT_NORMALISED_AGE, worstShare = 0.2, max = 3, minAreaM2 = 0.5, cellRoom } = opts;
  const norm = horizontalSlice(grid, ageNormalised, y);
  const age = horizontalSlice(grid, ageMinutes, y);
  const { width, height, values } = norm;
  const cutoff = percentile(values, 1 - worstShare);
  if (!Number.isFinite(cutoff)) return [];
  const hot = (t: number) => values[t]! > threshold && values[t]! >= cutoff && (!cellRoom || cellRoom[t]! >= 0);
  const sameRoom = (a: number, b: number) => !cellRoom || cellRoom[a] === cellRoom[b];
  const cellArea = grid.dx * grid.dx;
  const minCells = Math.max(1, Math.ceil(minAreaM2 / cellArea));

  const seen = new Uint8Array(width * height);
  const zones: (StaleZone & { cells: number[] })[] = [];
  for (let s = 0; s < width * height; s++) {
    if (seen[s] || !hot(s)) continue;
    const cells: number[] = [];
    const stack = [s];
    seen[s] = 1;
    while (stack.length) {
      const t = stack.pop()!;
      cells.push(t);
      const c = t % width;
      const r = (t - c) / width;
      for (const nb of [c > 0 ? t - 1 : -1, c < width - 1 ? t + 1 : -1, r > 0 ? t - width : -1, r < height - 1 ? t + width : -1]) {
        if (nb >= 0 && !seen[nb] && hot(nb) && sameRoom(t, nb)) {
          seen[nb] = 1;
          stack.push(nb);
        }
      }
    }
    if (cells.length < minCells) continue;
    let sc = 0;
    let sr = 0;
    let sumAge = 0;
    let nAge = 0;
    let sumNorm = 0;
    for (const t of cells) {
      sc += (t % width) + 0.5;
      sr += Math.floor(t / width) + 0.5;
      sumNorm += values[t]!;
      const a = age.values[t]!;
      if (Number.isFinite(a)) {
        sumAge += a;
        nAge++;
      }
    }
    const cc = sc / cells.length;
    const cr = sr / cells.length;
    // Nearest member cell to the centroid keeps the label inside an L- or ring-shaped zone
    let best = cells[0]!;
    let bestD = Infinity;
    for (const t of cells) {
      const d = ((t % width) + 0.5 - cc) ** 2 + (Math.floor(t / width) + 0.5 - cr) ** 2;
      if (d < bestD) {
        bestD = d;
        best = t;
      }
    }
    zones.push({
      cells,
      anchor: [grid.origin[0] + ((best % width) + 0.5) * grid.dx, grid.origin[2] + (Math.floor(best / width) + 0.5) * grid.dx],
      areaM2: cells.length * cellArea,
      meanAgeMinutes: nAge > 0 ? sumAge / nAge : NaN,
      meanNormalisedAge: sumNorm / cells.length,
      segments: [],
    });
  }

  zones.sort((a, b) => b.meanNormalisedAge - a.meanNormalisedAge);
  return zones.slice(0, max).map(({ cells, ...z }) => {
    const mask = new Float32Array(width * height);
    for (const t of cells) mask[t] = 1;
    // Outline one cell inside the zone where it is wide enough, so it reads off the walls
    const inner = new Float32Array(width * height);
    let innerCells = 0;
    for (const t of cells) {
      const c = t % width;
      if (c > 0 && c < width - 1 && mask[t - 1] && mask[t + 1] && mask[t - width] && mask[t + width]) {
        inner[t] = 1;
        innerCells++;
      }
    }
    if (innerCells >= cells.length / 3) mask.set(inner);
    const segments = marchingSquares({ width, height, values: mask, layer: norm.layer }, 0.5).map(
      ([x0, r0, x1, r1]) => [grid.origin[0] + x0 * grid.dx, grid.origin[2] + r0 * grid.dx, grid.origin[0] + x1 * grid.dx, grid.origin[2] + r1 * grid.dx] as [number, number, number, number]
    );
    return { ...z, segments };
  });
}
