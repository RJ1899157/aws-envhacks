import React, { useRef } from 'react';
import { GripVertical } from 'lucide-react';
import { useScenarioStore, type CompareView } from '../../store/scenarioStore';
import { useSimulationStore } from '../../store/simulationStore';
import { useCompareSides } from './useScenarios';
import { useShowcaseStore } from '../../store/showcaseStore';

const VIEWS: { id: CompareView; label: string }[] = [
  { id: 'a', label: 'A' },
  { id: 'b', label: 'B' },
  { id: 'swipe', label: 'Swipe' },
  { id: 'diff', label: 'Difference' },
];

/**
 * On the canvas while comparing: an A / B / Swipe / Difference toggle with the side names, and in
 * Swipe the draggable divider (A on the left, B on the right, same camera and colour scale).
 */
export const CompareOverlay: React.FC = () => {
  const compare = useScenarioStore((s) => s.compare);
  const show = useSimulationStore((s) => s.viz.show);
  const mode = useSimulationStore((s) => s.viz.mode);
  const sides = useCompareSides();
  const rootRef = useRef<HTMLDivElement>(null);
  const storyOpen = useShowcaseStore((s) => s.active !== null);
  if (!compare || !show || !sides) return null;
  const set = useScenarioStore.getState().setCompare;
  const aName = sides.a.name;
  const bName = sides.b.name;
  const drag = (e: React.PointerEvent) => {
    const root = rootRef.current;
    if (!root) return;
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    const move = (ev: PointerEvent) => {
      const r = root.getBoundingClientRect();
      set({ swipe: Math.min(0.95, Math.max(0.05, (ev.clientX - r.left) / r.width)) });
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };
  const label = (side: 'A' | 'B', name: string) => (
    <span className={`px-1.5 py-0.5 rounded text-[10.5px] font-semibold text-white whitespace-nowrap max-w-[220px] truncate ${side === 'A' ? 'bg-sky-700/90' : 'bg-orange-700/90'}`} title={name}>
      {side} · {name}
    </span>
  );
  return (
    <div ref={rootRef} className="absolute inset-0 z-[11] pointer-events-none" data-testid="sim-compare-overlay">
      <div className={`absolute ${storyOpen ? 'top-[108px]' : 'top-14'} left-1/2 -translate-x-1/2 flex flex-col items-center gap-1`}>
        <div role="radiogroup" aria-label="Compare view" className="pointer-events-auto flex p-0.5 rounded-[8px] bg-neutral-900/95 border border-white/15 shadow-xl" data-testid="sim-compare-toggle">
          {VIEWS.map((v) => (
            <button
              key={v.id}
              type="button"
              role="radio"
              aria-checked={compare.view === v.id}
              data-view={v.id}
              onClick={() => set({ view: v.id })}
              className={`rounded-[6px] px-2 py-0.5 text-[11px] font-medium ${compare.view === v.id ? 'bg-indigo-600 text-white' : 'text-neutral-300 hover:bg-white/10'}`}
            >
              {v.label}
            </button>
          ))}
        </div>
        {compare.view === 'a' && label('A', aName)}
        {compare.view === 'b' && label('B', bName)}
        {compare.view === 'diff' && <span className="px-1.5 py-0.5 rounded bg-neutral-900/90 text-[10.5px] text-neutral-200">Change from A ({aName}) to B ({bName})</span>}
        {mode === 'airflow' && <span className="px-1.5 py-0.5 rounded bg-neutral-900/90 text-[10px] text-neutral-400">Airflow has no heatmap: see the table</span>}
      </div>
      {compare.view === 'swipe' && mode !== 'airflow' && (
        <div className="absolute top-0 bottom-0" style={{ left: `${compare.swipe * 100}%` }} data-testid="sim-compare-swipe">
          <div className="absolute top-0 bottom-0 -translate-x-1/2 w-0.5 bg-white/85 shadow-[0_0_0_1px_rgba(0,0,0,0.5)]" />
          <div className={`absolute ${storyOpen ? 'top-[170px]' : 'top-[118px]'} right-2`}>{label('A', aName)}</div>
          <div className={`absolute ${storyOpen ? 'top-[170px]' : 'top-[118px]'} left-2`}>{label('B', bName)}</div>
          <button
            type="button"
            aria-label="Drag to compare"
            onPointerDown={drag}
            className="pointer-events-auto absolute top-1/2 -translate-x-1/2 -translate-y-1/2 w-6 h-10 rounded-full bg-white text-neutral-900 shadow-xl flex items-center justify-center cursor-ew-resize"
          >
            <GripVertical size={14} />
          </button>
        </div>
      )}
    </div>
  );
};
