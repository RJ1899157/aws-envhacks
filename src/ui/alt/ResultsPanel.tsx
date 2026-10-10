import React, { useEffect } from 'react';
import { AlertTriangle, Pencil, RefreshCw } from 'lucide-react';
import { DEFAULT_OUTDOOR_PM25 } from '../../simulation/constants';
import { useSceneStore } from '../../store/sceneStore';
import { useScenarioStore } from '../../store/scenarioStore';
import { useSimulationStore } from '../../store/simulationStore';
import { useSimulationModel } from '../../store/useSimulationModel';
import { useUiStore } from '../../store/uiStore';
import { ComparePanel } from '../simulation/ComparePanel';
import { InsightsPanel } from '../simulation/InsightsPanel';
import { ModeSwitch } from '../simulation/ModeSwitch';
import { homeSummary } from './AboutHomeCard';

const OUTDOOR = [
  { id: 'clean', label: 'Clean', valueUgM3: 15 },
  { id: 'average', label: 'Average', valueUgM3: DEFAULT_OUTDOOR_PM25 },
  { id: 'polluted', label: 'Polluted', valueUgM3: 60 },
  { id: 'smog', label: 'Winter smog', valueUgM3: 250 },
];

/** Runs the solver on the current design (instant when this exact design was already run). */
export function runSimulation(): void {
  const { room, otherRooms } = useSceneStore.getState();
  void useSimulationStore.getState().runVoxel(room, otherRooms);
}

/**
 * Right panel of Results mode: outdoor air, what to look at, insights and fixes. In an example the
 * story sets the conditions, so outdoor air is not offered and the panel clears the story bar.
 */
export const ResultsPanel: React.FC<{ onEdit?: () => void; example?: boolean }> = ({ onEdit, example = false }) => {
  const { room, stale } = useSimulationModel();
  const status = useSimulationStore((s) => s.status);
  const error = useSimulationStore((s) => s.error);
  const hasResult = useSimulationStore((s) => s.result !== null);
  const setUi = useSimulationStore((s) => s.setUi);
  const comparing = useScenarioStore((s) => s.compare !== null);
  const whatIf = useScenarioStore((s) => s.whatIf !== null);
  const outdoor = room.params.outdoorPm25?.valueUgM3 ?? DEFAULT_OUTDOOR_PM25;
  const lastApplied = useScenarioStore((s) => s.lastApplied);

  // Applying a suggested fix changes the design: say so and re-run, so the results show its effect
  const seenApplied = React.useRef(lastApplied?.at ?? 0);
  useEffect(() => {
    if (!lastApplied || lastApplied.at === seenApplied.current) return;
    seenApplied.current = lastApplied.at;
    useUiStore.getState().setToastMessage(`Applied: ${lastApplied.label}. Updating results… (Ctrl+Z to undo)`);
    runSimulation();
  }, [lastApplied]);

  // Insights live in this panel, not floating over the view
  useEffect(() => {
    setUi({ insightsDocked: true });
    return () => setUi({ insightsDocked: false });
  }, [setUi]);

  const setOutdoor = (valueUgM3: number) => {
    const params = { outdoorPm25: { valueUgM3, source: 'manual' as const } };
    if (whatIf) useScenarioStore.getState().setHouseParamsEverywhere(params);
    else useSceneStore.getState().setHouseParams(params);
    runSimulation();
  };

  return (
    <aside
      data-testid="alt-results-panel"
      data-viewport-right
      className={`pointer-events-auto fixed ${example ? 'top-[112px]' : 'top-14'} right-3 bottom-3 z-[15] w-[320px] flex flex-col rounded-[12px] bg-neutral-900/90 backdrop-blur-md border border-white/10 shadow-2xl text-neutral-200`}
    >
      <div className="px-4 pt-3.5 pb-3 border-b border-white/10 flex flex-col gap-2.5">
        <div>
          <h2 className="text-[15px] font-semibold text-white">Results</h2>
          <p className="text-[11px] text-neutral-400">{example ? 'Example flat, conditions set by the story.' : 'Simulated over 4 hours.'}</p>
          {!example && <p className="text-[10.5px] text-neutral-500 mt-0.5" data-testid="alt-results-home">Home: {homeSummary(room.params)}</p>}
        </div>
        {!example && <div className="flex flex-col gap-1">
          <span className="text-[10.5px] uppercase tracking-wider font-semibold text-neutral-400">Outdoor air</span>
          <div className="flex flex-wrap gap-1" role="radiogroup" aria-label="Outdoor air">
            {OUTDOOR.map((o) => (
              <button
                key={o.id}
                type="button"
                role="radio"
                aria-checked={outdoor === o.valueUgM3}
                onClick={() => setOutdoor(o.valueUgM3)}
                className={`px-2 py-0.5 rounded-full text-[10.5px] border ${
                  outdoor === o.valueUgM3 ? 'bg-indigo-600 border-indigo-400 text-white' : 'bg-white/5 border-white/10 text-neutral-300 hover:bg-white/10'
                }`}
              >
                {o.label} · {o.valueUgM3}
              </button>
            ))}
          </div>
        </div>}
        <div className="flex flex-col gap-1">
          <span className="text-[10.5px] uppercase tracking-wider font-semibold text-neutral-400">Show</span>
          <ModeSwitch />
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-3 py-3 flex flex-col gap-2.5">
        {status === 'error' && (
          <div className="p-2.5 rounded-[8px] bg-red-500/10 border border-red-400/30 text-[11.5px] text-red-200 flex flex-col gap-1.5">
            <span>The simulation failed: {error}</span>
            <button type="button" onClick={runSimulation} className="self-start px-2 py-0.5 rounded bg-white/10 hover:bg-white/15 text-white">
              Try again
            </button>
          </div>
        )}
        {status === 'running' && !hasResult && <p className="text-[12px] text-neutral-400 px-1">Simulating the air… results appear here in a few seconds.</p>}
        {(status === 'cancelled' || status === 'idle') && !hasResult && (
          <button type="button" onClick={runSimulation} className="py-2 rounded-[8px] bg-indigo-600 hover:bg-indigo-500 text-white text-[12px] font-semibold">
            Run the simulation
          </button>
        )}
        {stale && status !== 'running' && !whatIf && (
          <div className="p-2.5 rounded-[8px] bg-amber-500/10 border border-amber-400/30 text-[11.5px] text-amber-100 flex items-center gap-2" data-testid="alt-results-stale">
            <AlertTriangle size={13} className="shrink-0" />
            <span className="flex-1">The design changed since these results.</span>
            <button type="button" onClick={runSimulation} className="px-2 py-0.5 rounded bg-white/10 hover:bg-white/15 text-white flex items-center gap-1">
              <RefreshCw size={11} /> Update
            </button>
          </div>
        )}
        {comparing ? <ComparePanel variant="docked" /> : <InsightsPanel variant="docked" />}
      </div>

      {onEdit && (
        <div className="px-3 py-2.5 border-t border-white/10">
          <button type="button" onClick={onEdit} className="w-full py-1.5 rounded-[8px] bg-white/10 hover:bg-white/15 text-[12px] text-white flex items-center justify-center gap-1.5">
            <Pencil size={12} /> Change the design
          </button>
        </div>
      )}
    </aside>
  );
};
