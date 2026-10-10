import { EDDY_VISCOSITY, JET_RELAXATION_TIME_S, POROUS_DAMPING_RATE, VOXEL_CFL, VOXEL_PRESSURE_TOL } from '../constants';
import { FaceType, type Axis, type VoxelDomain } from './grid';
import { micPreconditioner, pcg, type StencilMatrix } from './linalg';

/**
 * Stable Fluids (Stam 1999) on the MAC grid, incompressible, no buoyancy:
 *   advect (semi-Lagrangian, RK2 backtrace) → diffuse (explicit eddy viscosity) →
 *   device jets + porous damping → project (CG on the pressure Poisson equation).
 * The staggered layout avoids the checkerboard pressure modes of a collocated grid.
 *
 * TODO buoyancy: `FlowOptions.buoyancy` is reserved; a Boussinesq term needs a temperature field.
 */

export interface VelocityField {
  u: Float64Array;
  v: Float64Array;
  w: Float64Array;
}

export interface FlowOptions {
  viscosity?: number;
  cfl?: number;
  /** Reserved; must be false until a temperature field exists */
  buoyancy?: boolean;
}

interface PressureFace {
  axis: Axis;
  index: number;
  row: number;
  outward: 1 | -1;
  /** Outdoor pressure on the face (Pa) */
  p0: number;
}

export interface FlowState {
  domain: VoxelDomain;
  field: VelocityField;
  /** Compact fluid-row → cell index, and cell → row (−1 if not fluid) */
  cellOfRow: Int32Array;
  rowOfCell: Int32Array;
  pressure: StencilMatrix;
  /** MIC(0) factor of `pressure` */
  pressurePrecon: Float64Array;
  phi: Float64Array;
  pressureFaces: PressureFace[];
  /** Free (solved) faces per axis */
  freeFaces: [Int32Array, Int32Array, Int32Array];
  /** Faces with an orifice loss, per axis */
  lossFaces: [Int32Array, Int32Array, Int32Array];
  viscosity: number;
  cfl: number;
  pressureIterations: number;
  projections: number;
}

export function createFlowState(domain: VoxelDomain, options: FlowOptions = {}): FlowState {
  if (options.buoyancy) throw new Error('Buoyancy is not implemented yet (needs a temperature field).');
  const { nx, ny, nz, fluid } = domain;
  const n = nx * ny * nz;
  const rowOfCell = new Int32Array(n).fill(-1);
  const cellOfRow = new Int32Array(domain.fluidCount);
  let m = 0;
  for (let c = 0; c < n; c++) {
    if (fluid[c]) {
      rowOfCell[c] = m;
      cellOfRow[m++] = c;
    }
  }

  const field: VelocityField = {
    u: Float64Array.from(domain.uFixed),
    v: Float64Array.from(domain.vFixed),
    w: Float64Array.from(domain.wFixed),
  };

  // Pressure Poisson matrix: L φ = Σ_free (φ_c − φ_nb), Dirichlet φ = 0 outside pressure faces
  const diag = new Float64Array(m);
  const nbr = new Int32Array(m * 6).fill(-1);
  const coef = new Float64Array(m * 6);
  const pressureFaces: PressureFace[] = [];
  forEachCellFace(domain, (row, cell, d, axis, index, outward, nbCell) => {
    const t = faceTypeArray(domain, axis)[index]!;
    if (t === FaceType.INTERIOR) {
      diag[row] = diag[row]! + 1;
      nbr[row * 6 + d] = rowOfCell[nbCell]!;
      coef[row * 6 + d] = 1;
    } else if (t === FaceType.PRESSURE) {
      diag[row] = diag[row]! + 1;
      const p0 = (axis === 0 ? domain.uPressure : axis === 1 ? domain.vPressure : domain.wPressure)[index]!;
      pressureFaces.push({ axis, index, row, outward, p0 });
    }
    void cell;
  }, rowOfCell);

  // Pin one cell of every connected component that has no pressure boundary, so the matrix is
  // positive definite; with a compatible right-hand side the pin carries no flux.
  const seen = new Uint8Array(m);
  const touchesPressure = new Uint8Array(m);
  for (const f of pressureFaces) touchesPressure[f.row] = 1;
  for (let start = 0; start < m; start++) {
    if (seen[start]) continue;
    const stack = [start];
    seen[start] = 1;
    let open = false;
    while (stack.length) {
      const r = stack.pop()!;
      if (touchesPressure[r]) open = true;
      for (let d = 0; d < 6; d++) {
        const nb = nbr[r * 6 + d]!;
        if (nb >= 0 && !seen[nb]) {
          seen[nb] = 1;
          stack.push(nb);
        }
      }
    }
    if (!open) diag[start] = diag[start]! + 1;
  }
  for (let r = 0; r < m; r++) if (diag[r] === 0) diag[r] = 1;

  const free = (types: Uint8Array) => {
    const out: number[] = [];
    for (let i = 0; i < types.length; i++) if (types[i] === FaceType.INTERIOR || types[i] === FaceType.PRESSURE) out.push(i);
    return Int32Array.from(out);
  };

  const withLoss = (loss: Float32Array) => {
    const out: number[] = [];
    for (let i = 0; i < loss.length; i++) if (loss[i]! > 0) out.push(i);
    return Int32Array.from(out);
  };
  const pressure: StencilMatrix = { size: m, diag, nbr, coef };
  return {
    domain,
    field,
    cellOfRow,
    rowOfCell,
    pressure,
    pressurePrecon: micPreconditioner(pressure),
    phi: new Float64Array(m),
    pressureFaces,
    freeFaces: [free(domain.uType), free(domain.vType), free(domain.wType)],
    lossFaces: [withLoss(domain.uLoss), withLoss(domain.vLoss), withLoss(domain.wLoss)],
    viscosity: options.viscosity ?? EDDY_VISCOSITY,
    cfl: options.cfl ?? VOXEL_CFL,
    pressureIterations: 0,
    projections: 0,
  };
}

