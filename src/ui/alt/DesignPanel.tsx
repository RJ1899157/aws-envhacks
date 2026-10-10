import React, { useEffect, useMemo, useState } from 'react';
import { ChevronDown, ChevronRight, Home, Info, Pencil, Play, Search, Trash2, X } from 'lucide-react';
import { getCatalogAsset } from '../../core/catalog';
import { openingSubTypeFor } from '../../core/openingPresets';
import { polygonBounds } from '../../core/parser';
import { ROOM_TYPES, ROOM_TYPE_ORDER, roomTypeOf } from '../../core/rooms';
import type { Opening, Room, RoomType, SceneObject } from '../../core/schema';
import { deviceFor } from '../../simulation/devices';
import { isOpeningOpen } from '../../simulation/geometry';
import { isPm25SourceObject, placedSourceParams } from '../../simulation/sources';
import { useSceneStore } from '../../store/sceneStore';
import { useUiStore } from '../../store/uiStore';
import { DESIGN_STEPS, cancelPlacement, useAltStore, type DesignStep } from './altStore';
import { AboutHomeCard, homeSummary } from './AboutHomeCard';
import { FURNITURE_ITEMS, MORE_FURNITURE_ITEMS, PARTITION_ITEMS, POLLUTION_GROUPS, VENTILATION_GROUPS, altLabel, searchItems, type AltItem } from './altCatalog';
import type { QuickShapeType } from '../../core/quickShapes';

// ---------------------------------------------------------------------------
// Shared bits
// ---------------------------------------------------------------------------

/** Arms placement of a catalogue asset; clicking the armed asset again cancels it. */
function togglePlacing(assetId: string): void {
  const ui = useUiStore.getState();
  if (ui.activeAssetId === assetId) {
    cancelPlacement();
    return;
  }
  useSceneStore.getState().clearSelection();
  ui.setSelectedWallIndex(null);
  ui.setPendingRoomType(null);
  ui.setActiveAssetId(assetId);
  ui.setToolMode(openingSubTypeFor(assetId) ? 'opening' : 'place');
}

const AssetButton: React.FC<{ item: AltItem }> = ({ item }) => {
  const active = useUiStore((s) => s.activeAssetId === item.assetId);
  const color = getCatalogAsset(item.assetId)?.color ?? '#64748b';
  return (
    <button
      type="button"
      data-testid={`alt-asset-${item.assetId}`}
      onClick={() => togglePlacing(item.assetId)}
      title={item.hint}
      className={`flex items-center gap-2 p-2 rounded-[8px] border text-left transition-colors ${
        active ? 'border-indigo-400 bg-indigo-500/20' : 'border-white/10 bg-white/[0.04] hover:bg-white/[0.08] hover:border-white/20'
      }`}
    >
      <span className="w-3.5 h-3.5 rounded-[3px] shrink-0 border border-white/20" style={{ background: color }} />
      <span className="min-w-0">
        <span className="block text-[12px] font-medium text-white truncate">{item.label}</span>
        {item.hint && <span className="block text-[10px] text-neutral-400 leading-tight truncate">{item.hint}</span>}
      </span>
    </button>
  );
};

const Section: React.FC<{ title: string; children: React.ReactNode }> = ({ title, children }) => (
  <section className="flex flex-col gap-1.5">
    <h3 className="text-[10.5px] uppercase tracking-wider font-semibold text-neutral-400">{title}</h3>
    {children}
  </section>
);

const Grid: React.FC<{ children: React.ReactNode }> = ({ children }) => <div className="grid grid-cols-2 gap-1.5">{children}</div>;

const Tip: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <p className="flex gap-1.5 text-[11px] text-neutral-400 leading-snug">
    <Info size={12} className="shrink-0 mt-px text-indigo-300" />
    <span>{children}</span>
  </p>
);

