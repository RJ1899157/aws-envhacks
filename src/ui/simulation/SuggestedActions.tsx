import React, { useState } from 'react';
import { AlertTriangle, CheckCircle2, ChevronDown, ChevronRight, Eye, Loader2, Wand2 } from 'lucide-react';
import { useScenarioStore } from '../../store/scenarioStore';
import { useSceneStore } from '../../store/sceneStore';
import type { Effort } from '../../simulation/scenarios/generate';
import { deltaLabel, type RankedAction } from '../../simulation/scenarios/rank';

const EFFORT_STYLE: Record<Effort, string> = {
  Free: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30',
  Low: 'bg-sky-500/15 text-sky-300 border-sky-500/30',
  Purchase: 'bg-amber-500/15 text-amber-300 border-amber-500/30',
};

const EFFORT_HINT: Record<Effort, string> = {
  Free: 'Free: open, close or move things',
  Low: 'Low effort: switch on a device you own',
  Purchase: 'Purchase: needs a new device',
};

const fmtMs = (ms: number) => (ms < 1000 ? `${Math.round(ms)} ms` : ms < 60000 ? `${(ms / 1000).toFixed(1)} s` : `${Math.floor(ms / 60000)} min ${Math.round((ms % 60000) / 1000)} s`);

const Verified: React.FC<{ r: RankedAction }> = ({ r }) => {
  if (r.verified === 'verified')
    return (
      <span className="flex items-center gap-0.5 text-[9.5px] text-emerald-300" title={`Voxel solver agrees (Δ ${r.voxelDelta?.toFixed(1)} µg/m³)`} data-testid="sim-action-verified">
        <CheckCircle2 size={10} /> verified
      </span>
    );
  // The 3D check runs quietly in the background; only its outcome is shown
  if (r.verified === 'disagrees')
    return (
      <span className="flex items-center gap-0.5 text-[9.5px] text-amber-300" title={`The voxel solver finds Δ ${r.voxelDelta?.toFixed(1)} µg/m³`}>
        <AlertTriangle size={10} /> voxel disagrees
      </span>
    );
  return null;
};

const ActionRow: React.FC<{ r: RankedAction; worse?: boolean; roomName?: string }> = ({ r, worse = false, roomName }) => {
  const objective = useScenarioStore((s) => s.objective);
  const st = useScenarioStore.getState;
  const text = r.texts.join(' + ');
  const preview = () => {
    st().setPreview({ id: 'preview', name: text, actions: r.actions });
    st().openCompare({ kind: 'baseline' }, { kind: 'preview' }, 'swipe');
  };
  return (
    <li className="flex flex-col gap-1 px-1.5 py-1.5 rounded-[6px] bg-white/[0.03] border border-white/5" data-testid={worse ? 'sim-avoid-row' : 'sim-action-row'}>
      <span className="text-[10.5px] text-neutral-100 leading-snug">{text}</span>
      <span className="flex flex-wrap items-center gap-1.5">
        <span className={`px-1.5 rounded-full text-[9.5px] font-semibold tabular-nums ${worse ? 'bg-red-500/20 text-red-300' : 'bg-emerald-500/20 text-emerald-300'}`} data-testid="sim-action-delta">
          {deltaLabel(r, objective, roomName)}
        </span>
        <span className={`px-1.5 rounded-full border text-[9px] ${EFFORT_STYLE[r.effort]}`} title={EFFORT_HINT[r.effort]}>
          {r.effort}
        </span>
        <Verified r={r} />
        {!worse && (
          <span className="ml-auto flex gap-1">
            <button type="button" onClick={preview} className="px-1.5 py-0.5 rounded bg-white/10 hover:bg-white/15 text-[9.5px] flex items-center gap-0.5" data-testid="sim-action-preview">
              <Eye size={10} /> Preview
            </button>
            <button type="button" onClick={() => st().applyToDesign(r)} className="px-1.5 py-0.5 rounded bg-indigo-600 hover:bg-indigo-500 text-white text-[9.5px] flex items-center gap-0.5" data-testid="sim-action-apply" title="Apply to your design (undo with Ctrl+Z)">
              <Wand2 size={10} /> Apply
            </button>
          </span>
        )}
        {worse && (
          <button type="button" onClick={preview} className="ml-auto px-1.5 py-0.5 rounded bg-white/10 hover:bg-white/15 text-[9.5px] flex items-center gap-0.5">
            <Eye size={10} /> Preview
          </button>
        )}
      </span>
    </li>
  );
};

