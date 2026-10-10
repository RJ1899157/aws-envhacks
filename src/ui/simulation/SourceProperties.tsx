import React from 'react';
import type { SceneObject } from '../../core/schema';
import { useSceneStore } from '../../store/sceneStore';
import { PM25_SOURCE_PRESETS, type Pm25SourcePresetId } from '../../simulation/constants';
import { placedSourceParams } from '../../simulation/sources';
import { Checkbox, CollapsibleSection, ScrubbableInput, Select } from '../components';

const PRESET_OPTIONS = (Object.keys(PM25_SOURCE_PRESETS) as Pm25SourcePresetId[]).map((id) => ({ value: id, label: PM25_SOURCE_PRESETS[id].label }));

/** Properties-tab section for a placed PM2.5 source: preset, rate, schedule, on/off, emission height. */
export const SourceProperties: React.FC<{ object: SceneObject }> = ({ object }) => {
  const updateObject = useSceneStore((s) => s.updateObject);
  const p = placedSourceParams(object);
  if (!p) return null;
  const preset = PM25_SOURCE_PRESETS[p.preset];
  const window = p.schedule[0];
  const scheduled = window !== undefined;

  return (
    <CollapsibleSection title="PM2.5 source" defaultOpen summary={`${p.rateUgMin.toFixed(0)} µg/min · ${p.enabled ? (scheduled ? 'scheduled' : 'always on') : 'off'}`}>
      <div className="flex flex-col gap-2" data-testid="source-properties">
        <Select
          label="Type"
          value={p.preset}
          onChange={(v) => {
            const id = v as Pm25SourcePresetId;
            // A new preset brings its own rate and height; clear the overrides
            updateObject(object.id, { sourcePreset: id, emissionRateUgMin: undefined, emissionHeightM: undefined });
          }}
          options={PRESET_OPTIONS}
        />
        <Checkbox checked={p.enabled} onChange={(enabled) => updateObject(object.id, { enabled })} label="Active" />
        <ScrubbableInput label="Emission" value={p.rateUgMin} min={0} step={10} precision={0} unit="µg/min" onChange={(v) => updateObject(object.id, { emissionRateUgMin: Math.max(0, v) })} />
        <span className="text-[10px] text-neutral-500 leading-snug">
          Preset {preset.rateUgMin} µg/min · {preset.reference}
          {preset.approximate && ' · approximate'}
        </span>
        <ScrubbableInput label="Height" value={p.heightM} min={0} max={3} step={0.05} precision={2} unit="m" onChange={(v) => updateObject(object.id, { emissionHeightM: Math.max(0, v) })} />
        <Select
          label="Schedule"
          value={scheduled ? 'window' : 'always'}
          onChange={(v) => updateObject(object.id, { sourceSchedule: v === 'window' ? [{ startMin: 10, durationMin: 30 }] : undefined })}
          options={[
            { value: 'always', label: 'Always on' },
            { value: 'window', label: 'Start + duration' },
          ]}
        />
        {scheduled && (
          <div className="grid grid-cols-2 gap-2">
            <ScrubbableInput label="Start" value={window.startMin} min={0} step={1} precision={0} unit="min" onChange={(v) => updateObject(object.id, { sourceSchedule: [{ ...window, startMin: Math.max(0, v) }] })} />
            <ScrubbableInput label="For" value={window.durationMin} min={1} step={1} precision={0} unit="min" onChange={(v) => updateObject(object.id, { sourceSchedule: [{ ...window, durationMin: Math.max(1, v) }] })} />
          </div>
        )}
      </div>
    </CollapsibleSection>
  );
};
