import { wallSegment, polygonBounds } from './parser';
import type { Opening, SceneObject, Vec2 } from './schema';

export type LengthAnchor = 'start' | 'end' | 'center';

/**
 * Moves an entire wall segment perpendicular to itself by delta along its outward normal.
 * Corners A and B follow, automatically stretching neighbouring walls.
 */
export function moveWallPerpendicular(
  outline: readonly Vec2[],
  wallIndex: number,
  delta: number
): Vec2[] {
  const n = outline.length;
  if (n < 3) return [...outline];

  const seg = wallSegment({ outline }, wallIndex);
  const shiftX = Number((delta * seg.normal[0]).toFixed(4));
  const shiftZ = Number((delta * seg.normal[1]).toFixed(4));

  const safeA = ((wallIndex % n) + n) % n;
  const safeB = (safeA + 1) % n;

  const nextOutline: Vec2[] = outline.map((pt) => [pt[0], pt[1]]);
  nextOutline[safeA] = [
    Number((nextOutline[safeA]![0] + shiftX).toFixed(4)),
    Number((nextOutline[safeA]![1] + shiftZ).toFixed(4)),
  ];
  nextOutline[safeB] = [
    Number((nextOutline[safeB]![0] + shiftX).toFixed(4)),
    Number((nextOutline[safeB]![1] + shiftZ).toFixed(4)),
  ];

  return nextOutline;
}

/**
 * Extrudes a rectangular bump or alcove outward from a wall segment (Alt-drag).
 * Inserts 4 new corners creating an extruded or recessed rectangle on that wall.
 */
export function extrudeWallAlcove(
  outline: readonly Vec2[],
  wallIndex: number,
  offset: number,
  fractionStart = 0.25,
  fractionEnd = 0.75
): Vec2[] {
  const n = outline.length;
  if (n < 3) return [...outline];

  const safeIndex = ((wallIndex % n) + n) % n;
  const seg = wallSegment({ outline }, safeIndex);

  const startT = Math.max(0.1, Math.min(0.4, fractionStart));
  const endT = Math.max(0.6, Math.min(0.9, fractionEnd));

  const c1X = seg.a[0] + seg.dir[0] * (seg.len * startT);
  const c1Z = seg.a[1] + seg.dir[1] * (seg.len * startT);

  const c2X = seg.a[0] + seg.dir[0] * (seg.len * endT);
  const c2Z = seg.a[1] + seg.dir[1] * (seg.len * endT);

  const c1ExtX = Number((c1X + offset * seg.normal[0]).toFixed(4));
  const c1ExtZ = Number((c1Z + offset * seg.normal[1]).toFixed(4));

  const c2ExtX = Number((c2X + offset * seg.normal[0]).toFixed(4));
  const c2ExtZ = Number((c2Z + offset * seg.normal[1]).toFixed(4));

  const nextOutline: Vec2[] = [];
  for (let i = 0; i < n; i++) {
    nextOutline.push(outline[i]!);
    if (i === safeIndex) {
      nextOutline.push([Number(c1X.toFixed(4)), Number(c1Z.toFixed(4))]);
      nextOutline.push([c1ExtX, c1ExtZ]);
      nextOutline.push([c2ExtX, c2ExtZ]);
      nextOutline.push([Number(c2X.toFixed(4)), Number(c2Z.toFixed(4))]);
    }
  }

  return nextOutline;
}

/**
 * Sets exact wall length with selectable anchor:
 * - 'start': Corner A remains fixed, Corner B extends or shrinks along wall direction
 * - 'end': Corner B remains fixed, Corner A extends or shrinks along opposite wall direction
 * - 'center': Both corners adjust symmetrically from the midpoint
 */
export function setWallLengthWithAnchor(
  outline: readonly Vec2[],
  wallIndex: number,
  newLength: number,
  anchor: LengthAnchor = 'center'
): Vec2[] {
  const n = outline.length;
  if (n < 3 || newLength <= 0.05) return [...outline];

  const safeA = ((wallIndex % n) + n) % n;
  const safeB = (safeA + 1) % n;

  const seg = wallSegment({ outline }, safeA);
  const nextOutline: Vec2[] = outline.map((pt) => [pt[0], pt[1]]);

  if (anchor === 'start') {
    // Corner A stays fixed, B moves
    nextOutline[safeB] = [
      Number((seg.a[0] + seg.dir[0] * newLength).toFixed(4)),
      Number((seg.a[1] + seg.dir[1] * newLength).toFixed(4)),
    ];
  } else if (anchor === 'end') {
    // Corner B stays fixed, A moves
    nextOutline[safeA] = [
      Number((seg.b[0] - seg.dir[0] * newLength).toFixed(4)),
      Number((seg.b[1] - seg.dir[1] * newLength).toFixed(4)),
    ];
  } else {
    // Centered: adjust symmetrically
    const midX = (seg.a[0] + seg.b[0]) / 2;
    const midZ = (seg.a[1] + seg.b[1]) / 2;
    const half = newLength / 2;

    nextOutline[safeA] = [
      Number((midX - seg.dir[0] * half).toFixed(4)),
      Number((midZ - seg.dir[1] * half).toFixed(4)),
    ];
    nextOutline[safeB] = [
      Number((midX + seg.dir[0] * half).toFixed(4)),
      Number((midZ + seg.dir[1] * half).toFixed(4)),
    ];
  }

  return nextOutline;
}

