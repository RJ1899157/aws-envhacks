import type { Room } from '../../core/schema';
import {
  BREATHING_ZONE_HEIGHT_M,
  DEFAULT_DURATION_S,
  HOTSPOT_MIN_VOLUME_M3,
  HOTSPOT_RELATIVE,
  PM25_DEPOSITION_RATE_PER_S,
  STAGNANT_NORMALISED_AGE,
  VOXEL_DIVERGENCE_TOL,
  VOXEL_DX_FULL,
  VOXEL_DX_LIVE,
  VOXEL_MAX_MIN_FLOW_TIME_S,
  VOXEL_MAX_SCALAR_DT_S,
  VOXEL_MAX_VELOCITY_STEPS,
  VOXEL_MIN_SCALAR_DT_S,
  VOXEL_SCALAR_DT_FRACTION,
  VOXEL_VELOCITY_TOL,
} from '../constants';
import type { HouseEnv } from '../house/house';
import { simulateHouseNetwork, type NetworkResult } from '../house/network';
import {
  bandValues,
  cellCentredVelocity,
  downsampleVector,
  fieldStats,
  findHotspots,
  toGridField,
  type FieldStats,
  type GridInfo,
  type Hotspot,
} from './analysis';
import { chooseDt, createFlowState, divergenceResidual, facePosition, flowStep, maxSpeed, project, type VelocityField } from './flow';
import { buildDomain, type DomainOpening } from './grid';
import { buildTransport, emissionRows, massBudget, recirculationReturn, solveSteady, stepImplicit } from './scalar';

const addRows = (a: Float64Array, b: Float64Array) => a.map((v, i) => v + b[i]!);

/**
 * Whole-house voxel airflow + PM2.5 + age-of-air solver.
 *
 * All rooms share one grid with an outdoor margin (see grid.ts). Air is driven by pressures, not
 * prescribed velocities: every exterior opening is a pressure boundary at the wind pressure
 * ½ρCpU²_local plus the stack term −(ρ_out − ρ_in)·g·z, every opening (exterior or interior,
 * including door undercuts) carries an orifice loss so its flow follows Q = Cd·A·sqrt(2Δp/ρ), and
 * the pressure projection decides where air enters and leaves the house. Devices add jets
 * (fans, AC, purifier outlets), recirculation (purifiers, AC) and extraction (exhaust fans).
 * Scalars: PM2.5 (outdoor air at P·C_out through openings, P_crack·C_out through the envelope,
 * sources, deposition, purifiers) and local mean age of air.
 */

export type VoxelResolution = 'live' | 'full';

export type VoxelEnv = Partial<HouseEnv> & {
  /** Alias of outdoorUgM3 (older callers) */
  outdoorPm25UgM3?: number;
  depositionPerS?: number;
};

export interface VoxelSimInput {
  /** Every room of the floor plan; the first supplies wind, temperatures and outdoor PM2.5 */
  rooms?: readonly Room[];
  /** Single-room form: rooms = [room, ...neighbours] */
  room?: Room;
  neighbours?: readonly Room[];
  env?: VoxelEnv;
  /** 'live' = 0.2 m, 'full' = 0.1 m, or an explicit cell size (m) */
  resolution?: VoxelResolution | number;
  durationS?: number;
  snapshotTimesS?: readonly number[];
  /** Initial uniform PM2.5 (µg/m³); default P·C_out */
  initialUgM3?: number;
  maxVelocitySteps?: number;
  /** Absolute hotspot thresholds; default HOTSPOT_RELATIVE × volume mean */
  hotspotPm25UgM3?: number;
  hotspotAgeMinutes?: number;
  /** Reserved for a temperature field (buoyancy inside rooms) */
  buoyancy?: false;
}

export interface VoxelProgress {
  phase: 'setup' | 'velocity' | 'pm25' | 'age' | 'transient' | 'analysis';
  /** 0–1 within the whole run */
  fraction: number;
  message: string;
}

export interface VoxelHooks {
  onProgress?: (p: VoxelProgress) => void;
  isCancelled?: () => boolean;
  /** Called between chunks of work so a worker can process messages (default: setTimeout 0) */
  yieldControl?: () => Promise<void>;
}

