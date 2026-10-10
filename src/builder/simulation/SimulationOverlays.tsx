import React, { useMemo } from 'react';
import { Play, Sparkles, Square, X } from 'lucide-react';
import { openExamples } from '../../ui/showcase/ExamplesPicker';
import { useShowcaseStore } from '../../store/showcaseStore';
import { useSceneStore } from '../../store/sceneStore';
import { useSimulationStore } from '../../store/simulationStore';
import { OUTDOOR_PM25_SCENARIOS } from '../../simulation/constants';
import { devicesIn } from '../../simulation/devices';
import { isPm25SourceObject } from '../../simulation/sources';

const Step: React.FC<{ n: number; title: string; children?: React.ReactNode }> = ({ n, title, children }) => (
  <li className="flex gap-2">
    <span className="mt-px w-5 h-5 shrink-0 rounded-full bg-indigo-600 text-white text-[11px] font-semibold flex items-center justify-center">{n}</span>
    <div className="flex flex-col gap-1 min-w-0">
      <span className="text-[12px] font-semibold text-white">{title}</span>
      {children}
    </div>
  </li>
);

/**
 * Before the first run (with the Simulation tab open): a card on the canvas with the three steps
 * (place sources and devices → pick outdoor conditions → run) and a prominent Run button.
 */
export const FirstUseCard: React.FC = () => {
  const room = useSceneStore((s) => s.room);
  const otherRooms = useSceneStore((s) => s.otherRooms);
  const setHouseParams = useSceneStore((s) => s.setHouseParams);
  const inExample = useShowcaseStore((s) => s.active !== null);
  const visible = useSimulationStore((s) => s.viz.show && s.result === null && s.status !== 'running' && s.insightsDocked && !s.firstUseDismissed) && !inExample;
  const setUi = useSimulationStore((s) => s.setUi);
  const runVoxel = useSimulationStore((s) => s.runVoxel);
  const counts = useMemo(() => {
    const rooms = [room, ...otherRooms];
    return {
      rooms: rooms.length,
      sources: rooms.reduce((n, r) => n + r.objects.filter(isPm25SourceObject).length + (r.params.pm25Sources?.length ?? 0), 0),
      devices: rooms.reduce((n, r) => n + devicesIn(r.objects).length, 0),
    };
  }, [room, otherRooms]);
  if (!visible) return null;
  const outdoor = room.params.outdoorPm25?.valueUgM3;

  return (
    <div className="absolute inset-0 z-[13] pointer-events-none flex items-center justify-center">
      <div data-testid="sim-first-use" className="pointer-events-auto w-[340px] max-w-[calc(100%-32px)] p-4 rounded-[12px] bg-neutral-900/95 border border-white/10 shadow-2xl backdrop-blur-md text-neutral-300 flex flex-col gap-3">
        <div className="flex items-start justify-between gap-2">
          <div>
            <div className="text-[14px] font-semibold text-white">Simulate the air in this house</div>
            <div className="text-[11px] text-neutral-400">See where pollution builds up, which rooms get stale and how air moves.</div>
          </div>
          <button type="button" aria-label="Close" onClick={() => setUi({ firstUseDismissed: true })} className="p-1 rounded hover:bg-white/10 text-neutral-400">
            <X size={14} />
          </button>
        </div>
        <ol className="flex flex-col gap-2.5">
          <Step n={1} title="Place pollution sources & devices">
            <span className="text-[10.5px] text-neutral-400">
              Asset Library › Pollution sources and Appliances and Airflow · {counts.sources} {counts.sources === 1 ? 'source' : 'sources'}, {counts.devices} {counts.devices === 1 ? 'device' : 'devices'} placed
            </span>
          </Step>
          <Step n={2} title="Pick outdoor conditions">
            <div className="flex flex-wrap gap-1">
              {OUTDOOR_PM25_SCENARIOS.slice(0, 2).map((sc) => (
                <button
                  key={sc.id}
                  type="button"
                  onClick={() => setHouseParams({ outdoorPm25: { valueUgM3: sc.valueUgM3, source: 'manual' } })}
                  className={`px-1.5 py-0.5 rounded-full text-[10px] border ${outdoor === sc.valueUgM3 ? 'bg-indigo-600 border-indigo-400 text-white' : 'bg-white/5 border-white/10 text-neutral-300 hover:bg-white/10'}`}
                >
                  {sc.label} · {sc.valueUgM3} µg/m³
                </button>
              ))}
            </div>
          </Step>
          <Step n={3} title="Run simulation" />
        </ol>
        <button type="button" onClick={openExamples} className="w-full py-1.5 rounded-[8px] border border-indigo-400/40 bg-indigo-500/10 hover:bg-indigo-500/20 text-[11.5px] text-indigo-100 flex items-center justify-center gap-1.5" data-testid="sim-first-use-examples">
          <Sparkles size={13} /> Or open an example with ready-made results
        </button>
        <button
          type="button"
          data-testid="sim-first-use-run"
          onClick={() => void runVoxel(room, otherRooms)}
          className="w-full py-2 rounded-[8px] bg-indigo-600 hover:bg-indigo-500 text-white text-[13px] font-semibold flex items-center justify-center gap-1.5 shadow-lg"
        >
          <Play size={14} /> Run simulation ({counts.rooms} {counts.rooms === 1 ? 'room' : 'rooms'})
        </button>
      </div>
    </div>
  );
};

/** While the solver runs: progress on the canvas itself (not only in the side panel). */
export const RunProgress: React.FC = () => {
  const running = useSimulationStore((s) => s.status === 'running');
  const progress = useSimulationStore((s) => s.progress);
  const cancelRun = useSimulationStore((s) => s.cancelRun);
  const storyOpen = useShowcaseStore((s) => s.active !== null);
  if (!running) return null;
  const pct = Math.round((progress?.fraction ?? 0) * 100);
  return (
    <div className={`absolute ${storyOpen ? 'top-[112px]' : 'top-16'} left-1/2 -translate-x-1/2 z-[13] pointer-events-none`}>
      <div data-testid="sim-run-progress" role="status" aria-live="polite" className="pointer-events-auto w-[300px] px-3 py-2.5 rounded-[10px] bg-neutral-900/95 border border-white/10 shadow-2xl backdrop-blur-md flex flex-col gap-1.5">
        <div className="flex items-center justify-between gap-2">
          <span className="text-[12px] font-semibold text-white">Simulating air in the house… {pct}%</span>
          <button type="button" onClick={cancelRun} className="px-1.5 py-0.5 rounded bg-white/10 hover:bg-white/15 text-[10.5px] text-neutral-200 flex items-center gap-1">
            <Square size={10} /> Cancel
          </button>
        </div>
        <div className="h-1.5 rounded bg-white/10 overflow-hidden">
          <div className="h-full bg-indigo-500 transition-[width]" style={{ width: `${pct}%` }} />
        </div>
        <span className="text-[10px] text-neutral-400 truncate">{progress?.message ?? 'Starting'}</span>
      </div>
    </div>
  );
};
