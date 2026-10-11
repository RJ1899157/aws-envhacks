import type { Room, RoomType } from '../core/schema';
import { INDIA_NAAQS_PM25_24H, SECONDS_PER_HOUR, WHO_2021_PM25_24H, type Pm25SourcePresetId } from './constants';
import type { NetworkResult } from './house/network';
import { AQI_PM25_BANDS } from './viz/colormap';
import { placedSourceParams } from './sources';

/**
 * What the simulated air means for the people breathing it, stated only as far as published guidance
 * goes: PM2.5 against India's National AQI bands (with CPCB's official health statements) and the
 * WHO / India 24-hour guidelines, and stale air as an estimate of CO₂ from the people in each room,
 * against the EN 16798-1 indoor-air categories. Awareness, not medical advice.
 */

/**
 * CPCB National Air Quality Index (2014): "health impacts" statement of each PM2.5 band, keyed by the
 * band labels of AQI_PM25_BANDS (24-h PM2.5 breakpoints 30 / 60 / 90 / 120 / 250 µg/m³).
 */
export const CPCB_HEALTH_STATEMENTS: Record<string, string> = {
  Good: 'Minimal impact.',
  Satisfactory: 'Minor breathing discomfort to sensitive people.',
  Moderate: 'Breathing discomfort to people with lung disease such as asthma, and discomfort to people with heart disease, children and older adults.',
  Poor: 'Breathing discomfort to most people on prolonged exposure.',
  'Very poor': 'Respiratory illness on prolonged exposure.',
  Severe: 'Affects healthy people and seriously impacts those with existing diseases.',
};

export interface Pm25Health {
  ugM3: number;
  /** Index into AQI_PM25_BANDS (0 = Good … 5 = Severe) */
  level: number;
  band: string;
  color: string;
  statement: string;
  /** Concentration ÷ WHO 2021 24-h guideline (15) and ÷ India NAAQS 24-h (60) */
  timesWho: number;
  timesNaaqs: number;
}

export function pm25Health(ugM3: number): Pm25Health {
  const level = Math.max(0, AQI_PM25_BANDS.findIndex((b) => ugM3 <= b.max));
  const band = AQI_PM25_BANDS[level]!;
  return {
    ugM3,
    level,
    band: band.label,
    color: band.color,
    statement: CPCB_HEALTH_STATEMENTS[band.label] ?? '',
    timesWho: ugM3 / WHO_2021_PM25_24H,
    timesNaaqs: ugM3 / INDIA_NAAQS_PM25_24H,
  };
}

// ---------------------------------------------------------------------------
// Stale air: CO₂ from the people in each room
// ---------------------------------------------------------------------------

/** Outdoor CO₂ (ppm): current global background is ~420 ppm (NOAA, 2024); cities run a little higher. */
export const OUTDOOR_CO2_PPM = 420;

export type Activity = 'sleeping' | 'sitting' | 'light';

/**
 * CO₂ breathed out per adult (m³/h), from Persily & de Jonge, Indoor Air 27 (2017) 868–879 (adults
 * 21–60 y, mixed sex): ≈ 0.0036 L/s asleep (≈1.0 met), 0.0050 L/s sitting (≈1.3 met), 0.0068 L/s doing
 * light chores (≈1.8 met). Children breathe out less; this assumes adults.
 */
export const CO2_GENERATION_M3H: Record<Activity, number> = {
  sleeping: 0.0036 * 3.6,
  sitting: 0.005 * 3.6,
  light: 0.0068 * 3.6,
};

/** Who is usually in a room of each type (editable per room as `occupants`). */
export const DEFAULT_OCCUPANTS: Record<RoomType, { count: number; activity: Activity }> = {
  bedroom: { count: 2, activity: 'sleeping' },
  living: { count: 3, activity: 'sitting' },
  dining: { count: 3, activity: 'sitting' },
  kitchen: { count: 1, activity: 'light' },
  bathroom: { count: 0, activity: 'light' },
  basic: { count: 1, activity: 'sitting' },
};

export function occupantsOf(room: Room): { count: number; activity: Activity } {
  const d = DEFAULT_OCCUPANTS[room.type ?? 'basic'];
  return { count: room.occupants ?? d.count, activity: d.activity };
}

/**
 * Steady CO₂ (ppm) in every zone with its usual occupants, on the network model's airflows: each
 * zone's CO₂ balance  Σ inflow·C_source + G = Σ outflow·C, with air from outdoors at OUTDOOR_CO2_PPM,
 * air from other rooms at their CO₂, exhaust and supply fans, and the background infiltration
 * exchange. Solved directly (a small dense system).
 */
