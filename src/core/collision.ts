import { wallSegment, pointInPolygon } from './parser';
import type { Opening, Room, SceneObject, Vec2 } from './schema';

/**
 * 2D cross product for segment intersection testing
 */
function crossProduct2D(p1: Vec2, p2: Vec2, p3: Vec2): number {
  return (p2[0] - p1[0]) * (p3[1] - p1[1]) - (p2[1] - p1[1]) * (p3[0] - p1[0]);
}

/**
 * Checks whether two 2D line segments strictly or endpoints-touching intersect
 */
export function segmentsIntersect(p1: Vec2, p2: Vec2, p3: Vec2, p4: Vec2): boolean {
  const d1 = crossProduct2D(p3, p4, p1);
  const d2 = crossProduct2D(p3, p4, p2);
  const d3 = crossProduct2D(p1, p2, p3);
  const d4 = crossProduct2D(p1, p2, p4);

  // General strictly crossing case
  if (
    ((d1 > 1e-9 && d2 < -1e-9) || (d1 < -1e-9 && d2 > 1e-9)) &&
    ((d3 > 1e-9 && d4 < -1e-9) || (d3 < -1e-9 && d4 > 1e-9))
  ) {
    return true;
  }

  // Collinear or endpoint touching cases
  const onSegment = (p: Vec2, a: Vec2, b: Vec2) =>
    p[0] <= Math.max(a[0], b[0]) + 1e-9 &&
    p[0] >= Math.min(a[0], b[0]) - 1e-9 &&
    p[1] <= Math.max(a[1], b[1]) + 1e-9 &&
    p[1] >= Math.min(a[1], b[1]) - 1e-9;

  if (Math.abs(d1) < 1e-9 && onSegment(p1, p3, p4)) return true;
  if (Math.abs(d2) < 1e-9 && onSegment(p2, p3, p4)) return true;
  if (Math.abs(d3) < 1e-9 && onSegment(p3, p1, p2)) return true;
  if (Math.abs(d4) < 1e-9 && onSegment(p4, p1, p2)) return true;

  return false;
}

/**
 * Calculates the 4 corner points in counter-clockwise order of a 3D SceneObject's
 * 2D footprint projected onto the XZ floor plane.
 */
export function getObjectFootprintCorners(obj: SceneObject): Vec2[] {
  const sx = obj.scale?.[0] ?? 1;
  const sz = obj.scale?.[2] ?? 1;
  const halfW = (obj.size[0] * sx) / 2;
  const halfD = (obj.size[2] * sz) / 2;

  // Rotation around Y axis (in radians)
  const rotY = obj.rotation?.[1] ?? 0;
  const cos = Math.cos(rotY);
  const sin = Math.sin(rotY);

  const localCorners: [number, number][] = [
    [-halfW, -halfD],
    [halfW, -halfD],
    [halfW, halfD],
    [-halfW, halfD],
  ];

  const posX = obj.position[0];
  const posZ = obj.position[2];

  return localCorners.map(([lx, lz]) => {
    // 2D rotation: x' = x*cos - z*sin, z' = x*sin + z*cos
    const rx = lx * cos - lz * sin;
    const rz = lx * sin + lz * cos;
    return [Number((posX + rx).toFixed(6)), Number((posZ + rz).toFixed(6))] as Vec2;
  });
}

/**
 * Checks whether an object lies completely inside the room polygon and does not
 * intersect any wall boundaries.
 */
export function isObjectInsideRoom(obj: SceneObject, room: Room): boolean {
  if (room.outline.length < 3) return false;

  const center: Vec2 = [obj.position[0], obj.position[2]];
  if (!pointInPolygon(center, room.outline)) {
    return false;
  }

  const corners = getObjectFootprintCorners(obj);

  // 1. All 4 corners must be strictly or inclusively inside the room polygon
  for (const corner of corners) {
    if (!pointInPolygon(corner, room.outline)) {
      return false;
    }
  }

  // 2. None of the 4 edges of the object footprint may intersect any room wall segment
  const n = room.outline.length;
  for (let i = 0; i < 4; i++) {
    const c1 = corners[i]!;
    const c2 = corners[(i + 1) % 4]!;

    for (let w = 0; w < n; w++) {
      const seg = wallSegment(room, w);
      if (segmentsIntersect(c1, c2, seg.a, seg.b)) {
        return false;
      }
    }
  }

  return true;
}

/**
 * Evaluates Separating Axis Theorem (SAT) for two convex 2D polygons (quad footprints)
 * on the XZ plane. Returns true if they overlap.
 */