const Toggle: React.FC<{ on: boolean; onChange: (on: boolean) => void; label: string }> = ({ on, onChange, label }) => (
  <button
    type="button"
    role="switch"
    aria-checked={on}
    aria-label={label}
    onClick={() => onChange(!on)}
    className={`w-8 h-[18px] rounded-full relative transition-colors shrink-0 ${on ? 'bg-emerald-500' : 'bg-white/15'}`}
  >
    <span className={`absolute top-[2px] w-[14px] h-[14px] rounded-full bg-white transition-all ${on ? 'left-[16px]' : 'left-[2px]'}`} />
  </button>
);

/** Closed / half / fully open, the three states offered for an opening. */
export type OpeningState = 'closed' | 'half' | 'open';

export function openingState(op: Opening): OpeningState {
  if (!isOpeningOpen(op)) return 'closed';
  return op.openFraction < 0.75 ? 'half' : 'open';
}

export function setOpeningState(op: Opening, state: OpeningState): void {
  const role = op.role === 'closed' ? (op.type === 'door' ? 'outlet' : 'inlet') : op.role;
  useSceneStore.getState().updateOpening(op.id, state === 'closed' ? { openFraction: 0, role: 'closed' } : { openFraction: state === 'half' ? 0.5 : 1, role });
}

export const OpeningStateControl: React.FC<{ opening: Opening }> = ({ opening }) => {
  const state = openingState(opening);
  return (
    <div className="flex p-0.5 rounded-[6px] bg-black/30 border border-white/10 shrink-0" role="radiogroup" aria-label="Open or closed">
      {(['closed', 'half', 'open'] as const).map((s) => (
        <button
          key={s}
          type="button"
          role="radio"
          aria-checked={state === s}
          onClick={() => setOpeningState(opening, s)}
          className={`px-1.5 py-0.5 rounded-[4px] text-[10px] font-medium ${state === s ? 'bg-indigo-600 text-white' : 'text-neutral-400 hover:text-white'}`}
        >
          {s === 'closed' ? 'Closed' : s === 'half' ? 'Half' : 'Open'}
        </button>
      ))}
    </div>
  );
};

const Row: React.FC<{ label: string; selected: boolean; onSelect: () => void; children?: React.ReactNode }> = ({ label, selected, onSelect, children }) => (
  <div className={`flex items-center gap-2 px-2 py-1.5 rounded-[7px] border ${selected ? 'border-indigo-400/60 bg-indigo-500/10' : 'border-transparent bg-white/[0.03]'}`}>
    <button type="button" onClick={onSelect} className="flex-1 min-w-0 text-left text-[12px] text-neutral-200 truncate hover:text-white">
      {label}
    </button>
    {children}
  </div>
);

/** The room placed items go into, with a switcher (placing over another room also switches to it). */
const ActiveRoomBar: React.FC = () => {
  const room = useSceneStore((s) => s.room);
  const otherRooms = useSceneStore((s) => s.otherRooms);
  const setActiveRoom = useSceneStore((s) => s.setActiveRoom);
  if (otherRooms.length === 0) return null;
  const rooms = [room, ...otherRooms].sort((a, b) => a.name.localeCompare(b.name));
  return (
    <label className="flex items-center gap-2 text-[11px] text-neutral-400">
      Showing
      <select
        value={room.id}
        onChange={(e) => setActiveRoom(e.target.value)}
        className="flex-1 bg-black/30 border border-white/10 rounded-[6px] px-1.5 py-1 text-[12px] text-white outline-none focus:border-indigo-500"
        data-testid="alt-active-room"
      >
        {rooms.map((r) => (
          <option key={r.id} value={r.id}>
            {r.name}
          </option>
        ))}
      </select>
    </label>
  );
};

const NumberField: React.FC<{ label: string; value: number; onCommit: (v: number) => void; min: number; max: number }> = ({ label, value, onCommit, min, max }) => {
  const [text, setText] = useState(value.toFixed(1));
  useEffect(() => setText(value.toFixed(1)), [value]);
  const commit = () => {
    const v = Number(text);
    if (Number.isFinite(v) && v >= min && v <= max && Math.abs(v - value) > 1e-3) onCommit(v);
    else setText(value.toFixed(1));
  };
  return (
    <label className="flex-1 flex flex-col gap-0.5 text-[10.5px] text-neutral-400">
      {label}
      <span className="flex items-center gap-1 bg-black/30 border border-white/10 rounded-[6px] px-2 py-1 focus-within:border-indigo-500">
        <input
          inputMode="decimal"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
          className="w-full bg-transparent text-[12px] text-white outline-none tabular-nums"
        />
        <span className="text-neutral-500">m</span>
      </span>
    </label>
  );
};

