import React from 'react';
import type { DeviceKind, SceneObject } from '../../core/schema';
import { useSceneStore } from '../../store/sceneStore';
import { DEFAULT_DISCHARGE_VELOCITY_MS } from '../../simulation/constants';
import { DEVICE_ROLE, deviceFor } from '../../simulation/devices';
import { Checkbox, CollapsibleSection, ScrubbableInput, Select } from '../components';

const KIND_OPTIONS: { value: DeviceKind; label: string }[] = [
  { value: 'purifier', label: 'Air purifier' },
  { value: 'exhaustFan', label: 'Exhaust fan' },
  { value: 'rangeHood', label: 'Range hood' },
  { value: 'ceilingFan', label: 'Ceiling fan' },
  { value: 'pedestalFan', label: 'Pedestal fan' },
  { value: 'ac', label: 'Split AC' },
];

/** Properties-tab section for air-handling devices: kind, on/off, CADR / flow, discharge velocity. */
export const DeviceProperties: React.FC<{ object: SceneObject }> = ({ object }) => {
  const updateObject = useSceneStore((s) => s.updateObject);
  const device = deviceFor(object);
  if (!device) return null;
  const kind = device.kind;
  const role = DEVICE_ROLE[kind];
  const flowM3h = device.flowM3s * 3600;

  return (
    <CollapsibleSection title="Air device" defaultOpen summary={`${KIND_OPTIONS.find((k) => k.value === kind)?.label} · ${device.enabled ? 'on' : 'off'}`}>
      <div className="flex flex-col gap-2" data-testid="device-properties">
        <Select label="Kind" value={kind} onChange={(v) => updateObject(object.id, { device: v as DeviceKind })} options={KIND_OPTIONS} />
        <Checkbox checked={device.enabled} onChange={(enabled) => updateObject(object.id, { enabled })} label="Switched on" />
        {role === 'clean' && (
          <ScrubbableInput label="CADR" value={flowM3h} min={0} step={10} unit="m³/h" onChange={(v) => updateObject(object.id, { cadrM3h: Math.max(0, v) })} />
        )}
        {role === 'exhaust' && (
          <ScrubbableInput label="Extract" value={flowM3h} min={0} step={10} unit="m³/h" onChange={(v) => updateObject(object.id, { exhaustFlowM3h: Math.max(0, v) })} />
        )}
        {role === 'mix' && (
          <ScrubbableInput label="Airflow" value={flowM3h} min={0} step={100} unit="m³/h" onChange={(v) => updateObject(object.id, { defaultAirflow: Math.max(0, v) })} />
        )}
        {DEFAULT_DISCHARGE_VELOCITY_MS[kind] !== null && (
          <ScrubbableInput
            label="Jet speed"
            value={device.dischargeVelocityMs ?? 0}
            min={0}
            max={10}
            step={0.1}
            precision={1}
            unit="m/s"
            onChange={(v) => updateObject(object.id, { dischargeVelocityMs: Math.max(0, v) })}
          />
        )}
        <span className="text-[10px] text-neutral-500">
          {role === 'clean' && 'Removes PM2.5 at its CADR; does not change air changes.'}
          {role === 'exhaust' && 'Extracts air to outdoors; adds to air changes.'}
          {role === 'mix' && 'Mixes room air (voxel solver only); does not change air changes.'}
        </span>
      </div>
    </CollapsibleSection>
  );
};