/**
 * Adjusts openings proportionally when wall length changes,
 * and identifies openings that no longer fit.
 */
export function adjustOpeningsForWallLength(
  openings: readonly Opening[],
  wallIndex: number,
  oldLength: number,
  newLength: number
): { updatedOpenings: Opening[]; adjustedOpenings: Opening[]; removedOpenings: Opening[] } {
  const updatedOpenings: Opening[] = [];
  const removedOpenings: Opening[] = [];

  for (const op of openings) {
    if (op.wallIndex !== wallIndex) {
      updatedOpenings.push(op);
      continue;
    }

    if (op.width > newLength - 1e-4) {
      removedOpenings.push(op);
      continue;
    }

    // Proportionally scale offset
    let newOffset =
      oldLength > 1e-4 ? Number((op.offset * (newLength / oldLength)).toFixed(4)) : op.offset;

    // Clamp within wall length
    newOffset = Math.max(0, Math.min(newLength - op.width, newOffset));

    updatedOpenings.push({
      ...op,
      offset: Number(newOffset.toFixed(4)),
    });
  }

  return { updatedOpenings, adjustedOpenings: updatedOpenings, removedOpenings };
}

/**
 * Updates opening wallIndex and offset after a wall is split by inserting a vertex.
 */
export function adjustOpeningsForWallSplit(
  openings: readonly Opening[],
  splitWallIndex: number,
  splitOffset: number
): Opening[] {
  return openings.map((op) => {
    if (op.wallIndex < splitWallIndex) {
      return op;
    }
    if (op.wallIndex > splitWallIndex) {
      return { ...op, wallIndex: op.wallIndex + 1 };
    }
    // Opening is on the split wall
    if (op.offset + op.width <= splitOffset + 1e-4) {
      // Stays on first half
      return op;
    }
    if (op.offset >= splitOffset - 1e-4) {
      // Moves to second half
      return {
        ...op,
        wallIndex: splitWallIndex + 1,
        offset: Number(Math.max(0, op.offset - splitOffset).toFixed(4)),
      };
    }
    // Straddles: if midpoint is on second half, transfer
    const mid = op.offset + op.width / 2;
    if (mid >= splitOffset) {
      return {
        ...op,
        wallIndex: splitWallIndex + 1,
        offset: 0,
      };
    }
    return {
      ...op,
      offset: Number(Math.max(0, splitOffset - op.width).toFixed(4)),
    };
  });
}

/**
 * Updates opening wall indices after a corner is deleted and two walls are merged.
 */
export function adjustOpeningsForWallMerge(
  openings: readonly Opening[],
  deletedCornerIndex: number,
  prevWallLength: number
): Opening[] {
  const mergedWallIndex = deletedCornerIndex === 0 ? 0 : deletedCornerIndex - 1;

  return openings.map((op) => {
    if (op.wallIndex < deletedCornerIndex) {
      return op;
    }
    if (op.wallIndex === deletedCornerIndex) {
      // Second half of merged wall: join onto mergedWallIndex with offset increased by prevWallLength
      return {
        ...op,
        wallIndex: mergedWallIndex,
        offset: Number((op.offset + prevWallLength).toFixed(4)),
      };
    }
    // Subsequent walls shift index down by 1
    return {
      ...op,
      wallIndex: op.wallIndex - 1,
    };
  });
}

/**
 * Moves entire room outline and all scene objects simultaneously by delta [dx, dz].
 */
export function moveRoomAndObjects(
  outline: readonly Vec2[],
  objects: readonly SceneObject[],
  delta: Vec2
): { outline: Vec2[]; objects: SceneObject[] } {
  const [dx, dz] = delta;
  const nextOutline: Vec2[] = outline.map(([x, z]) => [
    Number((x + dx).toFixed(4)),
    Number((z + dz).toFixed(4)),
  ]);

  const nextObjects: SceneObject[] = objects.map((obj) => ({
    ...obj,
    position: [
      Number((obj.position[0] + dx).toFixed(4)),
      obj.position[1],
      Number((obj.position[2] + dz).toFixed(4)),
    ],
  }));

  return { outline: nextOutline, objects: nextObjects };
}

