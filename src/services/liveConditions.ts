import type { GeoLocation, RoomParams } from '../core/schema';
import { useSimulationStore, type SimulationState } from '../store/simulationStore';
import { getConditions, type ConditionsResponse } from './api';

/**
 * "Live" outdoor conditions: where to look (the project location, else the browser's, else Delhi),
 * how the backend's answer maps onto the house params, and the caption under the outdoor chips.
 */

export const DELHI: GeoLocation = { lat: 28.61, lon: 77.21 };
export const GEOLOCATION_TIMEOUT_MS = 5000;

export interface ResolvedLocation {
  location: GeoLocation;
  /** Shown in the caption: "your location" or "Delhi" */
  place: string;
}

const sameLocation = (a: GeoLocation, b: GeoLocation) => Math.abs(a.lat - b.lat) < 0.005 && Math.abs(a.lon - b.lon) < 0.005;

/** The browser's position, or null on denial, error, timeout or no geolocation API. */
export function browserLocation(timeoutMs = GEOLOCATION_TIMEOUT_MS): Promise<GeoLocation | null> {
  const geo = typeof navigator !== 'undefined' ? navigator.geolocation : undefined;
  if (!geo) return Promise.resolve(null);
  return new Promise((resolve) => {
    // Our own timer too: the browser's timeout doesn't run while the permission prompt is open
    const timer = setTimeout(() => resolve(null), timeoutMs);
    const done = (v: GeoLocation | null) => {
      clearTimeout(timer);
      resolve(v);
    };
    try {
      geo.getCurrentPosition(
        (p) => done({ lat: p.coords.latitude, lon: p.coords.longitude }),
        () => done(null),
        { timeout: timeoutMs, maximumAge: 10 * 60 * 1000, enableHighAccuracy: false }
      );
    } catch {
      done(null);
    }
  });
}

/** The project location if set, else the browser's, else Delhi. */
export async function resolveLocation(params: Pick<RoomParams, 'location'>, locate: () => Promise<GeoLocation | null> = browserLocation): Promise<ResolvedLocation> {
  // A location saved by an earlier Delhi fallback is still Delhi
  if (params.location) return { location: params.location, place: sameLocation(params.location, DELHI) ? 'Delhi' : 'your location' };
  const here = await locate();
  return here ? { location: here, place: 'your location' } : { location: DELHI, place: 'Delhi' };
}

const round2 = (v: number) => Math.round(v * 100) / 100;

/**
 * House params from a /conditions response: live outdoor PM2.5, the location (~1 km, as the backend
 * caches it) and, when there is weather, outdoor wind and temperature. The indoor temperature is
 * left alone, and observedAt is not stored (it would change the simulation key on every fetch).
 */
export function conditionsToParams(res: ConditionsResponse, location: GeoLocation): Partial<RoomParams> {
  const params: Partial<RoomParams> = {
    outdoorPm25: { valueUgM3: res.current.pm2_5, source: 'live' },
    location: { lat: round2(location.lat), lon: round2(location.lon) },
  };
  if (res.weather) {
    params.windSpeed = Math.max(0, res.weather.windSpeedMs);
    // Same convention as src/core/wind.ts: meteorological "from" bearing, clockwise from north
    params.windDirDeg = ((res.weather.windDirDeg % 360) + 360) % 360;
    params.outdoorTempC = res.weather.temperatureC;
  }
  return params;
}

/** Local HH:MM of an Open-Meteo time (GMT, no zone suffix). */
export function formatLocalTime(gmt: string): string {
  const d = new Date(/[zZ]|[+-]\d\d:?\d\d$/.test(gmt) ? gmt : `${gmt}Z`);
  if (Number.isNaN(d.getTime())) return gmt;
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

const fmt1 = (v: number) => String(Math.round(v * 10) / 10);

/** Caption under the outdoor chips; null before any live fetch or once another value was chosen. */
export function liveCaption(lookup: SimulationState['outdoorLookup'], liveSelected: boolean): string | null {
  if (lookup.status === 'loading') return 'Fetching live conditions…';
  if (lookup.status === 'error') return 'Live data unavailable. Kept the current values.';
  if (lookup.status !== 'done' || !liveSelected) return null;
  const time = lookup.reading?.observedAt ? ` · ${formatLocalTime(lookup.reading.observedAt)}` : '';
  const w = lookup.weather;
  const weather = w ? ` · wind ${fmt1(w.windSpeedMs)} m/s, ${fmt1(w.temperatureC)} °C` : '';
  return `Live · ${lookup.place ?? 'your location'}${time}${weather}`;
}

/**
 * Live is the default outdoor air: look it up on opening Results when there is a backend, unless
 * the value is live already or the user picked one (a preset chip).
 */
export function shouldAutoLive(params: Pick<RoomParams, 'outdoorPm25'>, hasBackend: boolean): boolean {
  return hasBackend && params.outdoorPm25?.source !== 'live' && !params.outdoorPm25?.chosen;
}

let inFlight = false;

/**
 * Looks up live conditions and hands the params to `apply` (one house-params write + re-run, done
 * by the caller). On failure nothing is applied and the caption says so.
 */
export async function fetchLiveConditions(params: Pick<RoomParams, 'location'>, apply: (p: Partial<RoomParams>) => void, locate?: () => Promise<GeoLocation | null>): Promise<void> {
  if (inFlight) return;
  inFlight = true;
  const sim = useSimulationStore.getState;
  const prev = sim().outdoorLookup;
  sim().setOutdoorLookup({ ...prev, status: 'loading' });
  try {
    const { location, place } = await resolveLocation(params, locate);
    const res = await getConditions(location.lat, location.lon);
    apply(conditionsToParams(res, location));
    sim().setOutdoorLookup({
      status: 'done',
      reading: { pm25UgM3: res.current.pm2_5, source: 'live', provider: res.source, observedAt: res.current.time },
      place,
      weather: res.weather,
    });
  } catch {
    sim().setOutdoorLookup({ ...prev, status: 'error' });
  } finally {
    inFlight = false;
  }
}
