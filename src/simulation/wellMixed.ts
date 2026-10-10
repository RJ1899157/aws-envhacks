import type { OpeningRole, Pm25Source, Room } from '../core/schema';
import { roomPm25Sources } from './sources';
import {
  DEFAULT_DURATION_S,
  DEFAULT_OUTDOOR_PM25,
  DEFAULT_TIME_STEP_S,
  PM25_DEPOSITION_RATE_PER_S,
  PM25_THRESHOLDS,
  type Pm25Threshold,
} from './constants';
import { totalFlow } from './devices';
import {
  computeVentilation,
  ventilationEnvFromRoom,
  type AchBreakdown,
  type OpeningFlow,
  type VentilationEnv,
  type VentilationResult,
  type VentilationType,
} from './ventilation';

/**
 * Single-zone (well-mixed) PM2.5 mass balance:
 *
 *   dC/dt = λ·P·C_out + E/V − (λ + k_dep + Σ CADR/V)·C  =  b − a·C
 *
 * λ air exchange rate (1/s), P penetration, C_out outdoor PM2.5 (µg/m³), E emission (µg/s),
 * V volume (m³), k_dep deposition (1/s), CADR purifier clean air delivery rate (m³/s).
 */

// ---------------------------------------------------------------------------
// Analytic solution for constant inputs
// ---------------------------------------------------------------------------

export interface MassBalanceCoefficients {
  /** Total first-order loss rate a = λ + k_dep + ΣCADR/V (1/s) */
  lossPerS: number;
  /** Constant gain b = λ·P·C_out + E/V (µg/m³/s) */
  gainUgM3PerS: number;
}

export interface MassBalanceInputs {
  volumeM3: number;
  airExchangePerS: number;
  penetration: number;
  outdoorUgM3: number;
  emissionUgPerS: number;
  depositionPerS: number;
  cadrM3s: number;
}

export function massBalanceCoefficients(i: MassBalanceInputs): MassBalanceCoefficients {
  return {
    lossPerS: i.airExchangePerS + i.depositionPerS + (i.volumeM3 > 0 ? i.cadrM3s / i.volumeM3 : 0),
    gainUgM3PerS: i.airExchangePerS * i.penetration * i.outdoorUgM3 + (i.volumeM3 > 0 ? i.emissionUgPerS / i.volumeM3 : 0),
  };
}

/** Steady-state concentration b/a (Infinity when there is a gain but no loss). */
export function steadyState({ lossPerS, gainUgM3PerS }: MassBalanceCoefficients): number {
  if (lossPerS > 0) return gainUgM3PerS / lossPerS;
  return gainUgM3PerS > 0 ? Infinity : 0;
}

/** Exact C(t) for constant coefficients: Css + (C0 − Css)·e^(−a·t); linear growth when a = 0. */
export function analyticConcentration(coeffs: MassBalanceCoefficients, c0: number, tS: number): number {
  const { lossPerS: a, gainUgM3PerS: b } = coeffs;
  if (a <= 0) return c0 + b * tS;
  const css = b / a;
  return css + (c0 - css) * Math.exp(-a * tS);
}

/** Time (s) for the analytic solution to reach `target`, or null if it never does. */
export function analyticTimeToReach(coeffs: MassBalanceCoefficients, c0: number, target: number): number | null {
  const { lossPerS: a, gainUgM3PerS: b } = coeffs;
  if (c0 === target) return 0;
  if (a <= 0) return b !== 0 && (target - c0) / b > 0 ? (target - c0) / b : null;
  const css = b / a;
  const ratio = (target - css) / (c0 - css);
  if (!(ratio > 0 && ratio < 1)) return null;
  return -Math.log(ratio) / a;
}

/** One step of the exact exponential integrator for piecewise-constant inputs. */
export function exponentialStep(coeffs: MassBalanceCoefficients, c: number, h: number): number {
  return analyticConcentration(coeffs, c, h);
}

