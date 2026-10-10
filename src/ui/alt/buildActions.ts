import { useMemo } from 'react';
import type { Room } from '../../core/schema';
import { buildFileName, buildToFile, designFingerprint, useBuildsStore } from '../../store/buildsStore';
import { resetToNewUser } from '../../store/resetSession';
import { useScenarioStore } from '../../store/scenarioStore';
import { useSceneStore } from '../../store/sceneStore';
import { useUiStore } from '../../store/uiStore';
import { useAltStore } from './altStore';

/**
 * Saving and opening builds. The saved design is the user's own one: while a suggested fix is being
 * previewed, that is the baseline, not the preview.
 */

export function currentRooms(): Room[] {
  const baseline = useScenarioStore.getState().whatIf?.baseline;
  if (baseline) return [...baseline] as Room[];
  const { room, otherRooms } = useSceneStore.getState();
  return [room, ...otherRooms];
}

/** A sensible default name: the room's name for one room, "My home (N rooms)" for a house. */
export function defaultBuildName(): string {
  const rooms = currentRooms();
  return rooms.length === 1 ? rooms[0]!.name : `My home (${rooms.length} rooms)`;
}

const toast = (msg: string) => useUiStore.getState().setToastMessage(msg);

/** Saves as a new build under `name` and makes it the open build. */
export async function saveBuildAs(name: string): Promise<void> {
  const rooms = currentRooms();
  try {
    const b = await useBuildsStore.getState().save(rooms, name);
    useAltStore.getState().setBuild({ id: b.id, name: b.name, fingerprint: designFingerprint(rooms) });
    toast(`Saved "${b.name}"`);
  } catch {
    toast("Couldn't save in this browser. Use Download to keep a copy.");
  }
}

/** Saves over the open build; returns false when there is none yet (ask for a name first). */
export async function saveCurrentBuild(): Promise<boolean> {
  const open = useAltStore.getState().build;
  if (!open) return false;
  const rooms = currentRooms();
  try {
    const b = await useBuildsStore.getState().save(rooms, open.name, open.id);
    useAltStore.getState().setBuild({ id: b.id, name: b.name, fingerprint: designFingerprint(rooms) });
    toast(`Saved "${b.name}"`);
  } catch {
    toast("Couldn't save in this browser. Use Download to keep a copy.");
  }
  return true;
}

/** Whether the design has changes that aren't in its saved build (any design never saved counts). */
export function useUnsaved(): boolean {
  const room = useSceneStore((s) => s.room);
  const otherRooms = useSceneStore((s) => s.otherRooms);
  const whatIf = useScenarioStore((s) => s.whatIf);
  const build = useAltStore((s) => s.build);
  return useMemo(() => {
    if (!build) return true;
    const rooms = whatIf?.baseline ?? [room, ...otherRooms];
    return designFingerprint(rooms) !== build.fingerprint;
  }, [room, otherRooms, whatIf, build]);
}

/** Non-hook check: unsaved changes worth warning about before something replaces the design. */
export function hasUnsavedWork(): boolean {
  const { phase, build } = useAltStore.getState();
  if (phase !== 'design' && phase !== 'results') return false;
  const rooms = currentRooms();
  if (!build) return rooms.length > 1 || rooms.some((r) => r.objects.length > 0 || r.openings.length > 0);
  return designFingerprint(rooms) !== build.fingerprint;
}

/** Asks before discarding unsaved work; true = go ahead. */
export function confirmDiscard(): boolean {
  return !hasUnsavedWork() || window.confirm('Your current design has unsaved changes. Continue without saving them?');
}

/** Opens a design (a saved build, or a file) in Design mode, replacing the current one. */
export function openRooms(rooms: Room[], build: { id: string; name: string } | null): void {
  resetToNewUser();
  useSceneStore.getState().loadRoom(rooms[0]!, rooms.slice(1));
  useSceneStore.temporal.getState().clear();
  useAltStore.setState({
    phase: 'design',
    step: 'rooms',
    project: rooms.length > 1 ? 'house' : 'room',
    build: build ? { ...build, fingerprint: designFingerprint(rooms) } : null,
  });
  window.setTimeout(() => window.dispatchEvent(new CustomEvent('airforce:simulation-view')), 150);
}

/** Downloads the current design as a file. */
export function downloadCurrentBuild(): void {
  const name = useAltStore.getState().build?.name ?? defaultBuildName();
  const url = URL.createObjectURL(buildToFile(name, currentRooms()));
  const a = document.createElement('a');
  a.href = url;
  a.download = buildFileName(name);
  a.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
