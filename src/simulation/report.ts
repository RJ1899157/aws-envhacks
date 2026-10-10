import { getCatalogAsset } from '../core/catalog';
import { pointInPolygon, polygonBounds } from '../core/parser';
import { createBedroomSample, createLivingRoomSample, createStudioSample } from '../core/samples';
import type { Room, SceneObject, SiteExposure } from '../core/schema';
import { compassPoint } from '../core/wind';
import { DEFAULT_INFILTRATION_ACH, DEFAULT_SITE_EXPOSURE } from './constants';
import { deviceFor } from './devices';
import { computeVentilation, ventilationEnvFromRoom } from './ventilation';
import { simulateWellMixed, type WellMixedEnv, type WellMixedResult } from './wellMixed';

/** Scenario used by `npm run sim:report`: a bad Delhi day. */
export const REPORT_ENV: WellMixedEnv = {
  outdoorPm25UgM3: 150,
  windSpeed: 2,
  indoorTempC: 25,
  outdoorTempC: 30,
};

/** Calm-day wind (m/s), common on Delhi's worst winter smog days. */
export const CALM_WIND_MS = 0.5;
const AJAR_FRACTION = 0.2;
const REPORT_DURATION_S = 4 * 3600;

/**
 * Free floor spot for a w × d footprint nearest the room centre: inside the outline with 0.3 m wall
 * clearance and clear (by 0.1 m) of the footprints of floor-standing objects.
 */
export function freeFloorSpot(room: Room, w: number, d: number, height: number): [number, number] {
  const b = polygonBounds(room.outline);
  const centre: [number, number] = [(b.min[0] + b.max[0]) / 2, (b.min[1] + b.max[1]) / 2];
  const blockers = room.objects
    .filter((o) => (o.position[1] ?? 0) + (o.elevation ?? 0) < height)
    .map((o) => ({ x: o.position[0], z: o.position[2], r: Math.max(o.size[0], o.size[2]) / 2 + 0.1 }));
  const clear = 0.3;
  let best: [number, number] = centre;
  let bestD = Infinity;
  for (let x = b.min[0]; x <= b.max[0]; x += 0.1) {
    for (let z = b.min[1]; z <= b.max[1]; z += 0.1) {
      const corners: [number, number][] = [[x - w / 2 - clear, z - d / 2 - clear], [x + w / 2 + clear, z - d / 2 - clear], [x - w / 2 - clear, z + d / 2 + clear], [x + w / 2 + clear, z + d / 2 + clear]];
      if (!corners.every((c) => pointInPolygon(c, room.outline))) continue;
      if (blockers.some((o) => Math.abs(x - o.x) < o.r + w / 2 && Math.abs(z - o.z) < o.r + d / 2)) continue;
      const dist = Math.hypot(x - centre[0], z - centre[1]);
      if (dist < bestD) {
        bestD = dist;
        best = [x, z];
      }
    }
  }
  return best;
}

/** A catalogue air purifier on the free floor spot nearest the room centre. */
function standardPurifier(room: Room): SceneObject {
  const asset = getCatalogAsset('air-purifier')!;
  const [x, z] = freeFloorSpot(room, asset.size[0], asset.size[2], asset.size[1]);
  return {
    id: 'report-purifier',
    assetId: asset.id,
    name: asset.label,
    position: [x, 0, z],
    rotation: [0, 0, 0],
    size: asset.size,
    elevation: 0,
    role: asset.role,
    wallMounted: false,
    defaultAirflow: asset.defaultAirflow,
  };
}

export function withoutPurifiers(room: Room): Room {
  return { ...room, objects: room.objects.filter((o) => deviceFor(o)?.kind !== 'purifier') };
}

export function withOnePurifier(room: Room): Room {
  const base = withoutPurifiers(room);
  return { ...base, objects: [...base.objects, standardPurifier(base)] };
}

export function withOpeningsClosed(room: Room): Room {
  return { ...room, openings: room.openings.map((op) => ({ ...op, openFraction: 0 })) };
}

/** Every opening shut except the first window, opened to `fraction`. */
export function withOneWindowAjar(room: Room, fraction = AJAR_FRACTION): Room {
  const ajar = room.openings.find((op) => op.type === 'window');
  return {
    ...room,
    openings: room.openings.map((op) =>
      op === ajar
        ? { ...op, openFraction: fraction, role: op.role === 'closed' ? 'inlet' : op.role }
        : { ...op, openFraction: 0 }
    ),
  };
}

const f = (n: number, d = 1) => (Number.isFinite(n) ? n.toFixed(d) : '∞');
const mins = (s: number | null) => (s === null ? '—' : s === 0 ? '0' : (s / 60).toFixed(0));
const pad = (s: string, n: number) => s.padEnd(n);
const lpad = (s: string, n: number) => s.padStart(n);

const HEADER =
  `    ${pad('scenario', 34)}${lpad('ACH', 7)}${lpad('wind', 7)}${lpad('stack', 7)}${lpad('infil', 7)}` +
  `${lpad('Css', 8)}${lpad('τ min', 7)}${lpad('→60', 6)}${lpad('→15', 6)}${lpad('4h mean', 9)}`;

