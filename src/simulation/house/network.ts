import type { Room } from '../../core/schema';
import {
  DEFAULT_DURATION_S,
  DISCHARGE_COEFFICIENT,
  GRAVITY,
  INFILTRATION_PENETRATION,
  NETWORK_LINEAR_DP_PA,
  OPEN_WINDOW_PENETRATION,
  PM25_DEPOSITION_RATE_PER_S,
  PM25_THRESHOLDS,
  SECONDS_PER_HOUR,
  type Pm25Threshold,
} from '../constants';
import { totalFlow } from '../devices';
import { roomPm25Sources, sourceActiveAt } from '../sources';
import { buildHouse, type House, type HouseEnv, type HousePath } from './house';

/**
 * Multi-zone network model (CONTAM-style, one node per room):
 * 1. Airflow: unknown zone pressures p_i (Pa, at floor level). Every path is an orifice,
 *      Q = Cd·A·sqrt(2|Δp|/ρ)·sign(Δp),
 *    with Δp = p_from(z) − p_to(z); outdoors p(z) = ½ρCpU² − ρ_out·g·z and a zone p_i − ρ_in·g·z, so
 *    exterior openings carry wind and stack (sliced vertically so flow can go both ways). Exhaust
 *    devices remove their flow. Newton's method drives every zone's net inflow to zero.
 * 2. PM2.5 and age of air: a linear balance per zone with the solved inter-zone flows,
 *      V_i dC_i/dt = Σ_j Q_ji C_j + Q_oi P C_out + E_i + λ_inf V_i P_crack C_out
 *                    − (Σ out-flows + k V_i + CADR_i + λ_inf V_i) C_i
 *    solved steady (direct) and in time (backward Euler).
 */

export interface PathFlow {
  id: string;
  kind: HousePath['kind'];
  openingId?: string;
  from: number;
  to: number;
  /** Net flow from `from` to `to` (m³/s), summed over segments */
  flowM3s: number;
  /** Gross flows in each direction (two-way exchange through a tall opening shows in both) */
  forwardM3s: number;
  backwardM3s: number;
  areaM2: number;
  cp: number;
}

export interface ThresholdCrossing extends Pm25Threshold {
  timeS: number | null;
  crossing: 'rises-above' | 'falls-below' | null;
  initiallyAbove: boolean;
}

export interface ZoneResult {
  index: number;
  roomId: string;
  name: string;
  volumeM3: number;
  pressurePa: number;
  /** Outdoor air entering through openings and leaks (m³/s), excluding the infiltration exchange */
  outdoorInflowM3s: number;
  /** All air entering: outdoors + other rooms + infiltration exchange (m³/s) */
  totalInflowM3s: number;
  /** Outdoor-air changes per hour (openings + leaks + infiltration) */
  achOutdoor: number;
  /** All air changes per hour, including air from other rooms */
  achTotal: number;
  /** V / total inflow (min): the room's nominal time constant */
  nominalTauMinutes: number;
  cadrM3s: number;
  exhaustM3s: number;
  /** Steady PM2.5 with always-on sources (µg/m³) */
  cssUgM3: number;
  /** Steady mean age of air (min) */
  ageMinutes: number;
  series: { tS: number; c: number }[];
  thresholds: ThresholdCrossing[];
}

export interface NetworkResult {
  house: House;
  zones: ZoneResult[];
  paths: PathFlow[];
  /** max |net zone inflow| / max path flow after Newton */
  massBalanceError: number;
  newtonIterations: number;
  outdoorUgM3: number;
  durationS: number;
  warnings: string[];
}

export interface NetworkOptions {
  durationS?: number;
  /** Output interval of the time series (s) */
  dtS?: number;
  initialUgM3?: number;
  depositionPerS?: number;
}

const CD_SQRT = DISCHARGE_COEFFICIENT;

