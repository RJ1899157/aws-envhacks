import type { GridInfo } from '../voxel/analysis';

/**
 * Streamlines through the solver's MAC (face) velocities with Pollock's semi-analytic method, as
 * used for particle tracking in groundwater codes (Pollock, Ground Water 26 (1988) 743): inside a
 * cell each velocity component varies linearly between its two faces, so the path and the time to
 * reach each face have closed forms. The traced path follows the discrete divergence-free field
 * exactly, and a closed face (velocity 0) can never be crossed: lines stop at walls, leave the house
 * through open windows, and pass between rooms only where an opening (or undercut) carries flow.
 */

export interface FaceVelocities {
  /** x-normal faces, (nx+1)·ny·nz, index i + (nx+1)·(j + ny·k) */
  u: ArrayLike<number>;
  /** y-normal faces, nx·(ny+1)·nz, index i + nx·(j + (ny+1)·k) */
  v: ArrayLike<number>;
  /** z-normal faces, nx·ny·(nz+1), index i + nx·(j + ny·k) */
  w: ArrayLike<number>;
}

export interface Streamline {
  /** xyz per point (m) */
  points: Float32Array;
  /** Travel time from the seed (s); negative upstream of it for two-way traces */
  times: Float32Array;
  /** Air speed at each point (m/s) */
  speeds: Float32Array;
}

export interface TraceOptions {
  /** +1 downstream, −1 upstream */
  direction?: 1 | -1;
  /** Stop after this much travel time (s) */
  maxTimeS?: number;
  /** Stop after this path length (m) */
  maxLengthM?: number;
  /** Stop once the speed stays below this (m/s) */
  minSpeed?: number;
  /** Points recorded per cell crossed (≥ 1) */
  pointsPerCell?: number;
  maxCells?: number;
}

const EPS = 1e-9;

/** Time to reach the face at `x1` from velocity vp along an axis with v(x) = v0 + A·(x − x0); Infinity if never. */
function exitTime(vp: number, vFace: number, A: number, xp: number, xFace: number): number {
  // Already on the face it is moving towards (a seed or an exit point on a cell boundary)
  if (Math.abs(xFace - xp) < 1e-12 && Math.abs(vp) > EPS) return 0;
  if (Math.abs(A) < 1e-12) {
    const d = xFace - xp;
    return Math.abs(vp) > EPS && d * vp > 0 ? d / vp : Infinity;
  }
  // The particle moves monotonically towards a face only if the face velocity has the same sign
  if (vp * vFace <= 0 || Math.abs(vp) < EPS) return Infinity;
  if ((xFace - xp) * vp <= 0) return Infinity;
  const t = Math.log(vFace / vp) / A;
  return t > 0 ? t : Infinity;
}

/** Position after time t along one axis of the cell. */
function advance(xp: number, vp: number, A: number, t: number): number {
  if (Math.abs(A) < 1e-12) return xp + vp * t;
  return xp + (vp * (Math.exp(A * t) - 1)) / A;
}

/**
 * Traces one streamline from `seed` through fluid cells. Returns null if the seed is not in a
 * fluid cell. The first point is the seed itself.
 */
