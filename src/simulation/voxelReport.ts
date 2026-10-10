import { createBedroomSample, createLivingRoomSample, createStudioSample } from '../core/samples';
import type { Room } from '../core/schema';
import { compassPoint } from '../core/wind';
import { BREATHING_ZONE_HEIGHT_M } from './constants';
import {
  CALM_WIND_MS,
  REPORT_ENV,
  withOneWindowAjar,
  withOnePurifier,
  withOpeningsClosed,
  withoutPurifiers,
} from './report';
import { asciiSlice, type FieldStats, type Hotspot } from './voxel/analysis';
import { runVoxelSimulation, type VoxelSimResult } from './voxel/solver';
import type { WellMixedEnv } from './wellMixed';

const f = (n: number | null | undefined, d = 1) => (n === null || n === undefined || !Number.isFinite(n) ? '—' : n.toFixed(d));
const stats = (s: FieldStats | null) => (s ? `mean ${f(s.mean)} max ${f(s.max)} p90 ${f(s.p90)}` : 'n/a');
const hotspot = (h: Hotspot) => `[${h.centroid.map((v) => v.toFixed(1)).join(', ')}] ${f(h.volumeM3, 2)} m³ (mean ${f(h.mean)}, max ${f(h.max)})`;

function heatmaps(r: VoxelSimResult): string[] {
  const y = (BREATHING_ZONE_HEIGHT_M[0] + BREATHING_ZONE_HEIGHT_M[1]) / 2;
  const range = (field: Float32Array) => {
    const { nx, ny, dx, origin } = r.grid;
    const j = Math.min(ny - 1, Math.floor((y - origin[1]) / dx));
    let lo = Infinity;
    let hi = -Infinity;
    for (let k = 0; k < r.grid.nz; k++)
      for (let i = 0; i < nx; i++) {
        const v = field[i + nx * (j + ny * k)]!;
        if (Number.isFinite(v)) {
          lo = Math.min(lo, v);
          hi = Math.max(hi, v);
        }
      }
    return [lo, hi] as const;
  };
  const [pLo, pHi] = range(r.pm25.steady);
  const pm = asciiSlice(r.grid, r.pm25.steady, y, pLo, pHi);
  const age = r.ageMinutes ? (() => {
    const [aLo, aHi] = range(r.ageMinutes!);
    return { lines: asciiSlice(r.grid, r.ageMinutes!, y, aLo, aHi), lo: aLo, hi: aHi };
  })() : null;
  const width = r.grid.nx;
  const out = [
    `      slice y = ${y.toFixed(1)} m, north up · PM2.5 steady ' '=${f(pLo)} '@'=${f(pHi)} µg/m³` +
      (age ? `   |   age ' '=${f(age.lo)} '@'=${f(age.hi)} min` : ''),
  ];
  pm.forEach((line, k) => out.push(`      ${line}${age ? `   ${' '.repeat(Math.max(0, width - line.length))}${age.lines[k]}` : ''}`));
  return out;
}

function describe(label: string, r: VoxelSimResult): string[] {
  const s = r.summary;
  const d = r.diagnostics;
  const bz = r.breathingZone;
  const lines = [
    `  ${label}`,
    `    mean PM2.5 steady: voxel ${f(s.volumeMeanPm25Steady)} vs network ${f(s.networkMeanPm25)} µg/m³ (${s.networkDifference >= 0 ? '+' : ''}${f(s.networkDifference * 100)}%) · 4 h voxel ${f(s.volumeMeanPm25Final)} · network ACH ${f(r.zones[0]?.networkAchTotal)}`,
    `    mean age: voxel ${f(s.volumeMeanAgeMinutes)} min, network ${f(s.networkMeanAgeMinutes)} min · max speed ${f(r.velocity.maxSpeed, 2)} m/s`,
    `    breathing zone ${bz.heightM[0]}–${bz.heightM[1]} m: PM2.5 steady ${stats(bz.pm25Steady)} · 4 h ${stats(bz.pm25)} · age ${stats(bz.ageMinutes)}`,
    `    PM2.5 hotspots > ${f(r.hotspots.pm25ThresholdUgM3)}: ${r.hotspots.pm25.length === 0 ? 'none' : r.hotspots.pm25.slice(0, 3).map(hotspot).join('; ')}`,
    `    age hotspots > ${f(r.hotspots.ageThresholdMinutes)} min: ${r.hotspots.age.length === 0 ? 'none' : r.hotspots.age.slice(0, 3).map(hotspot).join('; ')}`,
    `    diagnostics: ${d.velocitySteps} velocity steps (${d.velocityConverged ? 'converged' : 'NOT converged'}, Δ ${d.finalRelChange.toExponential(1)}, ${f(d.simulatedFlowTimeS)} s), ` +
      `div ${d.divergenceResidual.toExponential(1)}, CG ${f(d.pressureIterationsPerStep)} it/step, mass balance steady ${d.steadyMassBalanceError.toExponential(1)} / transient ${d.transientMassBalanceError.toExponential(1)}`,
    `    wall time ${f(d.wallTimeMs.total / 1000, 2)} s (velocity ${f(d.wallTimeMs.velocity / 1000, 2)}, scalars ${f(d.wallTimeMs.scalars / 1000, 2)}) · ${d.fluidCells} fluid cells`,
  ];
  for (const w of r.warnings) lines.push(`    ! ${w}`);
  lines.push(...heatmaps(r));
  return lines;
}

