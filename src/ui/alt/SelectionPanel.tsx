import React from 'react';
import { RotateCw, Trash2, X } from 'lucide-react';
import { getCatalogAsset } from '../../core/catalog';
import { DEFAULT_DEVICE_FLOW_M3H, PM25_SOURCE_PRESETS, type Pm25SourcePresetId } from '../../simulation/constants';
import { deviceFor } from '../../simulation/devices';
import { isPm25SourceObject, placedSourceParams } from '../../simulation/sources';
import type { Opening, SceneObject } from '../../core/schema';
import { useSceneStore } from '../../store/sceneStore';
import { altLabel } from './altCatalog';
import { openingFlowFactor, windowSettings } from '../../simulation/geometry';
import { WINDOW_STYLES } from './AboutHomeCard';
import type { WindowStyle } from '../../core/schema';
import { OpeningStateControl } from './DesignPanel';
import { AlertTriangle, Minus, Plus } from 'lucide-react';
import { wallSegment } from '../../core/parser';
import { findNearestValidPosition } from '../../core/placementValidator';
import { usePlacementIssuesStore } from '../../store/placementIssuesStore';
import { useUiStore } from '../../store/uiStore';
import { wallHeightAt } from '../../simulation/geometry';

const Shell: React.FC<{ title: string; kind: string; onDelete: () => void; onRotate?: () => void; top?: React.ReactNode; children?: React.ReactNode }> = ({ title, kind, onDelete, onRotate, top, children }) => (
  <aside
    data-testid="alt-selection-panel"
    data-viewport-right
    className="pointer-events-auto fixed top-14 right-3 z-[15] w-[260px] rounded-[12px] bg-neutral-900/90 backdrop-blur-md border border-white/10 shadow-2xl text-neutral-200"
  >
    <div className="px-3.5 pt-3 pb-2 flex items-start gap-2 border-b border-white/10">
      <div className="flex-1 min-w-0">
        <div className="text-[10.5px] text-neutral-400">{kind}</div>
        <div className="text-[14px] font-semibold text-white truncate">{title}</div>
      </div>
      <button type="button" aria-label="Deselect" onClick={() => useSceneStore.getState().clearSelection()} className="p-1 rounded hover:bg-white/10 text-neutral-400">
        <X size={14} />
      </button>
    </div>
    <div className="px-3.5 py-3 flex flex-col gap-3 text-[12px]">
      {top}
      {children}
    </div>
    <div className="px-3.5 pb-3 flex gap-2">
      {onRotate && (
        <button type="button" onClick={onRotate} className="flex-1 py-1.5 rounded-[8px] bg-white/10 hover:bg-white/15 text-[12px] flex items-center justify-center gap-1.5">
          <RotateCw size={12} /> Rotate
        </button>
      )}
      <button type="button" onClick={onDelete} data-testid="alt-delete-selected" className="flex-1 py-1.5 rounded-[8px] bg-red-500/15 hover:bg-red-500/25 text-red-200 text-[12px] flex items-center justify-center gap-1.5">
        <Trash2 size={12} /> Delete
      </button>
    </div>
  </aside>
);

const Line: React.FC<{ label: string; children: React.ReactNode }> = ({ label, children }) => (
  <div className="flex items-center justify-between gap-2">
    <span className="text-neutral-400">{label}</span>
    {children}
  </div>
);

const OnOff: React.FC<{ on: boolean; onChange: (on: boolean) => void }> = ({ on, onChange }) => (
  <div className="flex p-0.5 rounded-[6px] bg-black/30 border border-white/10" role="radiogroup">
    {[false, true].map((v) => (
      <button
        key={String(v)}
        type="button"
        role="radio"
        aria-checked={on === v}
        onClick={() => onChange(v)}
        className={`px-2 py-0.5 rounded-[4px] text-[11px] font-medium ${on === v ? (v ? 'bg-emerald-600 text-white' : 'bg-neutral-600 text-white') : 'text-neutral-400 hover:text-white'}`}
      >
        {v ? 'On' : 'Off'}
      </button>
    ))}
  </div>
);

const selectCls = 'bg-black/30 border border-white/10 rounded-[6px] px-1.5 py-1 text-[12px] text-white outline-none max-w-[150px]';

