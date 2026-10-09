import { pointInPolygon, polygonBounds } from '../core/parser';
import type { SceneObject } from '../core/schema';
import { computeSmartSnap } from '../core/smartSnap';
import { useSceneStore } from './sceneStore';

/** In-app clipboard for placed objects (Cmd/Ctrl + C / X / V). */
let clipboard: { objects: SceneObject[]; sourceRoomId: string | undefined } | null = null;
let pasteCount = 0;

const PASTE_STEP = 0.3;

function selectedObjects(): SceneObject[] {
  const { room, selectedObjectIds, selectedObjectId } = useSceneStore.getState();
  const ids = selectedObjectIds.length > 0 ? selectedObjectIds : selectedObjectId ? [selectedObjectId] : [];
  return room.objects.filter((o) => ids.includes(o.id));
}

export function hasClipboard(): boolean {
  return Boolean(clipboard && clipboard.objects.length > 0);
}

/** Copies the selected objects; returns how many were copied. */
export function copySelection(): number {
  const objects = selectedObjects();
  if (objects.length === 0) return 0;
  clipboard = { objects: structuredClone(objects), sourceRoomId: useSceneStore.getState().room.id };
  pasteCount = 0;
  return objects.length;
}

/** Copies then deletes the selected objects (one undo step for the delete). */
export function cutSelection(): number {
  const count = copySelection();
  if (count > 0) useSceneStore.getState().deleteSelected();
  return count;
}

/**
 * Pastes the clipboard into the active room, keeping the copied objects' arrangement.
 * With `at` (the floor point under the mouse), the group is centred there and lands in whichever
 * room that point is in; otherwise each paste steps 30 cm further from the originals.
 * Every pasted object is kept inside the walls. Returns how many were pasted.
 */
export function pasteClipboard(at?: [number, number] | null): number {
  if (!clipboard || clipboard.objects.length === 0) return 0;
  const store = useSceneStore.getState();

  if (at) {
    const target = store.otherRooms.find((r) => pointInPolygon(at, r.outline));
    if (target?.id) store.setActiveRoom(target.id);
  }
  const room = useSceneStore.getState().room;
  const source = clipboard.objects;

  const cx = source.reduce((s, o) => s + o.position[0], 0) / source.length;
  const cz = source.reduce((s, o) => s + o.position[2], 0) / source.length;

  let dx: number;
  let dz: number;
  if (at) {
    [dx, dz] = [at[0] - cx, at[1] - cz];
  } else if (clipboard.sourceRoomId === room.id) {
    pasteCount++;
    dx = dz = PASTE_STEP * pasteCount;
  } else {
    const b = polygonBounds(room.outline);
    [dx, dz] = [(b.min[0] + b.max[0]) / 2 - cx, (b.min[1] + b.max[1]) / 2 - cz];
  }

  const stamp = Date.now().toString(36);
  const pasted: SceneObject[] = source.map((o, i) => {
    const candidate: [number, number, number] = [o.position[0] + dx, o.position[1], o.position[2] + dz];
    const { snappedPos } = computeSmartSnap({
      candidatePos: candidate,
      candidateRotY: o.rotation?.[1] ?? 0,
      objectSize: [o.size[0] * (o.scale?.[0] ?? 1), o.size[1] * (o.scale?.[1] ?? 1), o.size[2] * (o.scale?.[2] ?? 1)],
      startPos: candidate,
      room,
      gridStep: 0.1,
      snapEnabled: true,
      ctrlKey: true, // keep the exact arrangement; only push back inside the walls
    });
    return {
      ...structuredClone(o),
      id: `${o.assetId}-${stamp}-${i}-${Math.random().toString(36).slice(2, 6)}`,
      position: [Number(snappedPos[0].toFixed(4)), o.position[1], Number(snappedPos[2].toFixed(4))],
    };
  });

  useSceneStore.setState((state) => {
    state.room.objects.push(...pasted);
    state.selectedObjectIds = pasted.map((o) => o.id);
    state.selectedObjectId = pasted[0]?.id ?? null;
    state.selectedOpeningId = null;
    state.selectedOpeningIds = [];
  });
  return pasted.length;
}
