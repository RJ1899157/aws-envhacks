import { create } from 'zustand';
import type { Room, RoomParams, Scenario, ScenarioAction } from '../core/schema';
import { applyActions, applyScenario, diffDesigns } from '../simulation/scenarios/actions';
import type { Objective } from '../simulation/scenarios/metrics';
import type { Ranking } from '../simulation/scenarios/rank';
import { useSceneStore } from './sceneStore';
import { holdHistory, releaseHistory } from './historyLock';
import type { HouseMetrics } from '../simulation/scenarios/metrics';

/**
 * What-if scenarios (UI state; the scenarios themselves live in the design, see
 * sceneStore.setScenarios):
 * - What-if mode: the design is snapshotted as the baseline and undo history paused; the user edits
 *   normally and the edits are read back as actions (diffDesigns). Save or Discard restores the
 *   baseline exactly, so the design is unchanged either way.
 * - Compare: two sides (baseline, a saved scenario, or the preview of a ranked action).
 * - Ranked actions for the current design and objective.
 */

export type ScenarioRef = { kind: 'baseline' } | { kind: 'saved'; id: string } | { kind: 'preview' };
export type CompareView = 'a' | 'b' | 'swipe' | 'diff';

export interface CompareState {
  a: ScenarioRef;
  b: ScenarioRef;
  view: CompareView;
  /** Swipe divider, 0–1 of the canvas width (A on the left) */
  swipe: number;
  /** Room whose time series is charted */
  roomId: string | null;
}

export interface ScenarioUiState {
  whatIf: { baseline: Room[] } | null;
  compare: CompareState | null;
  /** An unsaved scenario being previewed (a ranked action) */
  preview: Scenario | null;
  objective: Objective;
  ranking: Ranking | null;
  /** Key of the inputs `ranking` was computed for */
  rankingKey: string | null;
  /** Voxel metrics already known for designs (precomputed showcase checks), by voxel cache key */
  knownVoxel: Record<string, HouseMetrics>;

  enterWhatIf: () => void;
  /** Edits recorded so far, as actions against the baseline */
  whatIfActions: () => ScenarioAction[];
  removeWhatIfAction: (index: number) => void;
  saveWhatIf: (name: string) => Scenario | null;
  discardWhatIf: () => void;
  /** House-wide params (outdoor conditions) change the baseline too, so they survive leaving what-if */
  setHouseParamsEverywhere: (params: Partial<RoomParams>) => void;

  saveScenario: (s: Scenario) => void;
  renameScenario: (id: string, name: string) => void;
  deleteScenario: (id: string) => void;
  duplicateScenario: (id: string) => void;
  /** The scenario becomes the design: one undoable step */
  applyToDesign: (s: Pick<Scenario, 'actions'> & { texts?: string[] }) => void;
  /** Last fix applied to the design (so the results view can re-run and say what changed) */
  lastApplied: { at: number; label: string } | null;

  openCompare: (a: ScenarioRef, b: ScenarioRef, view?: CompareView) => void;
  setCompare: (patch: Partial<CompareState>) => void;
  closeCompare: () => void;
  setPreview: (s: Scenario | null) => void;

  setObjective: (o: Objective) => void;
  setRanking: (r: Ranking | null, key: string | null) => void;
  setKnownVoxel: (m: Record<string, HouseMetrics>) => void;
}

export const newScenarioId = () => `scn-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;

const currentDesign = (): Room[] => {
  const { room, otherRooms } = useSceneStore.getState();
  return [room, ...otherRooms];
};

/** Scenarios of the house (normally all on the active room). */
export function houseScenarios(rooms: readonly Room[]): Scenario[] {
  return rooms.flatMap((r) => r.scenarios ?? []);
}

/** Puts rooms back as they were, keeping whichever room is active now in front, without history. */
function restore(rooms: Room[]): void {
  const activeId = useSceneStore.getState().room.id;
  const active = rooms.find((r) => r.id === activeId) ?? rooms[0]!;
  useSceneStore.setState({ room: active, otherRooms: rooms.filter((r) => r !== active), selectedObjectId: null, selectedObjectIds: [], selectedOpeningId: null, selectedOpeningIds: [] });
}

export const useScenarioStore = create<ScenarioUiState>()((set, get) => ({
  whatIf: null,
  compare: null,
  preview: null,
  objective: { kind: 'house' },
  ranking: null,
  rankingKey: null,
  knownVoxel: {},
  lastApplied: null,

  enterWhatIf: () => {
    if (get().whatIf) return;
    holdHistory();
    set({ whatIf: { baseline: currentDesign() }, compare: null });
  },

  whatIfActions: () => {
    const w = get().whatIf;
    return w ? diffDesigns(w.baseline, currentDesign()) : [];
  },

  removeWhatIfAction: (index) => {
    const w = get().whatIf;
    if (!w) return;
    const actions = get().whatIfActions().filter((_, i) => i !== index);
    restore(applyActions(w.baseline, actions));
  },

  saveWhatIf: (name) => {
    const w = get().whatIf;
    if (!w) return null;
    const actions = get().whatIfActions();
    restore(w.baseline);
    releaseHistory();
    set({ whatIf: null });
    if (actions.length === 0) return null;
    const scenario: Scenario = { id: newScenarioId(), name: name.trim() || 'Scenario', actions };
    get().saveScenario(scenario);
    return scenario;
  },

  discardWhatIf: () => {
    const w = get().whatIf;
    if (!w) return;
    restore(w.baseline);
    releaseHistory();
    set({ whatIf: null });
  },

  setHouseParamsEverywhere: (params) => {
    useSceneStore.getState().setHouseParams(params);
    const w = get().whatIf;
    if (w) set({ whatIf: { baseline: w.baseline.map((r) => ({ ...r, params: { ...r.params, ...params } })) } });
  },

  saveScenario: (s) => useSceneStore.getState().setScenarios([...houseScenarios(currentDesign()), s]),
  renameScenario: (id, name) => useSceneStore.getState().setScenarios(houseScenarios(currentDesign()).map((s) => (s.id === id ? { ...s, name: name.trim() || s.name } : s))),
  deleteScenario: (id) => {
    useSceneStore.getState().setScenarios(houseScenarios(currentDesign()).filter((s) => s.id !== id));
    const c = get().compare;
    if (c && ((c.a.kind === 'saved' && c.a.id === id) || (c.b.kind === 'saved' && c.b.id === id))) set({ compare: null });
  },
  duplicateScenario: (id) => {
    const list = houseScenarios(currentDesign());
    const s = list.find((x) => x.id === id);
    if (s) useSceneStore.getState().setScenarios([...list, { ...s, id: newScenarioId(), name: `${s.name} (copy)` }]);
  },

  applyToDesign: (s) => {
    useSceneStore.getState().replaceDesign(applyScenario(currentDesign(), s));
    set({ compare: null, preview: null, lastApplied: { at: Date.now(), label: s.texts?.join(' + ') ?? 'the change' } });
  },

  openCompare: (a, b, view = 'swipe') => set({ compare: { a, b, view, swipe: 0.5, roomId: null } }),
  setCompare: (patch) => {
    const c = get().compare;
    if (c) set({ compare: { ...c, ...patch } });
  },
  closeCompare: () => set({ compare: null, preview: null }),
  setPreview: (preview) => set({ preview }),

  setObjective: (objective) => set({ objective }),
  setRanking: (ranking, rankingKey) => set({ ranking, rankingKey }),
  setKnownVoxel: (knownVoxel) => set({ knownVoxel }),
}));
