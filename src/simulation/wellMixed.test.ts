import { describe, expect, it } from 'vitest';
import { device, opening, rectRoom } from '../test/simulationFixtures';
import { PM25_DEPOSITION_RATE_PER_S } from './constants';
import {
  analyticConcentration,
  analyticTimeToReach,
  massBalanceCoefficients,
  simulateWellMixed,
  steadyState,
} from './wellMixed';

const crossRoom = () => rectRoom(4, 3, 2.5, { openings: [opening('a', 0, { openFraction: 0.3 }), opening('b', 2, { openFraction: 0.3 })] });
const closedRoom = (objects = [device('hood', 'range-hood', { exhaustFlowM3h: 30 })]) => rectRoom(4, 3, 2.5, { objects });

describe('analytic box model', () => {
  it('steady state is gain / loss and C(t) relaxes toward it', () => {
    const k = massBalanceCoefficients({
      volumeM3: 30, airExchangePerS: 1 / 3600, penetration: 1, outdoorUgM3: 100,
      emissionUgPerS: 0, depositionPerS: 0, cadrM3s: 0,
    });
    expect(steadyState(k)).toBeCloseTo(100);
    expect(analyticConcentration(k, 0, 3600)).toBeCloseTo(100 * (1 - Math.exp(-1)));
    expect(analyticTimeToReach(k, 0, 100 * (1 - Math.exp(-2)))).toBeCloseTo(7200);
    expect(analyticTimeToReach(k, 0, 150)).toBeNull();
  });
});