/** The home's floor, surroundings and usual windows, with a button to change them. */
const HomeChip: React.FC = () => {
  const params = useSceneStore((s) => s.room.params);
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        data-testid="alt-home-chip"
        className="w-full flex items-start gap-2 p-2 rounded-[8px] border border-white/10 bg-white/[0.03] hover:bg-white/[0.07] text-left"
      >
        <Home size={13} className="mt-0.5 shrink-0 text-indigo-300" />
        <span className="flex-1 text-[11px] text-neutral-300 leading-snug">
          <span className="text-neutral-400">Home: </span>
          {homeSummary(params)}
        </span>
        <Pencil size={12} className="mt-0.5 shrink-0 text-neutral-500" />
      </button>
      {open && (
        <div className="fixed inset-0 z-[40] bg-neutral-950/70 backdrop-blur-sm flex items-center justify-center p-4" onClick={() => setOpen(false)}>
          <div className="w-[560px] max-w-full rounded-[16px] bg-neutral-900 border border-white/10 shadow-2xl p-6" onClick={(e) => e.stopPropagation()}>
            <AboutHomeCard onDone={() => setOpen(false)} onBack={() => setOpen(false)} doneLabel="Save" />
          </div>
        </div>
      )}
    </>
  );
};

// ---------------------------------------------------------------------------
// Steps
// ---------------------------------------------------------------------------

const SHAPES: { type: QuickShapeType; label: string; path: string }[] = [
  { type: 'rectangle', label: 'Square', path: 'M4 5h16v14H4z' },
  { type: 'l-shape', label: 'L', path: 'M4 5h16v8h-7v6H4z' },
  { type: 'u-shape', label: 'U', path: 'M4 5h16v14h-5v-7H9v7H4z' },
  { type: 't-shape', label: 'T', path: 'M4 5h16v7h-5v7H9v-7H4z' },
];