export interface ZoneComparison {
  index: number;
  roomId: string;
  name: string;
  volumeM3: number;
  voxelPm25Steady: number;
  voxelPm25Final: number;
  voxelAgeMinutes: number | null;
  networkPm25Steady: number;
  networkAgeMinutes: number;
  networkAchOutdoor: number;
  networkAchTotal: number;
  nominalTauMinutes: number;
}

export interface PathComparison {
  id: string;
  kind: DomainOpening['kind'];
  from: number;
  to: number;
  faces: number;
  voxelAreaM2: number;
  /** Net flow from `from` to `to` (m³/s) */
  voxelFlowM3s: number;
  networkFlowM3s: number;
  /** Gross exchange (sum of both directions, /2 for two-way) */
  voxelExchangeM3s: number;
  networkExchangeM3s: number;
}

export interface StagnantRegion extends Hotspot {
  meanAgeMinutes: number;
  zone: number;
}

export interface VoxelSimResult {
  grid: GridInfo & {
    /** Cell types (core/voxelizer CellType) */
    cells: Uint8Array;
    /** 1 where air moves (FLUID / POROUS / SOURCE) */
    fluid: Uint8Array;
    /** Room index of every cell (−1 outdoors), into `zones` */
    zoneOf: Int16Array;
  };
  velocity: {
    /** Cell-centred (u, v, w) m/s, 3 floats per cell, 0 outside fluid */
    cell: Float32Array;
    /** Block-averaged copy (factor 2) for arrows */
    downsampled: GridInfo & { factor: number; data: Float32Array };
    /** Raw MAC face velocities (m/s) */
    faces: { u: Float32Array; v: Float32Array; w: Float32Array };
    maxSpeed: number;
  };
  pm25: {
    /** Steady state with every source on (µg/m³; NaN outside fluid) */
    steady: Float32Array;
    /** End of the transient run */
    final: Float32Array;
    snapshots: { tS: number; mean: number; zoneMeans: number[]; field: Float32Array }[];
  };
  /** Steady local mean age of air (minutes); null when nothing exchanges air */
  ageMinutes: Float32Array | null;
  /** Age ÷ the house's nominal time constant (summary.houseTauMinutes); > STAGNANT_NORMALISED_AGE = stagnant */
  ageNormalised: Float32Array | null;
  /** Tracer start points (world xyz triples): just inside openings with inflow, and device jets */
  spawn: { inflow: Float32Array; devices: Float32Array };
  breathingZone: { heightM: readonly [number, number]; pm25: FieldStats; pm25Steady: FieldStats; ageMinutes: FieldStats | null };
  hotspots: {
    pm25ThresholdUgM3: number;
    ageThresholdMinutes: number | null;
    pm25: Hotspot[];
    age: Hotspot[];
    stagnant: StagnantRegion[];
  };
  zones: ZoneComparison[];
  paths: PathComparison[];
  summary: {
    volumeMeanPm25Steady: number;
    volumeMeanPm25Final: number;
    /** Volume-weighted network (multi-zone) steady PM2.5 */
    networkMeanPm25: number;
    /** (voxel − network) / network for the steady volume mean */
    networkDifference: number;
    volumeMeanAgeMinutes: number | null;
    networkMeanAgeMinutes: number;
    outdoorUgM3: number;
    /** Whole-house nominal time constant: Σ volume / Σ outdoor inflow (min) */
    houseTauMinutes: number;
  };
  network: Pick<NetworkResult, 'zones' | 'paths' | 'massBalanceError' | 'newtonIterations'>;
  diagnostics: {
    dx: number;
    cells: number;
    fluidCells: number;
    velocitySteps: number;
    velocityConverged: boolean;
    finalRelChange: number;
    /** Normalised max divergence residual of the averaged field */
    divergenceResidual: number;
    pressureIterationsPerStep: number;
    simulatedFlowTimeS: number;
    scalarIterations: { pm25Steady: number; age: number; transient: number };
    /** |gains − losses| / gains of the steady PM2.5 field */
    steadyMassBalanceError: number;
    /** Σ|ΔM − dt·(gains − losses)| / (M0 + Σ dt·gains) over the transient run */
    transientMassBalanceError: number;
    wallTimeMs: { domain: number; velocity: number; scalars: number; total: number };
  };
  warnings: string[];
}

