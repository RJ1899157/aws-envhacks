import type { Opening, Room, SiteExposure, Vec2, Vec3 } from '../core/schema';
import type { OpeningFlowRole } from '../core/voxelizer';
import { windFromXZ } from '../core/wind';
import {
  CP_BY_EXPOSURE,
  CP_INCIDENCE_DEG,
  DEFAULT_INFILTRATION_ACH,
  DEFAULT_SITE_EXPOSURE,
  DISCHARGE_COEFFICIENT,
  GRAVITY,
  INFILTRATION_PENETRATION,
  KELVIN_OFFSET,
  OPEN_WINDOW_PENETRATION,
  SAME_FACADE_NORMAL_DOT,
  SECONDS_PER_HOUR,
  SINGLE_OPENING_STACK_AREA_FACTOR,
  SINGLE_SIDED_WIND_COEFFICIENT,
  STACK_TWO_OPENING_MIN_HEIGHT_DIFF,
  TERRAIN_WIND_COEFFICIENTS,
  WIND_REFERENCE_HEIGHT_M,
} from './constants';
import { devicesIn, totalFlow, type Device } from './devices';
import { openingGeometries, roomVolume, type OpeningGeometry } from './geometry';

/**
 * Conventions
 * - Wind bearings follow src/core/wind.ts: `windDirDeg` is where the wind blows FROM, clockwise
 *   from north; north = −Z, east = +X.
 * - Signed flows are positive INTO the room.
 * - The flow direction computed here is the source of truth for whether an opening acts as an inlet
 *   or an outlet. The user's `role` tag is only a label (except 'closed', which still means shut).
 */

export interface VentilationEnv {
  /** Reported wind speed (m/s, met-station 10 m, open terrain); reduced by the site exposure */
  windSpeed: number;
  windDirDeg: number; // degrees, wind FROM, 0 = north
  indoorTempC: number;
  outdoorTempC: number;
  /** Default room.params.exposure, else DEFAULT_SITE_EXPOSURE ('urbanDense') */
  exposure?: SiteExposure;
  /** Background envelope infiltration (1/h). Default DEFAULT_INFILTRATION_ACH (0.5). */
  infiltrationAch?: number;
}

export function ventilationEnvFromRoom(room: Room): VentilationEnv {
  const { windSpeed, windDirDeg, indoorTempC, outdoorTempC, exposure } = room.params;
  return { windSpeed, windDirDeg, indoorTempC, outdoorTempC, ...(exposure && { exposure }) };
}

export type VentilationType = 'cross' | 'single-sided' | 'stack' | 'mechanical' | 'infiltration' | 'none';
export type FlowDirection = 'in' | 'out' | 'bidirectional' | 'none';

/**
 * How an opening actually behaves:
 * - inlet / outlet: net flow into / out of the room
 * - bidirectional: open to outdoors, exchanging both ways (single-sided, or no net driving force)
 * - interior: open, but onto another room (multi-zone flow is not modelled yet)
 * - closed: shut (tagged closed or 0% open)
 */
export type ComputedRole = OpeningFlowRole;

export interface OpeningFlow {
  id: string;
  wallIndex: number;
  type: Opening['type'];
  /** Role label stored by the user (Phase 1 tag) */
  taggedRole: Opening['role'];
  /** Role from the computed flow; use this downstream, not `taggedRole` */
  computedRole: ComputedRole;
  /** Tagged inlet but acts as an outlet, or vice versa */
  roleMismatch: boolean;
  effectiveArea: number; // m²
  normal: Vec2; // outward, [nx, nz]
  center: Vec3; // world [x, y, z]
  /** Angle between the outward normal and the wind-from direction (0° = windward), degrees */
  windIncidenceDeg: number;
  cp: number;
  /** Net wind-driven flow through the opening, + into the room (m³/s). 0 for single-sided exchange. */
  windNetM3s: number;
  /** Magnitude of wind-driven flow through the opening (m³/s) */
  windM3s: number;
  /** Net stack-driven flow, + into the room (m³/s). 0 for single-opening (bidirectional) exchange. */
  stackNetM3s: number;
  stackM3s: number;
  /** Combined flow through this opening, sqrt(wind² + stack²) (m³/s) */
  flowM3s: number;
  direction: FlowDirection;
  /** Mean normal velocity through the open area, flow / effectiveArea (m/s); voxel inlet BC */
  velocityMs: number;
  /** Not exchanging with outdoors (closed, or on a wall shared with another room) */
  excluded: boolean;
}

