import { wallSegment } from './parser';
import type { Room, SceneObject, Vec3 } from './schema';
import { degToRad, snap } from './units';

export interface AlignmentGuide {
  start: Vec3;
  end: Vec3;
  type: 'wall' | 'object';
}

export interface SmartSnapParams {
  candidatePos: Vec3;
  candidateRotY: number;
  objectSize: Vec3; // [W, H, D]
  startPos: Vec3;
  room: Room;
  objectId?: string;
  gridStep: number;
  /** World point the grid lattice is measured from (e.g. the room's min corner); default origin */
  gridOrigin?: readonly [number, number];
  snapEnabled: boolean;
  ctrlKey?: boolean;
  shiftKey?: boolean;
  autoOrientToWall?: boolean;
  transformY?: boolean;
}

export interface SmartSnapResult {
  snappedPos: Vec3;
  snappedRotY: number;
  isWallSnapped: boolean;
  isObjectSnapped: boolean;
  alignmentGuides: AlignmentGuide[];
}

/** Edges within this distance of a wall's inner face are pulled flush against it. */
export const WALL_MAGNET_DISTANCE = 0.2;
const OBJECT_SNAP_DISTANCE = 0.1;

/**
 * Normalizes an angle in radians to [-PI, PI] range
 */
export function normalizeAngleRad(angle: number): number {
  let a = angle % (2 * Math.PI);
  if (a > Math.PI) a -= 2 * Math.PI;
  if (a < -Math.PI) a += 2 * Math.PI;
  return a;
}

/** Half-extent of a footprint (half-width hw, half-depth hd, rotated by rotY about Y) along unit direction n. */
function footprintExtent(n: readonly [number, number], hw: number, hd: number, rotY: number): number {
  const c = Math.cos(rotY);
  const s = Math.sin(rotY);
  // Local X maps to (c, -s) and local Z to (s, c) on the XZ plane.
  return hw * Math.abs(n[0] * c - n[1] * s) + hd * Math.abs(n[0] * s + n[1] * c);
}

function aabbHalfExtents(hw: number, hd: number, rotY: number): [number, number] {
  return [footprintExtent([1, 0], hw, hd, rotY), footprintExtent([0, 1], hw, hd, rotY)];
}

function objectHalfExtents(o: SceneObject): [number, number] {
  const hw = (o.size[0] * (o.scale?.[0] ?? 1)) / 2;
  const hd = (o.size[2] * (o.scale?.[2] ?? 1)) / 2;
  return aabbHalfExtents(hw, hd, o.rotation?.[1] ?? 0);
}

/**
 * Keeps the footprint inside the room: any wall it penetrates pushes it back out, and when
 * `magnet` is set, edges within that distance of a wall are pulled flush against it.
 * Returns the wall indices the footprint ends up flush against.
 */
function resolveWalls(
  room: Room,
  pos: { x: number; z: number },
  hw: number,
  hd: number,
  rotY: number,
  magnet: number | null
): number[] {
  const flush = new Set<number>();
  const n = room.outline.length;
  if (n < 3) return [];

  // Two passes so a push out of one wall can't leave the footprint inside its neighbour.
  for (let pass = 0; pass < 2; pass++) {
    for (let i = 0; i < n; i++) {
      const seg = wallSegment(room, i);
      if (seg.len < 1e-6) continue;

      const relX = pos.x - seg.a[0];
      const relZ = pos.z - seg.a[1];
      const along = relX * seg.dir[0] + relZ * seg.dir[1];
      const alongExtent = footprintExtent(seg.dir, hw, hd, rotY);
      // Ignore walls the footprint doesn't sit alongside (e.g. the far side of an L-shaped room).
      if (along + alongExtent <= 1e-4 || along - alongExtent >= seg.len - 1e-4) continue;

      const inward: [number, number] = [-seg.normal[0], -seg.normal[1]];
      const distInside = relX * inward[0] + relZ * inward[1];
      const gap = distInside - footprintExtent(seg.normal, hw, hd, rotY);

      const penetrating = gap < -1e-6;
      const magnetic = magnet !== null && gap <= magnet;
      if (penetrating || magnetic) {
        pos.x -= gap * inward[0];
        pos.z -= gap * inward[1];
        if (magnet !== null) flush.add(i);
      }
    }
  }
  return [...flush];
}