/**
 * Scales entire room outline and object positions around room center to target width & depth.
 */
export function scaleRoomAndObjects(
  outline: readonly Vec2[],
  objects: readonly SceneObject[],
  targetWidth: number,
  targetDepth: number
): { outline: Vec2[]; objects: SceneObject[] } {
  if (outline.length < 3 || targetWidth <= 0.5 || targetDepth <= 0.5) {
    return { outline: [...outline], objects: [...objects] };
  }

  const bounds = polygonBounds(outline);
  const currentW = Math.max(0.1, bounds.width);
  const currentD = Math.max(0.1, bounds.depth);

  const scaleX = targetWidth / currentW;
  const scaleZ = targetDepth / currentD;

  const centerX = (bounds.min[0] + bounds.max[0]) / 2;
  const centerZ = (bounds.min[1] + bounds.max[1]) / 2;

  const nextOutline: Vec2[] = outline.map(([x, z]) => {
    const rx = (x - centerX) * scaleX;
    const rz = (z - centerZ) * scaleZ;
    return [Number((centerX + rx).toFixed(4)), Number((centerZ + rz).toFixed(4))];
  });

  const nextObjects: SceneObject[] = objects.map((obj) => {
    const rx = (obj.position[0] - centerX) * scaleX;
    const rz = (obj.position[2] - centerZ) * scaleZ;
    return {
      ...obj,
      position: [
        Number((centerX + rx).toFixed(4)),
        obj.position[1],
        Number((centerZ + rz).toFixed(4)),
      ],
    };
  });

  return { outline: nextOutline, objects: nextObjects };
}

/**
 * Computes 2D miter join intersection for exterior corner between two meeting walls.
 * Returns the offset vector from vertex corner P to mitered exterior corner point.
 */
function computeMiterFromVectors(
  _dIn: Vec2,
  nIn: Vec2,
  tIn: number,
  _dOut: Vec2,
  nOut: Vec2,
  tOut: number
): Vec2 {
  const bisectorX = nIn[0] + nOut[0];
  const bisectorZ = nIn[1] + nOut[1];
  const len = Math.hypot(bisectorX, bisectorZ);

  if (len < 1e-4) {
    return [nIn[0] * tIn, nIn[1] * tIn];
  }

  const normBisectorX = bisectorX / len;
  const normBisectorZ = bisectorZ / len;

  const dot = normBisectorX * nIn[0] + normBisectorZ * nIn[1];
  const avgThickness = (tIn + tOut) / 2;
  const miterDist = Math.min(avgThickness * 3.0, avgThickness / Math.max(0.25, Math.abs(dot)));

  return [
    Number((normBisectorX * miterDist).toFixed(4)),
    Number((normBisectorZ * miterDist).toFixed(4)),
  ];
}

/**
 * Computes 2D miter join intersection for exterior corner between two meeting walls.
 * Can be called with either (outline, cornerIndex, tIn, tOut) or (dIn, nIn, tIn, dOut, nOut, tOut).
 * Returns the offset vector from vertex corner P to mitered exterior corner point.
 */
export function computeMiterCorner(
  dInOrOutline: Vec2 | readonly Vec2[],
  nInOrCornerIdx: Vec2 | number,
  tIn: number,
  dOutOrTOut?: Vec2 | number,
  nOut?: Vec2,
  tOut?: number
): Vec2 {
  if (Array.isArray(dInOrOutline) && typeof nInOrCornerIdx === 'number') {
    const outline = dInOrOutline as unknown as readonly Vec2[];
    const cornerIndex = nInOrCornerIdx as number;
    const n = outline.length;
    const prevIndex = (cornerIndex - 1 + n) % n;
    const segIn = wallSegment({ outline }, prevIndex);
    const segOut = wallSegment({ outline }, cornerIndex);
    const tIncoming = tIn;
    const tOutgoing = typeof dOutOrTOut === 'number' ? dOutOrTOut : tIn;
    return computeMiterFromVectors(
      segIn.dir,
      segIn.normal,
      tIncoming,
      segOut.dir,
      segOut.normal,
      tOutgoing
    );
  }

  return computeMiterFromVectors(
    dInOrOutline as Vec2,
    nInOrCornerIdx as Vec2,
    tIn,
    dOutOrTOut as Vec2,
    nOut as Vec2,
    tOut ?? tIn
  );
}
