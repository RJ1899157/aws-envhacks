import { polygonBounds, wallSegment } from './parser';
import { RoomSchema, type Opening, type Room, type RoomType, type Vec2 } from './schema';

export interface RoomTypeInfo {
  label: string;
  /** Default floor size [width (X), depth (Z)] in meters */
  size: [number, number];
  /** Asset library category opened first for this room type ('All' = no preference) */
  assetCategory: string;
}

export const ROOM_TYPES: Record<RoomType, RoomTypeInfo> = {
  basic: { label: 'Room', size: [4, 3], assetCategory: 'All' },
  bedroom: { label: 'Bedroom', size: [3.6, 3.2], assetCategory: 'Bedroom' },
  living: { label: 'Living Room', size: [5, 4], assetCategory: 'Living' },
  kitchen: { label: 'Kitchen', size: [3, 3], assetCategory: 'Kitchen' },
  dining: { label: 'Dining Room', size: [3.6, 3], assetCategory: 'Dining' },
  bathroom: { label: 'Bathroom', size: [2.4, 2], assetCategory: 'Bathroom' },
};

export const ROOM_TYPE_ORDER: RoomType[] = ['basic', 'bedroom', 'living', 'kitchen', 'dining', 'bathroom'];

export function roomTypeOf(room: Room): RoomType {
  return room.type ?? 'basic';
}