export function traceStreamline(grid: GridInfo, fluid: ArrayLike<number>, faces: FaceVelocities, seed: readonly [number, number, number], options: TraceOptions = {}): Streamline | null {
  const { nx, ny, nz, dx, origin } = grid;
  const dir = options.direction ?? 1;
  const maxTime = options.maxTimeS ?? 600;
  const maxLength = options.maxLengthM ?? 20;
  const minSpeed = options.minSpeed ?? 1e-3;
  const perCell = Math.max(1, Math.round(options.pointsPerCell ?? 2));
  const maxCells = options.maxCells ?? 2000;

  let i = Math.floor((seed[0] - origin[0]) / dx);
  let j = Math.floor((seed[1] - origin[1]) / dx);
  let k = Math.floor((seed[2] - origin[2]) / dx);
  const inGrid = (a: number, b: number, c: number) => a >= 0 && b >= 0 && c >= 0 && a < nx && b < ny && c < nz;
  if (!inGrid(i, j, k) || !fluid[i + nx * (j + ny * k)]) return null;

  // Local coordinates inside the current cell, 0..dx
  let lx = seed[0] - origin[0] - i * dx;
  let ly = seed[1] - origin[1] - j * dx;
  let lz = seed[2] - origin[2] - k * dx;
  const pts: number[] = [seed[0], seed[1], seed[2]];
  const times: number[] = [0];
  const speeds: number[] = [];
  let t = 0;
  let length = 0;
  let slow = 0;

  const faceVel = () => {
    const u0 = dir * Number(faces.u[i + (nx + 1) * (j + ny * k)]);
    const u1 = dir * Number(faces.u[i + 1 + (nx + 1) * (j + ny * k)]);
    const v0 = dir * Number(faces.v[i + nx * (j + (ny + 1) * k)]);
    const v1 = dir * Number(faces.v[i + nx * (j + 1 + (ny + 1) * k)]);
    const w0 = dir * Number(faces.w[i + nx * (j + ny * k)]);
    const w1 = dir * Number(faces.w[i + nx * (j + ny * (k + 1))]);
    return { u0, u1, v0, v1, w0, w1 };
  };
  const speedAt = (f: ReturnType<typeof faceVel>, x: number, y: number, z: number) =>
    Math.hypot(f.u0 + ((f.u1 - f.u0) * x) / dx, f.v0 + ((f.v1 - f.v0) * y) / dx, f.w0 + ((f.w1 - f.w0) * z) / dx);

  speeds.push(speedAt(faceVel(), lx, ly, lz));
  for (let cells = 0; cells < maxCells; cells++) {
    const f = faceVel();
    const Ax = (f.u1 - f.u0) / dx;
    const Ay = (f.v1 - f.v0) / dx;
    const Az = (f.w1 - f.w0) / dx;
    const vx = f.u0 + Ax * lx;
    const vy = f.v0 + Ay * ly;
    const vz = f.w0 + Az * lz;
    const sp = Math.hypot(vx, vy, vz);
    if (sp < minSpeed) {
      if (++slow > 2) break;
    } else slow = 0;
    // Exit time through each of the six faces (the one ahead on each axis)
    const tx = vx > 0 ? exitTime(vx, f.u1, Ax, lx, dx) : exitTime(vx, f.u0, Ax, lx, 0);
    const ty = vy > 0 ? exitTime(vy, f.v1, Ay, ly, dx) : exitTime(vy, f.v0, Ay, ly, 0);
    const tz = vz > 0 ? exitTime(vz, f.w1, Az, lz, dx) : exitTime(vz, f.w0, Az, lz, 0);
    let te = Math.min(tx, ty, tz);
    const capped = !Number.isFinite(te) || t + te > maxTime;
    // A stagnation point inside the cell: move for the rest of the time budget, then stop
    if (!Number.isFinite(te)) te = Math.max(0, maxTime - t);
    if (capped) te = Math.min(te, Math.max(0, maxTime - t));
    if (te < 0 || (te === 0 && capped)) break;

    const ox = origin[0] + i * dx;
    const oy = origin[1] + j * dx;
    const oz = origin[2] + k * dx;
    let px = pts[pts.length - 3]!;
    let py = pts[pts.length - 2]!;
    let pz = pts[pts.length - 1]!;
    for (let s = 1; s <= (te > 0 ? perCell : 0); s++) {
      const ts = (te * s) / perCell;
      const x = advance(lx, vx, Ax, ts);
      const y = advance(ly, vy, Ay, ts);
      const z = advance(lz, vz, Az, ts);
      const wx = ox + x;
      const wy = oy + y;
      const wz = oz + z;
      length += Math.hypot(wx - px, wy - py, wz - pz);
      px = wx;
      py = wy;
      pz = wz;
      pts.push(wx, wy, wz);
      times.push(dir * (t + ts));
      speeds.push(speedAt(f, x, y, z));
    }
    t += te;
    if (capped || length >= maxLength) break;

    // Step into the neighbour through the exit face (snap that coordinate to the shared face)
    lx = advance(lx, vx, Ax, te);
    ly = advance(ly, vy, Ay, te);
    lz = advance(lz, vz, Az, te);
    let ni = i;
    let nj = j;
    let nk = k;
    if (te === tx) {
      ni += vx > 0 ? 1 : -1;
      lx = vx > 0 ? 0 : dx;
    } else if (te === ty) {
      nj += vy > 0 ? 1 : -1;
      ly = vy > 0 ? 0 : dx;
    } else {
      nk += vz > 0 ? 1 : -1;
      lz = vz > 0 ? 0 : dx;
    }
    // Leaving the fluid (an open window to outdoors, or the grid edge) ends the line
    if (!inGrid(ni, nj, nk) || !fluid[ni + nx * (nj + ny * nk)]) break;
    i = ni;
    j = nj;
    k = nk;
    lx = Math.min(dx, Math.max(0, lx));
    ly = Math.min(dx, Math.max(0, ly));
    lz = Math.min(dx, Math.max(0, lz));
  }
  if (pts.length < 6) return null;
  return { points: Float32Array.from(pts), times: Float32Array.from(times), speeds: Float32Array.from(speeds) };
}