export function estimateCo2(network: NetworkResult): number[] {
  const zones = network.house.zones;
  const n = zones.length;
  const lam = network.house.env.infiltrationAch / SECONDS_PER_HOUR;
  const A = Array.from({ length: n }, () => new Array<number>(n).fill(0));
  const b = new Array<number>(n).fill(0);
  const fromOutdoors = new Array<number>(n).fill(0);
  for (const p of network.paths) {
    if (p.to >= 0) {
      A[p.from]![p.from]! += p.forwardM3s;
      A[p.to]![p.from]! -= p.forwardM3s;
      A[p.to]![p.to]! += p.backwardM3s;
      A[p.from]![p.to]! -= p.backwardM3s;
    } else {
      A[p.from]![p.from]! += p.forwardM3s;
      fromOutdoors[p.from]! += p.backwardM3s;
    }
  }
  network.zones.forEach((z, i) => {
    const infiltration = lam * z.volumeM3;
    A[i]![i]! += z.exhaustM3s + infiltration;
    fromOutdoors[i]! += z.supplyM3s + infiltration;
    const occ = occupantsOf(zones[i]!.room);
    const generationM3s = (occ.count * CO2_GENERATION_M3H[occ.activity]) / SECONDS_PER_HOUR;
    b[i] = fromOutdoors[i]! * OUTDOOR_CO2_PPM + generationM3s * 1e6;
  });
  return solve(A, b);
}

function solve(A: number[][], b: number[]): number[] {
  const n = b.length;
  const M = A.map((row, i) => [...row, b[i]!]);
  for (let c = 0; c < n; c++) {
    let piv = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r]![c]!) > Math.abs(M[piv]![c]!)) piv = r;
    [M[c], M[piv]] = [M[piv]!, M[c]!];
    const d = M[c]![c]!;
    if (Math.abs(d) < 1e-15) continue;
    for (let r = 0; r < n; r++) {
      if (r === c) continue;
      const f = M[r]![c]! / d;
      if (f !== 0) for (let k = c; k <= n; k++) M[r]![k] = M[r]![k]! - f * M[c]![k]!;
    }
  }
  return M.map((row, i) => (Math.abs(row[i]!) < 1e-15 ? OUTDOOR_CO2_PPM : row[n]! / row[i]!));
}

export interface Co2Health {
  ppm: number;
  /** EN 16798-1:2019 category (1 best … 4) */
  category: 1 | 2 | 3 | 4;
  label: string;
  statement: string;
  color: string;
}

/**
 * EN 16798-1:2019 (Annex B) design CO₂ levels above outdoors: category I ≤ 550 ppm, II ≤ 800,
 * III ≤ 1350, IV above. The effects described for the higher categories (drowsiness, poorer
 * concentration and sleep) follow e.g. Satish et al., EHP 120 (2012) and Strøm-Tejsen et al.,
 * Indoor Air 26 (2016).
 */
export function co2Health(ppm: number): Co2Health {
  const above = ppm - OUTDOOR_CO2_PPM;
  if (above <= 550) return { ppm, category: 1, label: 'Fresh', statement: 'Air is being replaced well.', color: '#2e9d3a' };
  if (above <= 800) return { ppm, category: 2, label: 'Acceptable', statement: 'Fine for most people.', color: '#e8d23a' };
  if (above <= 1350) return { ppm, category: 3, label: 'Stuffy', statement: 'Can feel stuffy; linked to drowsiness and harder concentration.', color: '#f29130' };
  return { ppm, category: 4, label: 'Stale', statement: 'Linked to drowsiness, headaches and poorer sleep.', color: '#e2362b' };
}

// ---------------------------------------------------------------------------
// Daily exposure
// ---------------------------------------------------------------------------

export interface DailyPm25 {
  /** 24-hour mean PM2.5 per zone (µg/m³), each source running on its own schedule */
  meanUgM3: number[];
  /** Sources with no schedule, so counted as running all day */
  alwaysOn: string[];
}

/**
 * 24-hour average PM2.5 per room, to compare with the 24-hour guidelines like for like: the network
 * model run for a day from outdoor-level air, every source on its schedule (scheduled sources run
 * once, at the times set; unscheduled ones all day).
 */
export function dailyPm25(rooms: readonly Room[], simulate: (rooms: readonly Room[], durationS: number) => NetworkResult): DailyPm25 {
  const day = simulate(rooms, 24 * 3600);
  const meanUgM3 = day.zones.map((z) => {
    const s = z.series;
    let area = 0;
    for (let i = 1; i < s.length; i++) area += ((s[i]!.c + s[i - 1]!.c) / 2) * (s[i]!.tS - s[i - 1]!.tS);
    const span = s[s.length - 1]!.tS - s[0]!.tS;
    return span > 0 ? area / span : s[0]!.c;
  });
  const alwaysOn = rooms.flatMap((r) =>
    r.objects
      .filter((o) => {
        const p = placedSourceParams(o);
        return p !== null && p.enabled && p.schedule.length === 0;
      })
      .map((o) => `${o.name} (${r.name})`)
  );
  return { meanUgM3, alwaysOn };
}

