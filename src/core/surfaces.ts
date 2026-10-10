import { getCatalogAsset } from './catalog';
import { getObjectFootprintCorners } from './collision';
import { pointInPolygon } from './parser';
import type { Room, SceneObject } from './schema';

/**
 * Resting surfaces for pollution sources. A source (incense, stove, candle…) can't hang in the air:
 * it sits on the floor or on top of the furniture under it (a counter, a table, a wardrobe).
 */

/** Below this base height (m) an object counts as standing on the floor, so it can carry things. */
const FLOOR_STANDING_MAX_BASE_M = 0.05;
const EPS = 1e-4;

/** Placed PM2.5 source markers: explicitly tagged, or from the catalogue's Pollution sources. */
export function isPollutionSourceObject(obj: Pick<SceneObject, 'assetId' | 'device'>): boolean {
  if (obj.device) return obj.device === 'pm25Source';
  return getCatalogAsset(obj.assetId)?.category === 'Pollution sources';
}

function baseHeight(obj: SceneObject): number {
  return (obj.position[1] ?? 0) + (obj.elevation ?? 0);
}

/**
 * Height (m above the floor) of the surface at (x, z): the top of the highest floor-standing object
 * whose footprint covers the point, or 0 for the floor. Wall-mounted, hanging and source objects
 * don't carry anything.
 */
export function surfaceHeightAt(room: Pick<Room, 'objects'>, x: number, z: number, excludeId?: string): number {
  let top = 0;
  for (const obj of room.objects) {
    if (obj.id === excludeId || obj.wallMounted || isPollutionSourceObject(obj)) continue;
    if (baseHeight(obj) > FLOOR_STANDING_MAX_BASE_M) continue;
    if (!pointInPolygon([x, z], getObjectFootprintCorners(obj))) continue;
    top = Math.max(top, baseHeight(obj) + obj.size[1] * (obj.scale?.[1] ?? 1));
  }
  return Number(top.toFixed(4));
}

/**
 * Puts every pollution source of the room on the surface under its centre (mutates; immer-safe).
 * Run after anything that can move a source or the furniture under it.
 */
export function settleSources(room: Pick<Room, 'objects'>): void {
  for (const obj of room.objects) {
    if (!isPollutionSourceObject(obj)) continue;
    const h = surfaceHeightAt(room, obj.position[0], obj.position[2], obj.id);
    if (Math.abs(baseHeight(obj) - h) < EPS && Math.abs(obj.position[1]) < EPS) continue;
    obj.position = [obj.position[0], 0, obj.position[2]];
    obj.elevation = h;
  }
}