const RoomsStep: React.FC = () => {
  const room = useSceneStore((s) => s.room);
  const otherRooms = useSceneStore((s) => s.otherRooms);
  const setActiveRoom = useSceneStore((s) => s.setActiveRoom);
  const removeRoom = useSceneStore((s) => s.removeRoom);
  const setRoomName = useSceneStore((s) => s.setRoomName);
  const setRoomType = useSceneStore((s) => s.setRoomType);
  const scaleRoom = useSceneStore((s) => s.scaleRoom);
  const pendingRoomType = useUiStore((s) => s.pendingRoomType);
  const dividing = useUiStore((s) => s.dividerAxis !== null);
  const project = useAltStore((s) => s.project);
  const rooms = useMemo(() => [room, ...otherRooms].sort((a, b) => a.name.localeCompare(b.name)), [room, otherRooms]);
  const b = polygonBounds(room.outline);
  const [name, setName] = useState(room.name);
  useEffect(() => setName(room.name), [room.name]);

  const reshape = (type: QuickShapeType) => {
    if (room.openings.length > 0 && !window.confirm('Changing the shape may remove windows and doors that no longer fit their wall. Continue?')) return;
    const removed = useSceneStore.getState().reshapeRoom(type);
    if (removed > 0) useUiStore.getState().setToastMessage(`${removed} ${removed === 1 ? 'opening was' : 'openings were'} removed (no longer on a wall). Undo with Ctrl+Z.`);
  };

  const placeRoom = (type: RoomType) => {
    const ui = useUiStore.getState();
    if (ui.pendingRoomType === type) {
      cancelPlacement();
      return;
    }
    cancelPlacement();
    useSceneStore.getState().clearSelection();
    ui.setPendingRoomType(type);
    ui.setToolMode('room');
  };

  return (
    <>
      <HomeChip />
      {rooms.length > 1 && (
        <Section title={`Your rooms (${rooms.length})`}>
          <div className="flex flex-col gap-1">
            {rooms.map((r: Room) => (
              <Row key={r.id} label={`${r.name} · ${polygonBounds(r.outline).width.toFixed(1)} × ${polygonBounds(r.outline).depth.toFixed(1)} m`} selected={r.id === room.id} onSelect={() => r.id && setActiveRoom(r.id)}>
                <button
                  type="button"
                  aria-label={`Remove ${r.name}`}
                  onClick={() => r.id && confirm(`Remove ${r.name}?`) && removeRoom(r.id)}
                  className="p-1 rounded text-neutral-500 hover:text-red-300 hover:bg-white/10"
                >
                  <Trash2 size={12} />
                </button>
              </Row>
            ))}
          </div>
        </Section>
      )}

      <Section title={rooms.length > 1 ? `Selected: ${room.name}` : 'Your room'}>
        <div className="flex flex-col gap-2 p-2.5 rounded-[8px] bg-white/[0.03] border border-white/10">
          <label className="flex flex-col gap-0.5 text-[10.5px] text-neutral-400">
            Name
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              onBlur={() => (name.trim() ? setRoomName(name.trim()) : setName(room.name))}
              onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
              className="bg-black/30 border border-white/10 rounded-[6px] px-2 py-1 text-[12px] text-white outline-none focus:border-indigo-500"
            />
          </label>
          <label className="flex flex-col gap-0.5 text-[10.5px] text-neutral-400">
            Room type
            <select
              value={roomTypeOf(room)}
              onChange={(e) => setRoomType(e.target.value as RoomType)}
              className="bg-black/30 border border-white/10 rounded-[6px] px-1.5 py-1 text-[12px] text-white outline-none focus:border-indigo-500"
            >
              {ROOM_TYPE_ORDER.map((t) => (
                <option key={t} value={t}>
                  {t === 'basic' ? 'Other' : ROOM_TYPES[t].label}
                </option>
              ))}
            </select>
          </label>
          <div className="flex gap-2">
            <NumberField label="Width" value={b.width} min={1} max={20} onCommit={(w) => scaleRoom(w, b.depth)} />
            <NumberField label="Length" value={b.depth} min={1} max={20} onCommit={(d) => scaleRoom(b.width, d)} />
          </div>
          <span className="text-[10.5px] text-neutral-500">Or drag the walls in the view.</span>
        </div>
      </Section>

      <Section title={`Shape of ${room.name}`}>
        <div className="grid grid-cols-4 gap-1.5" role="radiogroup" aria-label="Room shape">
          {SHAPES.map((sh) => (
            <button
              key={sh.type}
              type="button"
              data-testid={`alt-shape-${sh.type}`}
              onClick={() => reshape(sh.type)}
              title={sh.label}
              className="flex flex-col items-center gap-1 p-1.5 rounded-[8px] border border-white/10 bg-white/[0.04] hover:bg-white/[0.08] hover:border-indigo-400/60"
            >
              <svg viewBox="0 0 24 24" className="w-7 h-7 text-indigo-300" fill="currentColor" fillOpacity={0.25} stroke="currentColor" strokeWidth={1.5}>
                <path d={sh.path} />
              </svg>
              <span className="text-[10px] text-neutral-300">{sh.label}</span>
            </button>
          ))}
        </div>
        <Tip>Or drag the corners and walls in the view. Double-click a wall to add a corner.</Tip>
      </Section>

      <Section title="Walls inside the room">
        <button
          type="button"
          data-testid="alt-divide-room"
          onClick={() => {
            const on = useUiStore.getState().dividerAxis !== null;
            cancelPlacement();
            if (!on) useUiStore.getState().setDividerAxis('x');
          }}
          className={`w-full flex items-center gap-2 p-2 rounded-[8px] border text-left transition-colors ${
            dividing ? 'border-indigo-400 bg-indigo-500/20' : 'border-white/10 bg-white/[0.04] hover:bg-white/[0.08] hover:border-white/20'
          }`}
        >
          <span className="w-3.5 h-3.5 rounded-[3px] shrink-0 border border-white/20 bg-neutral-300" />
          <span className="min-w-0">
            <span className="block text-[12px] font-medium text-white">Divide the room with a wall</span>
            <span className="block text-[10px] text-neutral-400 leading-tight">Makes two rooms; put a door on the new wall</span>
          </span>
        </button>
        {dividing && <Tip>Click in the room where the wall goes. R turns it 90°, Esc cancels.</Tip>}
        <Grid>
          {PARTITION_ITEMS.map((i) => (
            <AssetButton key={i.assetId} item={i} />
          ))}
        </Grid>
      </Section>

      <Section title={project === 'house' || rooms.length > 1 ? 'Add a room' : 'Add another room'}>
        <Grid>
          {ROOM_TYPE_ORDER.filter((t) => t !== 'basic').map((t) => (
            <button
              key={t}
              type="button"
              data-testid={`alt-add-room-${t}`}
              onClick={() => placeRoom(t)}
              className={`p-2 rounded-[8px] border text-left text-[12px] font-medium transition-colors ${
                pendingRoomType === t ? 'border-indigo-400 bg-indigo-500/20 text-white' : 'border-white/10 bg-white/[0.04] text-neutral-200 hover:bg-white/[0.08]'
              }`}
            >
              {ROOM_TYPES[t].label}
            </button>
          ))}
        </Grid>
        <Tip>Pick a room, then click next to your rooms to place it. Rooms that touch share a wall; add a door on it in the Doors & windows step.</Tip>
      </Section>
    </>
  );
};

