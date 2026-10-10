/**
 * Sparse 7-point-stencil operators on the compact list of fluid cells and the Krylov solvers used by
 * the voxel solver. A row is `diag[r]·x[r] − Σ coef[r·6+d]·x[nbr[r·6+d]]` (nbr −1 = no neighbour).
 */
export interface StencilMatrix {
  size: number;
  diag: Float64Array;
  nbr: Int32Array;
  coef: Float64Array;
}

export function applyStencil(A: StencilMatrix, x: Float64Array, out: Float64Array): void {
  const { size, diag, nbr, coef } = A;
  for (let r = 0; r < size; r++) {
    let s = diag[r]! * x[r]!;
    const base = r * 6;
    for (let d = 0; d < 6; d++) {
      const c = nbr[base + d]!;
      if (c >= 0) s -= coef[base + d]! * x[c]!;
    }
    out[r] = s;
  }
}

function dot(a: Float64Array, b: Float64Array): number {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i]! * b[i]!;
  return s;
}

function removeMean(v: Float64Array): void {
  let m = 0;
  for (let i = 0; i < v.length; i++) m += v[i]!;
  m /= v.length || 1;
  for (let i = 0; i < v.length; i++) v[i] = v[i]! - m;
}

export interface SolveStats {
  iterations: number;
  /** Final ‖r‖ / ‖b‖ */
  relResidual: number;
}

/**
 * Modified incomplete Cholesky MIC(0) factor of a symmetric 7-point stencil whose rows are in grid
 * order (slots 0, 2, 4 = lower neighbours), after Bridson, "Fluid Simulation for Computer Graphics".
 * Returns the inverse square roots used by `applyMic`.
 */
export function micPreconditioner(A: StencilMatrix, tau = 0.97, sigma = 0.25): Float64Array {
  const { size, diag, nbr, coef } = A;
  const precon = new Float64Array(size);
  // Upper off-diagonal sums of each row (positive coefficient magnitudes)
  const upper = (q: number, skip: number) => {
    let s = 0;
    for (const slot of [1, 3, 5]) if (slot !== skip && nbr[q * 6 + slot]! >= 0) s += coef[q * 6 + slot]!;
    return s;
  };
  for (let r = 0; r < size; r++) {
    let e = diag[r]!;
    for (const [slot, back] of [[0, 1], [2, 3], [4, 5]] as const) {
      const q = nbr[r * 6 + slot]!;
      if (q < 0) continue;
      const a = coef[r * 6 + slot]!;
      const pq = precon[q]!;
      e -= (a * pq) * (a * pq);
      e -= tau * a * upper(q, back) * pq * pq;
    }
    if (e < sigma * diag[r]!) e = diag[r]!;
    precon[r] = 1 / Math.sqrt(e);
  }
  return precon;
}

/** z = M⁻¹ r for the MIC(0) factor. */
function applyMic(A: StencilMatrix, precon: Float64Array, r: Float64Array, z: Float64Array, tmp: Float64Array): void {
  const { size, nbr, coef } = A;
  for (let i = 0; i < size; i++) {
    let t = r[i]!;
    for (const slot of [0, 2, 4]) {
      const q = nbr[i * 6 + slot]!;
      if (q >= 0) t += coef[i * 6 + slot]! * precon[q]! * tmp[q]!;
    }
    tmp[i] = t * precon[i]!;
  }
  for (let i = size - 1; i >= 0; i--) {
    let t = tmp[i]!;
    for (const slot of [1, 3, 5]) {
      const q = nbr[i * 6 + slot]!;
      if (q >= 0) t += coef[i * 6 + slot]! * precon[i]! * z[q]!;
    }
    z[i] = t * precon[i]!;
  }
}

/**
 * Preconditioned conjugate gradients (MIC(0) when `precon` is given, else Jacobi) for a symmetric positive (semi-)definite stencil.
 * With `singular` (pure-Neumann pressure), the constant null space is projected out of b and r.
 * `x` is the warm start and receives the solution.
 */
export function pcg(
  A: StencilMatrix,
  b: Float64Array,
  x: Float64Array,
  tol: number,
  maxIter: number,
  singular = false,
  precon?: Float64Array
): SolveStats {
  const n = A.size;
  const tmp = new Float64Array(n);
  const precondition = (src: Float64Array, dst: Float64Array) => {
    if (precon) applyMic(A, precon, src, dst, tmp);
    else for (let i = 0; i < n; i++) dst[i] = src[i]! / A.diag[i]!;
  };
  const r = new Float64Array(n);
  const z = new Float64Array(n);
  const p = new Float64Array(n);
  const q = new Float64Array(n);
  const rhs = singular ? Float64Array.from(b) : b;
  if (singular) removeMean(rhs);
  const bNorm = Math.sqrt(dot(rhs, rhs));
  if (bNorm === 0) {
    x.fill(0);
    return { iterations: 0, relResidual: 0 };
  }
  applyStencil(A, x, q);
  for (let i = 0; i < n; i++) r[i] = rhs[i]! - q[i]!;
  if (singular) removeMean(r);
  precondition(r, z);
  p.set(z);
  let rz = dot(r, z);
  let res = Math.sqrt(dot(r, r)) / bNorm;
  let it = 0;
  for (; it < maxIter && res > tol; it++) {
    applyStencil(A, p, q);
    const alpha = rz / dot(p, q);
    for (let i = 0; i < n; i++) {
      x[i] = x[i]! + alpha * p[i]!;
      r[i] = r[i]! - alpha * q[i]!;
    }
    if (singular) removeMean(r);
    res = Math.sqrt(dot(r, r)) / bNorm;
    precondition(r, z);
    const rzNew = dot(r, z);
    const beta = rzNew / rz;
    rz = rzNew;
    for (let i = 0; i < n; i++) p[i] = z[i]! + beta * p[i]!;
  }
  if (singular) removeMean(x);
  return { iterations: it, relResidual: res };
}

