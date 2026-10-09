import { computeSmartSnap, normalizeAngleRad } from '../core/smartSnap';
import { useSceneStore } from './sceneStore';

/**
 * Rotates every selected object about its own centre by `deltaRad` (one undo step), then nudges
 * it back inside the walls if the turned footprint would poke through one. Returns how many turned.
 */
export function rotateSelection(deltaRad: number): number {
  const { room, selectedObjectIds, selectedObjectId } = useSceneStore.getState();
  const ids = new Set(selectedObjectIds.length > 0 ? selectedObjectIds : selectedObjectId ? [selectedObjectId] : []);
  const targets = room.objects.filter((o) => ids.has(o.id) && !o.isLocked);
  if (targets.length === 0) return 0;

  const updates = new Map(
    targets.map((o) => {
      const rotY = Number(normalizeAngleRad((o.rotation?.[1] ?? 0) + deltaRad).toFixed(4));
      const { snappedPos } = computeSmartSnap({
        candidatePos: o.position,
        candidateRotY: rotY,
        objectSize: [o.size[0] * (o.scale?.[0] ?? 1), o.size[1] * (o.scale?.[1] ?? 1), o.size[2] * (o.scale?.[2] ?? 1)],
        startPos: o.position,
        room,
        gridStep: 0.1,
        snapEnabled: true,
        ctrlKey: true, // containment only
      });
      return [o.id, { rotY, x: snappedPos[0], z: snappedPos[2] }] as const;
    })
  );

  useSceneStore.setState((state) => {
    for (const obj of state.room.objects) {
      const u = updates.get(obj.id);
      if (!u) continue;
      obj.rotation = [obj.rotation?.[0] ?? 0, u.rotY, obj.rotation?.[2] ?? 0];
      obj.position = [Number(u.x.toFixed(4)), obj.position[1], Number(u.z.toFixed(4))];
    }
  });
  return targets.length;
}