/** What a source is doing, to finish "While …" */
const SOURCE_ACTIVITY: Partial<Record<Pm25SourcePresetId, string>> = {
  'gas-stove-frying': 'frying',
  'gas-stove-boiling': 'boiling on the gas stove',
  'tawa-roti': 'making rotis on the tawa',
  incense: 'incense burns',
  'mosquito-coil': 'the mosquito coil burns',
  'candle-diya': 'candles or diyas burn',
  cigarette: 'someone smokes',
  'sweeping-dusting': 'sweeping or dusting',
  'kerosene-coal-heater': 'the heater burns',
  'toilet-flush': 'flushing',
};

/** Enabled sources that run on a schedule (so the day average is lower than while they run). */
export function scheduledSources(rooms: readonly Room[]): { activity: string; roomId: string; roomName: string }[] {
  return rooms.flatMap((r) =>
    r.objects.flatMap((o) => {
      const p = placedSourceParams(o);
      if (!p || !p.enabled || p.schedule.length === 0) return [];
      return [{ activity: SOURCE_ACTIVITY[p.preset] ?? `the ${p.label.toLowerCase()} is on`, roomId: r.id ?? '', roomName: r.name }];
    })
  );
}

/**
 * PM2.5 while the sources run (the steady state the 3D view shows), when it is worth stating next
 * to the day average: a worse band than the day average and at least 1.5× it. Null otherwise.
 */
export function peakExposure(dayMeanUgM3: number, whileOnUgM3: number): Pm25Health | null {
  const peak = pm25Health(whileOnUgM3);
  return peak.level > pm25Health(dayMeanUgM3).level && whileOnUgM3 >= 1.5 * dayMeanUgM3 ? peak : null;
}

// ---------------------------------------------------------------------------
// Hazards of a poorly ventilated room
// ---------------------------------------------------------------------------

/**
 * Known consequences of poor ventilation, stated without numbers: airborne infection (e.g. Wells–
 * Riley; WHO 2021 roadmap on ventilation and airborne infection), damp, mould and dust mites (WHO
 * guidelines on dampness and mould, 2009) and indoor chemicals (WHO indoor air quality guidelines,
 * selected pollutants, 2010).
 */
export const POOR_VENTILATION_RISKS = [
  'Germs from coughs and colds linger, so infections spread more easily.',
  'Moisture builds up: damp, mould and dust mites, which trigger asthma and allergies.',
  'Fumes from furniture, cleaning products and incense accumulate.',
] as const;

export interface Hazard {
  /** 2 needs attention, 3 serious */
  level: 2 | 3;
  title: string;
  detail: string;
}

/**
 * Outdoor-air changes per hour a room effectively gets: the larger of what enters it straight from
 * outdoors and 60 / mean age of its air. The second counts outdoor air that reaches it through other
 * rooms, e.g. a living room cross-ventilated from the bedrooms whose own openings all flow out.
 */
export function effectiveOutdoorAch(achOutdoor: number, ageMinutes: number): number {
  return Math.max(achOutdoor, ageMinutes > 0 ? 60 / ageMinutes : 0);
}

/** Fresh air from openings and fans only (air changes per hour), i.e. without the background leakage. */
export function freshAirAch(achOutdoor: number, infiltrationAch: number): number {
  return Math.max(0, achOutdoor - infiltrationAch);
}

/**
 * Hazards of one room from its ventilation and what burns in it:
 * - fresh air only through leaks (< 0.3 air changes an hour from openings and fans): poorly ventilated
 * - an enabled kerosene / coal heater: carbon monoxide (serious in any room, worst when shut)
 * - a gas stove with no working hood or exhaust and no real fresh-air supply: cooking fumes
 */
export function roomHazards(room: Room, achOutdoor: number, infiltrationAch: number, hasExhaust: boolean): Hazard[] {
  const fresh = freshAirAch(achOutdoor, infiltrationAch);
  const shut = fresh < 0.3;
  const hazards: Hazard[] = [];
  const burning = room.objects.map((o) => placedSourceParams(o)).filter((p): p is NonNullable<typeof p> => p !== null && p.enabled);
  if (burning.some((p) => p.preset === 'kerosene-coal-heater'))
    hazards.push({
      level: 3,
      title: 'Carbon monoxide: can be fatal',
      detail: shut
        ? 'A kerosene or coal heater (angithi) in a closed room can poison people as they sleep; CO has no smell. Never use one in a shut room or overnight.'
        : 'Kerosene and coal heaters give off carbon monoxide, which has no smell. Keep a window open while it burns and never leave it on overnight.',
    });
  if (shut && !hasExhaust && burning.some((p) => p.preset === 'gas-stove-frying' || p.preset === 'gas-stove-boiling' || p.preset === 'tawa-roti'))
    hazards.push({
      level: 2,
      title: 'Gas cooking fumes build up',
      detail: 'A gas flame also gives off nitrogen dioxide and carbon monoxide. Use a range hood or exhaust fan, or open a window, while cooking.',
    });
  if (shut) hazards.push({ level: 2, title: 'Poorly ventilated: fresh air only through leaks', detail: POOR_VENTILATION_RISKS.join(' ') });
  return hazards;
}