/**
 * D-ILU(0) of a 7-point stencil in grid order (slots 0/2/4 point to lower rows, 1/3/5 to upper):
 * the modified pivots d_i = a_ii − Σ_lower a_ij·a_ji / d_j. Works for non-symmetric operators.
 */
export function diluPivots(A: StencilMatrix): Float64Array {
  const { size, diag, nbr, coef } = A;
  const d = new Float64Array(size);
  for (let i = 0; i < size; i++) {
    let v = diag[i]!;
    for (const s of [0, 2, 4]) {
      const j = nbr[i * 6 + s]!;
      if (j >= 0) v -= (coef[i * 6 + s]! * coef[j * 6 + s + 1]!) / d[j]!;
    }
    d[i] = Math.abs(v) > 1e-300 ? v : diag[i]!;
  }
  return d;
}

/** z = M⁻¹ r with M = (D + L) D⁻¹ (D + U) from `diluPivots`. */
function applyDilu(A: StencilMatrix, d: Float64Array, r: Float64Array, z: Float64Array, w: Float64Array): void {
  const { size, nbr, coef } = A;
  for (let i = 0; i < size; i++) {
    let t = r[i]!;
    for (const s of [0, 2, 4]) {
      const j = nbr[i * 6 + s]!;
      if (j >= 0) t += coef[i * 6 + s]! * w[j]!;
    }
    w[i] = t / d[i]!;
  }
  for (let i = size - 1; i >= 0; i--) {
    let t = 0;
    for (const s of [1, 3, 5]) {
      const j = nbr[i * 6 + s]!;
      if (j >= 0) t += coef[i * 6 + s]! * z[j]!;
    }
    z[i] = w[i]! + t / d[i]!;
  }
}

/** BiCGSTAB for the (non-symmetric) scalar transport operator, D-ILU(0) preconditioned. */
export function bicgstab(A: StencilMatrix, b: Float64Array, x: Float64Array, tol: number, maxIter: number, pivots?: Float64Array): SolveStats {
  const n = A.size;
  const piv = pivots ?? diluPivots(A);
  const work = new Float64Array(n);
  const precondition = (src: Float64Array, dst: Float64Array) => applyDilu(A, piv, src, dst, work);
  const r = new Float64Array(n);
  const r0 = new Float64Array(n);
  const p = new Float64Array(n);
  const v = new Float64Array(n);
  const s = new Float64Array(n);
  const t = new Float64Array(n);
  const y = new Float64Array(n);
  const zz = new Float64Array(n);
  const bNorm = Math.sqrt(dot(b, b));
  if (bNorm === 0) {
    x.fill(0);
    return { iterations: 0, relResidual: 0 };
  }
  applyStencil(A, x, v);
  for (let i = 0; i < n; i++) r[i] = b[i]! - v[i]!;
  r0.set(r);
  let rho = 1;
  let alpha = 1;
  let omega = 1;
  v.fill(0);
  p.fill(0);
  let res = Math.sqrt(dot(r, r)) / bNorm;
  let it = 0;
  for (; it < maxIter && res > tol; it++) {
    const rhoNew = dot(r0, r);
    if (rhoNew === 0) break;
    const beta = (rhoNew / rho) * (alpha / omega);
    rho = rhoNew;
    for (let i = 0; i < n; i++) p[i] = r[i]! + beta * (p[i]! - omega * v[i]!);
    precondition(p, y);
    applyStencil(A, y, v);
    alpha = rho / dot(r0, v);
    for (let i = 0; i < n; i++) s[i] = r[i]! - alpha * v[i]!;
    if (Math.sqrt(dot(s, s)) / bNorm <= tol) {
      for (let i = 0; i < n; i++) x[i] = x[i]! + alpha * y[i]!;
      res = Math.sqrt(dot(s, s)) / bNorm;
      it++;
      break;
    }
    precondition(s, zz);
    applyStencil(A, zz, t);
    const tt = dot(t, t);
    omega = tt > 0 ? dot(t, s) / tt : 0;
    for (let i = 0; i < n; i++) {
      x[i] = x[i]! + alpha * y[i]! + omega * zz[i]!;
      r[i] = s[i]! - omega * t[i]!;
    }
    res = Math.sqrt(dot(r, r)) / bNorm;
    if (omega === 0) break;
  }
  return { iterations: it, relResidual: res };
}