/**
 * Footprint-aware snapping for placing and moving objects:
 * - Object edges (not centres) land on grid lines, accounting for rotation
 * - Edges within WALL_MAGNET_DISTANCE of a wall snap flush to it, so corners catch both walls
 * - The footprint can never penetrate a wall, even with snapping disabled
 * - Edges/centres align to other objects within 0.1 m, with cyan guide lines
 * - Ctrl disables snapping, Shift constrains to the dominant axis
 * - Optional auto-orient to face away from the nearest wall
 */
export function computeSmartSnap(params: SmartSnapParams): SmartSnapResult {
  const {
    candidatePos,
    candidateRotY,
    objectSize,
    startPos,
    room,
    objectId,
    gridStep,
    gridOrigin = [0, 0],
    snapEnabled,
    ctrlKey = false,
    shiftKey = false,
    autoOrientToWall = false,
    transformY = false,
  } = params;

  let x = candidatePos[0];
  let y = candidatePos[1];
  let z = candidatePos[2];
  let rotY = candidateRotY;
  const hw = objectSize[0] / 2;
  const hd = objectSize[2] / 2;

  if (shiftKey) {
    const dx = Math.abs(x - startPos[0]);
    const dz = Math.abs(z - startPos[2]);
    if (dx >= dz) z = startPos[2];
    else x = startPos[0];
  }

  if (ctrlKey || !snapEnabled) {
    const pos = { x, z };
    resolveWalls(room, pos, hw, hd, rotY, null);
    const clampedY = Math.max(0, Math.min(room.wallHeight, y));
    return {
      snappedPos: [Number(pos.x.toFixed(4)), Number(clampedY.toFixed(4)), Number(pos.z.toFixed(4))],
      snappedRotY: rotY,
      isWallSnapped: false,
      isObjectSnapped: false,
      alignmentGuides: [],
    };
  }

  // 1. Rotation: face away from the nearest magnetic wall, otherwise 15° steps
  let autoOriented = false;
  if (autoOrientToWall) {
    let best = Infinity;
    for (let i = 0; i < room.outline.length; i++) {
      const seg = wallSegment(room, i);
      const relX = x - seg.a[0];
      const relZ = z - seg.a[1];
      const along = relX * seg.dir[0] + relZ * seg.dir[1];
      if (along < -hw || along > seg.len + hw) continue;
      const gap = -(relX * seg.normal[0] + relZ * seg.normal[1]) - hd;
      if (Math.abs(gap) <= WALL_MAGNET_DISTANCE && Math.abs(gap) < best) {
        best = Math.abs(gap);
        rotY = Math.atan2(seg.normal[0], seg.normal[1]);
        autoOriented = true;
      }
    }
  }
  if (!autoOriented) rotY = snap(rotY, degToRad(15));

  const [ex, ez] = aabbHalfExtents(hw, hd, rotY);
  const alignmentGuides: AlignmentGuide[] = [];
  let snappedAxisX = false;
  let snappedAxisZ = false;

  // 2. Align to other objects' edges and centres
  const others = room.objects.filter((o) => o.id !== objectId);
  let bestX: { diff: number; value: number; guideX: number } | null = null;
  let bestZ: { diff: number; value: number; guideZ: number } | null = null;
  for (const other of others) {
    const [ox, , oz] = other.position;
    const [oex, oez] = objectHalfExtents(other);
    const xCandidates: [number, number][] = [
      [ox, ox], // centre to centre
      [ox - oex + ex, ox - oex], // left edges
      [ox + oex - ex, ox + oex], // right edges
      [ox + oex + ex, ox + oex], // butt against right side
      [ox - oex - ex, ox - oex], // butt against left side
    ];
    for (const [value, guide] of xCandidates) {
      const diff = Math.abs(x - value);
      if (diff <= OBJECT_SNAP_DISTANCE && (!bestX || diff < bestX.diff)) bestX = { diff, value, guideX: guide };
    }
    const zCandidates: [number, number][] = [
      [oz, oz],
      [oz - oez + ez, oz - oez],
      [oz + oez - ez, oz + oez],
      [oz + oez + ez, oz + oez],
      [oz - oez - ez, oz - oez],
    ];
    for (const [value, guide] of zCandidates) {
      const diff = Math.abs(z - value);
      if (diff <= OBJECT_SNAP_DISTANCE && (!bestZ || diff < bestZ.diff)) bestZ = { diff, value, guideZ: guide };
    }
  }
  if (bestX) {
    x = bestX.value;
    snappedAxisX = true;
  }
  if (bestZ) {
    z = bestZ.value;
    snappedAxisZ = true;
  }

  // 3. Grid: snap the footprint's min edge (not its centre) onto grid lines
  if (!snappedAxisX) x = snap(x - ex - gridOrigin[0], gridStep) + gridOrigin[0] + ex;
  if (!snappedAxisZ) z = snap(z - ez - gridOrigin[1], gridStep) + gridOrigin[1] + ez;

  // 4. Walls last, so containment always wins
  const pos = { x, z };
  const flushWalls = resolveWalls(room, pos, hw, hd, rotY, WALL_MAGNET_DISTANCE);
  x = pos.x;
  z = pos.z;

  for (const i of flushWalls) {
    const seg = wallSegment(room, i);
    alignmentGuides.push({
      start: [seg.a[0], 0.005, seg.a[1]],
      end: [seg.b[0], 0.005, seg.b[1]],
      type: 'wall',
    });
  }
  // Object guides only if a wall push didn't move the object off the aligned line
  if (bestX && Math.abs(x - bestX.value) < 1e-6) {
    alignmentGuides.push({
      start: [bestX.guideX, 0.005, z - ez - 0.2],
      end: [bestX.guideX, 0.005, z + ez + 0.2],
      type: 'object',
    });
  }
  if (bestZ && Math.abs(z - bestZ.value) < 1e-6) {
    alignmentGuides.push({
      start: [x - ex - 0.2, 0.005, bestZ.guideZ],
      end: [x + ex + 0.2, 0.005, bestZ.guideZ],
      type: 'object',
    });
  }

  if (transformY) y = snap(y, 0.05);
  y = Math.max(0, Math.min(room.wallHeight, y));

  return {
    snappedPos: [Number(x.toFixed(4)), Number(y.toFixed(4)), Number(z.toFixed(4))],
    snappedRotY: Number(rotY.toFixed(4)),
    isWallSnapped: flushWalls.length > 0,
    isObjectSnapped: Boolean(bestX || bestZ),
    alignmentGuides,
  };
}

