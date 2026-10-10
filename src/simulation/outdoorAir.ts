import type { GeoLocation, OutdoorPm25Source } from '../core/schema';

/**
 * Outdoor PM2.5 providers. Swappable so the live source can later go through an AWS Lambda proxy
 * (pass its URL as `baseUrl`, or implement OutdoorAirProvider directly). No DOM APIs: `fetch` is
 * injected and defaults to the global one available in browsers, workers and Node 18+.
 */

export interface OutdoorAirReading {
  pm25UgM3: number;
  source: OutdoorPm25Source;
  /** Provider that produced the value */
  provider: string;
  /** Time of the observation/model step, ISO 8601 (as returned by the provider) */
  observedAt?: string;
  /** Set when a live lookup failed and a fallback value was used */
  fallbackReason?: string;
}

export interface OutdoorAirProvider {
  readonly name: string;
  getCurrentPm25(location?: GeoLocation): Promise<OutdoorAirReading>;
}

export function createManualProvider(pm25UgM3: number): OutdoorAirProvider {
  if (!(pm25UgM3 >= 0) || !Number.isFinite(pm25UgM3)) throw new Error('Manual PM2.5 must be a non-negative number');
  return {
    name: 'manual',
    getCurrentPm25: async () => ({ pm25UgM3, source: 'manual', provider: 'manual' }),
  };
}

/** Open-Meteo Air Quality API (CAMS model data, no key needed for non-commercial use). */
export const OPEN_METEO_AIR_QUALITY_URL = 'https://air-quality-api.open-meteo.com/v1/air-quality';

export type FetchLike = (url: string, init?: { signal?: AbortSignal }) => Promise<{
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
}>;

export interface OpenMeteoOptions {
  /** Endpoint; swap for a proxy that accepts the same query string */
  baseUrl?: string;
  fetch?: FetchLike;
  timeoutMs?: number;
}

/**
 * GET {baseUrl}?latitude=…&longitude=…&current=pm2_5
 * Response (checked 2026-10-08): { current_units: { pm2_5: "μg/m³" }, current: { time, interval, pm2_5 } }
 * Errors: HTTP 400 with { error: true, reason }.
 */
export function createOpenMeteoProvider(options: OpenMeteoOptions = {}): OutdoorAirProvider {
  const baseUrl = options.baseUrl ?? OPEN_METEO_AIR_QUALITY_URL;
  const timeoutMs = options.timeoutMs ?? 8000;
  return {
    name: 'open-meteo',
    async getCurrentPm25(location) {
      if (!location) throw new Error('Open-Meteo needs a project location (lat/lon)');
      const doFetch = options.fetch ?? (globalThis.fetch as FetchLike | undefined);
      if (!doFetch) throw new Error('fetch is not available in this environment');
      const url = `${baseUrl}?latitude=${location.lat}&longitude=${location.lon}&current=pm2_5`;

      const controller = typeof AbortController !== 'undefined' ? new AbortController() : undefined;
      const timer = controller ? setTimeout(() => controller.abort(), timeoutMs) : undefined;
      try {
        const res = await doFetch(url, { signal: controller?.signal });
        const body = (await res.json().catch(() => null)) as {
          error?: boolean;
          reason?: string;
          current?: { time?: string; pm2_5?: number | null };
        } | null;
        if (!res.ok || body?.error) {
          throw new Error(`Open-Meteo request failed (HTTP ${res.status})${body?.reason ? `: ${body.reason}` : ''}`);
        }
        const value = body?.current?.pm2_5;
        if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
          throw new Error('Open-Meteo response has no current pm2_5 value');
        }
        return { pm25UgM3: value, source: 'live', provider: 'open-meteo', observedAt: body?.current?.time };
      } finally {
        if (timer !== undefined) clearTimeout(timer);
      }
    },
  };
}

/** Tries `primary`; on any error returns the fallback's value with `fallbackReason` set. */
export function withFallback(primary: OutdoorAirProvider, fallback: OutdoorAirProvider): OutdoorAirProvider {
  return {
    name: `${primary.name}|${fallback.name}`,
    async getCurrentPm25(location) {
      try {
        return await primary.getCurrentPm25(location);
      } catch (err) {
        const reading = await fallback.getCurrentPm25(location);
        return { ...reading, fallbackReason: err instanceof Error ? err.message : String(err) };
      }
    },
  };
}