export class VoxelCancelledError extends Error {
  constructor() {
    super('Voxel simulation cancelled');
    this.name = 'VoxelCancelledError';
  }
}

/** Snapshot times (min) dense enough to watch a plume spread. */
export const VOXEL_PLAYBACK_MINUTES: readonly number[] = [0, 2, 5, 10, 15, 20, 30, 45, 60, 90, 120, 180, 240, 360, 480];

const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());
const defaultYield = () => new Promise<void>((r) => setTimeout(r, 0));

export function resolutionDx(res: VoxelSimInput['resolution']): number {
  if (typeof res === 'number') return res;
  return res === 'full' ? VOXEL_DX_FULL : VOXEL_DX_LIVE;
}

export function inputRooms(input: VoxelSimInput): Room[] {
  if (input.rooms && input.rooms.length > 0) return [...input.rooms];
  if (input.room) return [input.room, ...(input.neighbours ?? [])];
  throw new Error('runVoxelSimulation needs `rooms` or `room`');
}

export async function runVoxelSimulation(input: VoxelSimInput, hooks: VoxelHooks = {}): Promise<VoxelSimResult> {
  const t0 = now();
  const yieldControl = hooks.yieldControl ?? defaultYield;
  let lastYield = now();
  const checkpoint = async (p?: VoxelProgress) => {
    if (p) hooks.onProgress?.(p);
    if (now() - lastYield > 30) {
      await yieldControl();
      lastYield = now();
    }
    if (hooks.isCancelled?.()) throw new VoxelCancelledError();
  };
  if (input.buoyancy) throw new Error('Buoyancy is not implemented yet.');

  const rooms = inputRooms(input);
  const { outdoorPm25UgM3, depositionPerS: depOverride, ...houseEnv } = input.env ?? {};
  const envOverrides: Partial<HouseEnv> = { ...houseEnv, ...(outdoorPm25UgM3 !== undefined && { outdoorUgM3: outdoorPm25UgM3 }) };
  const dx = resolutionDx(input.resolution);
  const durationS = input.durationS ?? DEFAULT_DURATION_S;
  const snapshotTimes = [...new Set([...(input.snapshotTimesS ?? VOXEL_PLAYBACK_MINUTES.map((m) => m * 60)).filter((t) => t >= 0 && t <= durationS), 0, durationS])].sort((a, b) => a - b);
  const depositionPerS = depOverride ?? PM25_DEPOSITION_RATE_PER_S;

  // --- Setup: network model (also the comparison) and the voxel domain ---------------------------
  await checkpoint({ phase: 'setup', fraction: 0, message: 'Building the house grid' });
  const network = simulateHouseNetwork(rooms, envOverrides, { durationS, depositionPerS });
  const house = network.house;
  const outdoorUgM3 = house.env.outdoorUgM3;
  const domain = buildDomain({ house, dx });
  const warnings = [...network.warnings, ...domain.warnings];
  if (domain.fluidCount === 0) throw new Error('The house has no fluid cells at this resolution.');
  const flow = createFlowState(domain);
  const tDomain = now();

  // --- Velocity: march Stable Fluids to a quasi-steady state ---------------------------------------
  const maxSteps = input.maxVelocitySteps ?? VOXEL_MAX_VELOCITY_STEPS;
  let pLo = Infinity;
  let pHi = -Infinity;
  for (const f of flow.pressureFaces) {
    pLo = Math.min(pLo, f.p0);
    pHi = Math.max(pHi, f.p0);
  }
  const pressureDriven = flow.pressureFaces.length > 0 && pHi - pLo > 1e-9;
  const hasDrivers = pressureDriven || domain.jets.length > 0 || domain.sSink.some((s) => s !== 0);
  let steps = 0;
  let converged = !hasDrivers;
  let relChange = 0;
  let simTime = 0;
  let calm = 0;
  // Exponential moving average of the last ~40 steps: a combination of divergence-free fields is
  // divergence-free, and it smooths out the jitter of jets without storing 40 copies
  const avg: VelocityField = { u: new Float64Array(flow.field.u.length), v: new Float64Array(flow.field.v.length), w: new Float64Array(flow.field.w.length) };
  const AVG_STEPS = 40;
  const diagonal = Math.hypot(domain.nx, domain.ny, domain.nz) * dx;
  const speeds = [...domain.jets.map((j) => Math.abs(j.target)), ...(pressureDriven ? [Math.sqrt((2 * (pHi - pLo)) / domain.rho) * 0.5] : [])].filter((v) => v > 0);
  const driverSpeed = Math.max(0.05, Math.min(...speeds, Infinity));
  const minFlowTime = Math.min(VOXEL_MAX_MIN_FLOW_TIME_S, diagonal / driverSpeed);
  if (hasDrivers) {
    project(flow, chooseDt(flow));
    for (; steps < maxSteps; steps++) {
      const dt = chooseDt(flow);
      const st = flowStep(flow, dt);
      simTime += dt;
      relChange = st.relChange;
      const w = steps === 0 ? 1 : 1 / Math.min(AVG_STEPS, steps + 1);
      for (const [a, f] of [[avg.u, flow.field.u], [avg.v, flow.field.v], [avg.w, flow.field.w]] as const) {
        for (let i = 0; i < a.length; i++) a[i] = a[i]! + w * (f[i]! - a[i]!);
      }
      calm = relChange < VOXEL_VELOCITY_TOL ? calm + 1 : 0;
      if (calm >= 10 && simTime >= minFlowTime && divergenceResidual(flow) < VOXEL_DIVERGENCE_TOL) {
        converged = true;
        steps++;
        break;
      }
      await checkpoint({ phase: 'velocity', fraction: 0.05 + 0.55 * (steps / maxSteps), message: `Airflow step ${steps} (Δ ${relChange.toExponential(1)})` });
    }
    if (!converged) warnings.push(`Airflow did not fully settle within ${maxSteps} steps (last change ${relChange.toExponential(1)}); the recent steps are averaged.`);
  } else {
    warnings.push('Nothing drives the air (no open window with a pressure difference, no fan): it is still; PM2.5 and age evolve by diffusion and uniform exchange only.');
  }
  const field = hasDrivers ? avg : flow.field;
  const divRes = hasDrivers ? divergenceResidual(flow, field) : 0;
  const tVelocity = now();

  // --- Scalars ------------------------------------------------------------------------------------
  await checkpoint({ phase: 'pm25', fraction: 0.62, message: 'Steady PM2.5' });
  const pmOp = buildTransport(flow, 'pm25', field, { depositionPerS });
  const steadyEmission = emissionRows(flow, null);
  const networkMean = (values: number[]) => network.zones.reduce((s, z, i) => s + values[i]! * z.volumeM3, 0) / network.zones.reduce((s, z) => s + z.volumeM3, 0);
  const pmSteady = new Float64Array(flow.pressure.size);
  for (let r = 0; r < pmSteady.length; r++) pmSteady[r] = network.zones[domain.zoneOf[flow.cellOfRow[r]!]!]?.cssUgM3 ?? outdoorUgM3;
  const pmStats = solveSteady(flow, pmOp, steadyEmission, pmSteady);
  const steadyGains = addRows(steadyEmission, recirculationReturn(flow, 'pm25', pmSteady));
  const steadyBudget = massBudget(flow, pmOp, pmSteady, steadyGains, depositionPerS);
  const steadyMassBalanceError = steadyBudget.gains > 0 ? Math.abs(steadyBudget.gains - steadyBudget.losses) / steadyBudget.gains : 0;

  await checkpoint({ phase: 'age', fraction: 0.7, message: 'Age of air' });
  const ageOp = buildTransport(flow, 'age', field);
  let ageRows: Float64Array | null = null;
  let ageIters = 0;
  if (ageOp.exchanges) {
    ageRows = new Float64Array(flow.pressure.size);
    for (let r = 0; r < ageRows.length; r++) ageRows[r] = (network.zones[domain.zoneOf[flow.cellOfRow[r]!]!]?.ageMinutes ?? 60) * 60;
    ageIters = solveSteady(flow, ageOp, null, ageRows).iterations;
  } else {
    warnings.push('The house exchanges no air with outdoors, so the age of air grows without bound; no age field is reported.');
  }

  // Transient from a uniform initial field, backward Euler between snapshot times
  const c0 = input.initialUgM3 ?? domain.inflowUgM3;
  const pm = new Float64Array(flow.pressure.size).fill(c0);
  const snapshots: VoxelSimResult['pm25']['snapshots'] = [];
  const breaks = new Set<number>(snapshotTimes);
  for (const src of domain.sources) for (const w of src.schedule ?? []) for (const t of [w.startMin * 60, (w.startMin + w.durationMin) * 60]) if (t > 0 && t < durationS) breaks.add(t);
  const times = [...breaks].sort((a, b) => a - b);
  const fastestTau = Math.min(...network.zones.map((z) => z.nominalTauMinutes * 60).filter((v) => Number.isFinite(v) && v > 0), Infinity);
  const scalarDt = Math.min(VOXEL_MAX_SCALAR_DT_S, Math.max(VOXEL_MIN_SCALAR_DT_S, VOXEL_SCALAR_DT_FRACTION * (Number.isFinite(fastestTau) ? fastestTau : 3600)));
  let transientIters = 0;
  let imbalance = 0;
  let throughput = c0 * pmOp.cellVol * flow.pressure.size;
  const snapshotSet = new Set(snapshotTimes);
  const nZones = domain.zones.length;
  const zoneMeansOf = (rows: Float64Array) => {
    const sum = new Float64Array(nZones);
    const cnt = new Float64Array(nZones);
    for (let r = 0; r < rows.length; r++) {
      const z = domain.zoneOf[flow.cellOfRow[r]!]!;
      if (z < 0) continue;
      sum[z] = sum[z]! + rows[r]!;
      cnt[z] = cnt[z]! + 1;
    }
    return Array.from(sum, (s, z) => (cnt[z]! > 0 ? s / cnt[z]! : NaN));
  };
  const record = (t: number) => {
    if (!snapshotSet.has(t)) return;
    const mean = pm.reduce((s, v) => s + v, 0) / pm.length;
    snapshots.push({ tS: t, mean, zoneMeans: zoneMeansOf(pm), field: toGridField(domain, flow.cellOfRow, pm) });
  };
  record(0);
  for (let n = 1; n < times.length; n++) {
    const ta = times[n - 1]!;
    const tb = times[n]!;
    const emission = emissionRows(flow, (ta + tb) / 2);
    let t = ta;
    while (t < tb - 1e-9) {
      const dt = Math.min(scalarDt, tb - t);
      // Purifier/AC returns are lagged one step (explicit coupling of the non-local term)
      const gains = addRows(emission, recirculationReturn(flow, 'pm25', pm));
      const before = massBudget(flow, pmOp, pm, gains, depositionPerS).mass;
      transientIters += stepImplicit(pmOp, gains, pm, dt).iterations;
      const after = massBudget(flow, pmOp, pm, gains, depositionPerS);
      imbalance += Math.abs(after.mass - before - dt * (after.gains - after.losses));
      throughput += dt * after.gains;
      t += dt;
      await checkpoint({ phase: 'transient', fraction: 0.75 + 0.2 * (t / durationS), message: `PM2.5 t = ${(t / 60).toFixed(0)} min` });
    }
    record(tb);
  }
  const tScalars = now();

  // --- Analysis -----------------------------------------------------------------------------------
  await checkpoint({ phase: 'analysis', fraction: 0.97, message: 'Analysis' });
  const grid: GridInfo = { nx: domain.nx, ny: domain.ny, nz: domain.nz, dx, origin: domain.origin };
  const steadyField = toGridField(domain, flow.cellOfRow, pmSteady);
  const finalField = toGridField(domain, flow.cellOfRow, pm);
  const ageField = ageRows ? toGridField(domain, flow.cellOfRow, ageRows, 1 / 60) : null;
  // Nominal time constant of the whole house: total volume / total outdoor air coming in. Local
  // age ÷ this is the local air-change index of ventilation-effectiveness studies, so a shut room
  // that only gets air through undercuts and leaks reads as stagnant, not just its corners.
  const houseVolume = network.zones.reduce((s, z) => s + z.volumeM3, 0);
  const houseOutdoorIn = network.zones.reduce((s, z) => s + (z.achOutdoor * z.volumeM3) / 3600, 0);
  const houseTauMinutes = houseOutdoorIn > 0 ? houseVolume / houseOutdoorIn / 60 : Infinity;
  let ageNormalised: Float32Array | null = null;
  if (ageField && Number.isFinite(houseTauMinutes)) {
    ageNormalised = new Float32Array(ageField.length).fill(NaN);
    for (let c = 0; c < ageField.length; c++) {
      if (domain.zoneOf[c]! >= 0 && Number.isFinite(ageField[c]!)) ageNormalised[c] = ageField[c]! / houseTauMinutes;
    }
  }
  const [y0, y1] = BREATHING_ZONE_HEIGHT_M;
  const meanOf = (rows: Float64Array) => rows.reduce((s, v) => s + v, 0) / rows.length;
  const meanSteady = meanOf(pmSteady);
  const meanAge = ageRows ? meanOf(ageRows) / 60 : null;
  const pmThreshold = input.hotspotPm25UgM3 ?? HOTSPOT_RELATIVE * meanSteady;
  const ageThreshold = meanAge === null ? null : (input.hotspotAgeMinutes ?? HOTSPOT_RELATIVE * meanAge);
  const cellVel = cellCentredVelocity(domain, field);

  const stagnant: StagnantRegion[] = [];
  if (ageNormalised && ageField) {
    // Per room, so stale rooms side by side are not merged into one region across their wall
    for (let z = 0; z < domain.zones.length; z++) {
      const masked = ageNormalised.map((v, c) => (domain.zoneOf[c] === z ? v : NaN));
      for (const h of findHotspots(grid, masked, STAGNANT_NORMALISED_AGE, HOTSPOT_MIN_VOLUME_M3 * 10, 4)) stagnant.push({ ...h, meanAgeMinutes: h.mean * houseTauMinutes, zone: z });
    }
    stagnant.sort((a, b) => b.volumeM3 - a.volumeM3);
  }

  // Per-zone and per-path comparison with the network model
  const steadyZone = zoneMeansOf(pmSteady);
  const finalZone = zoneMeansOf(pm);
  const ageZone = ageRows ? zoneMeansOf(ageRows) : null;
  const zones: ZoneComparison[] = network.zones.map((z, i) => ({
    index: i,
    roomId: z.roomId,
    name: z.name,
    volumeM3: domain.zones[i]!.volumeM3,
    voxelPm25Steady: steadyZone[i]!,
    voxelPm25Final: finalZone[i]!,
    voxelAgeMinutes: ageZone ? ageZone[i]! / 60 : null,
    networkPm25Steady: z.cssUgM3,
    networkAgeMinutes: z.ageMinutes,
    networkAchOutdoor: z.achOutdoor,
    networkAchTotal: z.achTotal,
    nominalTauMinutes: z.nominalTauMinutes,
  }));
  const arrays = [field.u, field.v, field.w];
  const paths: PathComparison[] = domain.openings.map((o) => {
    let net = 0;
    let gross = 0;
    for (const f of o.faces) {
      const q = f.outward * arrays[f.axis]![f.index]! * dx * dx;
      net += q;
      gross += Math.abs(q);
    }
    const np = network.paths.find((p) => p.id === o.id);
    return {
      id: o.id,
      kind: o.kind,
      from: o.from,
      to: o.to,
      faces: o.faces.length,
      voxelAreaM2: o.voxelArea,
      voxelFlowM3s: net,
      networkFlowM3s: np?.flowM3s ?? 0,
      voxelExchangeM3s: gross / 2 + Math.abs(net) / 2,
      networkExchangeM3s: np ? Math.max(np.forwardM3s, np.backwardM3s) : 0,
    };
  });

  // Tracer spawn points: just inside openings where air comes in, and device jets
  const inflowPts: number[] = [];
  for (const o of domain.openings) {
    if (o.kind === 'undercut') continue;
    for (const f of o.faces) {
      const p = facePosition(domain, f.axis, f.index);
      if (o.to < 0) {
        // Exterior: only where outdoor air comes in, half a cell inside the room
        if (-f.outward * arrays[f.axis]![f.index]! <= 1e-6) continue;
        p[f.axis] = p[f.axis]! - f.outward * (dx / 2);
      }
      // Interior openings are seeded on the face itself so the room-to-room exchange shows
      inflowPts.push(...p);
    }
  }
  const devicePts: number[] = [];
  const jetStride = Math.max(1, Math.floor(domain.jets.length / 200));
  for (let i = 0; i < domain.jets.length; i += jetStride) devicePts.push(...facePosition(domain, domain.jets[i]!.axis, domain.jets[i]!.index));
  if (domain.openings.every((o) => o.to >= 0)) warnings.push('No open window or exterior door anywhere in the house.');
  const networkMeanPm25 = networkMean(network.zones.map((z) => z.cssUgM3));

  const tEnd = now();
  return {
    grid: { ...grid, cells: domain.cells, fluid: domain.fluid, zoneOf: domain.zoneOf },
    velocity: {
      cell: cellVel,
      downsampled: downsampleVector(domain, cellVel, 2),
      faces: { u: Float32Array.from(field.u), v: Float32Array.from(field.v), w: Float32Array.from(field.w) },
      maxSpeed: maxSpeed(field),
    },
    pm25: { steady: steadyField, final: finalField, snapshots },
    ageMinutes: ageField,
    ageNormalised,
    spawn: { inflow: Float32Array.from(inflowPts), devices: Float32Array.from(devicePts) },
    breathingZone: {
      heightM: BREATHING_ZONE_HEIGHT_M,
      pm25: fieldStats(bandValues(grid, finalField, y0, y1)),
      pm25Steady: fieldStats(bandValues(grid, steadyField, y0, y1)),
      ageMinutes: ageField ? fieldStats(bandValues(grid, ageField, y0, y1)) : null,
    },
    hotspots: {
      pm25ThresholdUgM3: pmThreshold,
      ageThresholdMinutes: ageThreshold,
      pm25: findHotspots(grid, steadyField, pmThreshold, HOTSPOT_MIN_VOLUME_M3),
      age: ageField && ageThreshold !== null ? findHotspots(grid, ageField, ageThreshold, HOTSPOT_MIN_VOLUME_M3) : [],
      stagnant,
    },
    zones,
    paths,
    summary: {
      volumeMeanPm25Steady: meanSteady,
      volumeMeanPm25Final: meanOf(pm),
      networkMeanPm25,
      networkDifference: networkMeanPm25 > 0 ? (meanSteady - networkMeanPm25) / networkMeanPm25 : 0,
      volumeMeanAgeMinutes: meanAge,
      networkMeanAgeMinutes: networkMean(network.zones.map((z) => z.ageMinutes)),
      outdoorUgM3,
      houseTauMinutes,
    },
    network: { zones: network.zones, paths: network.paths, massBalanceError: network.massBalanceError, newtonIterations: network.newtonIterations },
    diagnostics: {
      dx,
      cells: domain.nx * domain.ny * domain.nz,
      fluidCells: domain.fluidCount,
      velocitySteps: steps,
      velocityConverged: converged,
      finalRelChange: relChange,
      divergenceResidual: divRes,
      pressureIterationsPerStep: flow.projections > 0 ? flow.pressureIterations / flow.projections : 0,
      simulatedFlowTimeS: simTime,
      scalarIterations: { pm25Steady: pmStats.iterations, age: ageIters, transient: transientIters },
      steadyMassBalanceError,
      transientMassBalanceError: throughput > 0 ? imbalance / throughput : 0,
      wallTimeMs: { domain: tDomain - t0, velocity: tVelocity - tDomain, scalars: tScalars - tVelocity, total: tEnd - t0 },
    },
    warnings,
  };
}

/** Every ArrayBuffer in a result, for postMessage transfer lists. */
export function resultTransferables(r: VoxelSimResult): ArrayBuffer[] {
  const arrays: ArrayBufferView[] = [
    r.grid.cells,
    r.grid.fluid,
    r.grid.zoneOf,
    r.velocity.cell,
    r.velocity.downsampled.data,
    r.velocity.faces.u,
    r.velocity.faces.v,
    r.velocity.faces.w,
    r.pm25.steady,
    r.pm25.final,
    ...r.pm25.snapshots.map((s) => s.field),
    ...(r.ageMinutes ? [r.ageMinutes] : []),
    ...(r.ageNormalised ? [r.ageNormalised] : []),
    r.spawn.inflow,
    r.spawn.devices,
  ];
  return [...new Set(arrays.map((a) => a.buffer as ArrayBuffer))];
}