/**
 * Suggested actions (Insights panel): the top ranked actions for the objective (whole house or a
 * focus room), each with its effort, Δ, voxel verification and Preview / Apply; changes that make
 * things worse sit in a collapsed "Avoid" list.
 */
export const SuggestedActions: React.FC<{ limit?: number }> = ({ limit = 5 }) => {
  const ranking = useScenarioStore((s) => s.ranking);
  const objective = useScenarioStore((s) => s.objective);
  const setObjective = useScenarioStore((s) => s.setObjective);
  const room = useSceneStore((s) => s.room);
  const otherRooms = useSceneStore((s) => s.otherRooms);
  const [avoidOpen, setAvoidOpen] = useState(false);
  const rooms = [room, ...otherRooms];
  const focusName = objective.kind === 'room' ? rooms.find((r) => r.id === objective.roomId)?.name : undefined;

  return (
    <div data-testid="sim-suggested-actions" className="mt-0.5 flex flex-col gap-1.5">
      <div className="flex items-center gap-1.5">
        <span className="text-[10px] uppercase tracking-wider font-semibold text-neutral-400">Suggested actions</span>
        <select
          aria-label="What to improve"
          data-testid="sim-objective"
          value={objective.kind === 'house' ? 'house' : objective.roomId}
          onChange={(e) => setObjective(e.target.value === 'house' ? { kind: 'house' } : { kind: 'room', roomId: e.target.value })}
          className="ml-auto max-w-[140px] bg-black/30 border border-white/10 rounded px-1 py-0.5 text-[10px] text-neutral-200"
        >
          <option value="house">Whole house</option>
          {rooms.map((r) =>
            r.id ? (
              <option key={r.id} value={r.id}>
                Focus: {r.name}
              </option>
            ) : null
          )}
        </select>
      </div>
      {!ranking && (
        <span className="text-[10px] text-neutral-500 flex items-center gap-1">
          <Loader2 size={11} className="animate-spin" /> Ranking actions…
        </span>
      )}
      {ranking && ranking.better.length === 0 && <span className="text-[10px] text-neutral-400">No single change improves this noticeably.</span>}
      {ranking && (
        <ol className="flex flex-col gap-1" data-testid="sim-action-list">
          {ranking.better.slice(0, limit).map((r) => (
            <ActionRow key={r.id} r={r} roomName={focusName} />
          ))}
        </ol>
      )}
      {ranking && ranking.avoid.length > 0 && (
        <div>
          <button type="button" onClick={() => setAvoidOpen(!avoidOpen)} className="flex items-center gap-1 text-[10px] text-red-300/90" aria-expanded={avoidOpen} data-testid="sim-avoid-toggle">
            {avoidOpen ? <ChevronDown size={11} /> : <ChevronRight size={11} />} Avoid ({ranking.avoid.length}): these make it worse
          </button>
          {avoidOpen && (
            <ol className="mt-1 flex flex-col gap-1" data-testid="sim-avoid-list">
              {ranking.avoid.slice(0, 6).map((r) => (
                <ActionRow key={r.id} r={r} worse roomName={focusName} />
              ))}
            </ol>
          )}
        </div>
      )}
      {ranking && (
        <span className="text-[9px] text-neutral-500" data-testid="sim-ranking-stats">
          {ranking.evaluated} options scored in {fmtMs(ranking.runtimeMs)} (network model)
          {ranking.verifyMs !== undefined && ranking.better.some((r) => r.verified === 'verified' || r.verified === 'disagrees') ? ` · voxel checks ${fmtMs(ranking.verifyMs)}` : ''}
        </span>
      )}
    </div>
  );
};