export function faceTypeArray(domain: VoxelDomain, axis: Axis): Uint8Array {
  return axis === 0 ? domain.uType : axis === 1 ? domain.vType : domain.wType;
}

/**
 * Visits the six faces of every fluid cell: (row, cell, slot 0–5, axis, face index, outward sign,
 * neighbour cell or −1 outside the grid). Slots: −x, +x, −y, +y, −z, +z.
 */
export function forEachCellFace(
  domain: VoxelDomain,
  fn: (row: number, cell: number, slot: number, axis: Axis, index: number, outward: 1 | -1, nbCell: number) => void,
  rowOfCell: Int32Array
): void {
  const { nx, ny, nz } = domain;
  for (let k = 0; k < nz; k++)
    for (let j = 0; j < ny; j++)
      for (let i = 0; i < nx; i++) {
        const c = i + nx * (j + ny * k);
        const row = rowOfCell[c]!;
        if (row < 0) continue;
        fn(row, c, 0, 0, i + (nx + 1) * (j + ny * k), -1, i > 0 ? c - 1 : -1);
        fn(row, c, 1, 0, i + 1 + (nx + 1) * (j + ny * k), 1, i < nx - 1 ? c + 1 : -1);
        fn(row, c, 2, 1, i + nx * (j + (ny + 1) * k), -1, j > 0 ? c - nx : -1);
        fn(row, c, 3, 1, i + nx * (j + 1 + (ny + 1) * k), 1, j < ny - 1 ? c + nx : -1);
        fn(row, c, 4, 2, i + nx * (j + ny * k), -1, k > 0 ? c - nx * ny : -1);
        fn(row, c, 5, 2, i + nx * (j + ny * (k + 1)), 1, k < nz - 1 ? c + nx * ny : -1);
      }
}

// ---------------------------------------------------------------------------
// Interpolation on the staggered grid
// ---------------------------------------------------------------------------

