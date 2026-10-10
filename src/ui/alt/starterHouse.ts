import { createDefaultRoom } from '../../core/defaultRoom';
import { ROOM_TYPES, generateRoomId } from '../../core/rooms';
import { RoomSchema, type Opening, type Room, type RoomType } from '../../core/schema';

/**
 * A starter floor plan for "My whole house": the chosen rooms laid out in two
 * rows (living areas in front, bedrooms and bathrooms behind), one wall thickness apart so shared
 * walls are detected, with an open interior door joining every room to the rest and a closed front
 * door. Windows are left to the user (the Doors & windows step).
 */

export type HouseCounts = Partial<Record<Exclude<RoomType, 'basic'>, number>>;

const T = 0.15;
const H = 2.7;
const DOOR_W = 0.9;
const DOOR_H = 2.1;

const FRONT: RoomType[] = ['living', 'dining', 'kitchen'];
const BACK: RoomType[] = ['bedroom', 'bathroom'];

let doorCount = 0;
function door(wallIndex: number, offset: number, extra: Partial<Opening> = {}): Opening {
  return {
    id: `door-${Date.now().toString(36)}-${doorCount++}`,
    wallIndex,
    type: 'door',
    subType: 'single-door',
    offset: Math.max(0.1, offset),
    width: DOOR_W,
    height: DOOR_H,
    sill: 0,
    role: 'outlet',
    openFraction: 1,
    ...extra,
  };
}

interface Placed {
  type: RoomType;
  name: string;
  x0: number;
  z0: number;
  w: number;
  d: number;
  openings: Opening[];
}

function layoutRow(types: RoomType[], z0: number, names: Map<RoomType, number>): Placed[] {
  const depth = Math.max(...types.map((t) => ROOM_TYPES[t].size[1]));
  let x = 0;
  return types.map((type) => {
    const n = (names.get(type) ?? 0) + 1;
    names.set(type, n);
    const w = ROOM_TYPES[type].size[0];
    const placed: Placed = { type, name: n === 1 ? ROOM_TYPES[type].label : `${ROOM_TYPES[type].label} ${n}`, x0: x, z0, w, d: depth, openings: [] };
    x += w + T;
    return placed;
  });
}

export function createStarterHouse(counts: HouseCounts): Room[] {
  const expand = (types: RoomType[]) => types.flatMap((t) => Array.from({ length: Math.max(0, counts[t as keyof HouseCounts] ?? 0) }, () => t));
  let front = expand(FRONT);
  const back = expand(BACK);
  if (front.length === 0) front = back.length > 0 ? [back.shift()!] : ['living'];
  const names = new Map<RoomType, number>();
  const row1 = layoutRow(front, 0, names);
  const row2 = back.length > 0 ? layoutRow(back, row1[0]!.d + T, names) : [];

  // Outline walls run 0: −Z side (x0→x1), 1: +X side, 2: +Z side, 3: −X side (z1→z0)
  for (let i = 0; i < row1.length - 1; i++) {
    const r = row1[i]!;
    r.openings.push(door(1, (r.d - DOOR_W) / 2));
  }
  for (let i = 0; i < row2.length; i++) {
    const r = row2[i]!;
    // The front room sharing the longest stretch of this room's front wall
    let best: [number, number] | null = null;
    for (const f of row1) {
      const lo = Math.max(r.x0, f.x0);
      const hi = Math.min(r.x0 + r.w, f.x0 + f.w);
      if (hi - lo > (best ? best[1] - best[0] : 0)) best = [lo, hi];
    }
    if (best && best[1] - best[0] >= DOOR_W + 0.2) {
      // Into the front row, centred on that shared stretch
      r.openings.push(door(0, (best[0] + best[1]) / 2 - r.x0 - DOOR_W / 2));
    } else {
      r.openings.push(door(3, (r.d - DOOR_W) / 2));
    }
  }
  // Front door of the house, closed
  row1[0]!.openings.push(door(0, 0.3, { role: 'closed', openFraction: 0 }));

  const params = createDefaultRoom().params;
  return [...row1, ...row2].map((p) =>
    RoomSchema.parse({
      version: 1,
      id: generateRoomId(),
      type: p.type,
      name: p.name,
      wallHeight: H,
      wallThickness: T,
      outline: [
        [p.x0, p.z0],
        [p.x0 + p.w, p.z0],
        [p.x0 + p.w, p.z0 + p.d],
        [p.x0, p.z0 + p.d],
      ],
      openings: p.openings,
      objects: [],
      params,
      floorMaterial: p.type === 'bathroom' || p.type === 'kitchen' ? 'tile' : 'wood',
    })
  );
}

/** A single empty room of the given type, centred on the origin. */
export function createSingleRoom(type: RoomType): Room {
  const [w, d] = ROOM_TYPES[type].size;
  return RoomSchema.parse({
    version: 1,
    id: generateRoomId(),
    type,
    name: ROOM_TYPES[type].label,
    wallHeight: H,
    wallThickness: T,
    outline: [
      [-w / 2, -d / 2],
      [w / 2, -d / 2],
      [w / 2, d / 2],
      [-w / 2, d / 2],
    ],
    openings: [],
    objects: [],
    params: createDefaultRoom().params,
    floorMaterial: type === 'bathroom' || type === 'kitchen' ? 'tile' : 'wood',
  });
}
