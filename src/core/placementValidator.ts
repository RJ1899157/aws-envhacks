import { getCatalogAsset } from './catalog';
import { pointInPolygon, wallSegment } from './parser';
import type { Room, SceneObject, Vec2, Vec3 } from './schema';
import { getObjectFootprintCorners } from './collision';

export type PlacementIssueType = 'outside' | 'wall' | 'solid-overlap' | 'wall-mounted';

export interface PlacementIssue {
  id: string;
  objectId: string;
  type: PlacementIssueType;
  message: string;
  collidedWithId?: string;
  collidedWithName?: string;
  overlapDistanceM?: number;
}

/**
 * 2D cross product for line segment intersection
 */
function crossProduct2D(p1: Vec2, p2: Vec2, p3: Vec2): number {
  return (p2[0] - p1[0]) * (p3[1] - p1[1]) - (p2[1] - p1[1]) * (p3[0] - p1[0]);
}

/**
 * Tests whether segment p1->p2 strictly or endpoint-touches p3->p4
 */
function segmentsIntersect(p1: Vec2, p2: Vec2, p3: Vec2, p4: Vec2): boolean {
  const d1 = crossProduct2D(p3, p4, p1);
  const d2 = crossProduct2D(p3, p4, p2);
  const d3 = crossProduct2D(p1, p2, p3);
  const d4 = crossProduct2D(p1, p2, p4);

  if (
    ((d1 > 1e-9 && d2 < -1e-9) || (d1 < -1e-9 && d2 > 1e-9)) &&
    ((d3 > 1e-9 && d4 < -1e-9) || (d3 < -1e-9 && d4 > 1e-9))
  ) {
    return true;
  }

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
 * Computes 2D oriented-rectangle SAT penetration depth on the XZ plane.
 * Returns null if the footprints do not overlap; otherwise returns the minimum penetration distance in meters.
 */
export function computeFootprintPenetration(cornersA: Vec2[], cornersB: Vec2[]): number | null {
  const polygons = [cornersA, cornersB];
  let minPenetration = Infinity;

  for (let p = 0; p < polygons.length; p++) {
    const polygon = polygons[p]!;
    for (let i = 0; i < polygon.length; i++) {
      const p1 = polygon[i]!;
      const p2 = polygon[(i + 1) % polygon.length]!;

      const edgeX = p2[0] - p1[0];
      const edgeZ = p2[1] - p1[1];
      const len = Math.hypot(edgeX, edgeZ);
      if (len < 1e-9) continue;

      // Normalized normal vector
      const nx = -edgeZ / len;
      const nz = edgeX / len;

      let minA = Infinity;
      let maxA = -Infinity;
      for (const pt of cornersA) {
        const dot = pt[0] * nx + pt[1] * nz;
        if (dot < minA) minA = dot;
        if (dot > maxA) maxA = dot;
      }

      let minB = Infinity;
      let maxB = -Infinity;
      for (const pt of cornersB) {
        const dot = pt[0] * nx + pt[1] * nz;
        if (dot < minB) minB = dot;
        if (dot > maxB) maxB = dot;
      }

      // Separating axis found: no overlap
      if (maxA <= minB + 1e-4 || maxB <= minA + 1e-4) {
        return null;
      }

      const overlap = Math.min(maxA, maxB) - Math.max(minA, minB);
      if (overlap < minPenetration) {
        minPenetration = overlap;
      }
    }
  }

  return minPenetration === Infinity ? null : minPenetration;
}

/**
 * Validates a single object against the room (off the hot path, post-release):
 * - collision with walls or outside the room outline
 * - overlap with other solid objects (2D oriented SAT in XZ plane + Y elevation range check)
 * - wall-mounted items must sit on a wall
 */
export function validateObject(obj: SceneObject, room: Room): PlacementIssue[] {
  const issues: PlacementIssue[] = [];

  // 1. Check room outline containment
  if (room.outline.length >= 3) {
    const center: Vec2 = [obj.position[0], obj.position[2]];
    const centerIn = pointInPolygon(center, room.outline);

    const corners = getObjectFootprintCorners(obj);
    const anyCornerOut = corners.some((c) => !pointInPolygon(c, room.outline));

    if (!centerIn || anyCornerOut) {
      issues.push({
        id: `${obj.id}-outside`,
        objectId: obj.id,
        type: 'outside',
        message: 'Outside room',
      });
    } else {
      // Check wall boundary penetration
      const n = room.outline.length;
      let penetratesWall = false;

      for (let i = 0; i < 4; i++) {
        const c1 = corners[i]!;
        const c2 = corners[(i + 1) % 4]!;
        for (let w = 0; w < n; w++) {
          const seg = wallSegment(room, w);
          if (segmentsIntersect(c1, c2, seg.a, seg.b)) {
            penetratesWall = true;
            break;
          }
        }
        if (penetratesWall) break;
      }

      if (penetratesWall) {
        issues.push({
          id: `${obj.id}-wall`,
          objectId: obj.id,
          type: 'wall',
          message: 'Penetrates wall',
        });
      }
    }
  }

  // 2. Overlap with other solid objects (SAT XZ + Y range)
  const role = obj.role ?? 'solid';
  if (role === 'solid') {
    const elevA = obj.elevation ?? 0;
    const hA = obj.size[1] * (obj.scale?.[1] ?? 1);
    const minY_A = obj.position[1] + elevA;
    const maxY_A = minY_A + hA;
    const cornersA = getObjectFootprintCorners(obj);

    for (const other of room.objects) {
      if (other.id === obj.id) continue;
      const otherRole = other.role ?? 'solid';
      if (otherRole !== 'solid') continue;

      const elevB = other.elevation ?? 0;
      const hB = other.size[1] * (other.scale?.[1] ?? 1);
      const minY_B = other.position[1] + elevB;
      const maxY_B = minY_B + hB;

      // Vertical range overlap check
      const yOverlap = Math.min(maxY_A, maxY_B) - Math.max(minY_A, minY_B);
      if (yOverlap <= 1e-4) continue;

      // 2D oriented SAT check
      const cornersB = getObjectFootprintCorners(other);
      const penetration = computeFootprintPenetration(cornersA, cornersB);

      if (penetration !== null) {
        const cm = Math.max(1, Math.round(penetration * 100));
        const name = other.name || 'furniture';
        issues.push({
          id: `${obj.id}-overlap-${other.id}`,
          objectId: obj.id,
          type: 'solid-overlap',
          message: `Overlaps ${name} by ${cm} cm`,
          collidedWithId: other.id,
          collidedWithName: name,
          overlapDistanceM: Number(penetration.toFixed(4)),
        });
      }
    }
  }

  // 3. Wall-mounted items must sit on a wall
  const catalogDef = getCatalogAsset(obj.assetId);
  const isWallMounted = Boolean(obj.wallMounted || catalogDef?.wallMounted);

  if (isWallMounted && room.outline.length >= 2) {
    let minWallDist = Infinity;
    const px = obj.position[0];
    const pz = obj.position[2];

    for (let w = 0; w < room.outline.length; w++) {
      const seg = wallSegment(room, w);
      const toPtX = px - seg.a[0];
      const toPtZ = pz - seg.a[1];
      const t = toPtX * seg.dir[0] + toPtZ * seg.dir[1];
      const clampedT = Math.max(0, Math.min(seg.len, t));
      const projX = seg.a[0] + clampedT * seg.dir[0];
      const projZ = seg.a[1] + clampedT * seg.dir[1];
      const dist = Math.hypot(px - projX, pz - projZ);
      if (dist < minWallDist) {
        minWallDist = dist;
      }
    }

    // Must be within 0.15m of a wall
    if (minWallDist > 0.15) {
      issues.push({
        id: `${obj.id}-wall-mounted`,
        objectId: obj.id,
        type: 'wall-mounted',
        message: 'Wall-mounted item must sit on a wall',
      });
    }
  }

  return issues;
}

/**
 * Validates all objects in the room and returns a map of objectId -> issues
 */
export function validateAllObjects(room: Room): Record<string, PlacementIssue[]> {
  const result: Record<string, PlacementIssue[]> = {};
  for (const obj of room.objects) {
    const issues = validateObject(obj, room);
    if (issues.length > 0) {
      result[obj.id] = issues;
    }
  }
  return result;
}

/**
 * Spiral search: finds the closest non-overlapping, in-bounds snapped position for an object
 */
export function findNearestValidPosition(
  obj: SceneObject,
  room: Room,
  gridStep = 0.05
): Vec3 | null {
  const [origX, origY, origZ] = obj.position;
  const elev = obj.elevation ?? 0;

  // First check if current position is already valid
  if (validateObject(obj, room).length === 0) {
    return [origX, origY, origZ];
  }

  const step = Math.max(0.02, gridStep);
  const maxSearchRadiusM = 3.0;
  const maxRings = Math.ceil(maxSearchRadiusM / step);

  for (let ring = 1; ring <= maxRings; ring++) {
    const candidates: Array<{ x: number; z: number; distSq: number }> = [];

    // Perimeter coordinates of the ring square [-ring, ring]
    for (let i = -ring; i <= ring; i++) {
      // Top and bottom edges
      const x1 = origX + i * step;
      const z1 = origZ - ring * step;
      const x2 = origX + i * step;
      const z2 = origZ + ring * step;

      candidates.push({ x: x1, z: z1, distSq: (x1 - origX) ** 2 + (z1 - origZ) ** 2 });
      candidates.push({ x: x2, z: z2, distSq: (x2 - origX) ** 2 + (z2 - origZ) ** 2 });

      // Left and right edges (excluding corners already added)
      if (i > -ring && i < ring) {
        const x3 = origX - ring * step;
        const z3 = origZ + i * step;
        const x4 = origX + ring * step;
        const z4 = origZ + i * step;

        candidates.push({ x: x3, z: z3, distSq: (x3 - origX) ** 2 + (z3 - origZ) ** 2 });
        candidates.push({ x: x4, z: z4, distSq: (x4 - origX) ** 2 + (z4 - origZ) ** 2 });
      }
    }

    // Sort strictly by distance to find the closest valid spot
    candidates.sort((a, b) => a.distSq - b.distSq);

    for (const cand of candidates) {
      const candidateX = Number(cand.x.toFixed(4));
      const candidateZ = Number(cand.z.toFixed(4));

      const testObj: SceneObject = {
        ...obj,
        position: [candidateX, origY, candidateZ],
      };

      const testIssues = validateObject(testObj, room);
      if (testIssues.length === 0) {
        return [candidateX, elev, candidateZ];
      }
    }
  }

  return null;
}