/** Openings and air devices of the active room, with quick open/closed and on/off controls. */
const VentilationInRoom: React.FC = () => {
  const room = useSceneStore((s) => s.room);
  const selectedOpeningId = useSceneStore((s) => s.selectedOpeningId);
  const selectedObjectId = useSceneStore((s) => s.selectedObjectId);
  const selectOpening = useSceneStore((s) => s.selectOpening);
  const selectObject = useSceneStore((s) => s.selectObject);
  const updateObject = useSceneStore((s) => s.updateObject);
  const devices = room.objects.filter((o) => {
    const d = deviceFor(o);
    return d !== null && !isPm25SourceObject(o);
  });
  const windows = room.openings.filter((o) => o.type === 'window').length;
  return (
    <Section title={`In ${room.name}`}>
      {room.openings.length === 0 && devices.length === 0 ? (
        <p className="text-[11px] text-amber-200/90">No windows or doors yet. Air can only leak in through gaps.</p>
      ) : (
        <div className="flex flex-col gap-1">
          {room.openings.map((op) => (
            <Row key={op.id} label={altLabel(op.subType, op.type === 'door' ? 'Door' : 'Window')} selected={op.id === selectedOpeningId} onSelect={() => selectOpening(op.id)}>
              <OpeningStateControl opening={op} />
            </Row>
          ))}
          {devices.map((o: SceneObject) => (
            <Row key={o.id} label={altLabel(o.assetId, o.name)} selected={o.id === selectedObjectId} onSelect={() => selectObject(o.id)}>
              <Toggle on={o.enabled !== false} onChange={(enabled) => updateObject(o.id, { enabled })} label={`${o.name} on`} />
            </Row>
          ))}
        </div>
      )}
      {windows === 0 && room.openings.length > 0 && <p className="text-[11px] text-neutral-400">Tip: a window lets fresh air in; most rooms have at least one.</p>}
    </Section>
  );
};

const VentilationStep: React.FC = () => (
  <>
    <HomeChip />
    <Tip>Pick an item, then click a wall (windows, doors, exhaust fans) or the floor. A door on a wall shared by two rooms connects them.</Tip>
    {VENTILATION_GROUPS.map((g) => (
      <Section key={g.title} title={g.title}>
        <Grid>
          {g.items.map((i) => (
            <AssetButton key={i.assetId} item={i} />
          ))}
        </Grid>
      </Section>
    ))}
    <ActiveRoomBar />
    <VentilationInRoom />
  </>
);