/** Window type and insect mesh: this window's own setting, or the home's default. */
const WindowTypeControls: React.FC<{ opening: Opening }> = ({ opening }) => {
  const defaults = useSceneStore((s) => s.room.params.windowDefaults);
  const updateOpening = useSceneStore((s) => s.updateOpening);
  const home = windowSettings({ ...opening, windowStyle: undefined, mesh: undefined }, defaults);
  if (!home) return null;
  const styleLabel = (v: WindowStyle) => WINDOW_STYLES.find((w) => w.value === v)!.label;
  const share = Math.round(openingFlowFactor(opening, defaults) * 100);
  return (
    <>
      <Line label="Type">
        <select
          value={opening.windowStyle ?? 'home'}
          onChange={(e) => updateOpening(opening.id, { windowStyle: e.target.value === 'home' ? undefined : (e.target.value as WindowStyle) })}
          className={selectCls}
          data-testid="alt-window-style"
        >
          <option value="home">{styleLabel(home.style)} (home)</option>
          {WINDOW_STYLES.map((w) => (
            <option key={w.value} value={w.value}>
              {w.label}
            </option>
          ))}
        </select>
      </Line>
      <Line label="Insect mesh">
        <select
          value={opening.mesh === undefined ? 'home' : opening.mesh ? 'yes' : 'no'}
          onChange={(e) => updateOpening(opening.id, { mesh: e.target.value === 'home' ? undefined : e.target.value === 'yes' })}
          className={selectCls}
          data-testid="alt-window-mesh-select"
        >
          <option value="home">{home.mesh ? 'Has mesh' : 'No mesh'} (home)</option>
          <option value="yes">Has mesh</option>
          <option value="no">No mesh</option>
        </select>
      </Line>
      <p className="text-[11px] text-neutral-500 leading-snug">
        When fully open it lets through about {share}% of the air an open frame of this size would.
      </p>
    </>
  );
};

/** − value + stepper in metres. */
const Stepper: React.FC<{ value: number; min: number; max: number; step?: number; onChange: (v: number) => void; testId?: string }> = ({ value, min, max, step = 0.1, onChange, testId }) => {
  const set = (v: number) => onChange(Math.round(Math.min(max, Math.max(min, v)) * 100) / 100);
  const btn = 'w-6 h-6 rounded-[5px] bg-white/10 hover:bg-white/15 disabled:opacity-30 flex items-center justify-center';
  return (
    <div className="flex items-center gap-1" data-testid={testId}>
      <button type="button" aria-label="Smaller" className={btn} disabled={value <= min + 1e-6} onClick={() => set(value - step)}>
        <Minus size={11} />
      </button>
      <span className="w-14 text-center tabular-nums text-white">{value.toFixed(2)} m</span>
      <button type="button" aria-label="Bigger" className={btn} disabled={value >= max - 1e-6} onClick={() => set(value + step)}>
        <Plus size={11} />
      </button>
    </div>
  );
};

/** Overlap / outside-room warning of the selected object, with a fix (replaces the old hover popup). */
const PlacementWarning: React.FC<{ object: SceneObject }> = ({ object }) => {
  const issues = usePlacementIssuesStore((s) => s.issues[object.id]);
  const dismissed = usePlacementIssuesStore((s) => s.dismissedObjectIds.includes(object.id));
  if (!issues || issues.length === 0 || dismissed) return null;
  const nudge = () => {
    const { room } = useSceneStore.getState();
    const target = findNearestValidPosition(object, room, useUiStore.getState().gridStep);
    if (!target) {
      useUiStore.getState().setToastMessage('No free spot nearby: drag it somewhere clear.');
      return;
    }
    useSceneStore.getState().updateObject(object.id, { position: [target[0], 0, target[2]], elevation: target[1] });
    usePlacementIssuesStore.getState().clearDismissed(object.id);
  };
  return (
    <div className="p-2 rounded-[8px] bg-amber-500/10 border border-amber-400/30 flex flex-col gap-1.5" data-testid="alt-placement-warning">
      {issues.map((i) => (
        <span key={i.id} className="flex items-start gap-1.5 text-[11px] text-amber-100">
          <AlertTriangle size={12} className="shrink-0 mt-px text-amber-300" /> {i.message}
        </span>
      ))}
      <div className="flex gap-1.5">
        <button type="button" onClick={nudge} className="flex-1 py-1 rounded-[6px] bg-amber-500/25 hover:bg-amber-500/35 text-[11px] text-white">
          Move to a free spot
        </button>
        <button type="button" onClick={() => usePlacementIssuesStore.getState().dismissObject(object.id)} className="px-2 py-1 rounded-[6px] bg-white/10 hover:bg-white/15 text-[11px] text-neutral-300">
          Keep here
        </button>
      </div>
    </div>
  );
};