/** Orifice flow and dQ/dΔp, linearised below NETWORK_LINEAR_DP_PA. */
function orifice(area: number, dp: number, rho: number): [number, number] {
  const k = CD_SQRT * area * Math.sqrt(2 / rho);
  const a = Math.abs(dp);
  if (a < NETWORK_LINEAR_DP_PA) {
    const slope = k / Math.sqrt(NETWORK_LINEAR_DP_PA);
    return [slope * dp, slope];
  }
  const q = k * Math.sqrt(a) * Math.sign(dp);
  return [q, k / (2 * Math.sqrt(a))];
}

/** Solves A x = b (dense, partial pivoting). A is overwritten. */
function solveDense(A: number[][], b: number[]): number[] {
  const n = b.length;
  const x = b.slice();
  for (let c = 0; c < n; c++) {
    let piv = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(A[r]![c]!) > Math.abs(A[piv]![c]!)) piv = r;
    [A[c], A[piv]] = [A[piv]!, A[c]!];
    [x[c], x[piv]] = [x[piv]!, x[c]!];
    const d = A[c]![c]!;
    if (Math.abs(d) < 1e-300) continue;
    for (let r = c + 1; r < n; r++) {
      const f = A[r]![c]! / d;
      if (f === 0) continue;
      for (let k = c; k < n; k++) A[r]![k] = A[r]![k]! - f * A[c]![k]!;
      x[r] = x[r]! - f * x[c]!;
    }
  }
  for (let r = n - 1; r >= 0; r--) {
    let s = x[r]!;
    for (let k = r + 1; k < n; k++) s -= A[r]![k]! * x[k]!;
    x[r] = Math.abs(A[r]![r]!) < 1e-300 ? 0 : s / A[r]![r]!;
  }
  return x;
}

/** Signed segment flows of a path for zone pressures p, with derivatives wrt p_from and p_to. */
function pathFlows(house: House, path: HousePath, p: readonly number[]) {
  const { rhoIn, rhoOut } = house;
  let q = 0;
  let dFrom = 0;
  let dTo = 0;
  let fwd = 0;
  let back = 0;
  for (const s of path.segments) {
    const inside = p[path.from]! - rhoIn * GRAVITY * s.z;
    const other = path.to >= 0 ? p[path.to]! - rhoIn * GRAVITY * s.z : path.windPressurePa - rhoOut * GRAVITY * s.z;
    const dp = inside - other;
    // Density of the air moving through: indoor air going out, outdoor air coming in
    const rho = path.to < 0 && dp < 0 ? rhoOut : rhoIn;
    const [qs, dq] = orifice(s.areaM2, dp, rho);
    q += qs;
    dFrom += dq;
    dTo -= dq;
    if (qs >= 0) fwd += qs;
    else back -= qs;
  }
  return { q, dFrom, dTo, fwd, back };
}

/** Newton solve for zone pressures. Returns pressures, iterations and the final residual. */
export function solvePressures(house: House, maxIter = 100): { p: number[]; iterations: number; residual: number; scale: number } {
  const n = house.zones.length;
  const exhaust = house.zones.map((z) => totalFlow(z.devices, 'exhaust'));
  const residual = (p: number[]) => {
    const F = exhaust.map((e) => -e);
    let scale = 1e-12;
    for (const path of house.paths) {
      const { q } = pathFlows(house, path, p);
      F[path.from] = F[path.from]! - q;
      if (path.to >= 0) F[path.to] = F[path.to]! + q;
      scale = Math.max(scale, Math.abs(q));
    }
    for (const e of exhaust) scale = Math.max(scale, e);
    return { F, scale };
  };
  let p = new Array<number>(n).fill(0);
  let { F, scale } = residual(p);
  let norm = Math.max(...F.map(Math.abs));
  let it = 0;
  for (; it < maxIter && norm > 1e-12 * Math.max(scale, 1e-6); it++) {
    const J = Array.from({ length: n }, () => new Array<number>(n).fill(0));
    for (const path of house.paths) {
      const { dFrom, dTo } = pathFlows(house, path, p);
      // F_from = −q, F_to = +q
      J[path.from]![path.from] = J[path.from]![path.from]! - dFrom;
      if (path.to >= 0) {
        J[path.from]![path.to] = J[path.from]![path.to]! - dTo;
        J[path.to]![path.from] = J[path.to]![path.from]! + dFrom;
        J[path.to]![path.to] = J[path.to]![path.to]! + dTo;
      }
    }
    const step = solveDense(J, F.map((f) => -f));
    // Backtracking line search on the max-norm
    let lambda = 1;
    let accepted = false;
    for (let ls = 0; ls < 30; ls++) {
      const trial = p.map((v, i) => v + lambda * step[i]!);
      const r = residual(trial);
      const tn = Math.max(...r.F.map(Math.abs));
      if (tn < norm || lambda < 1e-6) {
        p = trial;
        F = r.F;
        scale = r.scale;
        norm = tn;
        accepted = true;
        break;
      }
      lambda /= 2;
    }
    if (!accepted) break;
  }
  return { p, iterations: it, residual: norm, scale };
}

