import { INDIA_NAAQS_PM25_24H } from '../constants';
import { aqiBand } from './colormap';

/**
 * Plain-language reading of the per-room results for the room chips, the legend and the Insights
 * panel: one metric per view mode, each with a unit and a band word.
 * - Pollution: PM2.5 (µg/m³) with the Indian AQI PM2.5 band ("Very poor")
 * - Ventilation: mean age of air (min): Fresh ≤ 20, OK ≤ 60, Stale ≤ 120, Very stale beyond
 *   (the age a well-mixed room has at 3, 1 and 0.5 outdoor-air changes an hour)
 * - Airflow: outdoor-air changes per hour: Good ≥ 3, Fair ≥ 1, Low ≥ 0.5, Very low below
 */

export type InsightMode = 'pollution' | 'ventilation' | 'airflow';

export interface RoomMetrics {
  roomId: string;
  name: string;
  pm25: number;
  ageMinutes: number;
  ach: number;
}

export interface Band {
  label: string;
  /** Upper bound for age bands, lower bound for air-change bands */
  limit: number;
}

/** Air-age bands (minutes, upper bounds). */
export const AGE_BANDS: readonly Band[] = [
  { label: 'Fresh', limit: 20 },
  { label: 'OK', limit: 60 },
  { label: 'Stale', limit: 120 },
  { label: 'Very stale', limit: Infinity },
];

/** Air age (min) beyond which a room counts as stale in the summary. */
export const STALE_AGE_MINUTES = 60;

/** Outdoor-air-change bands (per hour, lower bounds), best first. */
export const ACH_BANDS: readonly Band[] = [
  { label: 'Good', limit: 3 },
  { label: 'Fair', limit: 1 },
  { label: 'Low', limit: 0.5 },
  { label: 'Very low', limit: -Infinity },
];

/** Outdoor-air changes per hour below which a room counts as poorly ventilated. */
export const LOW_ACH = 1;

export function ageBand(minutes: number): string {
  return (AGE_BANDS.find((b) => minutes <= b.limit) ?? AGE_BANDS[AGE_BANDS.length - 1]!).label;
}

export function achBand(ach: number): string {
  return (ACH_BANDS.find((b) => ach >= b.limit) ?? ACH_BANDS[ACH_BANDS.length - 1]!).label;
}

export function metricOf(mode: InsightMode, m: RoomMetrics): number {
  return mode === 'pollution' ? m.pm25 : mode === 'ventilation' ? m.ageMinutes : m.ach;
}

export const fmtMinutes = (m: number) => (m < 10 ? m.toFixed(1) : Math.round(m).toString());

export interface FormattedMetric {
  /** Number with its unit, e.g. "176 µg/m³" */
  value: string;
  /** Narrower form for tight labels ("0.5 changes/h") */
  short: string;
  /** Band word, e.g. "Very poor" */
  word: string;
  /** "176 µg/m³ · Very poor" */
  text: string;
}

export function formatMetric(mode: InsightMode, v: number): FormattedMetric {
  let value: string;
  let short: string | null = null;
  let word: string;
  if (mode === 'pollution') {
    value = `${Math.round(v)} µg/m³`;
    word = aqiBand(v).label;
  } else if (mode === 'ventilation') {
    value = `${fmtMinutes(v)} min`;
    word = ageBand(v);
  } else {
    value = `${v.toFixed(1)} air changes/h`;
    short = `${v.toFixed(1)} changes/h`;
    word = achBand(v);
  }
  return { value, short: short ?? value, word, text: `${value} · ${word}` };
}

/** Rooms ordered worst → best for the mode (highest PM2.5, oldest air, fewest air changes). */
export function rankRooms<T extends RoomMetrics>(mode: InsightMode, rooms: readonly T[]): T[] {
  const sign = mode === 'airflow' ? 1 : -1;
  return [...rooms].sort((a, b) => sign * (metricOf(mode, a) - metricOf(mode, b)));
}

const plural = (n: number, one: string, many: string) => (n === 1 ? one : many);

/**
 * One-line conclusion for the house, e.g. "While every source is on, 3 of 6 rooms are above 60 µg/m³
 * (India's 24-h limit); worst: Kitchen". The values are steady state with every source on, not day
 * averages (the Health card has those), so the sentence says so.
 */
export function houseSummary(mode: InsightMode, rooms: readonly RoomMetrics[]): string {
  if (rooms.length === 0) return 'No rooms to summarise.';
  const ranked = rankRooms(mode, rooms);
  const worst = ranked[0]!;
  const n = rooms.length;
  if (mode === 'pollution') {
    const bad = rooms.filter((r) => r.pm25 > INDIA_NAAQS_PM25_24H).length;
    if (bad === 0) return `While every source is on, all ${n} rooms stay within ${INDIA_NAAQS_PM25_24H} µg/m³ (India's 24-h limit); highest: ${worst.name}`;
    return `While every source is on, ${bad} of ${n} ${plural(n, 'room is', 'rooms are')} above ${INDIA_NAAQS_PM25_24H} µg/m³ (India's 24-h limit); worst: ${worst.name}`;
  }
  if (mode === 'ventilation') {
    const bad = rooms.filter((r) => r.ageMinutes > STALE_AGE_MINUTES).length;
    if (bad === 0) return `Every room gets fresh air within ${STALE_AGE_MINUTES} min; stalest: ${worst.name}`;
    return `${bad} of ${n} ${plural(n, 'room has', 'rooms have')} stale air (older than ${STALE_AGE_MINUTES} min); stalest: ${worst.name}`;
  }
  const bad = rooms.filter((r) => r.ach < LOW_ACH).length;
  if (bad === 0) return `Every room gets at least ${LOW_ACH} outdoor-air change an hour; least: ${worst.name}`;
  return `${bad} of ${n} ${plural(n, 'room gets', 'rooms get')} under ${LOW_ACH} outdoor-air change an hour; least: ${worst.name}`;
}
