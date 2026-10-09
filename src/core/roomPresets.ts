import { getCatalogAsset } from './catalog';
import { polygonBounds } from './parser';
import { ROOM_TYPES } from './rooms';
import type { RoomType, SceneObject, Vec2 } from './schema';

/**
 * Furnished starting layouts for each room type (the basic "Room" stays empty).
 *
 * Coordinates are in the room's own frame at its default size: x runs 0..width (left to right),
 * z runs 0..depth, and z = 0 is the back wall. `rot` is the object's Y rotation; an object's back
 * faces -Z at rot 0, so BACK_TO_* says which wall it stands against.
 */
export interface PresetItem {
  assetId: string;
  x: number;
  z: number;
  rot?: number;
}

const BACK_TO_BACK_WALL = 0;
const BACK_TO_LEFT_WALL = Math.PI / 2;
const BACK_TO_RIGHT_WALL = -Math.PI / 2;
const BACK_TO_FRONT_WALL = Math.PI;

export const ROOM_PRESETS: Record<RoomType, PresetItem[]> = {
  basic: [],
  // 3.6 x 3.2 m
  bedroom: [
    { assetId: 'double-bed', x: 1.8, z: 1.0, rot: BACK_TO_BACK_WALL },
    { assetId: 'nightstand', x: 0.7, z: 0.2, rot: BACK_TO_BACK_WALL },
    { assetId: 'nightstand', x: 2.9, z: 0.2, rot: BACK_TO_BACK_WALL },
    { assetId: 'wardrobe', x: 0.3, z: 2.5, rot: BACK_TO_LEFT_WALL },
    { assetId: 'dresser', x: 3.35, z: 2.5, rot: BACK_TO_RIGHT_WALL },
  ],
  // 5 x 4 m
  living: [
    { assetId: 'rug', x: 2.5, z: 1.55 },
    { assetId: 'sofa-3-seater', x: 2.5, z: 0.45, rot: BACK_TO_BACK_WALL },
    { assetId: 'coffee-table', x: 2.5, z: 1.55 },
    { assetId: 'tv-unit', x: 2.5, z: 3.8, rot: BACK_TO_FRONT_WALL },
    { assetId: 'armchair', x: 0.75, z: 1.55, rot: BACK_TO_LEFT_WALL },
    { assetId: 'bookshelf', x: 4.825, z: 1.0, rot: BACK_TO_RIGHT_WALL },
    { assetId: 'floor-lamp', x: 0.3, z: 0.3 },
    { assetId: 'plant', x: 4.7, z: 3.6 },
  ],
  // 3 x 3 m
  kitchen: [
    { assetId: 'fridge', x: 0.45, z: 0.35, rot: BACK_TO_BACK_WALL },
    { assetId: 'kitchen-sink', x: 1.4, z: 0.3, rot: BACK_TO_BACK_WALL },
    { assetId: 'oven', x: 2.2, z: 0.3, rot: BACK_TO_BACK_WALL },
    { assetId: 'range-hood', x: 2.2, z: 0.25, rot: BACK_TO_BACK_WALL },
    { assetId: 'dishwasher', x: 2.7, z: 1.0, rot: BACK_TO_RIGHT_WALL },
    { assetId: 'kitchen-island', x: 1.4, z: 2.1 },
  ],
  // 3.6 x 3 m
  dining: [
    { assetId: 'sideboard', x: 1.8, z: 0.225, rot: BACK_TO_BACK_WALL },
    { assetId: 'dining-table', x: 1.8, z: 1.6 },
    { assetId: 'dining-chair', x: 1.35, z: 0.85, rot: BACK_TO_BACK_WALL },
    { assetId: 'dining-chair', x: 2.25, z: 0.85, rot: BACK_TO_BACK_WALL },
    { assetId: 'dining-chair', x: 1.35, z: 2.35, rot: BACK_TO_FRONT_WALL },
    { assetId: 'dining-chair', x: 2.25, z: 2.35, rot: BACK_TO_FRONT_WALL },
    { assetId: 'dining-chair', x: 0.65, z: 1.6, rot: BACK_TO_LEFT_WALL },
    { assetId: 'dining-chair', x: 2.95, z: 1.6, rot: BACK_TO_RIGHT_WALL },
    { assetId: 'plant', x: 3.3, z: 2.7 },
  ],
  // 2.4 x 2 m
  bathroom: [
    { assetId: 'bathtub', x: 0.85, z: 0.4, rot: BACK_TO_BACK_WALL },
    { assetId: 'toilet', x: 2.1, z: 0.35, rot: BACK_TO_BACK_WALL },
    { assetId: 'sink-vanity', x: 2.15, z: 1.45, rot: BACK_TO_RIGHT_WALL },
    { assetId: 'washing-machine', x: 0.3, z: 1.7, rot: BACK_TO_FRONT_WALL },
  ],
};

/** Short "what's inside" text for a room type, e.g. "Double bed, 2 nightstands, wardrobe" */
export function presetSummary(type: RoomType): string {
  const counts = new Map<string, number>();
  for (const item of ROOM_PRESETS[type]) {
    const label = getCatalogAsset(item.assetId)?.label ?? item.assetId;
    counts.set(label, (counts.get(label) ?? 0) + 1);
  }
  if (counts.size === 0) return 'Empty';
  const parts = [...counts].map(([label, n]) => (n > 1 ? `${n} ${label.toLowerCase()}s` : label.toLowerCase()));
  const text = parts.join(', ');
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/**
 * The preset's furniture placed into a room at `outline`. When the room was turned a quarter
 * (its width and depth swapped), the whole layout turns with it about the room's centre.
 */
export function buildPresetObjects(type: RoomType, outline: readonly Vec2[], rotated: boolean): SceneObject[] {
  const [w, d] = ROOM_TYPES[type].size;
  const b = polygonBounds(outline);
  const cx = (b.min[0] + b.max[0]) / 2;
  const cz = (b.min[1] + b.max[1]) / 2;
  const turn = rotated ? Math.PI / 2 : 0;
  const stamp = Date.now().toString(36);

  return ROOM_PRESETS[type].flatMap((item, i): SceneObject[] => {
    const def = getCatalogAsset(item.assetId);
    if (!def) return [];
    // Position relative to the room centre, turned with the room (three.js Y rotation)
    const lx = item.x - w / 2;
    const lz = item.z - d / 2;
    const x = cx + lx * Math.cos(turn) + lz * Math.sin(turn);
    const z = cz - lx * Math.sin(turn) + lz * Math.cos(turn);
    return [
      {
        id: `${def.id}-${stamp}-${i}`,
        assetId: def.id,
        name: def.label,
        position: [Number(x.toFixed(4)), 0, Number(z.toFixed(4))],
        rotation: [0, Number(((item.rot ?? 0) + turn).toFixed(4)), 0],
        size: [...def.size],
        scale: [1, 1, 1],
        elevation: def.elevation,
        role: def.role,
        wallMounted: false,
        color: def.color,
        defaultAirflow: def.defaultAirflow,
      },
    ];
  });
}