export interface AchBreakdown {
  wind: number;
  stack: number;
  natural: number;
  exhaust: number;
  infiltration: number;
  total: number;
}

export interface VentilationResult {
  volumeM3: number;
  type: VentilationType;
  exposure: SiteExposure;
  /** Reported wind (m/s) */
  windSpeed: number;
  /** Wind at the building after the terrain reduction (m/s) */
  localWindSpeed: number;
  windM3s: number;
  stackM3s: number;
  /** sqrt(wind² + stack²) */
  naturalM3s: number;
  exhaustM3s: number;
  infiltrationM3s: number;
  totalM3s: number;
  /** Total air changes per hour */
  ach: number;
  achBreakdown: AchBreakdown;
  /** Flow-weighted particle penetration factor of the incoming air */
  penetration: number;
  openings: OpeningFlow[];
  devices: Device[];
  warnings: string[];
}

// ---------------------------------------------------------------------------
// Closed-form building blocks
// ---------------------------------------------------------------------------

/** Effective area of openings in series: 1/A² = Σ 1/Aᵢ². */
export function seriesArea(areas: readonly number[]): number {
  if (areas.length === 0 || areas.some((a) => a <= 0)) return 0;
  return 1 / Math.sqrt(areas.reduce((s, a) => s + 1 / (a * a), 0));
}

/** Wind-driven cross ventilation through one inlet path and one outlet path: Q = Cd·A_eff·U·sqrt(|ΔCp|). */
export function crossVentilationFlow(inletArea: number, outletArea: number, windSpeed: number, deltaCp: number): number {
  return DISCHARGE_COEFFICIENT * seriesArea([inletArea, outletArea]) * windSpeed * Math.sqrt(Math.abs(deltaCp));
}

/** Single-sided wind ventilation: Q ≈ 0.025·A·U (BS 5925 / CIBSE). */
export function singleSidedFlow(area: number, windSpeed: number): number {
  return SINGLE_SIDED_WIND_COEFFICIENT * area * windSpeed;
}

function meanKelvin(indoorTempC: number, outdoorTempC: number): number {
  return (indoorTempC + outdoorTempC) / 2 + KELVIN_OFFSET;
}

/** Stack flow through a single opening of height h: Q = Cd·(A/3)·sqrt(g·h·|ΔT|/T_mean). */
export function singleOpeningStackFlow(area: number, height: number, indoorTempC: number, outdoorTempC: number): number {
  const dT = Math.abs(indoorTempC - outdoorTempC);
  return DISCHARGE_COEFFICIENT * area * SINGLE_OPENING_STACK_AREA_FACTOR *
    Math.sqrt((GRAVITY * height * dT) / meanKelvin(indoorTempC, outdoorTempC));
}

/** Stack flow between a low and a high opening Δh apart: Q = Cd·A_eff·sqrt(2·g·Δh·|ΔT|/T_mean). */
export function twoOpeningStackFlow(
  lowArea: number,
  highArea: number,
  heightDiff: number,
  indoorTempC: number,
  outdoorTempC: number
): number {
  const dT = Math.abs(indoorTempC - outdoorTempC);
  return DISCHARGE_COEFFICIENT * seriesArea([lowArea, highArea]) *
    Math.sqrt((2 * GRAVITY * heightDiff * dT) / meanKelvin(indoorTempC, outdoorTempC));
}

/** Local wind at the building: U · K · z^a for the site's terrain (BS 5925 Table 8). */
export function localWindSpeed(reportedWindSpeed: number, exposure: SiteExposure = DEFAULT_SITE_EXPOSURE): number {
  const { K, a } = TERRAIN_WIND_COEFFICIENTS[exposure];
  return Math.max(0, reportedWindSpeed) * K * Math.pow(WIND_REFERENCE_HEIGHT_M, a);
}

/**
 * Wind pressure coefficient of a wall from the angle θ between its outward normal and the
 * wind-from direction (0° = windward, 180° = leeward), linearly interpolated in θ between the 45°
 * steps of the AIVC low-rise table for the site exposure. Symmetric about the normal.
 */
export function pressureCoefficient(incidenceDeg: number, exposure: SiteExposure = DEFAULT_SITE_EXPOSURE): number {
  const table = CP_BY_EXPOSURE[exposure];
  const t = Math.min(180, Math.abs(incidenceDeg));
  for (let i = 1; i < CP_INCIDENCE_DEG.length; i++) {
    const t1 = CP_INCIDENCE_DEG[i]!;
    if (t <= t1) {
      const t0 = CP_INCIDENCE_DEG[i - 1]!;
      return table[i - 1]! + ((table[i]! - table[i - 1]!) * (t - t0)) / (t1 - t0);
    }
  }
  return table[table.length - 1]!;
}

