import { describe, expect, it } from 'vitest';
import { device, opening, rectRoom } from '../test/simulationFixtures';
import { CP_BY_EXPOSURE, TERRAIN_WIND_COEFFICIENTS, WIND_REFERENCE_HEIGHT_M } from './constants';
import {
  computedOpeningRoles,
  computeVentilation,
  crossVentilationFlow,
  localWindSpeed,
  pressureCoefficient,
  seriesArea,
  singleSidedFlow,
  solveWindFlows,
  windIncidenceDeg,
  type VentilationEnv,
} from './ventilation';

/** Wind from the north hits wall 0 (z = 0, facing −Z) of the fixture rooms. Open terrain, no infiltration. */
const env = (o: Partial<VentilationEnv> = {}): VentilationEnv => ({
  windSpeed: 2,
  windDirDeg: 0,
  indoorTempC: 25,
  outdoorTempC: 25,
  exposure: 'open',
  infiltrationAch: 0,
  ...o,
});

describe('wind pressure coefficients and exposure', () => {
  it('interpolates the AIVC table for each exposure', () => {
    for (const exposure of ['open', 'suburban', 'urbanDense'] as const) {
      const t = CP_BY_EXPOSURE[exposure];
      expect(pressureCoefficient(0, exposure)).toBeCloseTo(t[0]!);
      expect(pressureCoefficient(90, exposure)).toBeCloseTo(t[2]!);
      expect(pressureCoefficient(180, exposure)).toBeCloseTo(t[4]!);
      expect(pressureCoefficient(22.5, exposure)).toBeCloseTo((t[0]! + t[1]!) / 2);
    }
    // Sheltered sites have a smaller windward–leeward difference
    const dCp = (e: 'open' | 'urbanDense') => pressureCoefficient(0, e) - pressureCoefficient(180, e);
    expect(dCp('urbanDense')).toBeLessThan(dCp('open'));
  });

  it('north is −Z: wind from the north hits a −Z facing wall head-on', () => {
    expect(windIncidenceDeg([0, -1], 0)).toBeCloseTo(0);
    expect(windIncidenceDeg([1, 0], 90)).toBeCloseTo(0); // east wind on the +X (east) wall
    expect(windIncidenceDeg([0, 1], 0)).toBeCloseTo(180);
  });

  it('reduces reported wind by terrain (BS 5925 K·z^a)', () => {
    const { K, a } = TERRAIN_WIND_COEFFICIENTS.urbanDense;
    expect(localWindSpeed(4, 'urbanDense')).toBeCloseTo(4 * K * WIND_REFERENCE_HEIGHT_M ** a);
    expect(localWindSpeed(4, 'urbanDense')).toBeLessThan(localWindSpeed(4, 'suburban'));
    expect(localWindSpeed(4, 'suburban')).toBeLessThan(localWindSpeed(4, 'open'));
  });

  it('defaults to urbanDense, overridable by room params', () => {
    const room = rectRoom(4, 3, 2.5, { openings: [opening('a', 0), opening('b', 2)] });
    const noExposure = env({ exposure: undefined });
    expect(computeVentilation(room, noExposure).exposure).toBe('urbanDense');
    const open = { ...room, params: { ...room.params, exposure: 'open' as const } };
    expect(computeVentilation(open, noExposure).exposure).toBe('open');
    expect(computeVentilation(open, noExposure).ach).toBeGreaterThan(computeVentilation(room, noExposure).ach);
  });
});