export function generateRoomId(): string {
  return `room-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
}

export function withRoomId(room: Room): Room {
  return room.id ? room : { ...room, id: generateRoomId() };
}

function uniqueRoomName(base: string, rooms: readonly Room[]): string {
  const names = new Set(rooms.map((r) => r.name));
  if (!names.has(base)) return base;
  let n = 2;
  while (names.has(`${base} ${n}`)) n++;
  return `${base} ${n}`;
}

/** Bounds of every room's outline combined. */
function combinedBounds(rooms: readonly Room[]) {
  let minX = Infinity;
  let minZ = Infinity;
  let maxX = -Infinity;
  let maxZ = -Infinity;
  for (const r of rooms) {
    const b = polygonBounds(r.outline);
    minX = Math.min(minX, b.min[0]);
    minZ = Math.min(minZ, b.min[1]);
    maxX = Math.max(maxX, b.max[0]);
    maxZ = Math.max(maxZ, b.max[1]);
  }
  return { minX, minZ, maxX, maxZ };
}

/**
 * Creates an empty rectangular room of the given type, placed to the right (+X) of all existing
 * rooms with exactly one wall thickness between outlines, so the touching walls coincide.
 */
export function createRoomOfType(type: RoomType, existing: readonly Room[], anchor?: Room): Room {
  const info = ROOM_TYPES[type];
  const [w, d] = info.size;
  const template = anchor ?? existing[0];
  const wallThickness = template?.wallThickness ?? 0.15;
  const wallHeight = template?.wallHeight ?? 2.7;

  let minX = -w / 2;
  let minZ = -d / 2;
  if (existing.length > 0) {
    const all = combinedBounds(existing);
    minX = all.maxX + wallThickness;
    minZ = anchor ? polygonBounds(anchor.outline).min[1] : all.minZ;
  }
  const outline: Vec2[] = [
    [minX, minZ],
    [minX + w, minZ],
    [minX + w, minZ + d],
    [minX, minZ + d],
  ];

  return RoomSchema.parse({
    version: 1,
    id: generateRoomId(),
    type,
    name: uniqueRoomName(info.label, existing),
    wallHeight,
    wallThickness,
    outline,
    openings: [],
    objects: [],
    params: template?.params,
    floorMaterial: type === 'bathroom' || type === 'kitchen' ? 'tile' : (template?.floorMaterial ?? 'wood'),
    wallMaterial: template?.wallMaterial ?? 'paint',
  });
}

export interface SharedWallOpening {
  id: string;
  offset: number;
  width: number;
  height: number;
  sill: number;
  /** The neighbour's own role and how far open it is */
  role: Opening['role'];
  openFraction: number;
}

const SHARED_WALL_TOLERANCE = 0.03;

/**
 * Openings that belong to neighbouring rooms but sit on a wall shared with `room`'s wall
 * `wallIndex` (antiparallel walls exactly one wall-thickness apart), mapped into this wall's
 * offsets. Used to cut the matching hole so a door between two rooms goes through both walls.
 */
export function sharedWallOpenings(room: Room, wallIndex: number, others: readonly Room[]): SharedWallOpening[] {
  const seg = wallSegment(room, wallIndex);
  if (seg.len < 1e-6) return [];
  const result: SharedWallOpening[] = [];

  for (const other of others) {
    if (other.openings.length === 0) continue;
    for (const op of other.openings) {
      const oseg = wallSegment(other, op.wallIndex);
      const antiparallel = seg.dir[0] * oseg.dir[0] + seg.dir[1] * oseg.dir[1] < -0.999;
      if (!antiparallel) continue;
      // The other wall's line must sit one wall thickness outside ours
      const gap = (oseg.a[0] - seg.a[0]) * seg.normal[0] + (oseg.a[1] - seg.a[1]) * seg.normal[1];
      if (Math.abs(gap - room.wallThickness) > SHARED_WALL_TOLERANCE) continue;

      const startX = oseg.a[0] + op.offset * oseg.dir[0];
      const startZ = oseg.a[1] + op.offset * oseg.dir[1];
      const t1 = (startX - seg.a[0]) * seg.dir[0] + (startZ - seg.a[1]) * seg.dir[1];
      const t2 = t1 - op.width; // walls run in opposite directions
      const lo = Math.max(0, Math.min(t1, t2));
      const hi = Math.min(seg.len, Math.max(t1, t2));
      if (hi - lo < 1e-3) continue;
      result.push({
        id: `shared-${op.id}`,
        offset: lo,
        width: hi - lo,
        height: op.height,
        sill: op.sill,
        role: op.role,
        openFraction: op.openFraction,
      });
    }
  }
  return result;
}

const ROOM_SNAP_DISTANCE = 0.3;

/**
 * Adjusts a room-move delta so the moved room's bounding box lands flush against neighbouring
 * rooms (one wall thickness apart) or aligned with their edges, when within 0.3 m.
 */
export function snapRoomMove(
  outline: readonly Vec2[],
  delta: Vec2,
  others: readonly Room[],
  wallThickness: number
): Vec2 {
  if (others.length === 0) return delta;
  const b = polygonBounds(outline);
  const moved = {
    minX: b.min[0] + delta[0],
    maxX: b.max[0] + delta[0],
    minZ: b.min[1] + delta[1],
    maxZ: b.max[1] + delta[1],
  };

  let bestX: number | null = null;
  let bestZ: number | null = null;
  const consider = (current: number | null, shift: number) =>
    Math.abs(shift) <= ROOM_SNAP_DISTANCE && (current === null || Math.abs(shift) < Math.abs(current)) ? shift : current;

  for (const other of others) {
    const ob = polygonBounds(other.outline);
    const overlapsZ = moved.minZ < ob.max[1] + ROOM_SNAP_DISTANCE && moved.maxZ > ob.min[1] - ROOM_SNAP_DISTANCE;
    const overlapsX = moved.minX < ob.max[0] + ROOM_SNAP_DISTANCE && moved.maxX > ob.min[0] - ROOM_SNAP_DISTANCE;
    if (overlapsZ) {
      bestX = consider(bestX, ob.max[0] + wallThickness - moved.minX); // sit to the right
      bestX = consider(bestX, ob.min[0] - wallThickness - moved.maxX); // sit to the left
    }
    if (overlapsX) {
      bestZ = consider(bestZ, ob.max[1] + wallThickness - moved.minZ);
      bestZ = consider(bestZ, ob.min[1] - wallThickness - moved.maxZ);
    }
    // Edge alignment along the shared wall
    if (overlapsX) {
      bestX = consider(bestX, ob.min[0] - moved.minX);
      bestX = consider(bestX, ob.max[0] - moved.maxX);
    }
    if (overlapsZ) {
      bestZ = consider(bestZ, ob.min[1] - moved.minZ);
      bestZ = consider(bestZ, ob.max[1] - moved.maxZ);
    }
  }
  return [delta[0] + (bestX ?? 0), delta[1] + (bestZ ?? 0)];
}

/** The room's min corner: the snapping grid is measured from here so grid lines start at the walls. */
export function roomGridOrigin(room: Pick<Room, 'outline'>): [number, number] {
  const b = polygonBounds(room.outline);
  return [b.min[0], b.min[1]];
}

/**
 * Adjusts a perpendicular wall move (delta along the wall's outward normal) so the wall snaps
 * flush to a facing wall of a neighbouring room (one wall thickness apart) within 0.3 m, and never
 * pushes into that neighbour. Only facing walls that overlap along the wall's span are considered.
 */
export function snapWallMove(
  outline: readonly Vec2[],
  wallIndex: number,
  delta: number,
  others: readonly Room[],
  wallThickness: number
): number {
  const seg = wallSegment({ outline }, wallIndex);
  if (seg.len < 1e-6) return delta;
  let limit = Infinity; // furthest the wall may move before entering a neighbour
  let bestSnap: number | null = null;

  for (const other of others) {
    for (let i = 0; i < other.outline.length; i++) {
      const oseg = wallSegment(other, i);
      if (seg.dir[0] * oseg.dir[0] + seg.dir[1] * oseg.dir[1] > -0.999) continue; // must face us
      // Overlap along our wall direction
      const t1 = (oseg.a[0] - seg.a[0]) * seg.dir[0] + (oseg.a[1] - seg.a[1]) * seg.dir[1];
      const t2 = (oseg.b[0] - seg.a[0]) * seg.dir[0] + (oseg.b[1] - seg.a[1]) * seg.dir[1];
      if (Math.max(t1, t2) <= 1e-3 || Math.min(t1, t2) >= seg.len - 1e-3) continue;
      // Distance from our wall line to theirs along our outward normal
      const dist = (oseg.a[0] - seg.a[0]) * seg.normal[0] + (oseg.a[1] - seg.a[1]) * seg.normal[1];
      if (dist < wallThickness - 0.05) continue; // behind us, not a neighbour we'd run into
      const flushDelta = dist - wallThickness;
      limit = Math.min(limit, flushDelta);
      if (Math.abs(delta - flushDelta) <= ROOM_SNAP_DISTANCE && (bestSnap === null || Math.abs(delta - flushDelta) < Math.abs(delta - bestSnap))) {
        bestSnap = flushDelta;
      }
    }
  }
  return Math.min(bestSnap ?? delta, limit);
}

/** Axis-aligned rectangle outline (counter-clockwise like every room outline) */
export function rectOutline(minX: number, minZ: number, width: number, depth: number): Vec2[] {
  return [
    [minX, minZ],
    [minX + width, minZ],
    [minX + width, minZ + depth],
    [minX, minZ + depth],
  ];
}

/**
 * True if a room at `outline` would collide with an existing room: their footprints, including
 * the wall thickness between them, overlap. Rooms sitting exactly one wall apart are fine.
 */
export function roomOverlapsOthers(outline: readonly Vec2[], others: readonly Room[], wallThickness: number): boolean {
  const b = polygonBounds(outline);
  const gap = wallThickness - 1e-3;
  return others.some((r) => {
    const o = polygonBounds(r.outline);
    return b.min[0] < o.max[0] + gap && b.max[0] > o.min[0] - gap && b.min[1] < o.max[1] + gap && b.max[1] > o.min[1] - gap;
  });
}

// ---------------------------------------------------------------------------
// Dividing a room with a wall
// ---------------------------------------------------------------------------

/** Keeps the part of a polygon on one side of the line coordinate[axis] = limit (Sutherland–Hodgman). */
function clipHalf(poly: readonly Vec2[], axis: 0 | 1, limit: number, keepBelow: boolean): Vec2[] {
  const inside = (p: Vec2) => (keepBelow ? p[axis] <= limit + 1e-9 : p[axis] >= limit - 1e-9);
  const cross = (a: Vec2, b: Vec2): Vec2 => {
    const t = (limit - a[axis]) / (b[axis] - a[axis]);
    return [a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1])];
  };
  const out: Vec2[] = [];
  for (let i = 0; i < poly.length; i++) {
    const cur = poly[i]!;
    const prev = poly[(i + poly.length - 1) % poly.length]!;
    if (inside(cur)) {
      if (!inside(prev)) out.push(cross(prev, cur));
      out.push(cur);
    } else if (inside(prev)) out.push(cross(prev, cur));
  }
  return tidyOutline(out);
}

/** Drops repeated and collinear vertices (rounded to 0.1 mm). */
function tidyOutline(poly: Vec2[]): Vec2[] {
  let pts = poly.map(([x, z]) => [Number(x.toFixed(4)), Number(z.toFixed(4))] as Vec2);
  pts = pts.filter((p, i) => {
    const q = pts[(i + 1) % pts.length]!;
    return Math.hypot(p[0] - q[0], p[1] - q[1]) > 1e-4;
  });
  let changed = true;
  while (changed && pts.length > 3) {
    changed = false;
    for (let i = 0; i < pts.length; i++) {
      const a = pts[(i + pts.length - 1) % pts.length]!;
      const b = pts[i]!;
      const c = pts[(i + 1) % pts.length]!;
      if (Math.abs((b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])) < 1e-6) {
        pts.splice(i, 1);
        changed = true;
        break;
      }
    }
  }
  return pts;
}

/** How many times the line coordinate[axis] = at crosses the outline. */
function crossings(poly: readonly Vec2[], axis: 0 | 1, at: number): number {
  let n = 0;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i]![axis];
    const b = poly[(i + 1) % poly.length]![axis];
    if ((a < at && b > at) || (a > at && b < at)) n++;
  }
  return n;
}

const polyArea = (p: readonly Vec2[]) => Math.abs(p.reduce((s, a, i) => { const b = p[(i + 1) % p.length]!; return s + a[0] * b[1] - b[0] * a[1]; }, 0)) / 2;

/** Wall of `room` that the stretch [u0, u1] along a world line through p (direction d) lies on, with the offset of u0. */
function wallOnLine(room: Pick<Room, 'outline'>, p: Vec2, d: Vec2, halfWidth: number): { wallIndex: number; offset: number } | null {
  for (let i = 0; i < room.outline.length; i++) {
    const seg = wallSegment(room, i);
    const parallel = Math.abs(seg.dir[0] * d[1] - seg.dir[1] * d[0]) < 1e-6;
    if (!parallel) continue;
    const dist = Math.abs((p[0] - seg.a[0]) * seg.normal[0] + (p[1] - seg.a[1]) * seg.normal[1]);
    if (dist > 0.01) continue;
    const u = (p[0] - seg.a[0]) * seg.dir[0] + (p[1] - seg.a[1]) * seg.dir[1];
    if (u - halfWidth < -1e-3 || u + halfWidth > seg.len + 1e-3) continue;
    return { wallIndex: i, offset: Math.max(0, u - halfWidth) };
  }
  return null;
}

export type DivideResult = { ok: true; first: Room; second: Room } | { ok: false; reason: string };

/**
 * Splits a room with a wall along x = at (axis 'x') or z = at (axis 'z'). The two parts sit one wall
 * thickness apart, so the new wall is a shared wall that takes a door like any other. Furniture
 * goes with the part its centre is in; windows and doors stay on their walls when they still fit.
 */
export function divideRoom(room: Room, axis: 'x' | 'z', at: number, existing: readonly Room[]): DivideResult {
  const ax: 0 | 1 = axis === 'x' ? 0 : 1;
  const half = room.wallThickness / 2;
  if (crossings(room.outline, ax, at) !== 2) return { ok: false, reason: 'A dividing wall here would cross the room more than once.' };
  const a = clipHalf(room.outline, ax, at - half, true);
  const b = clipHalf(room.outline, ax, at + half, false);
  if (a.length < 3 || b.length < 3 || polyArea(a) < 1 || polyArea(b) < 1) return { ok: false, reason: 'Each part needs at least 1 m² of floor.' };

  const parts = [a, b].map((outline) => ({ outline, openings: [] as Opening[] }));
  for (const op of room.openings) {
    const seg = wallSegment(room, op.wallIndex);
    const u = op.offset + op.width / 2;
    const p: Vec2 = [seg.a[0] + seg.dir[0] * u, seg.a[1] + seg.dir[1] * u];
    for (const part of parts) {
      const hit = wallOnLine({ outline: part.outline }, p, seg.dir, op.width / 2);
      if (hit) {
        part.openings.push({ ...op, wallIndex: hit.wallIndex, offset: Number(hit.offset.toFixed(4)) });
        break;
      }
    }
  }
  const side = (x: number) => x < at;
  const objectsA = room.objects.filter((o) => side(o.position[ax === 0 ? 0 : 2]));
  const objectsB = room.objects.filter((o) => !side(o.position[ax === 0 ? 0 : 2]));
  const base = { ...room, wallOverrides: undefined };
  const first = RoomSchema.parse({ ...base, outline: parts[0]!.outline, openings: parts[0]!.openings, objects: objectsA });
  const second = RoomSchema.parse({
    ...base,
    id: generateRoomId(),
    name: uniqueRoomName(`${room.name} 2`, [room, ...existing]),
    outline: parts[1]!.outline,
    openings: parts[1]!.openings,
    objects: objectsB,
    scenarios: undefined,
  });
  return { ok: true, first, second };
}
