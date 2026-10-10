import React, { useState } from 'react';
import { Columns2, Copy, FlaskConical, Pencil, Trash2, Wand2 } from 'lucide-react';
import { houseScenarios, useScenarioStore } from '../../store/scenarioStore';
import { useDesign } from '../../builder/simulation/useScenarios';
import { describeAction } from '../../simulation/scenarios/actions';

const IconBtn: React.FC<{ label: string; onClick: () => void; children: React.ReactNode; testId?: string }> = ({ label, onClick, children, testId }) => (
  <button type="button" aria-label={label} title={label} onClick={onClick} data-testid={testId} className="p-1 rounded hover:bg-white/10 text-neutral-300">
    {children}
  </button>
);

/**
 * Scenarios in the Simulation tab: the baseline (your design) and the saved what-if scenarios, with
 * compare, apply, rename, duplicate and delete; "What-if" starts recording a new one.
 */
export const ScenarioList: React.FC = () => {
  const rooms = useDesign();
  const whatIf = useScenarioStore((s) => s.whatIf);
  const st = useScenarioStore.getState;
  const scenarios = houseScenarios(whatIf ? whatIf.baseline : rooms);
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState('');

  return (
    <div className="flex flex-col gap-1.5 p-2.5 rounded-[8px] bg-black/20 border border-white/10" data-testid="sim-scenarios">
      <div className="flex items-center gap-2">
        <span className="text-[10px] uppercase tracking-wider font-semibold text-neutral-400">Scenarios</span>
        <button
          type="button"
          data-testid="sim-whatif-btn"
          disabled={!!whatIf}
          onClick={() => st().enterWhatIf()}
          className="ml-auto px-2 py-0.5 rounded-[6px] bg-violet-600 hover:bg-violet-500 disabled:opacity-50 text-white text-[11px] font-semibold flex items-center gap-1"
          title="Try changes on a copy of your design"
        >
          <FlaskConical size={12} /> What-if
        </button>
      </div>
      <div className="flex items-center gap-1.5 text-[11px] text-neutral-200">
        <span className="w-1.5 h-1.5 rounded-full bg-neutral-300" />
        <span className="font-medium">Baseline</span>
        <span className="text-[10px] text-neutral-500">your design</span>
      </div>
      {scenarios.length === 0 && <span className="text-[10px] text-neutral-500">No scenarios yet. Press What-if, change windows, devices or sources, then save.</span>}
      {scenarios.map((s) => (
        <div key={s.id} className="flex flex-col gap-0.5 pl-3 border-l border-white/10" data-testid="sim-scenario-row">
          <div className="flex items-center gap-1">
            {editing === s.id ? (
              <input
                autoFocus
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onBlur={() => {
                  st().renameScenario(s.id, draft);
                  setEditing(null);
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
                  if (e.key === 'Escape') setEditing(null);
                }}
                className="flex-1 min-w-0 bg-black/30 border border-indigo-500 rounded px-1 text-[11px] text-white"
              />
            ) : (
              <span className="flex-1 min-w-0 truncate text-[11px] font-medium text-neutral-100" title={s.name}>
                {s.name}
              </span>
            )}
            <IconBtn label="Compare with the baseline" testId="sim-scenario-compare" onClick={() => st().openCompare({ kind: 'baseline' }, { kind: 'saved', id: s.id }, 'swipe')}>
              <Columns2 size={12} />
            </IconBtn>
            <IconBtn label="Apply to my design (undoable)" testId="sim-scenario-apply" onClick={() => st().applyToDesign(s)}>
              <Wand2 size={12} />
            </IconBtn>
            <IconBtn
              label="Rename"
              onClick={() => {
                setDraft(s.name);
                setEditing(s.id);
              }}
            >
              <Pencil size={12} />
            </IconBtn>
            <IconBtn label="Duplicate" onClick={() => st().duplicateScenario(s.id)}>
              <Copy size={12} />
            </IconBtn>
            <IconBtn label="Delete" onClick={() => st().deleteScenario(s.id)}>
              <Trash2 size={12} />
            </IconBtn>
          </div>
          <span className="text-[10px] text-neutral-500 leading-snug">{s.actions.map((a) => describeAction(a, rooms)).join(' · ') || 'No changes'}</span>
        </div>
      ))}
    </div>
  );
};
