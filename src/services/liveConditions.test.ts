import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ConditionsResponse } from './api';
import { conditionsToParams, DELHI, fetchLiveConditions, formatLocalTime, liveCaption, resolveLocation, shouldAutoLive } from './liveConditions';
import { useSimulationStore } from '../store/simulationStore';

vi.mock('../config', () => ({ apiBaseUrl: 'https://api.test' }));

const response = (weather: ConditionsResponse['weather']): ConditionsResponse => ({
  current: { time: '2026-10-11T07:00', pm2_5: 143.2 },
  weather,
  location: { lat: 28.61, lon: 77.21 },
  source: 'open-meteo',
  cached: false,
});
const WEATHER = { time: '2026-10-11T07:15', temperatureC: 29.1, windSpeedMs: 2.3, windDirDeg: 310 };

describe('conditionsToParams', () => {
  it('maps PM2.5, location and weather (outdoor only; no observedAt)', () => {
    const p = conditionsToParams(response(WEATHER), { lat: 28.6139, lon: 77.209 });
    expect(p).toEqual({
      outdoorPm25: { valueUgM3: 143.2, source: 'live' },
      location: { lat: 28.61, lon: 77.21 },
      windSpeed: 2.3,
      windDirDeg: 310,
      outdoorTempC: 29.1,
    });
    expect(p).not.toHaveProperty('indoorTempC');
    expect(p.outdoorPm25).not.toHaveProperty('observedAt');
  });

  it('leaves wind and temperature alone when weather is null', () => {
    const p = conditionsToParams(response(null), DELHI);
    expect(p).toEqual({ outdoorPm25: { valueUgM3: 143.2, source: 'live' }, location: DELHI });
  });

  it('keeps the meteorological "from" bearing within 0–360', () => {
    expect(conditionsToParams(response({ ...WEATHER, windDirDeg: 360 }), DELHI).windDirDeg).toBe(0);
    expect(conditionsToParams(response({ ...WEATHER, windDirDeg: 90 }), DELHI).windDirDeg).toBe(90);
  });
});

describe('resolveLocation', () => {
  it('prefers the project location', async () => {
    const locate = vi.fn();
    expect(await resolveLocation({ location: { lat: 51.5, lon: -0.12 } }, locate)).toEqual({ location: { lat: 51.5, lon: -0.12 }, place: 'your location' });
    expect(locate).not.toHaveBeenCalled();
  });
  it('then the browser, then Delhi', async () => {
    expect(await resolveLocation({}, async () => ({ lat: 1, lon: 2 }))).toEqual({ location: { lat: 1, lon: 2 }, place: 'your location' });
    expect(await resolveLocation({}, async () => null)).toEqual({ location: DELHI, place: 'Delhi' });
  });
  it('a location saved from the Delhi fallback is still labelled Delhi', async () => {
    expect((await resolveLocation({ location: DELHI })).place).toBe('Delhi');
  });
});

describe('fetchLiveConditions', () => {
  beforeEach(() => useSimulationStore.setState({ outdoorLookup: { status: 'idle', reading: null } }));
  afterEach(() => vi.unstubAllGlobals());

  it('applies one params write and records the display info', async () => {
    const fetchMock = vi.fn(async () => ({ ok: true, status: 200, json: async () => response(WEATHER) }));
    vi.stubGlobal('fetch', fetchMock);
    const apply = vi.fn();
    await fetchLiveConditions({}, apply, async () => null);
    expect(fetchMock).toHaveBeenCalledWith('https://api.test/conditions?lat=28.61&lon=77.21', expect.anything());
    expect(apply).toHaveBeenCalledTimes(1);
    expect(apply.mock.calls[0]![0]).toMatchObject({ outdoorPm25: { valueUgM3: 143.2, source: 'live' }, windDirDeg: 310 });
    const l = useSimulationStore.getState().outdoorLookup;
    expect(l).toMatchObject({ status: 'done', place: 'Delhi', weather: WEATHER, reading: { pm25UgM3: 143.2, observedAt: '2026-10-11T07:00' } });
  });

  it('changes nothing on failure', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 502, json: async () => ({ error: true, reason: 'upstream' }) })));
    const apply = vi.fn();
    await fetchLiveConditions({ location: { lat: 1, lon: 2 } }, apply);
    expect(apply).not.toHaveBeenCalled();
    expect(useSimulationStore.getState().outdoorLookup.status).toBe('error');
  });
});

describe('liveCaption', () => {
  const done = { status: 'done' as const, reading: { pm25UgM3: 143.2, source: 'live' as const, provider: 'open-meteo', observedAt: '2026-10-11T07:00' }, place: 'Delhi', weather: WEATHER };
  it('success, with and without weather', () => {
    const t = formatLocalTime('2026-10-11T07:00');
    expect(liveCaption(done, true)).toBe(`Live · Delhi · ${t} · wind 2.3 m/s, 29.1 °C`);
    expect(liveCaption({ ...done, weather: null }, true)).toBe(`Live · Delhi · ${t}`);
  });
  it('loading and failure', () => {
    expect(liveCaption({ status: 'loading', reading: null }, false)).toBe('Fetching live conditions…');
    expect(liveCaption({ status: 'error', reading: null }, false)).toBe('Live data unavailable. Kept the current values.');
  });
  it('nothing before a fetch or after switching to a preset', () => {
    expect(liveCaption({ status: 'idle', reading: null }, false)).toBeNull();
    expect(liveCaption(done, false)).toBeNull();
  });
  it('formats GMT as local HH:MM', () => {
    expect(formatLocalTime('2026-10-11T07:00')).toMatch(/^\d\d:\d\d$/);
    const d = new Date('2026-10-11T07:00Z');
    expect(formatLocalTime('2026-10-11T07:00')).toBe(`${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`);
  });
});

describe('shouldAutoLive', () => {
  it('fetches live by default, but never without a backend, when already live, or after a preset was picked', () => {
    expect(shouldAutoLive({}, true)).toBe(true);
    // A design's built-in value (e.g. the example flat's 60) is not a user choice
    expect(shouldAutoLive({ outdoorPm25: { valueUgM3: 60, source: 'manual' } }, true)).toBe(true);
    expect(shouldAutoLive({}, false)).toBe(false);
    expect(shouldAutoLive({ outdoorPm25: { valueUgM3: 143, source: 'live' } }, true)).toBe(false);
    expect(shouldAutoLive({ outdoorPm25: { valueUgM3: 250, source: 'manual', chosen: true } }, true)).toBe(false);
  });
});