describe('ventilation', () => {
  it('with zero openings ACH comes from mechanical sources only', () => {
    const room = rectRoom(4, 3, 2.5, {
      objects: [
        device('fan', 'exhaust-fan', { exhaustFlowM3h: 360 }),
        device('purifier', 'air-purifier'),
        device('ceiling', 'ceiling-fan', { defaultAirflow: 800 }),
      ],
    });
    const v = computeVentilation(room, env());
    expect(v.type).toBe('mechanical');
    expect(v.naturalM3s).toBe(0);
    expect(v.ach).toBeCloseTo(360 / 30);
    expect(v.achBreakdown.exhaust).toBeCloseTo(12);
    expect(v.warnings.some((w) => w.includes('No open openings'))).toBe(true);

    const sealed = computeVentilation(rectRoom(4, 3, 2.5), env());
    expect(sealed.ach).toBe(0);
    expect(sealed.type).toBe('none');
  });

  it('adds 0.5 /h background infiltration by default', () => {
    const defaults = env({ infiltrationAch: undefined });
    const v = computeVentilation(rectRoom(4, 3, 2.5), defaults);
    expect(v.type).toBe('infiltration');
    expect(v.achBreakdown.infiltration).toBeCloseTo(0.5);
  });

  it('disabled devices contribute nothing', () => {
    const room = rectRoom(4, 3, 2.5, {
      objects: [device('fan', 'exhaust-fan', { exhaustFlowM3h: 360, enabled: false })],
    });
    const v = computeVentilation(room, env());
    expect(v.exhaustM3s).toBe(0);
    expect(v.devices[0]!.enabled).toBe(false);
  });

  it('cross ventilation exceeds single-sided for the same area and wind', () => {
    const cross = rectRoom(4, 3, 2.5, { openings: [opening('a', 0), opening('b', 2)] });
    const single = rectRoom(4, 3, 2.5, { openings: [opening('a', 0), opening('b', 0, { offset: 2 })] });
    for (const exposure of ['open', 'urbanDense'] as const) {
      const qc = computeVentilation(cross, env({ exposure }));
      const qs = computeVentilation(single, env({ exposure }));
      expect(qc.type).toBe('cross');
      expect(qs.type).toBe('single-sided');
      expect(qs.windM3s).toBeCloseTo(singleSidedFlow(2, localWindSpeed(2, exposure)));
      expect(qc.windM3s).toBeGreaterThan(qs.windM3s);
    }
  });

  it('the multi-opening solver reduces to Q = Cd·A_eff·U·sqrt(ΔCp) for two openings', () => {
    const flows = solveWindFlows([1.2, 0.6], [0.6, -0.3], 3);
    const expected = crossVentilationFlow(1.2, 0.6, 3, 0.9);
    expect(flows[0]).toBeCloseTo(expected, 6);
    expect(flows[1]).toBeCloseTo(-expected, 6);
    expect(seriesArea([1, 1])).toBeCloseTo(1 / Math.SQRT2);
  });

  it('Q scales linearly with wind speed', () => {
    const cross = rectRoom(4, 3, 2.5, { openings: [opening('a', 0), opening('b', 2, { openFraction: 0.4 })] });
    const single = rectRoom(4, 3, 2.5, { openings: [opening('a', 0)] });
    for (const room of [cross, single]) {
      for (const exposure of ['open', 'urbanDense'] as const) {
        const q1 = computeVentilation(room, env({ windSpeed: 1.5, exposure })).totalM3s;
        const q2 = computeVentilation(room, env({ windSpeed: 3, exposure })).totalM3s;
        const q4 = computeVentilation(room, env({ windSpeed: 6, exposure })).totalM3s;
        expect(q2 / q1).toBeCloseTo(2, 9);
        expect(q4 / q1).toBeCloseTo(4, 9);
      }
    }
  });

  it('per-opening breakdown balances and gives inlet velocities', () => {
    const room = rectRoom(4, 3, 2.5, { openings: [opening('a', 0), opening('b', 2, { openFraction: 0.5 })] });
    const v = computeVentilation(room, env());
    const [a, b] = v.openings;
    expect(a!.direction).toBe('in');
    expect(b!.direction).toBe('out');
    expect(a!.windNetM3s + b!.windNetM3s).toBeCloseTo(0, 9);
    expect(a!.velocityMs).toBeCloseTo(a!.flowM3s / a!.effectiveArea);
  });

  it('wind 0 falls back to stack only; warm room drives air in low and out high', () => {
    const room = rectRoom(4, 3, 2.7, {
      openings: [opening('low', 0, { sill: 0.1, height: 0.5 }), opening('high', 2, { sill: 2, height: 0.5 })],
    });
    const v = computeVentilation(room, env({ windSpeed: 0, indoorTempC: 30, outdoorTempC: 20 }));
    expect(v.type).toBe('stack');
    expect(v.windM3s).toBe(0);
    expect(v.stackM3s).toBeGreaterThan(0);
    expect(v.warnings.some((w) => w.includes('stack effect only'))).toBe(true);
    expect(v.openings.find((o) => o.id === 'low')!.computedRole).toBe('inlet');
    expect(v.openings.find((o) => o.id === 'high')!.computedRole).toBe('outlet');
  });

  it('combines wind and stack in quadrature', () => {
    const room = rectRoom(4, 3, 2.5, { openings: [opening('a', 0)] });
    const v = computeVentilation(room, env({ indoorTempC: 20, outdoorTempC: 30 }));
    expect(v.windM3s).toBeGreaterThan(0);
    expect(v.stackM3s).toBeGreaterThan(0);
    expect(v.naturalM3s).toBeCloseTo(Math.hypot(v.windM3s, v.stackM3s));
  });
});

describe('computed opening roles', () => {
  it('come from the flow, not the tag, and flag mismatches', () => {
    const room = rectRoom(4, 3, 2.5, {
      openings: [
        opening('a', 0, { role: 'outlet' }), // windward, tagged outlet
        opening('b', 2, { role: 'inlet' }), // leeward, tagged inlet
        opening('c', 1, { role: 'inlet', openFraction: 0 }),
        opening('d', 3, { role: 'closed', openFraction: 1 }),
      ],
    });
    const v = computeVentilation(room, env());
    expect(computedOpeningRoles(v)).toEqual({ a: 'inlet', b: 'outlet', c: 'closed', d: 'closed' });
    expect(v.openings.filter((o) => o.roleMismatch).map((o) => o.id)).toEqual(['a', 'b']);
    expect(v.openings[0]!.taggedRole).toBe('outlet'); // the stored label is untouched
    expect(v.warnings.filter((w) => w.includes('is tagged'))).toHaveLength(2);
  });

  it('single-sided openings are bidirectional', () => {
    const v = computeVentilation(rectRoom(4, 3, 2.5, { openings: [opening('a', 0)] }), env());
    expect(v.openings[0]!.computedRole).toBe('bidirectional');
    expect(v.openings[0]!.roleMismatch).toBe(false);
  });
});
