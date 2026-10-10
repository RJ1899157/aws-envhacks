import { INDIA_NAAQS_PM25_24H, WHO_2021_PM25_24H } from '../constants';

/**
 * Colour scales for the simulation layer.
 * - PM2.5: absolute scale with the Indian National AQI PM2.5 (24 h) breakpoints (CPCB 2014):
 *   Good 0–30, Satisfactory 31–60, Moderate 61–90, Poor 91–120, Very poor 121–250, Severe > 250,
 *   coloured green → yellow → orange → red → purple → maroon. Inside each band the colour runs
 *   from a lighter tint at its lower bound to a deeper shade at its upper bound, so 20 and 28 look
 *   different while every band keeps its own hue (and the step at a boundary marks the band).
 * - PM2.5 "relative": a single warm sequential ramp (YlOrRd) stretched over the values in view,
 *   deliberately not the AQI hues so it is never read as an AQI band.
 * - Age of air: viridis (perceptually uniform, colour-blind safe), inlined as stops.
 * - Air speed (streamlines): slate → sky → near-white, so still air recedes on the dark scene.
 */

export interface AqiBand {
  label: string;
  /** Upper bound (µg/m³); Infinity for the last band */
  max: number;
  color: string;
}

export const AQI_PM25_BANDS: readonly AqiBand[] = [
  { label: 'Good', max: 30, color: '#2e9d3a' },
  { label: 'Satisfactory', max: 60, color: '#e8d23a' },
  { label: 'Moderate', max: 90, color: '#f29130' },
  { label: 'Poor', max: 120, color: '#e2362b' },
  { label: 'Very poor', max: 250, color: '#8e3b9e' },
  { label: 'Severe', max: Infinity, color: '#7e0023' },
];

/** Display range of the PM2.5 scale (values above clamp to Severe). */
export const AQI_SCALE_MAX = 400;

/** Viridis, 9 stops (matplotlib). */
export const VIRIDIS: readonly string[] = ['#440154', '#472d7b', '#3b528b', '#2c728e', '#21918c', '#28ae80', '#5ec962', '#addc30', '#fde725'];

/** Status colours (fixed; always shown with an icon + label, never colour alone). */
export const STATUS_COLORS = { good: '#0ca30c', warning: '#fab219', serious: '#ec835a', critical: '#d03b3b' } as const;

/** Chart series colours (dark-mode steps of categorical slots 1 and 2; validated together). */
export const SERIES_COLORS = { boxModel: '#3987e5', voxel: '#d95926' } as const;

export function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '');
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}

const VIRIDIS_RGB = VIRIDIS.map(hexToRgb);

/** Lower and upper bound of each AQI band on the display scale. */
export const AQI_BAND_RANGES: readonly [number, number][] = AQI_PM25_BANDS.map((b, i) => [i === 0 ? 0 : AQI_PM25_BANDS[i - 1]!.max, Number.isFinite(b.max) ? b.max : AQI_SCALE_MAX]);

/** Band boundaries (µg/m³) for contour lines. */
export const AQI_BOUNDARIES: readonly number[] = AQI_PM25_BANDS.slice(0, -1).map((b) => b.max);

const mix = (a: [number, number, number], b: [number, number, number], f: number): [number, number, number] => [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f];
/** Light end (band lower bound) and deep end (upper bound) of each band's in-band gradient. */
const AQI_BAND_RAMPS: { lo: [number, number, number]; hi: [number, number, number] }[] = AQI_PM25_BANDS.map((b) => {
  const c = hexToRgb(b.color);
  return { lo: mix(c, [255, 255, 255], 0.3), hi: mix(c, [0, 0, 0], 0.22) };
});

/** ColorBrewer YlOrRd (9 classes) for the relative PM2.5 scale. */
export const YLORRD: readonly string[] = ['#ffffcc', '#ffeda0', '#fed976', '#feb24c', '#fd8d3c', '#fc4e2a', '#e31a1c', '#bd0026', '#800026'];
const YLORRD_RGB = YLORRD.map(hexToRgb);