function sampleComponent(domain: VoxelDomain, arr: Float64Array, axis: Axis, x: number, y: number, z: number): number {
  const { nx, ny, nz, dx, origin } = domain;
  // Dimensions of the component array and the offset of its sample points
  const sx = axis === 0 ? nx + 1 : nx;
  const sy = axis === 1 ? ny + 1 : ny;
  const sz = axis === 2 ? nz + 1 : nz;
  let fx = (x - origin[0]) / dx - (axis === 0 ? 0 : 0.5);
  let fy = (y - origin[1]) / dx - (axis === 1 ? 0 : 0.5);
  let fz = (z - origin[2]) / dx - (axis === 2 ? 0 : 0.5);
  fx = Math.min(Math.max(fx, 0), sx - 1);
  fy = Math.min(Math.max(fy, 0), sy - 1);
  fz = Math.min(Math.max(fz, 0), sz - 1);
  const i0 = Math.min(Math.floor(fx), sx - 2 < 0 ? 0 : sx - 2);
  const j0 = Math.min(Math.floor(fy), sy - 2 < 0 ? 0 : sy - 2);
  const k0 = Math.min(Math.floor(fz), sz - 2 < 0 ? 0 : sz - 2);
  const tx = sx > 1 ? fx - i0 : 0;
  const ty = sy > 1 ? fy - j0 : 0;
  const tz = sz > 1 ? fz - k0 : 0;
  const i1 = Math.min(i0 + 1, sx - 1);
  const j1 = Math.min(j0 + 1, sy - 1);
  const k1 = Math.min(k0 + 1, sz - 1);
  const at = (i: number, j: number, k: number) => arr[i + sx * (j + sy * k)]!;
  const c00 = at(i0, j0, k0) * (1 - tx) + at(i1, j0, k0) * tx;
  const c10 = at(i0, j1, k0) * (1 - tx) + at(i1, j1, k0) * tx;
  const c01 = at(i0, j0, k1) * (1 - tx) + at(i1, j0, k1) * tx;
  const c11 = at(i0, j1, k1) * (1 - tx) + at(i1, j1, k1) * tx;
  return (c00 * (1 - ty) + c10 * ty) * (1 - tz) + (c01 * (1 - ty) + c11 * ty) * tz;
}

/** World position (m) of a face centre. */
export function facePosition(domain: VoxelDomain, axis: Axis, index: number): [number, number, number] {
  const { nx, ny, dx, origin } = domain;
  const sx = axis === 0 ? nx + 1 : nx;
  const sy = axis === 1 ? ny + 1 : ny;
  const i = index % sx;
  const j = Math.floor(index / sx) % sy;
  const k = Math.floor(index / (sx * sy));
  return [
    origin[0] + (i + (axis === 0 ? 0 : 0.5)) * dx,
    origin[1] + (j + (axis === 1 ? 0 : 0.5)) * dx,
    origin[2] + (k + (axis === 2 ? 0 : 0.5)) * dx,
  ];
}

// ---------------------------------------------------------------------------
// Step
// ---------------------------------------------------------------------------

export function maxSpeed(field: VelocityField): number {
  let m = 0;
  for (const a of [field.u, field.v, field.w]) for (let i = 0; i < a.length; i++) m = Math.max(m, Math.abs(a[i]!));
  return m;
}

/** CFL- and diffusion-limited time step. */
export function chooseDt(state: FlowState): number {
  const { dx } = state.domain;
  let speed = maxSpeed(state.field);
  for (const j of state.domain.jets) speed = Math.max(speed, Math.abs(j.target));
  // Orifice speed scale from the spread of boundary pressures
  if (state.pressureFaces.length > 0) {
    let lo = Infinity;
    let hi = -Infinity;
    for (const f of state.pressureFaces) {
      lo = Math.min(lo, f.p0);
      hi = Math.max(hi, f.p0);
    }
    speed = Math.max(speed, Math.sqrt((2 * (hi - lo)) / state.domain.rho));
  }
  speed = Math.max(speed, 0.05);
  const advective = (state.cfl * dx) / speed;
  const diffusive = state.viscosity > 0 ? (0.9 * dx * dx) / (6 * state.viscosity) : Infinity;
  return Math.min(advective, diffusive);
}

export interface StepStats {
  dt: number;
  /** max |Δu| over the step / max speed */
  relChange: number;
  pressureIterations: number;
}