/**
 * Ids of objects standing flush against wall `wallIndex` (within `tolerance` of its inner face and
 * alongside it), i.e. the furniture that should travel with the wall when it is moved.
 */
export function objectsFlushAgainstWall(room: Room, wallIndex: number, tolerance = 0.03): string[] {
  const seg = wallSegment(room, wallIndex);
  if (seg.len < 1e-6) return [];
  const inward: [number, number] = [-seg.normal[0], -seg.normal[1]];
  return room.objects
    .filter((o) => {
      const hw = (o.size[0] * (o.scale?.[0] ?? 1)) / 2;
      const hd = (o.size[2] * (o.scale?.[2] ?? 1)) / 2;
      const rotY = o.rotation?.[1] ?? 0;
      const relX = o.position[0] - seg.a[0];
      const relZ = o.position[2] - seg.a[1];
      const along = relX * seg.dir[0] + relZ * seg.dir[1];
      const alongExtent = footprintExtent(seg.dir, hw, hd, rotY);
      if (along + alongExtent <= 1e-3 || along - alongExtent >= seg.len - 1e-3) return false;
      const gap = relX * inward[0] + relZ * inward[1] - footprintExtent(seg.normal, hw, hd, rotY);
      return Math.abs(gap) <= tolerance;
    })
    .map((o) => o.id);
}