/**
 * Outdoor-air changes per hour (Airflow floor tint and chips), poorly → well ventilated, on a log
 * scale over ACH_SCALE. Mid-dark so the bright streamlines stay readable on top.
 */
export const ACH_RAMP: readonly string[] = ['#7a2e3b', '#8a5a2b', '#5f6b34', '#2f6b64', '#245f80'];
export const ACH_SCALE: readonly [number, number] = [0.25, 16];
const ACH_RGB = ACH_RAMP.map(hexToRgb);

/**
 * Difference (scenario − baseline) on a diverging scale: green = better (lower), white = no change,
 * red = worse. ColorBrewer RdYlGn ends with a near-white centre.
 */
export const DIFF_RAMP: readonly string[] = ['#1a9850', '#66bd63', '#d9ef8b', '#f7f7f7', '#fee08b', '#f46d43', '#d73027'];
const DIFF_RGB = DIFF_RAMP.map(hexToRgb);

/** Streamline speed ramp, still → fast. */
export const SPEED_RAMP: readonly string[] = ['#3b4a5e', '#2f7fb8', '#38bdf8', '#a5f3fc', '#f8fdff'];
const SPEED_RGB = SPEED_RAMP.map(hexToRgb);

function lerp(a: [number, number, number], b: [number, number, number], f: number, out: [number, number, number]) {
  out[0] = Math.round(a[0] + (b[0] - a[0]) * f);
  out[1] = Math.round(a[1] + (b[1] - a[1]) * f);
  out[2] = Math.round(a[2] + (b[2] - a[2]) * f);
  return out;
}

function ramp(stops: [number, number, number][], t: number, out: [number, number, number]): [number, number, number] {
  const x = Math.min(1, Math.max(0, Number.isFinite(t) ? t : 0)) * (stops.length - 1);
  const i = Math.min(stops.length - 2, Math.floor(x));
  return lerp(stops[i]!, stops[i + 1]!, x - i, out);
}

/** Viridis at t ∈ [0, 1] (clamped). */
export function viridis(t: number, out: [number, number, number] = [0, 0, 0]): [number, number, number] {
  return ramp(VIRIDIS_RGB, t, out);
}

/** YlOrRd at t ∈ [0, 1] (clamped). */
export function ylOrRd(t: number, out: [number, number, number] = [0, 0, 0]): [number, number, number] {
  return ramp(YLORRD_RGB, t, out);
}

/** Streamline colour at t ∈ [0, 1] of the speed scale (clamped). */
export function speedColor(t: number, out: [number, number, number] = [0, 0, 0]): [number, number, number] {
  return ramp(SPEED_RGB, t, out);
}

/** Position (0–1) of an air-change rate on the log ACH scale. */
export function achPosition(ach: number): number {
  const [lo, hi] = ACH_SCALE;
  return Math.min(1, Math.max(0, Math.log(Math.max(ach, lo) / lo) / Math.log(hi / lo)));
}

/** Colour of an outdoor-air change rate (per hour). */
export function achColor(ach: number, out: [number, number, number] = [0, 0, 0]): [number, number, number] {
  return ramp(ACH_RGB, achPosition(Number.isFinite(ach) ? ach : 0), out);
}

/** AQI-band colour of a PM2.5 value (µg/m³): the band's hue, lighter at its lower bound, deeper at its upper. */
export function aqiColor(v: number, out: [number, number, number] = [0, 0, 0]): [number, number, number] {
  const x = Number.isFinite(v) ? Math.max(0, v) : 0;
  let i = AQI_BAND_RANGES.findIndex(([, hi]) => x <= hi);
  if (i < 0) i = AQI_BAND_RANGES.length - 1;
  const [lo, hi] = AQI_BAND_RANGES[i]!;
  const r = AQI_BAND_RAMPS[i]!;
  return lerp(r.lo, r.hi, Math.min(1, (x - lo) / (hi - lo)), out);
}

