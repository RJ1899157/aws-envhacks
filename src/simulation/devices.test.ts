import { describe, expect, it } from 'vitest';
import { device } from '../test/simulationFixtures';
import { DEFAULT_DEVICE_FLOW_M3H, DEFAULT_DISCHARGE_VELOCITY_MS } from './constants';
import { DEVICE_KIND_BY_ASSET, deviceFor, deviceKindOf, totalFlow } from './devices';

describe('device kinds', () => {
  it('infers the kind from the asset id when `device` is missing', () => {
    for (const [assetId, kind] of Object.entries(DEVICE_KIND_BY_ASSET)) {
      expect(deviceKindOf(device('d', assetId))).toBe(kind);
    }
    expect(deviceKindOf(device('d', 'sofa', { role: 'solid' }))).toBeNull();
  });

  it('an explicit `device` wins over the asset id', () => {
    expect(deviceKindOf(device('d', 'pedestal-fan', { device: 'purifier' }))).toBe('purifier');
    expect(deviceKindOf(device('d', 'custom-box', { device: 'rangeHood' }))).toBe('rangeHood');
  });

  it('reads defaultAirflow as m³/h and falls back to per-kind defaults', () => {
    expect(deviceFor(device('d', 'exhaust-fan', { defaultAirflow: 360 }))!.flowM3s).toBeCloseTo(0.1);
    expect(deviceFor(device('d', 'range-hood'))!.flowM3s * 3600).toBeCloseTo(DEFAULT_DEVICE_FLOW_M3H.rangeHood);
    // Explicit CADR / exhaust flow take precedence over defaultAirflow
    expect(deviceFor(device('d', 'air-purifier', { defaultAirflow: 400, cadrM3h: 180 }))!.flowM3s * 3600).toBeCloseTo(180);
  });

  it('gives fans a discharge velocity for the voxel solver', () => {
    expect(deviceFor(device('d', 'ceiling-fan'))!.dischargeVelocityMs).toBe(DEFAULT_DISCHARGE_VELOCITY_MS.ceilingFan);
    expect(deviceFor(device('d', 'pedestal-fan', { dischargeVelocityMs: 4.2 }))!.dischargeVelocityMs).toBe(4.2);
    expect(deviceFor(device('d', 'exhaust-fan'))!.dischargeVelocityMs).toBeNull();
  });

  it('disabled devices are excluded from totals', () => {
    const devices = [
      deviceFor(device('a', 'air-purifier', { cadrM3h: 360 }))!,
      deviceFor(device('b', 'air-purifier', { cadrM3h: 360, enabled: false }))!,
    ];
    expect(totalFlow(devices, 'clean')).toBeCloseTo(0.1);
  });
});