/** Width, height and (windows) sill height, kept inside the wall. */
const OpeningSize: React.FC<{ opening: Opening }> = ({ opening }) => {
  const room = useSceneStore((s) => s.room);
  const updateOpening = useSceneStore((s) => s.updateOpening);
  const wallLen = wallSegment(room, opening.wallIndex).len;
  const wallH = wallHeightAt(room, opening.wallIndex);
  // Resize about the centre, sliding along the wall to stay on it
  const setWidth = (width: number) => {
    const centre = opening.offset + opening.width / 2;
    const offset = Math.min(Math.max(0, centre - width / 2), Math.max(0, wallLen - width));
    updateOpening(opening.id, { width, offset });
  };
  return (
    <>
      <Line label="Width">
        <Stepper value={opening.width} min={0.3} max={Math.max(0.3, wallLen)} onChange={setWidth} testId="alt-opening-width" />
      </Line>
      <Line label="Height">
        <Stepper value={opening.height} min={0.2} max={Math.max(0.2, wallH - opening.sill)} onChange={(height) => updateOpening(opening.id, { height })} testId="alt-opening-height" />
      </Line>
      {opening.type === 'window' && (
        <Line label="From floor">
          <Stepper value={opening.sill} min={0} max={Math.max(0, wallH - opening.height)} onChange={(sill) => updateOpening(opening.id, { sill })} testId="alt-opening-sill" />
        </Line>
      )}
    </>
  );
};

const OpeningSelection: React.FC<{ opening: Opening }> = ({ opening }) => {
  const isDoor = opening.type === 'door';
  return (
    <Shell title={altLabel(opening.subType, isDoor ? 'Door' : 'Window')} kind={isDoor ? 'Door' : 'Window'} onDelete={() => useSceneStore.getState().removeOpening(opening.id)}>
      <Line label="Usually">
        <OpeningStateControl opening={opening} />
      </Line>
      <OpeningSize opening={opening} />
      <WindowTypeControls opening={opening} />
      <p className="text-[11px] text-neutral-500 leading-snug">Drag it along the wall to move it.</p>
    </Shell>
  );
};

const STRENGTH: { label: string; factor: number }[] = [
  { label: 'Low', factor: 0.5 },
  { label: 'Normal', factor: 1 },
  { label: 'High', factor: 1.5 },
];

