import React, { useMemo, useState } from 'react';
import { FlaskConical, Save, X } from 'lucide-react';
import { useScenarioStore } from '../../store/scenarioStore';
import { describeAction, diffDesigns } from '../../simulation/scenarios/actions';
import { useDesign } from './useScenarios';

/**
 * What-if mode on the canvas: a subtle tint plus a banner ("editing a copy, your design is
 * unchanged") listing the recorded changes, each removable, with Save scenario (named) and Discard.
 */
export const WhatIfBanner: React.FC = () => {
  const whatIf = useScenarioStore((s) => s.whatIf);
  const rooms = useDesign();
  const actions = useMemo(() => (whatIf ? diffDesigns(whatIf.baseline, rooms) : []), [whatIf, rooms]);
  const [name, setName] = useState('');
  if (!whatIf) return null;
  const st = useScenarioStore.getState;
  return (
    <>
      <div className="absolute inset-0 z-[5] pointer-events-none border-2 border-violet-400/50 bg-violet-500/[0.06]" data-testid="sim-whatif-tint" />
      <div className="absolute top-14 left-1/2 -translate-x-1/2 z-[16] pointer-events-none">
        <div data-testid="sim-whatif-banner" className="pointer-events-auto w-[400px] max-w-[calc(100vw-32px)] px-3 py-2 rounded-[10px] bg-violet-950/95 border border-violet-400/50 shadow-2xl backdrop-blur-md flex flex-col gap-1.5 text-neutral-200">
          <div className="flex items-center gap-1.5 text-[12px] font-semibold text-white">
            <FlaskConical size={14} className="text-violet-300" /> What-if: editing a copy, your design is unchanged
          </div>
          {actions.length === 0 ? (
            <span className="text-[10.5px] text-violet-200/80">Open or close windows, move or switch devices, add or stop sources. Each change is recorded here.</span>
          ) : (
            <ol className="flex flex-col gap-0.5 max-h-[120px] overflow-y-auto" data-testid="sim-whatif-actions">
              {actions.map((a, i) => (
                <li key={i} className="flex items-center gap-1 text-[10.5px]">
                  <span className="w-4 text-violet-300 tabular-nums">{i + 1}.</span>
                  <span className="flex-1 min-w-0">{describeAction(a, whatIf.baseline)}</span>
                  <button type="button" aria-label="Remove this change" onClick={() => st().removeWhatIfAction(i)} className="p-0.5 rounded hover:bg-white/10 text-violet-200">
                    <X size={11} />
                  </button>
                </li>
              ))}
            </ol>
          )}
          <div className="flex items-center gap-1.5">
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Scenario name"
              data-testid="sim-whatif-name"
              className="flex-1 min-w-0 bg-black/30 border border-white/15 rounded px-1.5 py-0.5 text-[11px] text-white placeholder:text-neutral-500"
            />
            <button
              type="button"
              disabled={actions.length === 0}
              data-testid="sim-whatif-save"
              onClick={() => {
                st().saveWhatIf(name || actions.map((a) => describeAction(a, whatIf.baseline)).join(', ').slice(0, 60));
                setName('');
              }}
              className="px-2 py-0.5 rounded bg-violet-500 hover:bg-violet-400 disabled:opacity-40 text-white text-[11px] font-semibold flex items-center gap-1"
            >
              <Save size={11} /> Save scenario
            </button>
            <button type="button" data-testid="sim-whatif-discard" onClick={() => st().discardWhatIf()} className="px-2 py-0.5 rounded bg-white/10 hover:bg-white/15 text-[11px]">
              Discard
            </button>
          </div>
        </div>
      </div>
    </>
  );
};