export function aqiBand(v: number): AqiBand {
  return AQI_PM25_BANDS.find((b) => v <= b.max) ?? AQI_PM25_BANDS[AQI_PM25_BANDS.length - 1]!;
}

export type SimField = 'pm25' | 'age' | 'speed' | 'diff';

export const FIELD_META: Record<SimField, { label: string; unit: string }> = {
  pm25: { label: 'PM2.5', unit: 'µg/m³' },
  age: { label: 'Age of air', unit: 'min' },
  speed: { label: 'Air speed', unit: 'm/s' },
  diff: { label: 'Change', unit: '' },
};

/** A field's colour mapping: the colormap and (for viridis fields) its domain. */
export interface ColorScale {
  field: SimField;
  /** Domain of the viridis fields and of relative PM2.5; absolute PM2.5 is [0, AQI_SCALE_MAX] */
  domain: [number, number];
  /** Map on a log scale (age of air spanning ventilated and shut rooms) */
  log?: boolean;
  /** PM2.5 only: YlOrRd stretched over `domain` instead of the absolute AQI bands */
  relative?: boolean;
}

/** Position of v on a scale's domain, 0–1 (log or linear). */
export function scalePosition(scale: ColorScale, v: number): number {
  const [lo, hi] = scale.domain;
  if (scale.log && lo > 0) return Math.log(Math.max(v, lo) / lo) / Math.log(hi / lo);
  return (v - lo) / Math.max(1e-12, hi - lo);
}

/**
 * Age of air goes on a log scale when its domain spans more than a decade, so a living room's
 * 2–8 min gradient stays visible next to shut rooms at ~2 h.
 */
export function isLogScale(field: SimField, domain: [number, number]): boolean {
  return field === 'age' && domain[0] > 0 && domain[1] / domain[0] > 10;
}

/** RGBA (0–255) of a value; NaN (solid / outdoors) is fully transparent. */
export function mapValue(scale: ColorScale, v: number, alpha = 255, out: [number, number, number, number] = [0, 0, 0, 0]): [number, number, number, number] {
  if (!Number.isFinite(v)) {
    out[0] = out[1] = out[2] = out[3] = 0;
    return out;
  }
  const rgb: [number, number, number] = [0, 0, 0];
  if (scale.field === 'pm25') {
    if (scale.relative) ylOrRd(scalePosition(scale, v), rgb);
    else aqiColor(v, rgb);
  } else if (scale.field === 'diff') ramp(DIFF_RGB, scalePosition(scale, v), rgb);
  else viridis(scalePosition(scale, v), rgb);
  out[0] = rgb[0];
  out[1] = rgb[1];
  out[2] = rgb[2];
  out[3] = alpha;
  return out;
}

/** Value at the given percentile (0–1) of the finite entries. */
export function percentile(values: ArrayLike<number>, p: number): number {
  const v: number[] = [];
  for (let i = 0; i < values.length; i++) if (Number.isFinite(values[i]!)) v.push(values[i]!);
  if (v.length === 0) return NaN;
  v.sort((a, b) => a - b);
  return v[Math.min(v.length - 1, Math.max(0, Math.round(p * (v.length - 1))))]!;
}

/** Absolute age scale (min) when auto contrast is off. */
export const AGE_SCALE_MAX_MIN = 120;

/**
 * Colour domain of a viridis field. Auto contrast stretches to the 2nd–98th percentile of the
 * values given (so small gradients become visible); otherwise age uses 0–120 min and speed 0–max.
 */
export function fieldDomain(field: SimField, values: ArrayLike<number>, autoContrast: boolean): [number, number] {
  if (field === 'pm25') return [0, AQI_SCALE_MAX];
  if (autoContrast) {
    // Age floor of 0.5 min keeps a log scale finite near inlets
    const lo = field === 'age' ? Math.max(0.5, percentile(values, 0.02)) : percentile(values, 0.02);
    const hi = percentile(values, 0.98);
    if (!Number.isFinite(lo) || !Number.isFinite(hi)) return [0, 1];
    return hi - lo > 1e-9 ? [lo, hi] : [lo, lo + (field === 'age' ? 1 : 0.01)];
  }
  if (field === 'age') return [0, AGE_SCALE_MAX_MIN];
  const hi = percentile(values, 1);
  return [0, Number.isFinite(hi) && hi > 0 ? hi : 1];
}