/** One classic RK4 step of dC/dt = b − a·C. */
export function rk4Step({ lossPerS: a, gainUgM3PerS: b }: MassBalanceCoefficients, c: number, h: number): number {
  const f = (x: number) => b - a * x;
  const k1 = f(c);
  const k2 = f(c + (h / 2) * k1);
  const k3 = f(c + (h / 2) * k2);
  const k4 = f(c + h * k3);
  return c + (h / 6) * (k1 + 2 * k2 + 2 * k3 + k4);
}

// ---------------------------------------------------------------------------
// Time-varying simulation
// ---------------------------------------------------------------------------

export interface WellMixedEnv extends Partial<VentilationEnv> {
  /** Outdoor PM2.5 (µg/m³). Default: room.params.outdoorPm25, else DEFAULT_OUTDOOR_PM25. */
  outdoorPm25UgM3?: number;
  depositionPerS?: number;
  /** Override the flow-weighted penetration factor from the ventilation model */
  penetration?: number;
}

export type SimulationEvent =
  | { atS: number; kind: 'opening'; openingId: string; openFraction?: number; role?: OpeningRole }
  /** Switch a device (purifier, exhaust fan …) on or off; sets its `enabled` flag */
  | { atS: number; kind: 'device'; objectId: string; on: boolean };

export interface WellMixedOptions {
  durationS?: number;
  /** Output interval (s) */
  dtS?: number;
  /** Initial concentration (µg/m³). Default P·C_out (room starts equilibrated with outdoor air). */
  initialUgM3?: number;
  method?: 'exponential' | 'rk4';
  events?: readonly SimulationEvent[];
  /** PM2.5 sources; default the room-level and placed sources of the room */
  sources?: readonly Pm25Source[];
  neighbours?: readonly Room[];
  thresholds?: readonly Pm25Threshold[];
}

export interface ThresholdResult extends Pm25Threshold {
  /** First time (s) the concentration crosses the threshold, or null if it never does in the run */
  timeS: number | null;
  crossing: 'rises-above' | 'falls-below' | null;
  initiallyAbove: boolean;
  steadyStateAbove: boolean;
}

export interface WellMixedResult {
  volumeM3: number;
  ventilationType: VentilationType;
  /** Total ACH at t = 0 */
  ach: number;
  achBreakdown: AchBreakdown;
  openings: OpeningFlow[];
  ventilation: VentilationResult;
  outdoorPm25UgM3: number;
  penetration: number;
  /** Loss rates at t = 0, per hour (display) */
  lossRatesPerHour: { ventilation: number; deposition: number; purifiers: number; total: number };
  /**
   * Long-run steady state (µg/m³): the design after every event, with always-on sources only
   * (scheduled sources are assumed to have ended).
   */
  cssUgM3: number;
  /** 1/a at t = 0 (s); Infinity if there is no loss */
  timeConstantS: number;
  initialUgM3: number;
  series: { tS: number; c: number }[];
  peakUgM3: number;
  finalUgM3: number;
  thresholds: ThresholdResult[];
  /**
   * Time-averaged concentration over the run (µg/m³). In a well-mixed zone the breathing zone sees
   * the room average; the voxel solver will refine this.
   */
  breathingZoneExposureUgM3: number;
  warnings: string[];
}

interface State {
  room: Room;
  ventilation: VentilationResult;
}

function applyEvents(room: Room, events: readonly SimulationEvent[]): Room {
  if (events.length === 0) return room;
  const enabled = new Map<string, boolean>();
  let openings = room.openings;
  for (const e of events) {
    if (e.kind === 'opening') {
      openings = openings.map((op) =>
        op.id === e.openingId
          ? { ...op, ...(e.openFraction !== undefined && { openFraction: e.openFraction }), ...(e.role && { role: e.role }) }
          : op
      );
    } else enabled.set(e.objectId, e.on);
  }
  const objects = room.objects.map((o) => (enabled.has(o.id) ? { ...o, enabled: enabled.get(o.id)! } : o));
  return { ...room, openings, objects };
}

function sourceActive(src: Pm25Source, tS: number): boolean {
  if (!src.schedule || src.schedule.length === 0) return true;
  const tMin = tS / 60;
  return src.schedule.some((w) => tMin >= w.startMin && tMin < w.startMin + w.durationMin);
}

