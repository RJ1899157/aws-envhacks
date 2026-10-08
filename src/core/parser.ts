import { getCatalogAsset } from './catalog';
import { RoomSchema, type Opening, type Room, type SceneObject, type Vec2 } from './schema';

export type IssueLevel = 'error' | 'warning';

export interface ParseIssue {
  level: IssueLevel;
  message: string;
  ref?: string;
}

export interface ParseResult {
  room: Room | null;
  issues: ParseIssue[];
}

/**
 * Calculates the signed area of a 2D polygon on the XZ floor plane.
 * - Positive for Counter-Clockwise (CCW) winding.
 * - Negative for Clockwise (CW) winding.
 */
export function signedArea(outline: readonly Vec2[]): number {
  const n = outline.length;
  if (n < 3) return 0;
  let sum = 0;
  for (let i = 0; i < n; i++) {
    const current = outline[i]!;
    const next = outline[(i + 1) % n]!;
    sum += current[0] * next[1] - next[0] * current[1];
  }
  return sum / 2;
}

/**
 * Determines whether a 2D point [x, z] lies strictly inside a polygon using ray casting.
 */
export function pointInPolygon(point: Vec2, polygon: readonly Vec2[]): boolean {
  const n = polygon.length;
  if (n < 3) return false;
  const [x, z] = point;
  let inside = false;

  for (let i = 0, j = n - 1; i < n; j = i++) {
    const pi = polygon[i]!;
    const pj = polygon[j]!;

    const xi = pi[0];
    const zi = pi[1];
    const xj = pj[0];
    const zj = pj[1];

    const intersect = zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi;
    if (intersect) {
      inside = !inside;
    }
  }

  return inside;
}

/**
 * Returns geometry properties of a wall segment: start point a, end point b, length,
 * normalized direction vector, and outward normal vector.
 */
export function wallSegment(
  room: { outline: readonly Vec2[] },
  index: number
): { a: Vec2; b: Vec2; len: number; dir: Vec2; normal: Vec2 } {
  const { outline } = room;
  const n = outline.length;
  if (n < 2) {
    throw new Error('Polygon must have at least 2 vertices to compute a wall segment');
  }

  const safeIndex = ((index % n) + n) % n;
  const nextIndex = (safeIndex + 1) % n;

  const a = outline[safeIndex]!;
  const b = outline[nextIndex]!;

  const dx = b[0] - a[0];
  const dz = b[1] - a[1];
  const len = Math.hypot(dx, dz);

  const dir: Vec2 = len > 1e-9 ? [dx / len, dz / len] : [0, 0];
  // Outward normal for CCW polygon on XZ plane: rotate dir 90° clockwise -> [dz, -dx]
  const normal: Vec2 = len > 1e-9 ? [dz / len, -dx / len] : [0, 0];

  return { a, b, len, dir, normal };
}

/**
 * Computes axis-aligned bounding box of a 2D polygon.
 */
export function polygonBounds(outline: readonly Vec2[]): {
  min: Vec2;
  max: Vec2;
  width: number;
  depth: number;
} {
  if (outline.length === 0) {
    return { min: [0, 0], max: [0, 0], width: 0, depth: 0 };
  }

  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;

  for (const [x, z] of outline) {
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (z < minZ) minZ = z;
    if (z > maxZ) maxZ = z;
  }

  return {
    min: [minX, minZ],
    max: [maxX, maxZ],
    width: maxX - minX,
    depth: maxZ - minZ,
  };
}

function crossProduct2D(p1: Vec2, p2: Vec2, p3: Vec2): number {
  return (p2[0] - p1[0]) * (p3[1] - p1[1]) - (p2[1] - p1[1]) * (p3[0] - p1[0]);
}

function isPointOnSegment(p: Vec2, q: Vec2, r: Vec2): boolean {
  return (
    q[0] <= Math.max(p[0], r[0]) + 1e-9 &&
    q[0] >= Math.min(p[0], r[0]) - 1e-9 &&
    q[1] <= Math.max(p[1], r[1]) + 1e-9 &&
    q[1] >= Math.min(p[1], r[1]) - 1e-9
  );
}

function segmentsIntersect(p1: Vec2, p2: Vec2, p3: Vec2, p4: Vec2): boolean {
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

  // Collinear overlap cases
  if (Math.abs(d1) <= 1e-9 && isPointOnSegment(p3, p1, p4)) return true;
  if (Math.abs(d2) <= 1e-9 && isPointOnSegment(p3, p2, p4)) return true;
  if (Math.abs(d3) <= 1e-9 && isPointOnSegment(p1, p3, p2)) return true;
  if (Math.abs(d4) <= 1e-9 && isPointOnSegment(p1, p4, p2)) return true;

  return false;
}

/**
 * Checks whether a polygon is simple (no self-intersecting or overlapping edges).
 */
export function isPolygonSimple(outline: readonly Vec2[]): boolean {
  const n = outline.length;
  if (n < 3) return false;

  for (let i = 0; i < n; i++) {
    const a1 = outline[i]!;
    const a2 = outline[(i + 1) % n]!;

    for (let j = i + 1; j < n; j++) {
      // Skip adjacent segments which share a vertex by definition
      if (j === (i + 1) % n || i === (j + 1) % n) {
        continue;
      }

      const b1 = outline[j]!;
      const b2 = outline[(j + 1) % n]!;

      if (segmentsIntersect(a1, a2, b1, b2)) {
        return false;
      }
    }
  }

  return true;
}