export function flowStep(state: FlowState, dt: number): StepStats {
  const { domain, field } = state;
  const arrays = [field.u, field.v, field.w] as const;
  const old = arrays.map((a) => Float64Array.from(a));
  const sample = (axis: Axis, x: number, y: number, z: number) => sampleComponent(domain, old[axis]!, axis, x, y, z);

  // 1. Semi-Lagrangian advection of every free face (RK2 / midpoint backtrace)
  for (let axis = 0 as Axis; axis < 3; axis = (axis + 1) as Axis) {
    const arr = arrays[axis]!;
    for (const index of state.freeFaces[axis]) {
      const [x, y, z] = facePosition(domain, axis, index);
      const u0 = sample(0, x, y, z);
      const v0 = sample(1, x, y, z);
      const w0 = sample(2, x, y, z);
      const xm = x - 0.5 * dt * u0;
      const ym = y - 0.5 * dt * v0;
      const zm = z - 0.5 * dt * w0;
      const xb = x - dt * sample(0, xm, ym, zm);
      const yb = y - dt * sample(1, xm, ym, zm);
      const zb = z - dt * sample(2, xm, ym, zm);
      arr[index] = sample(axis, xb, yb, zb);
    }
  }

  // 2. Explicit eddy-viscosity diffusion (dt is limited so ν·dt/dx² ≤ 0.15)
  if (state.viscosity > 0) {
    const { nx, ny, nz, dx } = domain;
    const kappa = (state.viscosity * dt) / (dx * dx);
    for (let axis = 0 as Axis; axis < 3; axis = (axis + 1) as Axis) {
      const arr = arrays[axis]!;
      const src = Float64Array.from(arr);
      const sx = axis === 0 ? nx + 1 : nx;
      const sy = axis === 1 ? ny + 1 : ny;
      const sz = axis === 2 ? nz + 1 : nz;
      for (const index of state.freeFaces[axis]) {
        const i = index % sx;
        const j = Math.floor(index / sx) % sy;
        const k = Math.floor(index / (sx * sy));
        const c = src[index]!;
        const nb = (ii: number, jj: number, kk: number) =>
          ii < 0 || ii >= sx || jj < 0 || jj >= sy || kk < 0 || kk >= sz ? c : src[ii + sx * (jj + sy * kk)]!;
        const lap = nb(i - 1, j, k) + nb(i + 1, j, k) + nb(i, j - 1, k) + nb(i, j + 1, k) + nb(i, j, k - 1) + nb(i, j, k + 1) - 6 * c;
        arr[index] = c + kappa * lap;
      }
    }
  }

  // 3. Device jets: relax toward the discharge velocity
  const beta = 1 - Math.exp(-dt / JET_RELAXATION_TIME_S);
  for (const jet of domain.jets) {
    const arr = arrays[jet.axis]!;
    arr[jet.index] = arr[jet.index]! + beta * (jet.target - arr[jet.index]!);
  }

  // 4. Porous damping
  const keep = Math.exp(-POROUS_DAMPING_RATE * dt);
  for (const idx of domain.porousFaces.u) if (domain.uType[idx] !== FaceType.PRESCRIBED) field.u[idx] = field.u[idx]! * keep;
  for (const idx of domain.porousFaces.v) if (domain.vType[idx] !== FaceType.PRESCRIBED) field.v[idx] = field.v[idx]! * keep;
  for (const idx of domain.porousFaces.w) if (domain.wType[idx] !== FaceType.PRESCRIBED) field.w[idx] = field.w[idx]! * keep;

  // 5. Orifice losses on opening faces, implicit: Δp = K·½ρu² per face
  const lossArrays = [domain.uLoss, domain.vLoss, domain.wLoss] as const;
  for (let axis = 0; axis < 3; axis++) {
    const arr = arrays[axis]!;
    const K = lossArrays[axis]!;
    for (const idx of state.lossFaces[axis]!) {
      const u = arr[idx]!;
      arr[idx] = u / (1 + (dt * K[idx]! * Math.abs(u)) / (2 * domain.dx));
    }
  }

  // 6. Projection
  const iters = project(state, dt);

  let change = 0;
  for (let axis = 0; axis < 3; axis++) {
    const a = arrays[axis]!;
    const o = old[axis]!;
    for (let i = 0; i < a.length; i++) change = Math.max(change, Math.abs(a[i]! - o[i]!));
  }
  return { dt, relChange: change / Math.max(maxSpeed(field), 1e-3), pressureIterations: iters };
}