export function windIncidenceDeg(normal: Vec2, windDirDeg: number): number {
  const f = windFromXZ(windDirDeg);
  const c = Math.max(-1, Math.min(1, normal[0] * f[0] + normal[1] * f[1]));
  return (Math.acos(c) * 180) / Math.PI;
}

/**
 * Multi-opening wind flow: finds the internal pressure coefficient Cpᵢₙ that balances mass,
 * Σ Cd·Aᵢ·U·sign(Cpᵢ − Cpᵢₙ)·sqrt(|Cpᵢ − Cpᵢₙ|) = 0, by bisection. For one inlet and one outlet this
 * reduces exactly to Q = Cd·A_eff·U·sqrt(|ΔCp|) with 1/A_eff² = 1/A₁² + 1/A₂²; parallel openings on a
 * facade add their areas. Returns signed flows (+ in).
 */
export function solveWindFlows(areas: readonly number[], cps: readonly number[], windSpeed: number): number[] {
  const flowAt = (cpIn: number) =>
    areas.map((a, i) => {
      const d = cps[i]! - cpIn;
      return DISCHARGE_COEFFICIENT * a * windSpeed * Math.sign(d) * Math.sqrt(Math.abs(d));
    });
  if (areas.length < 2 || windSpeed <= 0) return areas.map(() => 0);
  let lo = Math.min(...cps);
  let hi = Math.max(...cps);
  for (let iter = 0; iter < 200 && hi - lo > 1e-12; iter++) {
    const mid = (lo + hi) / 2;
    const net = flowAt(mid).reduce((s, q) => s + q, 0);
    // Net inflow decreases as internal pressure rises
    if (net > 0) lo = mid;
    else hi = mid;
  }
  return flowAt((lo + hi) / 2);
}

function sameFacade(geoms: readonly OpeningGeometry[]): boolean {
  const first = geoms[0];
  if (!first) return true;
  return geoms.every((g) => g.normal[0] * first.normal[0] + g.normal[1] * first.normal[1] > SAME_FACADE_NORMAL_DOT);
}

// ---------------------------------------------------------------------------
// Room ventilation
// ---------------------------------------------------------------------------

export interface VentilationOptions {
  /** Other rooms of the floor plan; openings on walls shared with them are not outdoor openings */
  neighbours?: readonly Room[];
}

/**
 * Air exchange of a single zone with outdoors: wind (cross or single-sided), stack, enabled exhaust
 * devices and background infiltration, with a per-opening breakdown for the voxel solver.
 */