const PollutionStep: React.FC = () => {
  const room = useSceneStore((s) => s.room);
  const selectedObjectId = useSceneStore((s) => s.selectedObjectId);
  const selectObject = useSceneStore((s) => s.selectObject);
  const updateObject = useSceneStore((s) => s.updateObject);
  const sources = room.objects.filter(isPm25SourceObject);
  return (
    <>
      <Tip>Add what produces smoke or dust (PM2.5) and where it happens. Click to pick, then click the floor or a counter.</Tip>
      {POLLUTION_GROUPS.map((g) => (
        <Section key={g.title} title={g.title}>
          <Grid>
            {g.items.map((i) => (
              <AssetButton key={i.assetId} item={i} />
            ))}
          </Grid>
        </Section>
      ))}
      <ActiveRoomBar />
      <Section title={`In ${room.name}`}>
        {sources.length === 0 ? (
          <p className="text-[11px] text-neutral-500">No pollution sources here. Outdoor air still comes in through windows.</p>
        ) : (
          <div className="flex flex-col gap-1">
            {sources.map((o) => (
              <Row key={o.id} label={altLabel(o.assetId, o.name)} selected={o.id === selectedObjectId} onSelect={() => selectObject(o.id)}>
                <Toggle on={placedSourceParams(o)?.enabled ?? true} onChange={(enabled) => updateObject(o.id, { enabled })} label={`${o.name} active`} />
              </Row>
            ))}
          </div>
        )}
      </Section>
      <p className="text-[10.5px] text-neutral-500 leading-snug">
        Toilet flushing sprays fine droplets, but very little PM2.5 by mass, so it barely shows on the map. Its germs, bathroom smells and humidity aren't simulated (only PM2.5). An exhaust fan in the bathroom still shows how it pulls air through the house.
      </p>
    </>
  );
};

const FurnitureStep: React.FC = () => {
  const [more, setMore] = useState(false);
  return (
    <>
      <Tip>Optional, you can skip this. Large furniture blocks air and changes how it moves; small items don't matter.</Tip>
      <Section title="Furniture">
        <Grid>
          {FURNITURE_ITEMS.map((i) => (
            <AssetButton key={i.assetId} item={i} />
          ))}
        </Grid>
      </Section>
      <button type="button" onClick={() => setMore(!more)} className="flex items-center gap-1 text-[11px] text-neutral-400 hover:text-white" data-testid="alt-more-furniture">
        {more ? <ChevronDown size={13} /> : <ChevronRight size={13} />} More furniture ({MORE_FURNITURE_ITEMS.length})
      </button>
      {more && (
        <Grid>
          {MORE_FURNITURE_ITEMS.map((i) => (
            <AssetButton key={i.assetId} item={i} />
          ))}
        </Grid>
      )}
    </>
  );
};

const STEP_INTRO: Record<DesignStep, { title: string; text: string }> = {
  rooms: { title: 'Set up your rooms', text: 'Name, size and add rooms.' },
  furniture: { title: 'Add furniture', text: 'Big pieces that block the air.' },
  ventilation: { title: 'Doors & windows', text: 'How air gets in and out: windows, doors, balcony, exhaust fans and fans.' },
  pollution: { title: 'Add pollution sources', text: 'Cooking, incense, smoking, dust…' },
};

/** Left panel of Design mode: one step at a time, Back / Next, and Simulate at the end. */
/** Search across every item (doors, windows, fans, furniture, partitions, pollution sources). */
const SearchResults: React.FC<{ query: string }> = ({ query }) => {
  const results = searchItems(query);
  if (results.length === 0) return <p className="text-[11.5px] text-neutral-500">Nothing matches "{query}".</p>;
  const groups = [...new Set(results.map((r) => r.group))];
  return (
    <>
      {groups.map((g) => (
        <Section key={g} title={g}>
          <Grid>
            {results
              .filter((r) => r.group === g)
              .map((i) => (
                <AssetButton key={i.assetId} item={i} />
              ))}
          </Grid>
        </Section>
      ))}
    </>
  );
};

