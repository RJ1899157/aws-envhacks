import { apiBaseUrl } from '../config';

/**
 * Client of the AWS backend (see infra/README.md). Both calls throw on HTTP errors, network
 * failures, timeouts or a missing base URL; callers decide what to fall back to.
 */

/** GET /conditions response. `time` values are GMT without a zone, as Open-Meteo returns them. */
export interface ConditionsResponse {
  current: { time: string; pm2_5: number };
  /** null when the weather lookup failed (PM2.5 is still returned) */
  weather: { time: string; temperatureC: number; windSpeedMs: number; windDirDeg: number } | null;
  location: { lat: number; lon: number };
  source: string;
  cached: boolean;
}

/** POST /explain body: one ranked action, numbers rounded (see buildExplainPayload). */
export interface ExplainPayload {
  objective: string;
  action: {
    texts: string[];
    effort: 'Free' | 'Low' | 'Purchase';
    before: number;
    after: number;
    fraction: number;
    roomDeltas: { name: string; before: number; after: number }[];
    facts: string[];
    verified: 'unverified' | 'pending' | 'verified' | 'disagrees';
  };
  outdoorPm25: number;
}

export interface ExplainResponse {
  /** null when the backend could not ground the answer in the numbers it was given */
  text: string | null;
}

export const CONDITIONS_TIMEOUT_MS = 10_000;
export const EXPLAIN_TIMEOUT_MS = 20_000;

async function request(path: string, init: RequestInit, timeoutMs: number): Promise<unknown> {
  if (!apiBaseUrl) throw new Error('No backend configured (VITE_API_BASE_URL)');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`${apiBaseUrl}${path}`, { ...init, signal: controller.signal });
    const body = (await res.json().catch(() => null)) as { error?: boolean; reason?: string } | null;
    if (!res.ok || !body || body.error) throw new Error(`Backend ${path} failed (HTTP ${res.status})${body?.reason ? `: ${body.reason}` : ''}`);
    return body;
  } catch (err) {
    if (controller.signal.aborted) throw new Error(`Backend ${path} timed out after ${timeoutMs / 1000} s`);
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

export async function getConditions(lat: number, lon: number): Promise<ConditionsResponse> {
  const body = (await request(`/conditions?lat=${encodeURIComponent(lat)}&lon=${encodeURIComponent(lon)}`, { method: 'GET' }, CONDITIONS_TIMEOUT_MS)) as Partial<ConditionsResponse>;
  if (!body.current || !isNum(body.current.pm2_5) || body.current.pm2_5 < 0) throw new Error('Backend /conditions returned no PM2.5 value');
  const w = body.weather;
  const weather = w && isNum(w.temperatureC) && isNum(w.windSpeedMs) && isNum(w.windDirDeg) ? w : null;
  return {
    current: body.current,
    weather,
    location: body.location ?? { lat, lon },
    source: body.source ?? 'unknown',
    cached: body.cached ?? false,
  };
}

export async function explainAction(payload: ExplainPayload): Promise<ExplainResponse> {
  const body = (await request('/explain', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) }, EXPLAIN_TIMEOUT_MS)) as { text?: unknown };
  return { text: typeof body.text === 'string' && body.text.trim() !== '' ? body.text : null };
}
