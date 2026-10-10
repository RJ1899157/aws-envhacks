import { DISCHARGE_COEFFICIENT, EDDY_DIFFUSIVITY, PM25_DEPOSITION_RATE_PER_S, VOXEL_SCALAR_TOL } from '../constants';
import { sourceActiveAt } from '../sources';
import { faceTypeArray, forEachCellFace, type FlowState, type VelocityField } from './flow';
import { FaceType } from './grid';
import { bicgstab, diluPivots, type SolveStats, type StencilMatrix } from './linalg';

/**
 * Scalar transport on the frozen velocity field, conservative finite volumes with first-order upwind
 * fluxes and eddy diffusion, solved implicitly:
 *   V·dC/dt = −Σ_f F_f·C_upwind + D·dx·Σ(C_nb − C) + V·(sources) − V·(losses)·C
 * Implicit solves (BiCGSTAB) give exact mass balance up to the solver tolerance, a direct steady
 * state, and backward-Euler steps far longer than the advective CFL limit. (Semi-Lagrangian
 * advection, used for the velocity, is not conservative, which would spoil the comparison with
 * the box model and the mass-balance diagnostic.)
 */

export type ScalarKind = 'pm25' | 'age';

export interface TransportOperator {
  kind: ScalarKind;
  /** Steady operator A (units m³/s) */
  A: StencilMatrix;
  /** Constant right-hand side (µg/s for PM2.5, m³ for age: V·1 s/s) without emissions */
  b: Float64Array;
  /** Cell volume (m³) */
  cellVol: number;
  /** Per-row loss coefficients split out for the mass budget (m³/s) */
  outflowCoef: Float64Array;
  inflowRate: Float64Array;
  /** True if the operator has any exchange with outdoors (else age has no steady state) */
  exchanges: boolean;
}

export interface TransportOptions {
  diffusivity?: number;
  depositionPerS?: number;
}

export function buildTransport(state: FlowState, kind: ScalarKind, field: VelocityField = state.field, options: TransportOptions = {}): TransportOperator {
  const { domain, rowOfCell, cellOfRow } = state;
  const m = state.pressure.size;
  const dx = domain.dx;
  const area = dx * dx;
  const cellVol = area * dx;
  const D = options.diffusivity ?? EDDY_DIFFUSIVITY;
  const kDep = kind === 'pm25' ? (options.depositionPerS ?? PM25_DEPOSITION_RATE_PER_S) : 0;
  const cIn = kind === 'pm25' ? domain.inflowUgM3 : 0;
  const cEnv = kind === 'pm25' ? domain.envelopeInflowUgM3 : 0;

  const diag = new Float64Array(m);
  const nbr = new Int32Array(m * 6).fill(-1);
  const coef = new Float64Array(m * 6);
  const b = new Float64Array(m);
  const outflowCoef = new Float64Array(m);
  const inflowRate = new Float64Array(m);
  const arrays = [field.u, field.v, field.w];
  const losses = [domain.uLoss, domain.vLoss, domain.wLoss];
  let exchanges = false;

  forEachCellFace(domain, (row, _cell, slot, axis, index, outward, nbCell) => {
    const t = faceTypeArray(domain, axis)[index]!;
    if (t === FaceType.SOLID) return;
    const F = outward * arrays[axis]![index]! * area; // outward volume flux (m³/s)
    if (t === FaceType.INTERIOR) {
      const nb = rowOfCell[nbCell]!;
      nbr[row * 6 + slot] = nb;
      if (F > 0) diag[row] = diag[row]! + F;
      else coef[row * 6 + slot] = coef[row * 6 + slot]! - F;
      // Diffusion through an opening scales with its real open area, not the voxelized hole
      // (A_open / A_voxel = 1 / (Cd·sqrt K)); an undercut is ~1 cm high, not a full cell
      const K = losses[axis]![index]!;
      const g = D * dx * (K > 0 ? Math.min(1, 1 / (DISCHARGE_COEFFICIENT * Math.sqrt(K))) : 1);
      diag[row] = diag[row]! + g;
      coef[row * 6 + slot] = coef[row * 6 + slot]! + g;
    } else {
      // Opening face (prescribed inflow or pressure boundary): upwind with the outdoor value
      if (F > 0) {
        diag[row] = diag[row]! + F;
        outflowCoef[row] = outflowCoef[row]! + F;
      } else if (F < 0) {
        b[row] = b[row]! - F * cIn;
        inflowRate[row] = inflowRate[row]! - F;
      }
      if (F !== 0) exchanges = true;
    }
  }, rowOfCell);

  for (let r = 0; r < m; r++) {
    const c = cellOfRow[r]!;
    const sink = -domain.sSink[c]!;
    const src = domain.sSource[c]!;
    diag[r] = diag[r]! + cellVol * (kDep + domain.infiltrationPerS + sink);
    b[r] = b[r]! + cellVol * (domain.infiltrationPerS + src) * cEnv;
    if (kind === 'age') b[r] = b[r]! + cellVol; // every cell ages at 1 s per s
    if (domain.infiltrationPerS > 0 || src > 0 || sink > 0) exchanges = true;
  }
  // Guard rows that ended up with no coupling at all (isolated cells)
  for (let r = 0; r < m; r++) if (diag[r]! <= 0) diag[r] = 1e-12;

  return { kind, A: { size: m, diag, nbr, coef }, b, cellVol, outflowCoef, inflowRate, exchanges };
}