/** Outward face-velocity sum of each fluid row minus dx·s (target divergence × dx). */
export function divergenceRows(state: FlowState, field: VelocityField = state.field): Float64Array {
  const { domain, rowOfCell } = state;
  const out = new Float64Array(state.pressure.size);
  const arrays = [field.u, field.v, field.w];
  forEachCellFace(domain, (row, _cell, _slot, axis, index, outward) => {
    out[row] = out[row]! + outward * arrays[axis]![index]!;
  }, rowOfCell);
  for (let r = 0; r < out.length; r++) {
    const c = state.cellOfRow[r]!;
    out[r] = out[r]! - domain.dx * (domain.sSink[c]! + domain.sSource[c]! + domain.sReturn[c]! + domain.sSupply[c]!);
  }
  return out;
}

/**
 * Makes the field satisfy the target divergence, with Dirichlet pressures on PRESSURE faces;
 * returns CG iterations. φ = dt·p/(ρ·dx) is the velocity correction, so outdoor pressures enter as
 * ghost values φ₀ = dt·p₀/(ρ·dx).
 */
export function project(state: FlowState, dt: number, tol = VOXEL_PRESSURE_TOL): number {
  const { domain, field } = state;
  const { nx, ny, nz } = domain;
  const div = divergenceRows(state);
  const rhs = new Float64Array(div.length);
  for (let r = 0; r < rhs.length; r++) rhs[r] = -div[r]!;
  const ghost = dt / (domain.rho * domain.dx);
  for (const pf of state.pressureFaces) rhs[pf.row] = rhs[pf.row]! + ghost * pf.p0;
  const stats = pcg(state.pressure, rhs, state.phi, tol, 2000, false, state.pressurePrecon);
  state.pressureIterations += stats.iterations;
  state.projections++;
  const phi = state.phi;
  const row = state.rowOfCell;
  // Interior faces: u -= φ(+side) − φ(−side)
  for (let k = 0; k < nz; k++)
    for (let j = 0; j < ny; j++)
      for (let i = 1; i < nx; i++) {
        const f = i + (nx + 1) * (j + ny * k);
        if (domain.uType[f] !== FaceType.INTERIOR) continue;
        const c = i + nx * (j + ny * k);
        field.u[f] = field.u[f]! - (phi[row[c]!]! - phi[row[c - 1]!]!);
      }
  for (let k = 0; k < nz; k++)
    for (let j = 1; j < ny; j++)
      for (let i = 0; i < nx; i++) {
        const f = i + nx * (j + (ny + 1) * k);
        if (domain.vType[f] !== FaceType.INTERIOR) continue;
        const c = i + nx * (j + ny * k);
        field.v[f] = field.v[f]! - (phi[row[c]!]! - phi[row[c - nx]!]!);
      }
  for (let k = 1; k < nz; k++)
    for (let j = 0; j < ny; j++)
      for (let i = 0; i < nx; i++) {
        const f = i + nx * (j + ny * k);
        if (domain.wType[f] !== FaceType.INTERIOR) continue;
        const c = i + nx * (j + ny * k);
        field.w[f] = field.w[f]! - (phi[row[c]!]! - phi[row[c - nx * ny]!]!);
      }
  // Pressure faces: ghost φ₀ outside
  const arrays = [field.u, field.v, field.w];
  for (const pf of state.pressureFaces) {
    const a = arrays[pf.axis]!;
    a[pf.index] = a[pf.index]! + pf.outward * (phi[pf.row]! - ghost * pf.p0);
  }
  return stats.iterations;
}

/**
 * Normalised divergence residual: max over fluid cells of |Σ outward u − dx·s| / (max speed).
 * Dimensionless; 0 for an exactly divergence-free field.
 */
export function divergenceResidual(state: FlowState, field: VelocityField = state.field): number {
  const div = divergenceRows(state, field);
  let m = 0;
  for (let r = 0; r < div.length; r++) m = Math.max(m, Math.abs(div[r]!));
  return m / Math.max(maxSpeed(field), 1e-6);
}