function row(label: string, r: WellMixedResult): string {
  const b = r.achBreakdown;
  const t = (id: string) => r.thresholds.find((x) => x.id === id);
  const cross = (id: string) => {
    const th = t(id);
    if (!th) return '—';
    if (th.crossing === 'falls-below') return mins(th.timeS);
    if (th.crossing === 'rises-above') return `↑${mins(th.timeS)}`;
    return th.initiallyAbove ? 'never' : 'below';
  };
  return (
    `    ${pad(label, 34)}${lpad(f(b.total), 7)}${lpad(f(b.wind), 7)}${lpad(f(b.stack), 7)}${lpad(f(b.infiltration), 7)}` +
    `${lpad(f(r.cssUgM3), 8)}${lpad(f(r.timeConstantS / 60), 7)}${lpad(cross('india-naaqs-24h'), 6)}` +
    `${lpad(cross('who-2021-24h'), 6)}${lpad(f(r.breathingZoneExposureUgM3), 9)}`
  );
}

function openingLines(r: WellMixedResult): string[] {
  return r.openings.map((o) => {
    const state = o.computedRole === 'closed'
      ? 'closed'
      : `${f(o.flowM3s * 3600, 0)} m³/h, acts as ${o.computedRole}${o.roleMismatch ? ' (MISMATCH)' : ''}, v ${f(o.velocityMs, 2)} m/s`;
    return `      ${pad(o.id, 22)} wall ${o.wallIndex}  tagged ${pad(o.taggedRole, 7)} A_eff ${f(o.effectiveArea, 3)} m²  Cp ${lpad(f(o.cp, 2), 5)}  ${state}`;
  });
}

/** Plain-text report over the three sample templates. */
export function buildSimReport(): string {
  const samples = [createStudioSample(), createBedroomSample(), createLivingRoomSample()];
  const purifier = getCatalogAsset('air-purifier')!;
  const out = [
    'Airforce well-mixed PM2.5 report',
    `Scenario: outdoor PM2.5 ${REPORT_ENV.outdoorPm25UgM3} µg/m³, indoor ${REPORT_ENV.indoorTempC} °C / outdoor ${REPORT_ENV.outdoorTempC} °C, ` +
      `4 h run, C0 = P·C_out, each sample's own wind direction.`,
    `Runtime defaults: exposure ${DEFAULT_SITE_EXPOSURE}, background infiltration ${DEFAULT_INFILTRATION_ACH} /h. ` +
      `Wind ${REPORT_ENV.windSpeed} m/s ("windy") and ${CALM_WIND_MS} m/s ("calm") are reported (met-station) speeds.`,
    `"+ purifier" = one catalogue ${purifier.label} at ${purifier.defaultAirflow} m³/h CADR; sample purifiers removed first.`,
    `"1 window ajar" = every opening shut except the first window, at openFraction ${AJAR_FRACTION}.`,
    'Columns: ACH /h (total, wind, stack, infiltration), Css µg/m³, time constant, minutes until C falls below',
    'India NAAQS 60 / WHO 15 ("never" = stays above for the whole 4 h), 4 h mean exposure µg/m³.',
    'Thresholds are 24-hour mean guidelines; comparing them to instantaneous concentrations is indicative only.',
    '',
  ];

  for (const room of samples) {
    const opts = { durationS: REPORT_DURATION_S };
    const windy: WellMixedEnv = REPORT_ENV;
    const calm: WellMixedEnv = { ...REPORT_ENV, windSpeed: CALM_WIND_MS };
    const designed = simulateWellMixed(withoutPurifiers(room), windy, opts);

    out.push(`${room.name}  — volume ${f(designed.volumeM3, 2)} m³, wind from ${compassPoint(room.params.windDirDeg)} (${room.params.windDirDeg}°)`);
    out.push(`    openings as designed, windy (${designed.ventilationType}, local wind ${f(designed.ventilation.localWindSpeed, 2)} m/s):`);
    out.push(...openingLines(designed));
    out.push(HEADER);
    for (const [name, env] of [['windy', windy], ['calm', calm]] as const) {
      out.push(row(`${name}: as designed`, simulateWellMixed(withoutPurifiers(room), env, opts)));
      out.push(row(`${name}: as designed + purifier`, simulateWellMixed(withOnePurifier(room), env, opts)));
      out.push(row(`${name}: 1 window ajar + purifier`, simulateWellMixed(withOnePurifier(withOneWindowAjar(room)), env, opts)));
      out.push(row(`${name}: closed`, simulateWellMixed(withoutPurifiers(withOpeningsClosed(room)), env, opts)));
      out.push(row(`${name}: closed + purifier`, simulateWellMixed(withOnePurifier(withOpeningsClosed(room)), env, opts)));
    }

    if (room.name.startsWith('Bedroom')) {
      out.push('    exposure comparison (openings as designed, no purifier, infiltration included):');
      for (const windSpeed of [REPORT_ENV.windSpeed!, CALM_WIND_MS]) {
        const cells = (['open', 'suburban', 'urbanDense'] as SiteExposure[]).map((exposure) => {
          const v = computeVentilation(room, {
            ...ventilationEnvFromRoom(room),
            indoorTempC: REPORT_ENV.indoorTempC!,
            outdoorTempC: REPORT_ENV.outdoorTempC!,
            windSpeed,
            exposure,
          });
          return `${exposure} ${f(v.ach)} /h (local wind ${f(v.localWindSpeed, 2)} m/s)`;
        });
        out.push(`      ${f(windSpeed)} m/s: ${cells.join(' · ')}`);
      }
    }

    const warnings = [...new Set(designed.warnings)].filter((w) => !w.startsWith('Steady-state') && !w.startsWith('Thresholds are'));
    if (warnings.length > 0) out.push('    warnings (as designed, windy):', ...warnings.map((w) => `      - ${w}`));
    out.push('');
  }
  return out.join('\n');
}
