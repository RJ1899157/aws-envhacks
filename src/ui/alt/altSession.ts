import { useEffect } from 'react';
import type { Room } from '../../core/schema';
import { useSceneStore } from '../../store/sceneStore';
import { useScenarioStore } from '../../store/scenarioStore';
import { useShowcaseStore } from '../../store/showcaseStore';
import { useAltStore, type AltPhase, type DesignStep, type OpenBuild } from './altStore';

/**
 * Autosave of the design plus where the user was (phase, step), so a reload or a discarded
 * background tab resumes instead of starting over.
 */

const ALT_SESSION_KEY = 'airforce_alt_session_v1';
const SAVE_DEBOUNCE_MS = 400;

export interface AltSession {
  room: Room;
  otherRooms: Room[];
  phase: Extract<AltPhase, 'design' | 'results'>;
  step: DesignStep;
  project: 'room' | 'house';
  /** Saved build being edited, if any */
  build?: OpenBuild | null;
  savedAt: number;
}

export function readAltSession(): AltSession | null {
  try {
    const raw = typeof localStorage === 'undefined' ? null : localStorage.getItem(ALT_SESSION_KEY);
    if (!raw) return null;
    const s = JSON.parse(raw) as AltSession;
    return s && s.room && (s.phase === 'design' || s.phase === 'results') ? s : null;
  } catch {
    return null;
  }
}

export function clearAltSession(): void {
  try {
    localStorage.removeItem(ALT_SESSION_KEY);
  } catch {
    // storage blocked: nothing was saved either
  }
}

/** Writes the current design now; skipped outside Design/Results (start screen, examples). */
export function saveAltSessionNow(): void {
  const { phase, step, project, build } = useAltStore.getState();
  if (phase !== 'design' && phase !== 'results') return;
  if (useShowcaseStore.getState().active) return;
  // While previewing a what-if, the user's own design is the baseline
  const baseline = useScenarioStore.getState().whatIf?.baseline;
  const { room, otherRooms } = useSceneStore.getState();
  const session: AltSession = {
    room: baseline ? baseline[0]! : room,
    otherRooms: baseline ? baseline.slice(1) : otherRooms,
    phase,
    step,
    project,
    build,
    savedAt: Date.now(),
  };
  try {
    localStorage.setItem(ALT_SESSION_KEY, JSON.stringify(session));
  } catch {
    // storage full or blocked: the session lives on in memory only
  }
}

/** Saves on every design or step change (debounced) and at once when the tab is hidden or closed. */
export function useAltSessionAutosave(): void {
  const room = useSceneStore((s) => s.room);
  const otherRooms = useSceneStore((s) => s.otherRooms);
  const phase = useAltStore((s) => s.phase);
  const step = useAltStore((s) => s.step);
  const build = useAltStore((s) => s.build);

  useEffect(() => {
    const id = window.setTimeout(saveAltSessionNow, SAVE_DEBOUNCE_MS);
    return () => window.clearTimeout(id);
  }, [room, otherRooms, phase, step, build]);

  useEffect(() => {
    const flush = () => {
      if (document.visibilityState === 'hidden') saveAltSessionNow();
    };
    document.addEventListener('visibilitychange', flush);
    window.addEventListener('pagehide', saveAltSessionNow);
    return () => {
      document.removeEventListener('visibilitychange', flush);
      window.removeEventListener('pagehide', saveAltSessionNow);
    };
  }, []);
}