/**
 * Parses and validates raw room input against all IAQ and 3D architectural rules.
 *
 * Rules:
 * - Validates with RoomSchema
 * - Forces outline to counter-clockwise (reverses if signed area < 0) with a warning
 * - Warns if floor area < 4 m²
 * - Errors if any wall length < 0.3 m
 * - Errors and drops openings that reference missing walls, exceed wall length, or exceed wall height
 * - Errors and drops duplicate object ids and unknown assetIds
 * - Warns if an object's centre is outside the floor polygon
 * - Warns if there is no inlet AND outlet opening (cross-ventilation requirement)
 * - Returns room = null if any error exists
 */
export function parseRoom(raw: unknown): ParseResult {
  const issues: ParseIssue[] = [];

  // 1. Validate with RoomSchema
  const schemaResult = RoomSchema.safeParse(raw);
  if (!schemaResult.success) {
    for (const issue of schemaResult.error.issues) {
      issues.push({
        level: 'error',
        message: `Schema error at ${issue.path.join('.')}: ${issue.message}`,
        ref: issue.path.join('.'),
      });
    }
    return { room: null, issues };
  }

  const roomData = schemaResult.data;

  // 2. Check for self-intersecting outline
  if (!isPolygonSimple(roomData.outline)) {
    issues.push({
      level: 'error',
      message: 'Room outline has self-intersections (polygon must be simple)',
    });
  }

  // 3. Force counter-clockwise winding
  let outline: Vec2[] = [...roomData.outline];
  const area = signedArea(outline);
  if (area < 0) {
    outline = outline.reverse();
    issues.push({
      level: 'warning',
      message: 'Room outline was clockwise; reversed to counter-clockwise',
    });
  }

  // 4. Warn if area < 4 m²
  const absArea = Math.abs(area);
  if (absArea < 4) {
    issues.push({
      level: 'warning',
      message: `Room floor area (${absArea.toFixed(2)} m²) is less than 4 m²`,
    });
  }

  // 5. Error if any wall < 0.3 m
  const nWalls = outline.length;
  for (let i = 0; i < nWalls; i++) {
    const seg = wallSegment({ outline }, i);
    if (seg.len < 0.3) {
      issues.push({
        level: 'error',
        message: `Wall ${i} length (${seg.len.toFixed(2)}m) is less than 0.3m`,
        ref: `wall-${i}`,
      });
    }
  }

  // 6. Error and drop openings that reference missing wall, exceed wall length, or exceed wall height
  const validOpenings: Opening[] = [];
  for (const op of roomData.openings) {
    let hasError = false;

    if (op.wallIndex < 0 || op.wallIndex >= nWalls) {
      issues.push({
        level: 'error',
        message: `Opening '${op.id}' references missing wall index ${op.wallIndex} (room has ${nWalls} walls) and was dropped`,
        ref: op.id,
      });
      hasError = true;
    } else {
      const wall = wallSegment({ outline }, op.wallIndex);
      if (op.offset + op.width > wall.len + 1e-6) {
        issues.push({
          level: 'error',
          message: `Opening '${op.id}' offset (${op.offset}m) + width (${op.width}m) exceeds wall ${op.wallIndex} length (${wall.len.toFixed(2)}m) and was dropped`,
          ref: op.id,
        });
        hasError = true;
      }
    }

    if (op.sill + op.height > roomData.wallHeight + 1e-6) {
      issues.push({
        level: 'error',
        message: `Opening '${op.id}' sill (${op.sill}m) + height (${op.height}m) exceeds wall height (${roomData.wallHeight}m) and was dropped`,
        ref: op.id,
      });
      hasError = true;
    }

    if (!hasError) {
      validOpenings.push(op);
    }
  }

  // 7. Error and drop duplicate object ids and unknown assetIds
  const validObjects: SceneObject[] = [];
  const seenObjectIds = new Set<string>();

  for (const obj of roomData.objects) {
    let hasError = false;

    if (seenObjectIds.has(obj.id)) {
      issues.push({
        level: 'error',
        message: `Duplicate object id '${obj.id}' and was dropped`,
        ref: obj.id,
      });
      hasError = true;
    } else {
      seenObjectIds.add(obj.id);
    }

    if (!getCatalogAsset(obj.assetId)) {
      issues.push({
        level: 'error',
        message: `Unknown assetId '${obj.assetId}' for object '${obj.id}' and was dropped`,
        ref: obj.id,
      });
      hasError = true;
    }

    if (!hasError) {
      validObjects.push(obj);
    }
  }

  // 8. Warn if an object's centre is outside the polygon
  for (const obj of validObjects) {
    const center: Vec2 = [obj.position[0], obj.position[2]];
    if (!pointInPolygon(center, outline)) {
      issues.push({
        level: 'warning',
        message: `Object '${obj.id}' (${obj.name}) centre [${center[0]}, ${center[1]}] is outside the room floor boundary`,
        ref: obj.id,
      });
    }
  }

  // 9. Warn if there is no inlet AND outlet opening (cross-ventilation needs both)
  const hasInlet = validOpenings.some((op) => op.role === 'inlet');
  const hasOutlet = validOpenings.some((op) => op.role === 'outlet');
  if (!hasInlet || !hasOutlet) {
    issues.push({
      level: 'warning',
      message:
        'Room lacks cross-ventilation: requires at least one inlet opening and one outlet opening',
    });
  }

  // 10. Return room = null if any error exists
  const hasErrors = issues.some((iss) => iss.level === 'error');
  if (hasErrors) {
    return {
      room: null,
      issues,
    };
  }

  return {
    room: {
      ...roomData,
      outline,
      openings: validOpenings,
      objects: validObjects,
    },
    issues,
  };
}
