import type { Room } from '../core/schema';
import { AUTOSAVE_STORAGE_KEY } from './useAutosave';
import { useSceneStore } from './sceneStore';
import { useUiStore } from './uiStore';
import { useSimulationStore } from './simulationStore';
import { useScenarioStore } from './scenarioStore';
import { useShowcaseStore } from './showcaseStore';

/** Clears results, what-if state, the open example and the selection, then loads an empty room. */
export function resetToNewUser(): void {
  if (useShowcaseStore.getState().active) useShowcaseStore.getState().exit();
  const scenarios = useScenarioStore.getState();
  if (scenarios.whatIf) scenarios.discardWhatIf();
  scenarios.closeCompare();
  scenarios.setPreview(null);
  const sim = useSimulationStore.getState();
  if (sim.status === 'running') sim.cancelRun();
  sim.clearResult();
  sim.setViz({ show: false, mode: 'pollution', snapshotIndex: null, playing: false });
  sim.setUi({ insightsDocked: false, firstUseDismissed: true });
  useUiStore.getState().resetUi();
  useSceneStore.getState().resetRoom();
  useSceneStore.temporal.getState().clear();
}

/**
 * Where designs made in the old (classic) editor were kept: the backup taken when switching to the
 * new UI, else the classic autosave. Read only to offer "Continue my previous design".
 */
const PREVIOUS_DESIGN_KEYS = ['airforce_classic_backup_v1', AUTOSAVE_STORAGE_KEY];
const RETIRED_KEYS = ['airforce_ui_variant_v1'];

export interface PreviousDesign {
  room: Room;
  otherRooms: Room[];
}

/** A non-empty design saved by the old editor, if there is one. */
export function readPreviousDesign(): PreviousDesign | null {
  try {
    if (typeof localStorage === 'undefined') return null;
    for (const k of RETIRED_KEYS) localStorage.removeItem(k);
    for (const key of PREVIOUS_DESIGN_KEYS) {
      const raw = localStorage.getItem(key);
      if (!raw) continue;
      const saved = JSON.parse(raw) as Partial<PreviousDesign>;
      if (!saved.room?.outline) continue;
      const otherRooms = saved.otherRooms ?? [];
      // An untouched starting room isn't worth offering
      if (saved.room.objects?.length || saved.room.openings?.length || otherRooms.length) return { room: saved.room, otherRooms };
    }
  } catch {
    // unreadable or blocked storage: nothing to offer
  }
  return null;
}

/** Forgets the old editor's saved design once it has been opened in the new UI (or dismissed). */
export function clearPreviousDesign(): void {
  try {
    for (const key of PREVIOUS_DESIGN_KEYS) localStorage.removeItem(key);
  } catch {
    // storage blocked
  }
}
