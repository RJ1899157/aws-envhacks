import { describe, expect, it, vi } from 'vitest';
import { createManualProvider, createOpenMeteoProvider, withFallback, type FetchLike } from './outdoorAir';

const delhi = { lat: 28.61, lon: 77.21 };
const respond = (status: number, body: unknown): FetchLike => vi.fn(async () => ({ ok: status < 400, status, json: async () => body }));

describe('outdoor air providers', () => {
  it('manual provider returns its value', async () => {
    await expect(createManualProvider(150).getCurrentPm25()).resolves.toMatchObject({ pm25UgM3: 150, source: 'manual' });
    expect(() => createManualProvider(-1)).toThrow();
  });

  it('Open-Meteo provider requests current pm2_5 and parses it', async () => {
    const fetch = respond(200, { current_units: { pm2_5: 'μg/m³' }, current: { time: '2026-10-08T15:00', interval: 3600, pm2_5: 182.4 } });
    const reading = await createOpenMeteoProvider({ fetch }).getCurrentPm25(delhi);
    expect(reading).toEqual({ pm25UgM3: 182.4, source: 'live', provider: 'open-meteo', observedAt: '2026-10-08T15:00' });
    const url = (fetch as ReturnType<typeof vi.fn>).mock.calls[0]![0] as string;
    expect(url).toBe('https://air-quality-api.open-meteo.com/v1/air-quality?latitude=28.61&longitude=77.21&current=pm2_5');
  });

  it('can be pointed at a proxy', async () => {
    const fetch = respond(200, { current: { pm2_5: 10 } });
    await createOpenMeteoProvider({ fetch, baseUrl: 'https://proxy.example/aq' }).getCurrentPm25(delhi);
    expect((fetch as ReturnType<typeof vi.fn>).mock.calls[0]![0]).toMatch(/^https:\/\/proxy\.example\/aq\?latitude=/);
  });

  it('falls back to the manual value on API errors, bad payloads, network failures and missing location', async () => {
    const manual = createManualProvider(150);
    const cases: [FetchLike, string | undefined][] = [
      [respond(400, { error: true, reason: 'Latitude must be in range' }), 'Latitude must be in range'],
      [respond(200, { current: { pm2_5: null } }), 'no current pm2_5'],
      [vi.fn(async () => { throw new Error('offline'); }), 'offline'],
    ];
    for (const [fetch, reason] of cases) {
      const r = await withFallback(createOpenMeteoProvider({ fetch }), manual).getCurrentPm25(delhi);
      expect(r).toMatchObject({ pm25UgM3: 150, source: 'manual' });
      expect(r.fallbackReason).toContain(reason);
    }
    const noLoc = await withFallback(createOpenMeteoProvider({ fetch: respond(200, {}) }), manual).getCurrentPm25();
    expect(noLoc.fallbackReason).toMatch(/location/);
  });
});