export const DesignPanel: React.FC<{ onSimulate: () => void }> = ({ onSimulate }) => {
  const step = useAltStore((s) => s.step);
  const [query, setQuery] = useState('');
  const setStep = useAltStore((s) => s.setStep);
  const index = DESIGN_STEPS.findIndex((s) => s.id === step);
  const intro = STEP_INTRO[step];
  const placing = useUiStore((s) => s.toolMode === 'place' || s.toolMode === 'opening' || s.toolMode === 'room');

  return (
    <aside
      data-testid="alt-design-panel"
      data-viewport-left
      className="pointer-events-auto fixed top-14 left-3 bottom-3 z-[15] w-[300px] flex flex-col rounded-[12px] bg-neutral-900/90 backdrop-blur-md border border-white/10 shadow-2xl text-neutral-200"
    >
      <div className="px-4 pt-3.5 pb-2.5 border-b border-white/10">
        <div className="text-[10.5px] font-semibold text-indigo-300">
          Step {index + 1} of {DESIGN_STEPS.length}
        </div>
        <h2 className="text-[15px] font-semibold text-white">{intro.title}</h2>
        <p className="text-[11.5px] text-neutral-400">{intro.text}</p>
      </div>

      <div className="px-3 pt-2.5">
        <label className="flex items-center gap-2 px-2.5 py-1.5 rounded-[8px] bg-black/30 border border-white/10 focus-within:border-indigo-500">
          <Search size={13} className="text-neutral-500 shrink-0" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => e.key === 'Escape' && setQuery('')}
            placeholder="Search windows, fans, furniture…"
            className="flex-1 bg-transparent text-[12px] text-white placeholder-neutral-500 outline-none"
            data-testid="alt-asset-search"
          />
          {query && (
            <button type="button" aria-label="Clear search" onClick={() => setQuery('')} className="text-neutral-500 hover:text-white">
              <X size={12} />
            </button>
          )}
        </label>
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-3 flex flex-col gap-3.5">
        {query.trim() ? (
          <SearchResults query={query} />
        ) : (
          <>
            {step === 'rooms' && <RoomsStep />}
            {step === 'ventilation' && <VentilationStep />}
            {step === 'pollution' && <PollutionStep />}
            {step === 'furniture' && <FurnitureStep />}
          </>
        )}
      </div>

      {placing && (
        <div className="mx-3 mb-2 px-2.5 py-1.5 rounded-[8px] bg-indigo-500/15 border border-indigo-400/40 text-[11px] text-indigo-100 flex items-center gap-2" data-testid="alt-placing-hint">
          <span className="flex-1">Click in the view to place it. Press R to rotate.</span>
          <button type="button" onClick={cancelPlacement} className="flex items-center gap-0.5 px-1.5 py-0.5 rounded bg-white/10 hover:bg-white/15">
            <X size={11} /> Cancel
          </button>
        </div>
      )}

      <div className="px-3 py-2.5 border-t border-white/10 flex items-center gap-2">
        <button
          type="button"
          disabled={index === 0}
          onClick={() => setStep(DESIGN_STEPS[index - 1]!.id)}
          className="px-3 py-1.5 rounded-[8px] text-[12px] text-neutral-300 hover:bg-white/10 disabled:opacity-0"
        >
          Back
        </button>
        <div className="flex-1" />
        {index < DESIGN_STEPS.length - 1 && (
          <button
            type="button"
            data-testid="alt-next-step"
            onClick={() => setStep(DESIGN_STEPS[index + 1]!.id)}
            className="px-3 py-1.5 rounded-[8px] text-[12px] font-medium bg-white/10 hover:bg-white/15 text-white"
          >
            Next: {DESIGN_STEPS[index + 1]!.label}
          </button>
        )}
        {index === DESIGN_STEPS.length - 1 && (
          <button
            type="button"
            onClick={onSimulate}
            className="px-3 py-1.5 rounded-[8px] text-[12px] font-semibold bg-indigo-600 hover:bg-indigo-500 text-white flex items-center gap-1.5"
          >
            <Play size={12} /> Simulate airflow
          </button>
        )}
      </div>
    </aside>
  );
};