export function doFootprintsOverlap(cornersA: Vec2[], cornersB: Vec2[]): boolean {
  const polygons = [cornersA, cornersB];

  for (let p = 0; p < polygons.length; p++) {
    const polygon = polygons[p]!;
    for (let i = 0; i < polygon.length; i++) {
      const p1 = polygon[i]!;
      const p2 = polygon[(i + 1) % polygon.length]!;

      // Normal vector perpendicular to the edge
      const edgeX = p2[0] - p1[0];
      const edgeZ = p2[1] - p1[1];
      const normal: Vec2 = [-edgeZ, edgeX];

      // Project polygon A onto normal
      let minA = Infinity;
      let maxA = -Infinity;
      for (const pt of cornersA) {
        const dot = pt[0] * normal[0] + pt[1] * normal[1];
        if (dot < minA) minA = dot;
        if (dot > maxA) maxA = dot;
      }

      // Project polygon B onto normal
      let minB = Infinity;
      let maxB = -Infinity;
      for (const pt of cornersB) {
        const dot = pt[0] * normal[0] + pt[1] * normal[1];
        if (dot < minB) minB = dot;
        if (dot > maxB) maxB = dot;
      }

      // If projections do not overlap, separating axis found -> no collision
      if (maxA <= minB + 1e-4 || maxB <= minA + 1e-4) {
        return false;
      }
    }
  }

  return true;
}

/**
 * Checks whether two 3D SceneObjects collide in both 3D height (Y) and 2D footprint (XZ).
 * Only applies if both objects have role === 'solid'.
 */
export function doObjectsCollide(objA: SceneObject, objB: SceneObject): boolean {
  const roleA = objA.role ?? 'solid';
  const roleB = objB.role ?? 'solid';

  // Only solid objects collide with each other
  if (roleA !== 'solid' || roleB !== 'solid') {
    return false;
  }

  // 1. Check vertical (Y) overlap
  const elevationA = objA.elevation ?? 0;
  const heightA = objA.size[1] * (objA.scale?.[1] ?? 1);
  const minY_A = objA.position[1] + elevationA;
  const maxY_A = minY_A + heightA;

  const elevationB = objB.elevation ?? 0;
  const heightB = objB.size[1] * (objB.scale?.[1] ?? 1);
  const minY_B = objB.position[1] + elevationB;
  const maxY_B = minY_B + heightB;

  const yOverlap = Math.min(maxY_A, maxY_B) - Math.max(minY_A, minY_B);
  if (yOverlap <= 1e-4) {
    return false;
  }

  // 2. Check 2D footprint overlap on XZ plane via SAT
  const cornersA = getObjectFootprintCorners(objA);
  const cornersB = getObjectFootprintCorners(objB);

  return doFootprintsOverlap(cornersA, cornersB);
}

export interface ObjectCollisionResult {
  colliding: boolean;
  reason?: 'outside' | 'wall' | 'solid-overlap';
  collidedWithId?: string;
}

/**
 * Validates whether a scene object collides with the room walls / outside boundary
 * or with another solid object in the room.
 */
export function checkObjectCollision(
  obj: SceneObject,
  room: Room,
  excludeId?: string
): ObjectCollisionResult {
  // 1. Check room polygon containment & wall intersections
  if (!isObjectInsideRoom(obj, room)) {
    return { colliding: true, reason: 'outside' };
  }

  // 2. If object is solid, check collision against other solid objects
  const role = obj.role ?? 'solid';
  if (role === 'solid') {
    for (const other of room.objects) {
      if (other.id === obj.id || other.id === excludeId) continue;
      if (doObjectsCollide(obj, other)) {
        return { colliding: true, reason: 'solid-overlap', collidedWithId: other.id };
      }
    }
  }

  return { colliding: false };
}

export interface OpeningCollisionResult {
  colliding: boolean;
  reason?: 'bounds' | 'opening-overlap';
  collidedWithId?: string;
}

/**
 * Validates whether an opening fits within its wall boundaries and does not overlap
 * other openings on the same wall segment.
 */
export function checkOpeningCollision(
  opening: Opening,
  room: Room,
  excludeId?: string
): OpeningCollisionResult {
  if (room.outline.length < 2) {
    return { colliding: true, reason: 'bounds' };
  }

  const n = room.outline.length;
  const wallIdx = ((opening.wallIndex % n) + n) % n;
  const seg = wallSegment(room, wallIdx);

  // 1. Check wall length bounds
  if (opening.offset < -1e-4 || opening.offset + opening.width > seg.len + 1e-4) {
    return { colliding: true, reason: 'bounds' };
  }

  // 2. Check wall height bounds
  if (opening.sill < -1e-4 || opening.sill + opening.height > room.wallHeight + 1e-4) {
    return { colliding: true, reason: 'bounds' };
  }

  // 3. Check overlap with other openings on the same wall
  for (const other of room.openings) {
    if (other.id === opening.id || other.id === excludeId) continue;
    if (other.wallIndex !== opening.wallIndex) continue;

    const uStartA = opening.offset;
    const uEndA = opening.offset + opening.width;
    const uStartB = other.offset;
    const uEndB = other.offset + other.width;

    const vStartA = opening.sill;
    const vEndA = opening.sill + opening.height;
    const vStartB = other.sill;
    const vEndB = other.sill + other.height;

    const horizOverlap = Math.min(uEndA, uEndB) - Math.max(uStartA, uStartB);
    const vertOverlap = Math.min(vEndA, vEndB) - Math.max(vStartA, vStartB);

    if (horizOverlap > 1e-4 && vertOverlap > 1e-4) {
      return { colliding: true, reason: 'opening-overlap', collidedWithId: other.id };
    }
  }

  return { colliding: false };
}