export interface VoxelReportOptions {
  /** Print each block as soon as it is ready */
  log?: (line: string) => void;
  /** Also time one template at 0.1 m (default true) */
  includeFull?: boolean;
  /** Rooms of a whole house to report first (primary room first) */
  house?: Room[];
}

/** Runs the sim:report scenarios through the voxel solver at 0.2 m. */
export async function buildVoxelReport(options: VoxelReportOptions = {}): Promise<string> {
  const out: string[] = [];
  const emit = (...lines: string[]) => {
    out.push(...lines);
    for (const l of lines) options.log?.(l);
  };
  emit(
    'Airforce voxel PM2.5 report (0.2 m grid)',
    `Scenario as sim:report: outdoor ${REPORT_ENV.outdoorPm25UgM3} µg/m³, ${REPORT_ENV.indoorTempC} °C in / ${REPORT_ENV.outdoorTempC} °C out, windy ${REPORT_ENV.windSpeed} m/s, calm ${CALM_WIND_MS} m/s, exposure urbanDense, infiltration 0.5 /h.`,
    'Heatmaps: steady PM2.5 and age of air on the breathing-height slice, scaled to each slice\'s own range; ▓ = wall/solid.',
    ''
  );
  // Whole-house demo (multi-zone network vs voxel, per room and per opening)
  if (options.house) {
    const rooms = options.house;
    const resolutions: ('live' | 'full')[] = options.includeFull === false ? ['live'] : ['live', 'full'];
    for (const res of resolutions) {
      const r = await runVoxelSimulation({ rooms, resolution: res });
      emit(`Whole house (${rooms.length} rooms) at ${r.grid.dx} m`, ...describe('demo scenario', r));
      emit('    per room: voxel vs network steady PM2.5 (µg/m³) · age (min) · network ACH total');
      for (const z of r.zones) {
        emit(`      ${z.name.padEnd(12)} ${f(z.voxelPm25Steady).padStart(7)} vs ${f(z.networkPm25Steady).padStart(7)} (${f((z.voxelPm25Steady / z.networkPm25Steady - 1) * 100).padStart(5)}%) · age ${f(z.voxelAgeMinutes)} vs ${f(z.networkAgeMinutes)} · ACH ${f(z.networkAchTotal)}`);
      }
      emit('    per opening: net flow from → to, voxel vs network (m³/h)');
      for (const p of r.paths) {
        const name = (i: number) => (i < 0 ? 'outdoors' : r.zones[i]!.name);
        emit(`      ${p.id.padEnd(28)} ${`${name(p.from)} → ${name(p.to)}`.padEnd(26)} ${f(p.voxelFlowM3s * 3600).padStart(8)} vs ${f(p.networkFlowM3s * 3600).padStart(8)}`);
      }
      emit('');
    }
  }

  const samples = [createStudioSample(), createBedroomSample(), createLivingRoomSample()];
  for (const room of samples) {
    emit(`${room.name} — wind from ${compassPoint(room.params.windDirDeg)}`);
    const scenarios: [string, Room, WellMixedEnv][] = [];
    for (const [name, env] of [['windy', REPORT_ENV], ['calm', { ...REPORT_ENV, windSpeed: CALM_WIND_MS }]] as const) {
      scenarios.push([`${name}: as designed`, withoutPurifiers(room), env]);
      scenarios.push([`${name}: as designed + purifier`, withOnePurifier(room), env]);
      scenarios.push([`${name}: 1 window ajar + purifier`, withOnePurifier(withOneWindowAjar(room)), env]);
      scenarios.push([`${name}: closed`, withoutPurifiers(withOpeningsClosed(room)), env]);
      scenarios.push([`${name}: closed + purifier`, withOnePurifier(withOpeningsClosed(room)), env]);
    }
    for (const [label, r, env] of scenarios) {
      const result = await runVoxelSimulation({ room: r, env, resolution: 'live' });
      emit(...describe(label, result));
    }
    emit('');
  }

  if (options.includeFull !== false) {
    const room = createBedroomSample();
    const live = await runVoxelSimulation({ room: withoutPurifiers(room), env: REPORT_ENV, resolution: 'live' });
    const full = await runVoxelSimulation({ room: withoutPurifiers(room), env: REPORT_ENV, resolution: 'full' });
    const line = (r: VoxelSimResult, name: string) =>
      `  ${name}: ${r.diagnostics.fluidCells} fluid cells, ${r.diagnostics.velocitySteps} steps, wall ${f(r.diagnostics.wallTimeMs.total / 1000, 2)} s ` +
      `(velocity ${f(r.diagnostics.wallTimeMs.velocity / 1000, 2)}, scalars ${f(r.diagnostics.wallTimeMs.scalars / 1000, 2)}), mean PM2.5 ${f(r.summary.volumeMeanPm25Steady)}, mean age ${f(r.summary.volumeMeanAgeMinutes, 2)} min`;
    emit('Resolution timing — Bedroom, windy, as designed', line(live, '0.2 m'), line(full, '0.1 m'), '');
  }
  return out.join('\n');
}