describe('simulateWellMixed', () => {
  it('no source and C0 = C_out with ACH > 0 stays near P·C_out', () => {
    const r = simulateWellMixed(crossRoom(), { outdoorPm25UgM3: 80, exposure: 'open', infiltrationAch: 0 }, { initialUgM3: 80 });
    expect(r.ach).toBeGreaterThan(1);
    const pCout = r.penetration * 80;
    for (const p of r.series) expect(Math.abs(p.c - pCout) / pCout).toBeLessThan(0.02);
    // Only deposition pulls it below P·C_out
    const lambda = r.lossRatesPerHour.ventilation;
    expect(r.cssUgM3).toBeCloseTo((lambda * pCout) / (lambda + r.lossRatesPerHour.deposition), 6);
  });

  it('adding a purifier lowers Css', () => {
    const env = { outdoorPm25UgM3: 150 };
    const without = simulateWellMixed(closedRoom(), env);
    const withP = simulateWellMixed(closedRoom([device('hood', 'range-hood', { exhaustFlowM3h: 30 }), device('p', 'air-purifier', { cadrM3h: 200 })]), env);
    expect(withP.ach).toBeCloseTo(without.ach); // purifiers do not ventilate
    expect(withP.cssUgM3).toBeLessThan(without.cssUgM3);
    expect(withP.lossRatesPerHour.purifiers).toBeCloseTo(200 / 30);
  });

  it('a disabled purifier contributes nothing, and device events switch it', () => {
    const env = { outdoorPm25UgM3: 150 };
    const off = simulateWellMixed(closedRoom([device('p', 'air-purifier', { cadrM3h: 300, enabled: false })]), env);
    const none = simulateWellMixed(closedRoom([]), env);
    expect(off.cssUgM3).toBeCloseTo(none.cssUgM3, 9);
    expect(off.lossRatesPerHour.purifiers).toBe(0);

    const switchedOn = simulateWellMixed(
      closedRoom([device('p', 'air-purifier', { cadrM3h: 300, enabled: false })]),
      env,
      { events: [{ atS: 600, kind: 'device', objectId: 'p', on: true }] }
    );
    expect(switchedOn.cssUgM3).toBeLessThan(none.cssUgM3 / 2);
    expect(switchedOn.series.find((p) => p.tS === 600)!.c).toBeCloseTo(none.series.find((p) => p.tS === 600)!.c, 6);
  });

  it('analytic and stepped (exponential and RK4) solutions agree within 1%', () => {
    const room = closedRoom();
    const sources = [{ id: 'incense', emissionRateUgMin: 400 }];
    const env = { outdoorPm25UgM3: 150 };
    const v = simulateWellMixed(room, env, { sources, durationS: 1 });
    const k = massBalanceCoefficients({
      volumeM3: v.volumeM3, airExchangePerS: v.ventilation.totalM3s / v.volumeM3, penetration: v.penetration,
      outdoorUgM3: 150, emissionUgPerS: 400 / 60, depositionPerS: PM25_DEPOSITION_RATE_PER_S, cadrM3s: 0,
    });
    for (const method of ['exponential', 'rk4'] as const) {
      const r = simulateWellMixed(room, env, { sources, method, initialUgM3: 0, durationS: 6 * 3600, dtS: 120 });
      for (const p of r.series.filter((s) => s.tS > 0)) {
        const exact = analyticConcentration(k, 0, p.tS);
        expect(Math.abs(p.c - exact) / exact).toBeLessThan(0.01);
      }
      expect(r.cssUgM3).toBeCloseTo(steadyState(k), 6);
    }
  });

  it('a 30-minute cooking source raises C then decays', () => {
    const room = closedRoom();
    const sources = [{ id: 'cook', emissionRateUgMin: 1700, schedule: [{ startMin: 10, durationMin: 30 }] }];
    const r = simulateWellMixed(room, { outdoorPm25UgM3: 0 }, { sources, initialUgM3: 0, durationS: 3 * 3600 });
    const at = (t: number) => r.series.find((p) => p.tS === t)!.c;
    expect(at(600)).toBe(0);
    expect(r.peakUgM3).toBeCloseTo(at(40 * 60), 9);
    expect(at(3 * 3600)).toBeLessThan(at(40 * 60));
    expect(r.cssUgM3).toBeCloseTo(0); // scheduled sources do not count toward the long-run state
  });

  it('opening a window at t = 10 min switches to the faster ventilated decay', () => {
    const room = rectRoom(4, 3, 2.5, { openings: [opening('a', 0, { openFraction: 0 }), opening('b', 2, { openFraction: 0.3 })] });
    const r = simulateWellMixed(room, { outdoorPm25UgM3: 0 }, {
      initialUgM3: 200,
      durationS: 1800,
      dtS: 30,
      events: [{ atS: 600, kind: 'opening', openingId: 'a', openFraction: 0.3 }],
    });
    const c600 = r.series.find((p) => p.tS === 600)!.c;
    const c1200 = r.series.find((p) => p.tS === 1200)!.c;
    // Before: single-sided through b only; after: cross ventilation
    expect(r.ventilationType).toBe('single-sided');
    const before = -Math.log(c600 / 200) / 600;
    const after = -Math.log(c1200 / c600) / 600;
    expect(after).toBeGreaterThan(5 * before);
  });

  it('reports time to cross each threshold and the exposure average', () => {
    const room = closedRoom([device('p', 'air-purifier', { cadrM3h: 300 })]);
    const r = simulateWellMixed(room, { outdoorPm25UgM3: 0, infiltrationAch: 0 }, { initialUgM3: 150, dtS: 10 });
    const k = massBalanceCoefficients({
      volumeM3: 30, airExchangePerS: 0, penetration: 1, outdoorUgM3: 0, emissionUgPerS: 0,
      depositionPerS: PM25_DEPOSITION_RATE_PER_S, cadrM3s: 300 / 3600,
    });
    const who = r.thresholds.find((t) => t.id === 'who-2021-24h')!;
    expect(who.crossing).toBe('falls-below');
    expect(who.timeS!).toBeCloseTo(analyticTimeToReach(k, 150, 15)!, -1);
    expect(r.breathingZoneExposureUgM3).toBeLessThan(150);
    expect(r.breathingZoneExposureUgM3).toBeGreaterThan(r.finalUgM3);

    const flat = simulateWellMixed(room, { outdoorPm25UgM3: 0 }, { initialUgM3: 0 });
    expect(flat.thresholds.every((t) => t.timeS === null && t.crossing === null)).toBe(true);
  });
});
