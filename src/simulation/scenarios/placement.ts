import type { Room, SceneObject } from '../../core/schema';
import { pointInPolygon, poleOfInaccessibility, signedEdgeDistance } from '../viz/layout';

/** Floor footprint of an object as a rotated rectangle's corners (XZ). */
function footprint(o: SceneObject, pad: number): [number, number][] {
  const sx = o.size[0] * (o.scale?.[0] ?? 1) / 2 + pad;
  const sz = o.size[2] * (o.scale?.[2] ?? 1) / 2 + pad;
  const c = Math.cos(o.rotation[1] ?? 0);
  const s = Math.sin(o.rotation[1] ?? 0);
  return [
    [-sx, -sz],
    [sx, -sz],
    [sx, sz],
    [-sx, sz],
  ].map(([x, z]) => [o.position[0] + x! * c + z! * s, o.position[2] - x! * s + z! * c] as [number, number]);
}

/**
 * A free floor spot for a device of the given half-width in the room: the point nearest the room's
 * visual centre (pole of inaccessibility) that keeps `wallGap` from the walls and clear of every
 * floor-standing object (wall-mounted and elevated objects don't block). Null if the room is full.
 */
export function freeSpot(room: Room, halfWidth: number, opts: { wallGap?: number; ignoreIds?: readonly string[] } = {}): [number, number] | null {
  const wallGap = (opts.wallGap ?? 0.3) + halfWidth;
  const outline = room.outline;
  if (outline.length < 3) return null;
  const blockers = room.objects.filter((o) => !o.wallMounted && (o.elevation ?? 0) < 0.5 && o.role !== 'none' && !opts.ignoreIds?.includes(o.id)).map((o) => footprint(o, halfWidth + 0.05));
  const centre = poleOfInaccessibility(outline).point;
  const xs = outline.map((p) => p[0]);
  const zs = outline.map((p) => p[1]);
  let best: [number, number] | null = null;
  let bestD = Infinity;
  for (let x = Math.min(...xs); x <= Math.max(...xs); x += 0.1)
    for (let z = Math.min(...zs); z <= Math.max(...zs); z += 0.1) {
      const p: [number, number] = [x, z];
      if (signedEdgeDistance(p, outline) < wallGap) continue;
      if (blockers.some((b) => pointInPolygon(p, b))) continue;
      const d = Math.hypot(x - centre[0], z - centre[1]);
      if (d < bestD) {
        bestD = d;
        best = [Math.round(x * 100) / 100, Math.round(z * 100) / 100];
      }
    }
  return best;
}