export function computeVentilation(room: Room, env: VentilationEnv, options: VentilationOptions = {}): VentilationResult {
  const warnings: string[] = [];
  const volumeM3 = roomVolume(room);
  const exposure = env.exposure ?? room.params.exposure ?? DEFAULT_SITE_EXPOSURE;
  const allGeoms = openingGeometries(room, options.neighbours ?? []);

  for (const g of allGeoms) {
    if (g.interior && g.effectiveArea > 0) {
      warnings.push(`Opening "${g.id}" is on a wall shared with another room; it is treated as closed to outdoors (multi-zone flow is not modelled yet).`);
    }
  }
  const open = allGeoms.filter((g) => g.effectiveArea > 0 && !g.interior);
  const windSpeed = Math.max(0, env.windSpeed);
  const localWind = localWindSpeed(windSpeed, exposure);
  const dT = env.indoorTempC - env.outdoorTempC;

  const incidence = allGeoms.map((g) => windIncidenceDeg(g.normal, env.windDirDeg));
  const cp = incidence.map((t) => pressureCoefficient(t, exposure));
  const openIdx = allGeoms.map((g, i) => (open.includes(g) ? i : -1)).filter((i) => i >= 0);

  // --- Wind -------------------------------------------------------------------------------------
  const windNet = new Array<number>(allGeoms.length).fill(0);
  const windMag = new Array<number>(allGeoms.length).fill(0);
  const multiFacade = open.length >= 2 && !sameFacade(open);
  let windM3s = 0;
  if (localWind > 0 && open.length > 0) {
    const singleTotal = singleSidedFlow(open.reduce((s, g) => s + g.effectiveArea, 0), localWind);
    let crossTotal = 0;
    let crossFlows: number[] = [];
    if (multiFacade) {
      crossFlows = solveWindFlows(
        openIdx.map((i) => allGeoms[i]!.effectiveArea),
        openIdx.map((i) => cp[i]!),
        localWind
      );
      crossTotal = crossFlows.reduce((s, q) => s + Math.max(0, q), 0);
    }
    // Turbulent single-sided exchange is the floor when the cross-flow pressure difference vanishes
    // (e.g. wind parallel to both facades).
    if (crossTotal >= singleTotal) {
      windM3s = crossTotal;
      openIdx.forEach((i, k) => {
        windNet[i] = crossFlows[k]!;
        windMag[i] = Math.abs(crossFlows[k]!);
      });
    } else {
      windM3s = singleTotal;
      for (const i of openIdx) windMag[i] = singleSidedFlow(allGeoms[i]!.effectiveArea, localWind);
    }
  }

  // --- Stack ------------------------------------------------------------------------------------
  const stackNet = new Array<number>(allGeoms.length).fill(0);
  const stackMag = new Array<number>(allGeoms.length).fill(0);
  let stackM3s = 0;
  if (Math.abs(dT) > 1e-6 && open.length > 0) {
    const heights = open.map((g) => g.centerHeight);
    const hMin = Math.min(...heights);
    const hMax = Math.max(...heights);
    if (open.length >= 2 && hMax - hMin >= STACK_TWO_OPENING_MIN_HEIGHT_DIFF) {
      const split = (hMin + hMax) / 2;
      const low = openIdx.filter((i) => allGeoms[i]!.centerHeight < split);
      const high = openIdx.filter((i) => allGeoms[i]!.centerHeight >= split);
      const areaOf = (ids: number[]) => ids.reduce((s, i) => s + allGeoms[i]!.effectiveArea, 0);
      const meanH = (ids: number[]) => ids.reduce((s, i) => s + allGeoms[i]!.effectiveArea * allGeoms[i]!.centerHeight, 0) / areaOf(ids);
      const aLow = areaOf(low);
      const aHigh = areaOf(high);
      stackM3s = twoOpeningStackFlow(aLow, aHigh, meanH(high) - meanH(low), env.indoorTempC, env.outdoorTempC);
      // Warm inside: air enters low and leaves high; reversed when outdoors is warmer
      const lowSign = dT > 0 ? 1 : -1;
      for (const i of low) {
        stackMag[i] = (stackM3s * allGeoms[i]!.effectiveArea) / aLow;
        stackNet[i] = lowSign * stackMag[i]!;
      }
      for (const i of high) {
        stackMag[i] = (stackM3s * allGeoms[i]!.effectiveArea) / aHigh;
        stackNet[i] = -lowSign * stackMag[i]!;
      }
    } else {
      for (const i of openIdx) {
        const g = allGeoms[i]!;
        stackMag[i] = singleOpeningStackFlow(g.effectiveArea, g.clearHeight, env.indoorTempC, env.outdoorTempC);
        stackM3s += stackMag[i]!;
      }
    }
  }

  // --- Mechanical and infiltration ---------------------------------------------------------------
  const devices = devicesIn(room.objects);
  const exhaustM3s = totalFlow(devices, 'exhaust');
  const infiltrationM3s = ((env.infiltrationAch ?? DEFAULT_INFILTRATION_ACH) * volumeM3) / SECONDS_PER_HOUR;

  // Quadrature superposition of wind and stack (CIBSE AM10 / BS 5925 simple method). It is an
  // approximation: it ignores that the two can oppose each other through a given opening.
  const naturalM3s = Math.hypot(windM3s, stackM3s);
  // Mechanical exhaust and infiltration added linearly (an upper bound; ASHRAE Fundamentals
  // suggests quadrature superposition for unbalanced flows: sqrt(Q_nat² + Q_exhaust²)).
  const totalM3s = naturalM3s + exhaustM3s + infiltrationM3s;

  // Makeup air for exhaust comes through open windows if any, otherwise through envelope cracks.
  const makeupP = open.length > 0 ? OPEN_WINDOW_PENETRATION : INFILTRATION_PENETRATION;
  const penetration = totalM3s > 0
    ? (naturalM3s * OPEN_WINDOW_PENETRATION + exhaustM3s * makeupP + infiltrationM3s * INFILTRATION_PENETRATION) / totalM3s
    : OPEN_WINDOW_PENETRATION;

  const openings: OpeningFlow[] = allGeoms.map((g, i) => {
    const excluded = !openIdx.includes(i);
    const flow = Math.hypot(windMag[i]!, stackMag[i]!);
    const net = windNet[i]! + stackNet[i]!;
    let direction: FlowDirection = 'none';
    if (flow > 1e-9) direction = Math.abs(net) > 0.05 * flow ? (net > 0 ? 'in' : 'out') : 'bidirectional';
    let computedRole: ComputedRole;
    if (g.effectiveArea <= 0) computedRole = 'closed';
    else if (g.interior) computedRole = 'interior';
    else computedRole = direction === 'in' ? 'inlet' : direction === 'out' ? 'outlet' : 'bidirectional';
    const roleMismatch =
      (g.role === 'inlet' && computedRole === 'outlet') || (g.role === 'outlet' && computedRole === 'inlet');
    return {
      id: g.id,
      wallIndex: g.wallIndex,
      type: g.type,
      taggedRole: g.role,
      computedRole,
      roleMismatch,
      effectiveArea: g.effectiveArea,
      normal: g.normal,
      center: g.center,
      windIncidenceDeg: incidence[i]!,
      cp: cp[i]!,
      windNetM3s: windNet[i]!,
      windM3s: windMag[i]!,
      stackNetM3s: stackNet[i]!,
      stackM3s: stackMag[i]!,
      flowM3s: flow,
      direction,
      velocityMs: g.effectiveArea > 0 ? flow / g.effectiveArea : 0,
      excluded,
    };
  });

  // --- Classification and warnings ---------------------------------------------------------------
  const fallbackType: VentilationType = exhaustM3s > 0 ? 'mechanical' : infiltrationM3s > 0 ? 'infiltration' : 'none';
  let type: VentilationType;
  if (open.length === 0) type = fallbackType;
  else if (windM3s <= 0) type = stackM3s > 0 ? 'stack' : fallbackType;
  else type = multiFacade && windNet.some((q) => q !== 0) ? 'cross' : 'single-sided';

  if (open.length === 0) {
    warnings.push(
      type === 'none'
        ? 'No open openings to outdoors, no exhaust fan and no infiltration; the room exchanges no air in this model.'
        : 'No open openings to outdoors; air exchange comes from exhaust fans and/or envelope infiltration only.'
    );
  } else {
    if (windSpeed <= 0) warnings.push('Wind speed is 0 m/s; natural ventilation is from the stack effect only.');
    if (windSpeed <= 0 && Math.abs(dT) <= 1e-6) warnings.push('No wind and no indoor/outdoor temperature difference; no natural driving force.');
    for (const o of openings) {
      if (o.roleMismatch) {
        warnings.push(`Opening "${o.id}" is tagged ${o.taggedRole} but acts as an ${o.computedRole} (wind from ${env.windDirDeg}°).`);
      }
    }
  }
  if (devices.some((d) => d.enabled && d.role === 'exhaust')) warnings.push('Enabled exhaust fans / range hoods are assumed to run continuously.');
  if (devices.some((d) => d.enabled && d.role === 'mix')) {
    warnings.push('Ceiling/pedestal fans and ACs only mix room air; they do not change ACH in the well-mixed model.');
  }

  const toAch = (q: number) => (volumeM3 > 0 ? (q * SECONDS_PER_HOUR) / volumeM3 : 0);
  return {
    volumeM3,
    type,
    exposure,
    windSpeed,
    localWindSpeed: localWind,
    windM3s,
    stackM3s,
    naturalM3s,
    exhaustM3s,
    infiltrationM3s,
    totalM3s,
    ach: toAch(totalM3s),
    achBreakdown: {
      wind: toAch(windM3s),
      stack: toAch(stackM3s),
      natural: toAch(naturalM3s),
      exhaust: toAch(exhaustM3s),
      infiltration: toAch(infiltrationM3s),
      total: toAch(totalM3s),
    },
    penetration,
    openings,
    devices,
    warnings,
  };
}

/**
 * Computed role per opening id, for the voxelizer and solver (which must not use the user's tag).
 * Openings of neighbouring rooms that sit on this room's shared walls are not included; the
 * voxelizer treats those as interior passages.
 */
export function computedOpeningRoles(result: Pick<VentilationResult, 'openings'>): Record<string, ComputedRole> {
  return Object.fromEntries(result.openings.map((o) => [o.id, o.computedRole]));
}