/** First crossing of `value` in a series, with its direction. */
function crossing(series: { tS: number; c: number }[], th: Pm25Threshold): ThresholdCrossing {
  const initiallyAbove = (series[0]?.c ?? 0) > th.valueUgM3;
  for (let i = 1; i < series.length; i++) {
    const a = series[i - 1]!;
    const b = series[i]!;
    if (a.c > th.valueUgM3 !== b.c > th.valueUgM3) {
      const t = a.tS + ((th.valueUgM3 - a.c) / (b.c - a.c)) * (b.tS - a.tS);
      return { ...th, timeS: t, crossing: initiallyAbove ? 'falls-below' : 'rises-above', initiallyAbove };
    }
  }
  return { ...th, timeS: null, crossing: null, initiallyAbove };
}

/** Runs the network model for a floor plan; `rooms[0]` supplies the environment. */
export function simulateHouseNetwork(rooms: readonly Room[], envOverrides: Partial<HouseEnv> = {}, options: NetworkOptions = {}): NetworkResult {
  const house = buildHouse(rooms, envOverrides);
  const n = house.zones.length;
  const warnings = [...house.warnings];
  const { p, iterations, residual, scale } = solvePressures(house);

  // Inter-zone flow matrix: Qz[i][j] = air moving from zone i to zone j; Qo[i] = outdoor → i; Qx[i] = i → outdoor
  const Qz = Array.from({ length: n }, () => new Array<number>(n).fill(0));
  const QoWindow = new Array<number>(n).fill(0);
  const QoLeak = new Array<number>(n).fill(0);
  const Qx = new Array<number>(n).fill(0);
  const paths: PathFlow[] = house.paths.map((path) => {
    const { q, fwd, back } = pathFlows(house, path, p);
    if (path.to >= 0) {
      Qz[path.from]![path.to] = Qz[path.from]![path.to]! + fwd;
      Qz[path.to]![path.from] = Qz[path.to]![path.from]! + back;
    } else {
      Qx[path.from] = Qx[path.from]! + fwd;
      if (path.kind === 'leak') QoLeak[path.from] = QoLeak[path.from]! + back;
      else QoWindow[path.from] = QoWindow[path.from]! + back;
    }
    return { id: path.id, kind: path.kind, openingId: path.openingId, from: path.from, to: path.to, flowM3s: q, forwardM3s: fwd, backwardM3s: back, areaM2: path.areaM2, cp: path.cp };
  });
  const exhaust = house.zones.map((z) => totalFlow(z.devices, 'exhaust'));
  for (let i = 0; i < n; i++) Qx[i] = Qx[i]! + exhaust[i]!;

  // Linear zone balance: M C = b (+ V/dt terms in time)
  const k = options.depositionPerS ?? PM25_DEPOSITION_RATE_PER_S;
  const lam = house.env.infiltrationAch / SECONDS_PER_HOUR;
  const cOut = house.env.outdoorUgM3;
  const V = house.zones.map((z) => z.volumeM3);
  const cadr = house.zones.map((z) => totalFlow(z.devices, 'clean'));
  const outflow = house.zones.map((_, i) => Qx[i]! + Qz[i]!.reduce((s, q) => s + q, 0));
  const matrix = (withLosses: boolean) =>
    Array.from({ length: n }, (_, i) =>
      Array.from({ length: n }, (_, j) => (i === j ? outflow[i]! + lam * V[i]! + (withLosses ? k * V[i]! + cadr[i]! : 0) : -Qz[j]![i]!))
    );
  const outdoorGain = house.zones.map((_, i) => QoWindow[i]! * OPEN_WINDOW_PENETRATION * cOut + (QoLeak[i]! + lam * V[i]!) * INFILTRATION_PENETRATION * cOut);
  // Room-level and placed sources; the steady state (tS null) has every source on
  const zoneSources = house.zones.map((z) => roomPm25Sources(z.room));
  const emission = (tS: number | null) => zoneSources.map((list) => list.reduce((s, src) => (sourceActiveAt(src, tS) ? s + src.emissionRateUgMin / 60 : s), 0));

  const css = solveDense(matrix(true), outdoorGain.map((g, i) => g + emission(null)[i]!));
  const age = solveDense(matrix(false), V.slice()); // seconds

  // Time series: backward Euler at 10 s, sampled every dtS
  const durationS = options.durationS ?? DEFAULT_DURATION_S;
  const dtOut = options.dtS ?? 60;
  const h = Math.min(10, dtOut);
  const c0 = options.initialUgM3 ?? OPEN_WINDOW_PENETRATION * cOut;
  let C = new Array<number>(n).fill(c0);
  const series = house.zones.map(() => [{ tS: 0, c: c0 }]);
  const M = matrix(true);
  let t = 0;
  let nextOut = dtOut;
  while (t < durationS - 1e-9) {
    const step = Math.min(h, durationS - t);
    const e = emission(t + step / 2);
    const A = M.map((row, i) => row.map((v, j) => (i === j ? v + V[i]! / step : v)));
    const b = C.map((c, i) => (V[i]! / step) * c + outdoorGain[i]! + e[i]!);
    C = solveDense(A, b);
    t += step;
    if (t >= nextOut - 1e-9 || t >= durationS - 1e-9) {
      C.forEach((c, i) => series[i]!.push({ tS: t, c }));
      nextOut += dtOut;
    }
  }

  const zones: ZoneResult[] = house.zones.map((z, i) => {
    const fromOthers = Qz.reduce((s, row) => s + row[i]!, 0);
    const outdoorIn = QoWindow[i]! + QoLeak[i]!;
    const totalIn = outdoorIn + fromOthers + lam * V[i]!;
    return {
      index: i,
      roomId: z.roomId,
      name: z.name,
      volumeM3: V[i]!,
      pressurePa: p[i]!,
      outdoorInflowM3s: outdoorIn,
      totalInflowM3s: totalIn,
      achOutdoor: ((outdoorIn + lam * V[i]!) * SECONDS_PER_HOUR) / V[i]!,
      achTotal: (totalIn * SECONDS_PER_HOUR) / V[i]!,
      nominalTauMinutes: totalIn > 0 ? V[i]! / totalIn / 60 : Infinity,
      cadrM3s: cadr[i]!,
      exhaustM3s: exhaust[i]!,
      cssUgM3: css[i]!,
      ageMinutes: age[i]! / 60,
      series: series[i]!,
      thresholds: PM25_THRESHOLDS.map((th) => crossing(series[i]!, th)),
    };
  });

  const massBalanceError = residual / Math.max(scale, 1e-12);
  if (massBalanceError > 1e-6) warnings.push(`Airflow network did not fully converge (mass balance error ${massBalanceError.toExponential(1)}).`);
  return { house, zones, paths, massBalanceError, newtonIterations: iterations, outdoorUgM3: cOut, durationS, warnings };
}