/** Emission per row (µg/s) of the sources active at time t (every source for the steady state, t null). */
export function emissionRows(state: FlowState, tS: number | null): Float64Array {
  const out = new Float64Array(state.pressure.size);
  for (const src of state.domain.sources) {
    if (!sourceActiveAt(src, tS)) continue;
    for (let r = 0; r < out.length; r++) out[r] = out[r]! + src.perCell[state.cellOfRow[r]!]!;
  }
  return out;
}

/**
 * What purifier/AC outlets put back (µg/s or m³·s/s per row) for the current field `x`: each unit
 * returns its flow at (1 − efficiency) × the mean intake value for PM2.5, and unchanged for age.
 */
export function recirculationReturn(state: FlowState, kind: ScalarKind, x: Float64Array): Float64Array {
  const out = new Float64Array(x.length);
  for (const rc of state.domain.recirculators) {
    let mean = 0;
    for (const c of rc.intake) mean += x[state.rowOfCell[c]!]!;
    mean /= rc.intake.length;
    const back = (kind === 'pm25' ? 1 - rc.efficiency : 1) * mean;
    for (const c of rc.outlet) {
      const r = state.rowOfCell[c]!;
      out[r] = out[r]! + (rc.flowM3s / rc.outlet.length) * back;
    }
  }
  return out;
}

const addRows = (a: Float64Array, b: Float64Array | null) => (b ? a.map((v, i) => v + b[i]!) : a);

/**
 * Steady solve A·x = b + extra + recirculation(x). The non-local recirculation term is handled by
 * fixed-point iteration (each pass a warm-started BiCGSTAB solve).
 */
export function solveSteady(state: FlowState, op: TransportOperator, extra: Float64Array | null, x: Float64Array, tol = VOXEL_SCALAR_TOL, maxIter = 20000): SolveStats {
  let iterations = 0;
  let stats: SolveStats = { iterations: 0, relResidual: 0 };
  const hasRecirc = state.domain.recirculators.length > 0;
  for (let pass = 0; pass < (hasRecirc ? 60 : 1); pass++) {
    const ret = hasRecirc ? recirculationReturn(state, op.kind, x) : null;
    const b = addRows(addRows(op.b, extra), ret);
    const before = hasRecirc ? Float64Array.from(x) : null;
    stats = bicgstab(op.A, b, x, tol, maxIter);
    iterations += stats.iterations;
    if (!before) break;
    let change = 0;
    let scale = 0;
    for (let i = 0; i < x.length; i++) {
      change = Math.max(change, Math.abs(x[i]! - before[i]!));
      scale = Math.max(scale, Math.abs(x[i]!));
    }
    if (change <= 1e-6 * Math.max(scale, 1e-12)) break;
  }
  return { iterations, relResidual: stats.relResidual };
}

/** One backward-Euler step: (V/dt + A)·x¹ = V/dt·x⁰ + b + extra. `x` holds x⁰ and receives x¹. */
const stepCache = new WeakMap<TransportOperator, { dt: number; A: StencilMatrix; pivots: Float64Array }>();

/** One backward-Euler step: (V/dt + A)·x¹ = V/dt·x⁰ + b + extra. `x` holds x⁰ and receives x¹. */
export function stepImplicit(op: TransportOperator, extra: Float64Array | null, x: Float64Array, dt: number, tol = VOXEL_TRANSIENT_TOL): SolveStats {
  const m = op.A.size;
  const vdt = op.cellVol / dt;
  let cached = stepCache.get(op);
  if (!cached || cached.dt !== dt) {
    const diag = new Float64Array(m);
    for (let r = 0; r < m; r++) diag[r] = op.A.diag[r]! + vdt;
    const A = { ...op.A, diag };
    cached = { dt, A, pivots: diluPivots(A) };
    stepCache.set(op, cached);
  }
  const b = new Float64Array(m);
  for (let r = 0; r < m; r++) b[r] = op.b[r]! + (extra ? extra[r]! : 0) + vdt * x[r]!;
  return bicgstab(cached.A, b, x, tol, 5000, cached.pivots);
}

/** Relative tolerance of each backward-Euler step (looser than the steady solves). */
const VOXEL_TRANSIENT_TOL = 1e-7;

/**
 * Mass budget of a PM2.5 field (µg/s): gains = inflow through openings + envelope/make-up +
 * `extraGains` (emission and purifier/AC returns); losses = outflow through openings + intake,
 * exhaust and leakage sinks + infiltration out + deposition. For a steady field gains ≈ losses.
 */
export function massBudget(state: FlowState, op: TransportOperator, x: Float64Array, extraGains: Float64Array | null, depositionPerS = PM25_DEPOSITION_RATE_PER_S) {
  const { domain, cellOfRow } = state;
  let gains = 0;
  let losses = 0;
  let mass = 0;
  for (let r = 0; r < x.length; r++) {
    const c = cellOfRow[r]!;
    const C = x[r]!;
    mass += C * op.cellVol;
    gains += op.inflowRate[r]! * domain.inflowUgM3;
    gains += op.cellVol * (domain.infiltrationPerS + domain.sSource[c]!) * domain.envelopeInflowUgM3;
    if (extraGains) gains += extraGains[r]!;
    losses += op.outflowCoef[r]! * C;
    losses += op.cellVol * (depositionPerS + domain.infiltrationPerS - domain.sSink[c]!) * C;
  }
  return { gains, losses, mass };
}
