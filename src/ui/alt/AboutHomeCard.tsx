import React, { useState } from 'react';
import { Building, Building2, Trees } from 'lucide-react';
import type { RoomParams, SiteExposure, WindowStyle } from '../../core/schema';
import { useSceneStore } from '../../store/sceneStore';

/**
 * "About your home": the floor, the surroundings and the usual windows. They set how much wind reaches
 * the windows (height and shielding) and how much air a window lets through (style, insect mesh), for
 * every room of the home. Typical answers are preselected, so Skip is always safe.
 */

/** Floor buckets: the level written when a chip is picked, and the floors each chip covers. */
const FLOORS: { label: string; level: number; max: number }[] = [
  { label: 'Ground', level: 0, max: 0 },
  { label: '1st–3rd', level: 2, max: 3 },
  { label: '4th–9th', level: 6, max: 9 },
  { label: '10th +', level: 12, max: Infinity },
];
const floorBucket = (level: number) => FLOORS.find((f) => level <= f.max)!;

const SURROUNDINGS: { value: SiteExposure; label: string; hint: string; icon: React.ElementType }[] = [
  { value: 'open', label: 'Open', hint: 'Park, fields or sea-facing', icon: Trees },
  { value: 'suburban', label: 'Some buildings', hint: 'Colony, low-rise around', icon: Building },
  { value: 'urbanDense', label: 'Packed in', hint: 'Buildings close on all sides', icon: Building2 },
];

export const WINDOW_STYLES: { value: WindowStyle; label: string; hint: string }[] = [
  { value: 'sliding', label: 'Sliding', hint: 'Opens up to half' },
  { value: 'casement', label: 'Opens outwards', hint: 'Hinged, fully open' },
  { value: 'louvre', label: 'Louvres / jaali', hint: 'Slats, small gaps' },
];

/** Answers preselected for a new home (and used by Skip). */
export const TYPICAL_HOME: Required<Pick<RoomParams, 'floorLevel' | 'exposure' | 'windowDefaults'>> = {
  floorLevel: 2,
  exposure: 'suburban',
  windowDefaults: { style: 'sliding', mesh: false },
};

function ordinal(n: number): string {
  const tens = n % 100;
  const suffix = tens >= 11 && tens <= 13 ? 'th' : ['th', 'st', 'nd', 'rd'][n % 10] ?? 'th';
  return `${n}${suffix}`;
}

/** One-line summary of the home's answers, e.g. "2nd floor · some buildings · sliding windows + mesh". */
export function homeSummary(p: RoomParams): string {
  const floor = p.floorLevel === undefined ? 'floor not set' : p.floorLevel === 0 ? 'ground floor' : `${ordinal(p.floorLevel)} floor`;
  const around = SURROUNDINGS.find((s) => s.value === (p.exposure ?? 'urbanDense'))!.label.toLowerCase();
  const w = p.windowDefaults;
  const windows = w ? `${WINDOW_STYLES.find((s) => s.value === w.style)!.label.toLowerCase()} windows${w.mesh ? ' + mesh' : ''}` : 'windows not set';
  return `${floor} · ${around} · ${windows}`;
}

const Chip: React.FC<{ on: boolean; onClick: () => void; children: React.ReactNode; testId?: string }> = ({ on, onClick, children, testId }) => (
  <button
    type="button"
    role="radio"
    aria-checked={on}
    data-testid={testId}
    onClick={onClick}
    className={`flex-1 px-2 py-2 rounded-[8px] border text-[12px] transition-colors ${
      on ? 'border-indigo-400 bg-indigo-500/20 text-white font-semibold' : 'border-white/10 bg-white/[0.04] text-neutral-300 hover:bg-white/[0.08]'
    }`}
  >
    {children}
  </button>
);