/** Joins an upstream and a downstream trace from the same seed into one line (upstream reversed). */
export function joinTraces(back: Streamline | null, fwd: Streamline | null): Streamline | null {
  if (!back) return fwd;
  if (!fwd) {
    const n = back.times.length;
    const rev = (a: Float32Array, stride: number) => {
      const out = new Float32Array(a.length);
      for (let p = 0; p < n; p++) for (let c = 0; c < stride; c++) out[p * stride + c] = a[(n - 1 - p) * stride + c]!;
      return out;
    };
    return { points: rev(back.points, 3), times: rev(back.times, 1), speeds: rev(back.speeds, 1) };
  }
  const nb = back.times.length;
  const nf = fwd.times.length;
  const n = nb + nf - 1; // the seed is shared
  const points = new Float32Array(n * 3);
  const times = new Float32Array(n);
  const speeds = new Float32Array(n);
  for (let p = 0; p < nb; p++) {
    const src = nb - 1 - p;
    points.set(back.points.subarray(src * 3, src * 3 + 3), p * 3);
    times[p] = back.times[src]!;
    speeds[p] = back.speeds[src]!;
  }
  for (let p = 1; p < nf; p++) {
    points.set(fwd.points.subarray(p * 3, p * 3 + 3), (nb - 1 + p) * 3);
    times[nb - 1 + p] = fwd.times[p]!;
    speeds[nb - 1 + p] = fwd.speeds[p]!;
  }
  return { points, times, speeds };
}

export interface StreamlineSeeds {
  /** World xyz triples traced downstream only (inflow openings, device outlets) */
  forward: Float32Array;
  /** World xyz triples traced both ways (an even grid per room) */
  both: Float32Array;
}

export interface StreamlineSetOptions {
  /** Spacing of the per-room seed grid (m) */
  spacingM?: number;
  /** Heights of the seed grid (m) */
  heightsM?: readonly number[];
  /** Cap on lines from openings and devices */
  maxForward?: number;
  maxTimeS?: number;
  maxLengthM?: number;
}

/**
 * Seeds: given inflow / device points (traced downstream) plus an even grid in every room at the
 * given heights (traced both ways). A grid seed is skipped when an earlier line already passed
 * through its floor column, which keeps the lines evenly spread instead of bunching up.
 */
export function computeStreamlines(
  grid: GridInfo & { fluid: ArrayLike<number>; zoneOf: ArrayLike<number> },
  faces: FaceVelocities,
  forwardSeeds: Float32Array,
  options: StreamlineSetOptions = {}
): Streamline[] {
  const { nx, ny, nz, dx, origin, fluid, zoneOf } = grid;
  const spacing = options.spacingM ?? 0.6;
  const heights = options.heightsM ?? [1.2];
  const trace = { maxTimeS: options.maxTimeS ?? 240, maxLengthM: options.maxLengthM ?? 14, pointsPerCell: 2 };
  const lines: Streamline[] = [];
  // Floor-column occupancy at the seed spacing
  const cw = Math.max(1, Math.round(spacing / dx));
  const ox = Math.ceil(nx / cw);
  const occupied = new Uint8Array(ox * Math.ceil(nz / cw));
  const mark = (s: Streamline) => {
    for (let p = 0; p < s.times.length; p++) {
      const ci = Math.floor((s.points[3 * p]! - origin[0]) / dx / cw);
      const ck = Math.floor((s.points[3 * p + 2]! - origin[2]) / dx / cw);
      if (ci >= 0 && ck >= 0 && ci < ox) occupied[ci + ox * ck] = 1;
    }
  };

  const nf = forwardSeeds.length / 3;
  const maxForward = options.maxForward ?? 80;
  const stride = Math.max(1, Math.ceil(nf / maxForward));
  for (let p = 0; p < nf; p += stride) {
    const s = traceStreamline(grid, fluid, faces, [forwardSeeds[3 * p]!, forwardSeeds[3 * p + 1]!, forwardSeeds[3 * p + 2]!], trace);
    if (s) {
      lines.push(s);
      mark(s);
    }
  }
  for (const h of heights) {
    const j = Math.min(ny - 1, Math.max(0, Math.floor((h - origin[1]) / dx)));
    for (let k = Math.floor(cw / 2); k < nz; k += cw)
      for (let i = Math.floor(cw / 2); i < nx; i += cw) {
        const c = i + nx * (j + ny * k);
        if (!fluid[c] || Number(zoneOf[c]) < 0) continue;
        if (occupied[Math.floor(i / cw) + ox * Math.floor(k / cw)]) continue;
        const seed: [number, number, number] = [origin[0] + (i + 0.5) * dx, origin[1] + (j + 0.5) * dx, origin[2] + (k + 0.5) * dx];
        const s = joinTraces(traceStreamline(grid, fluid, faces, seed, { ...trace, direction: -1 }), traceStreamline(grid, fluid, faces, seed, trace));
        if (s) {
          lines.push(s);
          mark(s);
        }
      }
  }
  return lines;
}
