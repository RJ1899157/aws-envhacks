import { useEffect, useRef, useState } from 'react';
import { useSceneStore } from './sceneStore';
import { useScenarioStore } from './scenarioStore';
import { useShowcaseStore } from './showcaseStore';
import type { Room } from '../core/types';

export const AUTOSAVE_STORAGE_KEY = 'airforce_autosave_room_v1';
export const AUTOSAVE_DEBOUNCE_MS = 500;

export interface AutosaveData {
  room: Room;
  otherRooms?: Room[];
  savedAt: number;
}

export function getAutosavedSession(): AutosaveData | null {
  if (typeof localStorage === 'undefined') return null;
  try {
    const raw = localStorage.getItem(AUTOSAVE_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (parsed && parsed.room && typeof parsed.savedAt === 'number') {
      return parsed as AutosaveData;
    }
    return null;
  } catch {
    return null;
  }
}

export function saveSessionToStorage(room: Room, otherRooms: Room[] = []): void {
  if (typeof localStorage === 'undefined') return;
  try {
    const data: AutosaveData = {
      room,
      otherRooms,
      savedAt: Date.now(),
    };
    localStorage.setItem(AUTOSAVE_STORAGE_KEY, JSON.stringify(data));
  } catch {
    // ignore storage quota / private browsing errors
  }
}

export function clearAutosavedSession(): void {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.removeItem(AUTOSAVE_STORAGE_KEY);
  } catch {
    // ignore
  }
}

/**
 * Hook to manage localStorage autosaving (debounced 500ms)
 * and provide pending session restoration on load.
 */
export function useAutosave() {
  const room = useSceneStore((state) => state.room);
  const otherRooms = useSceneStore((state) => state.otherRooms);
  const loadRoom = useSceneStore((state) => state.loadRoom);

  const [pendingRestore, setPendingRestore] = useState<AutosaveData | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isInitialMount = useRef(true);

  // Check for previous autosaved session on initial mount
  useEffect(() => {
    const saved = getAutosavedSession();
    if (saved && saved.room) {
      // Check if saved room is non-trivial or differs from default
      setPendingRestore(saved);
    }
  }, []);

  // Debounced autosave whenever room changes
  useEffect(() => {
    if (isInitialMount.current) {
      isInitialMount.current = false;
      return;
    }

    if (timerRef.current) {
      clearTimeout(timerRef.current);
    }

    timerRef.current = setTimeout(() => {
      // In what-if mode or an example the live rooms are a scratch copy: keep saving the user's design
      const example = useShowcaseStore.getState().saved;
      const baseline = useScenarioStore.getState().whatIf?.baseline;
      if (example) saveSessionToStorage(example.room, example.otherRooms);
      else if (baseline) saveSessionToStorage(baseline[0]!, baseline.slice(1));
      else saveSessionToStorage(room, otherRooms);
    }, AUTOSAVE_DEBOUNCE_MS);

    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
      }
    };
  }, [room, otherRooms]);

  const restoreSession = () => {
    if (pendingRestore?.room) {
      loadRoom(pendingRestore.room, pendingRestore.otherRooms ?? []);
      setPendingRestore(null);
    }
  };

  const dismissRestore = () => {
    setPendingRestore(null);
  };

  return {
    pendingRestore,
    restoreSession,
    dismissRestore,
  };
}