/** The card itself; `onDone` runs after the answers are written to every room. */
export const AboutHomeCard: React.FC<{ onDone: () => void; onBack?: () => void; doneLabel?: string }> = ({ onDone, onBack, doneLabel = 'Next' }) => {
  const params = useSceneStore((s) => s.room.params);
  const [floor, setFloor] = useState(params.floorLevel ?? TYPICAL_HOME.floorLevel);
  const [exposure, setExposure] = useState<SiteExposure>(params.exposure ?? TYPICAL_HOME.exposure);
  const [style, setStyle] = useState<WindowStyle>(params.windowDefaults?.style ?? TYPICAL_HOME.windowDefaults.style);
  const [mesh, setMesh] = useState(params.windowDefaults?.mesh ?? TYPICAL_HOME.windowDefaults.mesh);
  const [floorText, setFloorText] = useState(String(floor));

  const save = (p: typeof TYPICAL_HOME) => {
    useSceneStore.getState().setHouseParams(p);
    onDone();
  };
  const pickFloor = (level: number) => {
    setFloor(level);
    setFloorText(String(level));
  };

  return (
    <div className="flex flex-col gap-4" data-testid="alt-about-home">
      <div>
        <h1 className="text-[20px] font-semibold text-white">About your home</h1>
        <p className="text-[12px] text-neutral-400 mt-0.5">This sets how much fresh air reaches your windows and how much they let in.</p>
      </div>

      <section className="flex flex-col gap-1.5">
        <h3 className="text-[12px] font-semibold text-neutral-200">Which floor is it on?</h3>
        <div className="flex gap-1.5" role="radiogroup" aria-label="Floor">
          {FLOORS.map((f) => (
            <Chip key={f.label} on={floorBucket(floor) === f} onClick={() => pickFloor(f.level)} testId={`alt-floor-${f.level}`}>
              {f.label}
            </Chip>
          ))}
        </div>
        <label className="flex items-center gap-2 text-[11px] text-neutral-400">
          or exact floor
          <input
            inputMode="numeric"
            value={floorText}
            onChange={(e) => {
              setFloorText(e.target.value);
              const n = Number(e.target.value);
              if (Number.isInteger(n) && n >= 0 && n <= 150) setFloor(n);
            }}
            className="w-14 bg-black/30 border border-white/10 rounded-[6px] px-1.5 py-0.5 text-[12px] text-white outline-none focus:border-indigo-500"
            aria-label="Exact floor"
          />
          <span className="text-neutral-500">(0 = ground)</span>
        </label>
      </section>

      <section className="flex flex-col gap-1.5">
        <h3 className="text-[12px] font-semibold text-neutral-200">What's around it?</h3>
        <div className="flex gap-1.5" role="radiogroup" aria-label="Surroundings">
          {SURROUNDINGS.map(({ value, label, hint, icon: Icon }) => (
            <Chip key={value} on={exposure === value} onClick={() => setExposure(value)} testId={`alt-exposure-${value}`}>
              <span className="flex flex-col items-center gap-1">
                <Icon size={18} className="text-neutral-300" />
                <span>{label}</span>
                <span className="text-[10px] font-normal text-neutral-400 leading-tight">{hint}</span>
              </span>
            </Chip>
          ))}
        </div>
      </section>

      <section className="flex flex-col gap-1.5">
        <h3 className="text-[12px] font-semibold text-neutral-200">Your windows are mostly…</h3>
        <div className="flex gap-1.5" role="radiogroup" aria-label="Window type">
          {WINDOW_STYLES.map((w) => (
            <Chip key={w.value} on={style === w.value} onClick={() => setStyle(w.value)} testId={`alt-window-${w.value}`}>
              <span className="flex flex-col items-center">
                <span>{w.label}</span>
                <span className="text-[10px] font-normal text-neutral-400">{w.hint}</span>
              </span>
            </Chip>
          ))}
        </div>
        <label className="flex items-center gap-2 text-[12px] text-neutral-200 mt-1 cursor-pointer">
          <input type="checkbox" checked={mesh} onChange={(e) => setMesh(e.target.checked)} className="accent-indigo-500" data-testid="alt-window-mesh" />
          Most windows have insect mesh
        </label>
        <p className="text-[10.5px] text-neutral-500">You can change any single window later.</p>
      </section>

      <div className="flex items-center gap-2 pt-1">
        {onBack && (
          <button type="button" onClick={onBack} className="px-3 py-2 rounded-[8px] text-[12px] text-neutral-300 hover:bg-white/10">
            Back
          </button>
        )}
        <div className="flex-1" />
        <button type="button" onClick={() => save(TYPICAL_HOME)} className="px-3 py-2 rounded-[8px] text-[12px] text-neutral-400 hover:text-white hover:bg-white/10" data-testid="alt-about-skip">
          Skip, use typical
        </button>
        <button
          type="button"
          onClick={() => save({ floorLevel: floor, exposure, windowDefaults: { style, mesh } })}
          className="px-4 py-2 rounded-[8px] bg-indigo-600 hover:bg-indigo-500 text-white text-[12.5px] font-semibold"
          data-testid="alt-about-done"
        >
          {doneLabel}
        </button>
      </div>
    </div>
  );
};
