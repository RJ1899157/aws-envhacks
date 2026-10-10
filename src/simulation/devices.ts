import type { DeviceKind, SceneObject } from '../core/schema';
import { DEFAULT_DEVICE_FLOW_M3H, DEFAULT_DISCHARGE_VELOCITY_MS, PM25_SOURCE_PRESETS, SECONDS_PER_HOUR } from './constants';

/** The single asset → device mapping used when an object has no explicit `device`. */
export const DEVICE_KIND_BY_ASSET: Readonly<Record<string, DeviceKind>> = {
  'air-purifier': 'purifier',
  'exhaust-fan': 'exhaustFan',
  'range-hood': 'rangeHood',
  'ceiling-fan': 'ceilingFan',
  'pedestal-fan': 'pedestalFan',
  'ac-split': 'ac',
  ...Object.fromEntries(Object.values(PM25_SOURCE_PRESETS).map((p) => [p.assetId, 'pm25Source' as const])),
};

/** Device kinds that move or clean air (a placed PM2.5 source only emits; see simulation/sources.ts). */
export type AirDeviceKind = Exclude<DeviceKind, 'pm25Source'>;

/**
 * How a device acts in the well-mixed model:
 * - clean: removes PM2.5 at its CADR (purifier)
 * - exhaust: extracts air to outdoors, adding to air exchange (exhaust fan, range hood)
 * - mix: recirculates room air; no effect on ACH, only on the voxel solver (fans, AC)
 */
export type DeviceRole = 'clean' | 'exhaust' | 'mix';

export const DEVICE_ROLE: Readonly<Record<AirDeviceKind, DeviceRole>> = {
  purifier: 'clean',
  exhaustFan: 'exhaust',
  rangeHood: 'exhaust',
  ceilingFan: 'mix',
  pedestalFan: 'mix',
  ac: 'mix',
};

export interface Device {
  objectId: string;
  name: string;
  kind: AirDeviceKind;
  role: DeviceRole;
  enabled: boolean;
  /** CADR for purifiers, extraction for exhaust devices, delivered airflow for mixing devices (m³/s) */
  flowM3s: number;
  /** Jet velocity for the voxel solver (m/s); null for exhaust devices (flow boundaries) */
  dischargeVelocityMs: number | null;
}

/**
 * Device kind of an object: explicit `device`, else the asset mapping, else legacy hints
 * (`cadrM3h` → purifier, `exhaustFlowM3h` → exhaust fan). Null for non-devices.
 */
export function deviceKindOf(obj: SceneObject): DeviceKind | null {
  if (obj.device) return obj.device;
  const fromAsset = DEVICE_KIND_BY_ASSET[obj.assetId];
  if (fromAsset) return fromAsset;
  if (obj.cadrM3h !== undefined) return 'purifier';
  if (obj.exhaustFlowM3h !== undefined) return 'exhaustFan';
  return null;
}

/**
 * Resolves an object's air-handling device parameters (`defaultAirflow` is m³/h for every kind).
 * Null for non-devices and for PM2.5 sources, which move no air.
 */
export function deviceFor(obj: SceneObject): Device | null {
  const kind = deviceKindOf(obj);
  if (!kind || kind === 'pm25Source') return null;
  const role = DEVICE_ROLE[kind];
  const explicit = role === 'clean' ? obj.cadrM3h : role === 'exhaust' ? obj.exhaustFlowM3h : undefined;
  const m3h = explicit ?? obj.defaultAirflow ?? DEFAULT_DEVICE_FLOW_M3H[kind];
  return {
    objectId: obj.id,
    name: obj.name,
    kind,
    role,
    enabled: obj.enabled !== false,
    flowM3s: Math.max(0, m3h) / SECONDS_PER_HOUR,
    dischargeVelocityMs: obj.dischargeVelocityMs ?? DEFAULT_DISCHARGE_VELOCITY_MS[kind],
  };
}

/** All devices in the room, including disabled ones (callers filter on `enabled`). */
export function devicesIn(objects: readonly SceneObject[]): Device[] {
  return objects.map(deviceFor).filter((d): d is Device => d !== null);
}

/** Sum of enabled device flows with the given role (m³/s). Disabled devices contribute nothing. */
export function totalFlow(devices: readonly Device[], role: DeviceRole): number {
  return devices.filter((d) => d.enabled && d.role === role).reduce((s, d) => s + d.flowM3s, 0);
}