const css = (rgb: [number, number, number]) => `rgb(${rgb.map((c) => Math.round(c)).join(' ')})`;

/** #rrggbb (valid both in CSS and for THREE.Color). */
const hex = (rgb: readonly number[]) => `#${rgb.slice(0, 3).map((c) => Math.round(Math.min(255, Math.max(0, c))).toString(16).padStart(2, '0')).join('')}`;

/** Colour (#rrggbb) of a value on a heatmap scale, exactly as the floor texture maps it. */
export function scaleCss(scale: ColorScale, v: number): string {
  return hex(mapValue(scale, v));
}

/** Colour (#rrggbb) of an air-change rate on the Airflow floor tint. */
export function achCss(ach: number): string {
  return hex(achColor(ach));
}

/** CSS gradient of a colormap, low at the left: AQI bands (hard steps, gradient inside), YlOrRd, viridis or speed. */
export function rampCss(field: SimField | 'pm25-relative' | 'speed-lines' | 'ach', direction = 'to right'): string {
  if (field === 'pm25') {
    const stops = AQI_BAND_RANGES.flatMap(([lo, hi], i) => [`${css(AQI_BAND_RAMPS[i]!.lo)} ${((100 * lo) / AQI_SCALE_MAX).toFixed(2)}%`, `${css(AQI_BAND_RAMPS[i]!.hi)} ${((100 * hi) / AQI_SCALE_MAX).toFixed(2)}%`]);
    return `linear-gradient(${direction}, ${stops.join(', ')})`;
  }
  if (field === 'pm25-relative') return `linear-gradient(${direction}, ${YLORRD.join(', ')})`;
  if (field === 'ach') return `linear-gradient(${direction}, ${ACH_RAMP.join(', ')})`;
  if (field === 'diff') return `linear-gradient(${direction}, ${DIFF_RAMP.join(', ')})`;
  if (field === 'speed-lines') return `linear-gradient(${direction}, ${SPEED_RAMP.join(', ')})`;
  return `linear-gradient(${direction}, ${VIRIDIS.join(', ')})`;
}

export type Pm25Level = 'good' | 'warning' | 'critical';

/** PM2.5 status against WHO 2021 (15) and India NAAQS (60) 24-hour guidelines, for cards. */
export function pm25Band(v: number): { level: Pm25Level; color: string; label: string } {
  if (v <= WHO_2021_PM25_24H) return { level: 'good', color: STATUS_COLORS.good, label: 'Within WHO guideline' };
  if (v <= INDIA_NAAQS_PM25_24H) return { level: 'warning', color: STATUS_COLORS.warning, label: 'Above WHO, within NAAQS' };
  return { level: 'critical', color: STATUS_COLORS.critical, label: 'Above India NAAQS' };
}

/**
 * Fastest on-screen speed (m/s) the flow animation may show. Gentle draughts (≤ 0.3 m/s) are sped up
 * to be visible, but a fan's 1–3 m/s jet sped up as much races across the room and looks wrong.
 */
export const MAX_ANIMATED_SPEED_MS = 6;

/**
 * Speed-up actually used for streamlines and smoke: the chosen one (default 20×), capped so the
 * fastest air in the result moves at most MAX_ANIMATED_SPEED_MS on screen, and never slower than
 * real time.
 */
export function motionTimeScale(maxSpeedMs: number, chosen: number): number {
  if (!(maxSpeedMs > 0)) return chosen;
  return Math.max(1, Math.min(chosen, MAX_ANIMATED_SPEED_MS / maxSpeedMs));
}