const ObjectSelection: React.FC<{ object: SceneObject }> = ({ object }) => {
  const updateObject = useSceneStore((s) => s.updateObject);
  const remove = () => useSceneStore.getState().removeObject(object.id);
  const rotate = () => updateObject(object.id, { rotation: [object.rotation[0], object.rotation[1] + Math.PI / 2, object.rotation[2]] });
  const name = altLabel(object.assetId, object.name);

  if (isPm25SourceObject(object)) {
    const p = placedSourceParams(object);
    const window = p?.schedule[0];
    const when = !window ? 'always' : window.durationMin <= 30 ? '30' : '60';
    return (
      <Shell top={<PlacementWarning object={object} />} title={name} kind="Pollution source" onDelete={remove} onRotate={rotate}>
        <Line label="Active">
          <OnOff on={p?.enabled ?? true} onChange={(enabled) => updateObject(object.id, { enabled })} />
        </Line>
        <Line label="How long">
          <select
            value={when}
            onChange={(e) =>
              updateObject(object.id, { sourceSchedule: e.target.value === 'always' ? undefined : [{ startMin: 0, durationMin: Number(e.target.value) }] })
            }
            className="bg-black/30 border border-white/10 rounded-[6px] px-1.5 py-1 text-[12px] text-white outline-none"
          >
            <option value="30">30 minutes</option>
            <option value="60">1 hour</option>
            <option value="always">The whole time</option>
          </select>
        </Line>
        {p && (
          <p className="text-[11px] text-neutral-500 leading-snug">
            {PM25_SOURCE_PRESETS[p.preset as Pm25SourcePresetId]?.label ?? name}: about {p.rateUgMin.toFixed(0)} µg of PM2.5 per minute while active.
          </p>
        )}
      </Shell>
    );
  }

  const device = deviceFor(object);
  if (device) {
    const role = device.role;
    const base = getCatalogAsset(object.assetId)?.defaultAirflow ?? DEFAULT_DEVICE_FLOW_M3H[device.kind];
    const flow = device.flowM3s * 3600;
    const field = role === 'clean' ? 'cadrM3h' : role === 'exhaust' || role === 'supply' ? 'exhaustFlowM3h' : 'defaultAirflow';
    const current = STRENGTH.reduce((best, s) => (Math.abs(s.factor * base - flow) < Math.abs(best.factor * base - flow) ? s : best), STRENGTH[1]!);
    return (
      <Shell top={<PlacementWarning object={object} />} title={name} kind="Air device" onDelete={remove} onRotate={rotate}>
        <Line label="Switched">
          <OnOff on={device.enabled} onChange={(enabled) => updateObject(object.id, { enabled })} />
        </Line>
        {device.kind === 'exhaustFan' && (
          <Line label="Direction">
            <div className="flex p-0.5 rounded-[6px] bg-black/30 border border-white/10" role="radiogroup" aria-label="Airflow direction" data-testid="alt-fan-direction">
              {(['out', 'in'] as const).map((dir) => (
                <button
                  key={dir}
                  type="button"
                  role="radio"
                  aria-checked={(object.flowDirection ?? 'out') === dir}
                  onClick={() => updateObject(object.id, { flowDirection: dir === 'out' ? undefined : 'in' })}
                  className={`px-1.5 py-0.5 rounded-[4px] text-[10.5px] font-medium ${(object.flowDirection ?? 'out') === dir ? 'bg-indigo-600 text-white' : 'text-neutral-400 hover:text-white'}`}
                >
                  {dir === 'out' ? 'Blows out' : 'Blows in'}
                </button>
              ))}
            </div>
          </Line>
        )}
        <Line label="Strength">
          <div className="flex p-0.5 rounded-[6px] bg-black/30 border border-white/10">
            {STRENGTH.map((s) => (
              <button
                key={s.label}
                type="button"
                onClick={() => updateObject(object.id, { [field]: Math.round(base * s.factor) })}
                className={`px-1.5 py-0.5 rounded-[4px] text-[10.5px] font-medium ${current === s ? 'bg-indigo-600 text-white' : 'text-neutral-400 hover:text-white'}`}
              >
                {s.label}
              </button>
            ))}
          </div>
        </Line>
        <p className="text-[11px] text-neutral-500 leading-snug">
          {role === 'clean' && `Cleans about ${flow.toFixed(0)} m³ of air per hour.`}
          {role === 'exhaust' && `Pulls room air and blows about ${flow.toFixed(0)} m³ of it outside per hour.`}
          {role === 'supply' && `Blows about ${flow.toFixed(0)} m³ of outdoor air into the room per hour (unfiltered: outdoor smoke and dust come in with it).`}
          {role === 'mix' && 'Moves air around the room; it does not bring in fresh air.'}
        </p>
      </Shell>
    );
  }

  return (
    <Shell top={<PlacementWarning object={object} />} title={name} kind={isPartition(object.assetId) ? 'Wall' : 'Furniture'} onDelete={remove} onRotate={rotate}>
      {isPartition(object.assetId) && (
        <>
          <Line label="Length">
            <Stepper value={object.size[0]} min={0.3} max={12} step={0.25} onChange={(len) => updateObject(object.id, { size: [len, object.size[1], object.size[2]] })} testId="alt-partition-length" />
          </Line>
          <Line label="Height">
            <Stepper value={object.size[1]} min={0.5} max={6} step={0.1} onChange={(h) => updateObject(object.id, { size: [object.size[0], h, object.size[2]] })} />
          </Line>
        </>
      )}
      <p className="text-[11px] text-neutral-400 leading-snug">
        {object.role === 'porous' ? 'Air partly passes through it.' : 'Air flows around it, not through it.'} Drag to move; drag the handles to resize.
      </p>
    </Shell>
  );
};

const isPartition = (assetId: string) => assetId === 'partition-wall' || assetId === 'half-partition';

/** Right panel of Design mode while something is selected. */
export const SelectionPanel: React.FC = () => {
  const room = useSceneStore((s) => s.room);
  const objectId = useSceneStore((s) => s.selectedObjectId);
  const openingId = useSceneStore((s) => s.selectedOpeningId);
  const object = objectId ? room.objects.find((o) => o.id === objectId) : undefined;
  const opening = !object && openingId ? room.openings.find((o) => o.id === openingId) : undefined;
  if (object) return <ObjectSelection object={object} />;
  if (opening) return <OpeningSelection opening={opening} />;
  return null;
};
