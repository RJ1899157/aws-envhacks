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

const Shell: React.FC<{ title: string; kind: string; onDelete: () => void; onRotate?: () => void; children?: React.ReactNode }> = ({ title, kind, onDelete, onRotate, children }) => (
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
    <div className="px-3.5 py-3 flex flex-col gap-3 text-[12px]">{children}</div>
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

const OpeningSelection: React.FC<{ opening: Opening }> = ({ opening }) => {
  const isDoor = opening.type === 'door';
  return (
    <Shell title={altLabel(opening.subType, isDoor ? 'Door' : 'Window')} kind={isDoor ? 'Door' : 'Window'} onDelete={() => useSceneStore.getState().removeOpening(opening.id)}>
      <Line label="Usually">
        <OpeningStateControl opening={opening} />
      </Line>
      <WindowTypeControls opening={opening} />
      <p className="text-[11px] text-neutral-500 leading-snug">
        {opening.width.toFixed(1)} m wide. Drag it along the wall to move it; drag its edges to resize.
      </p>
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
      <Shell title={name} kind="Pollution source" onDelete={remove} onRotate={rotate}>
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
      <Shell title={name} kind="Air device" onDelete={remove} onRotate={rotate}>
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
    <Shell title={name} kind="Furniture" onDelete={remove} onRotate={rotate}>
      <p className="text-[11px] text-neutral-400 leading-snug">
        {object.role === 'porous' ? 'Air partly passes through it.' : 'Air flows around it, not through it.'} Drag to move; drag the handles to resize.
      </p>
    </Shell>
  );
};

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
