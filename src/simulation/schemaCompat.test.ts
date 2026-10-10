import { describe, expect, it } from 'vitest';
import { parseRoom } from '../core/parser';
import { createBedroomSample, createLivingRoomSample, createStudioSample } from '../core/samples';
import { ObjectSchema, RoomParamsSchema, RoomSchema } from '../core/schema';
import { simulateWellMixed } from './wellMixed';

/** A Phase 1 export, written before the air-simulation fields existed. */
const PHASE1_JSON = JSON.stringify({
  version: 1,
  name: 'Old design',
  wallHeight: 2.7,
  wallThickness: 0.15,
  outline: [[-2, -1.5], [2, -1.5], [2, 1.5], [-2, 1.5]],
  openings: [{ id: 'w', wallIndex: 0, type: 'window', offset: 1, width: 1.2, height: 1.2, sill: 0.9, role: 'inlet', openFraction: 0.5 }],
  objects: [{ id: 'p', assetId: 'air-purifier', name: 'Air Purifier', position: [1, 0, 0], rotation: [0, 0, 0], size: [0.38, 0.6, 0.38], elevation: 0, role: 'source', wallMounted: false, defaultAirflow: 300 }],
  params: { windSpeed: 2.5, windDirDeg: 0, pressurePa: 101325, indoorTempC: 22, outdoorTempC: 25, humidity: 50, datetime: '2026-10-05T12:00:00Z' },
  floorMaterial: 'wood',
  wallMaterial: 'paint',
});

describe('backward compatibility of the Phase 2 schema additions', () => {
  it('an old design JSON without the new fields still loads unchanged', () => {
    const raw = JSON.parse(PHASE1_JSON);
    const parsed = parseRoom(raw);
    expect(parsed.issues.filter((i) => i.level === 'error')).toHaveLength(0);
    expect(parsed.room).toEqual(raw); // no new keys are injected by defaults
    expect(parsed.room!.params.pm25Sources).toBeUndefined();
    expect(parsed.room!.params.outdoorPm25).toBeUndefined();
    expect(parsed.room!.params.location).toBeUndefined();
    expect(parsed.room!.params.exposure).toBeUndefined();
    const obj = parsed.room!.objects[0]!;
    expect([obj.cadrM3h, obj.device, obj.enabled, obj.dischargeVelocityMs]).toEqual([undefined, undefined, undefined, undefined]);
  });

  it('the sample templates round-trip through JSON exactly as before', () => {
    for (const sample of [createStudioSample(), createBedroomSample(), createLivingRoomSample()]) {
      const json = JSON.stringify(sample);
      expect(json).not.toMatch(/pm25Sources|outdoorPm25|location|exposure|cadrM3h|exhaustFlowM3h|"device"|"enabled"|dischargeVelocityMs/);
      expect(JSON.stringify(RoomSchema.parse(JSON.parse(json)))).toBe(json);
    }
  });

  it('old designs simulate with runtime defaults (device from assetId, enabled, urbanDense, infiltration)', () => {
    const room = RoomSchema.parse(JSON.parse(PHASE1_JSON));
    const r = simulateWellMixed(room);
    expect(r.ventilation.devices[0]).toMatchObject({ kind: 'purifier', enabled: true });
    expect(r.lossRatesPerHour.purifiers).toBeCloseTo(300 / r.volumeM3);
    expect(r.ventilation.exposure).toBe('urbanDense');
    expect(r.achBreakdown.infiltration).toBeCloseTo(0.5);
    expect(r.warnings.some((w) => w.includes('Outdoor PM2.5 not set'))).toBe(true);
  });

  it('accepts and validates the new optional fields', () => {
    const params = RoomParamsSchema.parse({
      pm25Sources: [{ id: 'cook', kind: 'cooking-frying', emissionRateUgMin: 1700, schedule: [{ startMin: 0, durationMin: 30 }] }],
      outdoorPm25: { valueUgM3: 150 },
      location: { lat: 28.61, lon: 77.21 },
      exposure: 'suburban',
    });
    expect(params.outdoorPm25!.source).toBe('manual');
    expect(params.exposure).toBe('suburban');
    expect(RoomParamsSchema.safeParse({ exposure: 'rural' }).success).toBe(false);
    const base = JSON.parse(PHASE1_JSON).objects[0];
    expect(ObjectSchema.parse({ ...base, device: 'ceilingFan', enabled: false, dischargeVelocityMs: 2 }).device).toBe('ceilingFan');
    expect(ObjectSchema.safeParse({ ...base, device: 'blender' }).success).toBe(false);
    expect(ObjectSchema.safeParse({ ...base, dischargeVelocityMs: -1 }).success).toBe(false);
    expect(RoomParamsSchema.safeParse({ location: { lat: 95, lon: 0 } }).success).toBe(false);
    expect(RoomParamsSchema.safeParse({ pm25Sources: [{ id: 'x', emissionRateUgMin: -1 }] }).success).toBe(false);
    expect(ObjectSchema.safeParse({ ...JSON.parse(PHASE1_JSON).objects[0], cadrM3h: -5 }).success).toBe(false);
  });
});