/**
 * Runs the box model for a room. Inputs are piecewise constant between breakpoints (events and
 * source schedule edges); ventilation is recomputed whenever the design changes.
 */
export function simulateWellMixed(room: Room, env: WellMixedEnv = {}, options: WellMixedOptions = {}): WellMixedResult {
  const durationS = options.durationS ?? DEFAULT_DURATION_S;
  const dtS = options.dtS ?? DEFAULT_TIME_STEP_S;
  if (!(durationS > 0) || !(dtS > 0)) throw new Error('durationS and dtS must be positive');

  const warnings: string[] = [];
  const ventEnv = resolveVentilationEnv(room, env);
  const depositionPerS = env.depositionPerS ?? PM25_DEPOSITION_RATE_PER_S;
  const sources = options.sources ?? roomPm25Sources(room);
  const thresholds = options.thresholds ?? PM25_THRESHOLDS;
  const events = [...(options.events ?? [])].sort((x, y) => x.atS - y.atS);

  const { outdoorUgM3: cOut, defaulted } = resolveOutdoorPm25(room, env);
  if (defaulted) warnings.push(`Outdoor PM2.5 not set; using a default of ${DEFAULT_OUTDOOR_PM25} µg/m³.`);

  const stateCache = new Map<number, State>();
  const stateAt = (tS: number): State => {
    const applied = events.filter((e) => e.atS <= tS);
    const key = applied.length;
    let s = stateCache.get(key);
    if (!s) {
      const r = applyEvents(room, applied);
      s = { room: r, ventilation: computeVentilation(r, ventEnv, { neighbours: options.neighbours }) };
      stateCache.set(key, s);
      for (const w of s.ventilation.warnings) if (!warnings.includes(w)) warnings.push(w);
    }
    return s;
  };

  const coeffsFor = (s: State, emissionUgPerS: number): MassBalanceCoefficients =>
    massBalanceCoefficients({
      volumeM3: s.ventilation.volumeM3,
      airExchangePerS: s.ventilation.volumeM3 > 0 ? s.ventilation.totalM3s / s.ventilation.volumeM3 : 0,
      penetration: env.penetration ?? s.ventilation.penetration,
      outdoorUgM3: cOut,
      emissionUgPerS,
      depositionPerS,
      cadrM3s: totalFlow(s.ventilation.devices, 'clean'),
    });
  const emissionAt = (tS: number) =>
    sources.filter((src) => sourceActive(src, tS)).reduce((sum, src) => sum + src.emissionRateUgMin / 60, 0);
  const coeffsAt = (tS: number) => coeffsFor(stateAt(tS), emissionAt(tS));

  // Breakpoints where inputs change
  const breaks = new Set<number>([0, durationS]);
  for (const e of events) if (e.atS > 0 && e.atS < durationS) breaks.add(e.atS);
  for (const src of sources) {
    for (const w of src.schedule ?? []) {
      for (const t of [w.startMin * 60, (w.startMin + w.durationMin) * 60]) if (t > 0 && t < durationS) breaks.add(t);
    }
  }
  const outputTimes = new Set<number>(breaks);
  for (let t = 0; t < durationS; t += dtS) outputTimes.add(Math.round(t * 1e6) / 1e6);
  const times = [...outputTimes].sort((x, y) => x - y);

  const initial = stateAt(0);
  const penetration0 = env.penetration ?? initial.ventilation.penetration;
  const c0 = options.initialUgM3 ?? penetration0 * cOut;
  const step = options.method === 'rk4' ? rk4Step : exponentialStep;

  const series: { tS: number; c: number }[] = [{ tS: 0, c: c0 }];
  let c = c0;
  for (let n = 1; n < times.length; n++) {
    const t0 = times[n - 1]!;
    const t1 = times[n]!;
    // Inputs are constant on [t0, t1): sample at the midpoint to stay clear of breakpoint edges
    const coeffs = coeffsAt((t0 + t1) / 2);
    let t = t0;
    while (t < t1 - 1e-9) {
      const h = Math.min(dtS, t1 - t);
      c = step(coeffs, c, h);
      t += h;
    }
    series.push({ tS: t1, c });
  }

  // Exposure: trapezoidal time average
  let integral = 0;
  for (let n = 1; n < series.length; n++) {
    integral += ((series[n]!.c + series[n - 1]!.c) / 2) * (series[n]!.tS - series[n - 1]!.tS);
  }

  const finalState = stateAt(Infinity);
  const alwaysOn = sources.filter((src) => !src.schedule || src.schedule.length === 0).reduce((s, src) => s + src.emissionRateUgMin / 60, 0);
  const cssUgM3 = steadyState(coeffsFor(finalState, alwaysOn));

  const thresholdResults: ThresholdResult[] = thresholds.map((th) => {
    const initiallyAbove = c0 > th.valueUgM3;
    let timeS: number | null = null;
    for (let n = 1; n < series.length && timeS === null; n++) {
      const a = series[n - 1]!;
      const b = series[n]!;
      if (a.c > th.valueUgM3 !== b.c > th.valueUgM3) {
        timeS = a.tS + ((th.valueUgM3 - a.c) / (b.c - a.c)) * (b.tS - a.tS);
      }
    }
    return {
      ...th,
      timeS,
      crossing: timeS === null ? null : initiallyAbove ? 'falls-below' : 'rises-above',
      initiallyAbove,
      steadyStateAbove: cssUgM3 > th.valueUgM3,
    };
  });

  const v = initial.ventilation;
  const coeffs0 = coeffsAt(0);
  const purifierPerS = v.volumeM3 > 0 ? totalFlow(v.devices, 'clean') / v.volumeM3 : 0;
  const ventPerS = v.volumeM3 > 0 ? v.totalM3s / v.volumeM3 : 0;

  for (const th of thresholdResults) {
    if (th.steadyStateAbove) warnings.push(`Steady-state PM2.5 (${cssUgM3.toFixed(0)} µg/m³) exceeds the ${th.label} (${th.valueUgM3} µg/m³).`);
  }
  if (thresholds.length > 0) warnings.push('Thresholds are 24-hour mean guidelines; comparing them to instantaneous concentrations is indicative only.');

  return {
    volumeM3: v.volumeM3,
    ventilationType: v.type,
    ach: v.ach,
    achBreakdown: v.achBreakdown,
    openings: v.openings,
    ventilation: v,
    outdoorPm25UgM3: cOut,
    penetration: penetration0,
    lossRatesPerHour: {
      ventilation: ventPerS * 3600,
      deposition: depositionPerS * 3600,
      purifiers: purifierPerS * 3600,
      total: coeffs0.lossPerS * 3600,
    },
    cssUgM3,
    timeConstantS: coeffs0.lossPerS > 0 ? 1 / coeffs0.lossPerS : Infinity,
    initialUgM3: c0,
    series,
    peakUgM3: Math.max(...series.map((p) => p.c)),
    finalUgM3: c,
    thresholds: thresholdResults,
    breathingZoneExposureUgM3: integral / durationS,
    warnings,
  };
}

/** Ventilation inputs of a run: the room's params overridden by any values set in `env`. */
export function resolveVentilationEnv(room: Room, env: WellMixedEnv = {}): VentilationEnv {
  return {
    ...ventilationEnvFromRoom(room),
    ...definedOnly({
      windSpeed: env.windSpeed,
      windDirDeg: env.windDirDeg,
      indoorTempC: env.indoorTempC,
      outdoorTempC: env.outdoorTempC,
      exposure: env.exposure,
      infiltrationAch: env.infiltrationAch,
    }),
  };
}

/** Outdoor PM2.5 of a run: env, else the room's stored value, else DEFAULT_OUTDOOR_PM25. */
export function resolveOutdoorPm25(room: Room, env: WellMixedEnv = {}): { outdoorUgM3: number; defaulted: boolean } {
  const v = env.outdoorPm25UgM3 ?? room.params.outdoorPm25?.valueUgM3;
  return v === undefined ? { outdoorUgM3: DEFAULT_OUTDOOR_PM25, defaulted: true } : { outdoorUgM3: v, defaulted: false };
}

function definedOnly<T extends object>(obj: T): Partial<T> {
  return Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined)) as Partial<T>;
}
