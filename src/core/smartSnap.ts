import { wallSegment } from './parser';
import type { Room, Vec3 } from './schema';
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

/**
 * Normalizes an angle in radians to [-PI, PI] range
 */
export function normalizeAngleRad(angle: number): number {
  let a = angle % (2 * Math.PI);
  if (a > Math.PI) a -= 2 * Math.PI;
  if (a < -Math.PI) a += 2 * Math.PI;
  return a;
}

/**
 * Computes smart snapping for direct object manipulation:
 * - Snap object edges flush to wall faces when within 0.15 m
 * - Snap to other objects' edges and centers when within 0.1 m
 * - Fall back to grid snapping when enabled
 * - Generate cyan alignment guide lines
 * - Hold Ctrl to temporarily disable snapping
 * - Hold Shift to constrain to dominant axis
 * - Optional auto-orient to wall to face away from it
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

  // 1. Shift key: constrain to dominant movement axis relative to start position
  if (shiftKey) {
    const dx = Math.abs(x - startPos[0]);
    const dz = Math.abs(z - startPos[2]);
    if (dx >= dz) {
      z = startPos[2];
    } else {
      x = startPos[0];
    }
  }

  // 2. Ctrl key or snapping disabled: return raw continuous coordinates with zero guides
  if (ctrlKey || !snapEnabled) {
    const clampedY = Math.max(0, Math.min(room.wallHeight, y));
    return {
      snappedPos: [Number(x.toFixed(4)), Number(clampedY.toFixed(4)), Number(z.toFixed(4))],
      snappedRotY: rotY,
      isWallSnapped: false,
      isObjectSnapped: false,
      alignmentGuides: [],
    };
  }

  const [w, , d] = objectSize;
  const alignmentGuides: AlignmentGuide[] = [];
  let isWallSnapped = false;
  let isObjectSnapped = false;
  let snappedAxisX = false;
  let snappedAxisZ = false;

  // 3. Wall Face Flush Snapping (threshold: 0.15 m)
  if (room.outline.length >= 3) {
    let closestWallDist = Infinity;
    let bestWallIdx = -1;
    let bestDeltaWall = 0;
    let bestWallOrientation = rotY;

    // Half dimensions
    const hw = w / 2;
    const hd = d / 2;

    for (let i = 0; i < room.outline.length; i++) {
      const seg = wallSegment(room, i);
      const toCenterX = x - seg.a[0];
      const toCenterZ = z - seg.a[1];

      // Projected position along wall segment
      const t = toCenterX * seg.dir[0] + toCenterZ * seg.dir[1];
      // Signed distance along outward normal: inside room has negative distance
      const signedDist = toCenterX * seg.normal[0] + toCenterZ * seg.normal[1];
      const distFromWall = -signedDist; // positive distance from inner face into room

      // Only consider if the object is reasonably along the wall segment span
      if (t >= -hw && t <= seg.len + hw) {
        // Angle facing directly away from the wall (into the room)
        const wallAngle = Math.atan2(seg.normal[0], seg.normal[1]);

        // If auto-orient is enabled or rotation is already close to facing away from wall
        const effectiveRot = autoOrientToWall ? wallAngle : rotY;
        const halfDepthAgainstWall = hd;
        const deltaWall = distFromWall - halfDepthAgainstWall;

        if (Math.abs(deltaWall) <= 0.15 && Math.abs(deltaWall) < closestWallDist) {
          closestWallDist = Math.abs(deltaWall);
          bestWallIdx = i;
          bestDeltaWall = deltaWall;
          bestWallOrientation = effectiveRot;
        }
      }
    }

    if (bestWallIdx !== -1) {
      const seg = wallSegment(room, bestWallIdx);
      // Shift object flush against the inner face of the wall
      x += bestDeltaWall * seg.normal[0];
      z += bestDeltaWall * seg.normal[1];
      rotY = bestWallOrientation;
      isWallSnapped = true;

      // Wall alignment guide line along the wall segment
      alignmentGuides.push({
        start: [seg.a[0], 0.005, seg.a[1]],
        end: [seg.b[0], 0.005, seg.b[1]],
        type: 'wall',
      });

      // Mark axes as snapped based on wall normal orientation
      if (Math.abs(seg.normal[0]) > 0.7) snappedAxisX = true;
      if (Math.abs(seg.normal[1]) > 0.7) snappedAxisZ = true;
    }
  }

  // 4. Object-to-Object Snapping (threshold: 0.1 m)
  const SNAP_OBJ_THRESH = 0.1;
  const otherObjects = room.objects.filter((o) => o.id !== objectId);

  const hw = w / 2;
  const hd = d / 2;

  // X-Axis Alignment (Center and Edges)
  if (!snappedAxisX) {
    let minDiffX = Infinity;
    let bestSnapX = x;
    let guideX: AlignmentGuide | null = null;

    for (const other of otherObjects) {
      const [ox, , oz] = other.position;
      const [ow, , od] = other.size;
      const osx = other.scale?.[0] ?? 1;
      const osz = other.scale?.[2] ?? 1;
      const ohw = (ow * osx) / 2;
      const ohd = (od * osz) / 2;

      // Center-to-Center X
      const diffCenter = Math.abs(x - ox);
      if (diffCenter <= SNAP_OBJ_THRESH && diffCenter < minDiffX) {
        minDiffX = diffCenter;
        bestSnapX = ox;
        const minZ = Math.min(z - hd, oz - ohd) - 0.2;
        const maxZ = Math.max(z + hd, oz + ohd) + 0.2;
        guideX = {
          start: [ox, 0.005, minZ],
          end: [ox, 0.005, maxZ],
          type: 'object',
        };
      }

      // Left Edge (x - hw) vs Other Left Edge (ox - ohw)
      const diffLeftLeft = Math.abs(x - hw - (ox - ohw));
      if (diffLeftLeft <= SNAP_OBJ_THRESH && diffLeftLeft < minDiffX) {
        minDiffX = diffLeftLeft;
        bestSnapX = ox - ohw + hw;
        const edgeX = ox - ohw;
        guideX = {
          start: [edgeX, 0.005, Math.min(z - hd, oz - ohd) - 0.2],
          end: [edgeX, 0.005, Math.max(z + hd, oz + ohd) + 0.2],
          type: 'object',
        };
      }

      // Right Edge (x + hw) vs Other Right Edge (ox + ohw)
      const diffRightRight = Math.abs(x + hw - (ox + ohw));
      if (diffRightRight <= SNAP_OBJ_THRESH && diffRightRight < minDiffX) {
        minDiffX = diffRightRight;
        bestSnapX = ox + ohw - hw;
        const edgeX = ox + ohw;
        guideX = {
          start: [edgeX, 0.005, Math.min(z - hd, oz - ohd) - 0.2],
          end: [edgeX, 0.005, Math.max(z + hd, oz + ohd) + 0.2],
          type: 'object',
        };
      }

      // Abutting Left-to-Right (x - hw == ox + ohw)
      const diffAbut1 = Math.abs(x - hw - (ox + ohw));
      if (diffAbut1 <= SNAP_OBJ_THRESH && diffAbut1 < minDiffX) {
        minDiffX = diffAbut1;
        bestSnapX = ox + ohw + hw;
        const edgeX = ox + ohw;
        guideX = {
          start: [edgeX, 0.005, Math.min(z - hd, oz - ohd) - 0.2],
          end: [edgeX, 0.005, Math.max(z + hd, oz + ohd) + 0.2],
          type: 'object',
        };
      }

      // Abutting Right-to-Left (x + hw == ox - ohw)
      const diffAbut2 = Math.abs(x + hw - (ox - ohw));
      if (diffAbut2 <= SNAP_OBJ_THRESH && diffAbut2 < minDiffX) {
        minDiffX = diffAbut2;
        bestSnapX = ox - ohw - hw;
        const edgeX = ox - ohw;
        guideX = {
          start: [edgeX, 0.005, Math.min(z - hd, oz - ohd) - 0.2],
          end: [edgeX, 0.005, Math.max(z + hd, oz + ohd) + 0.2],
          type: 'object',
        };
      }
    }

    if (guideX) {
      x = bestSnapX;
      isObjectSnapped = true;
      snappedAxisX = true;
      alignmentGuides.push(guideX);
    }
  }

  // Z-Axis Alignment (Center and Edges)
  if (!snappedAxisZ) {
    let minDiffZ = Infinity;
    let bestSnapZ = z;
    let guideZ: AlignmentGuide | null = null;

    for (const other of otherObjects) {
      const [ox, , oz] = other.position;
      const [ow, , od] = other.size;
      const osx = other.scale?.[0] ?? 1;
      const osz = other.scale?.[2] ?? 1;
      const ohw = (ow * osx) / 2;
      const ohd = (od * osz) / 2;

      // Center-to-Center Z
      const diffCenter = Math.abs(z - oz);
      if (diffCenter <= SNAP_OBJ_THRESH && diffCenter < minDiffZ) {
        minDiffZ = diffCenter;
        bestSnapZ = oz;
        guideZ = {
          start: [Math.min(x - hw, ox - ohw) - 0.2, 0.005, oz],
          end: [Math.max(x + hw, ox + ohw) + 0.2, 0.005, oz],
          type: 'object',
        };
      }

      // Front Edge (z - hd) vs Other Front Edge (oz - ohd)
      const diffFrontFront = Math.abs(z - hd - (oz - ohd));
      if (diffFrontFront <= SNAP_OBJ_THRESH && diffFrontFront < minDiffZ) {
        minDiffZ = diffFrontFront;
        bestSnapZ = oz - ohd + hd;
        const edgeZ = oz - ohd;
        guideZ = {
          start: [Math.min(x - hw, ox - ohw) - 0.2, 0.005, edgeZ],
          end: [Math.max(x + hw, ox + ohw) + 0.2, 0.005, edgeZ],
          type: 'object',
        };
      }

      // Back Edge (z + hd) vs Other Back Edge (oz + ohd)
      const diffBackBack = Math.abs(z + hd - (oz + ohd));
      if (diffBackBack <= SNAP_OBJ_THRESH && diffBackBack < minDiffZ) {
        minDiffZ = diffBackBack;
        bestSnapZ = oz + ohd - hd;
        const edgeZ = oz + ohd;
        guideZ = {
          start: [Math.min(x - hw, ox - ohw) - 0.2, 0.005, edgeZ],
          end: [Math.max(x + hw, ox + ohw) + 0.2, 0.005, edgeZ],
          type: 'object',
        };
      }

      // Abutting Front-to-Back (z - hd == oz + ohd)
      const diffAbut1 = Math.abs(z - hd - (oz + ohd));
      if (diffAbut1 <= SNAP_OBJ_THRESH && diffAbut1 < minDiffZ) {
        minDiffZ = diffAbut1;
        bestSnapZ = oz + ohd + hd;
        const edgeZ = oz + ohd;
        guideZ = {
          start: [Math.min(x - hw, ox - ohw) - 0.2, 0.005, edgeZ],
          end: [Math.max(x + hw, ox + ohw) + 0.2, 0.005, edgeZ],
          type: 'object',
        };
      }

      // Abutting Back-to-Front (z + hd == oz - ohd)
      const diffAbut2 = Math.abs(z + hd - (oz - ohd));
      if (diffAbut2 <= SNAP_OBJ_THRESH && diffAbut2 < minDiffZ) {
        minDiffZ = diffAbut2;
        bestSnapZ = oz - ohd - hd;
        const edgeZ = oz - ohd;
        guideZ = {
          start: [Math.min(x - hw, ox - ohw) - 0.2, 0.005, edgeZ],
          end: [Math.max(x + hw, ox + ohw) + 0.2, 0.005, edgeZ],
          type: 'object',
        };
      }
    }

    if (guideZ) {
      z = bestSnapZ;
      isObjectSnapped = true;
      snappedAxisZ = true;
      alignmentGuides.push(guideZ);
    }
  }

  // 5. Grid Snap for remaining un-snapped axes
  if (!snappedAxisX) {
    x = snap(x, gridStep);
  }
  if (!snappedAxisZ) {
    z = snap(z, gridStep);
  }

  // 6. Y (Elevation) Snapping: snap to 0.05m or gridStep, clamped to room height
  if (transformY) {
    y = snap(y, 0.05);
  }
  y = Math.max(0, Math.min(room.wallHeight, y));

  // 7. Rotation: snap to 15 degrees if not wall snapped
  if (!isWallSnapped) {
    rotY = snap(rotY, degToRad(15));
  }

  return {
    snappedPos: [Number(x.toFixed(4)), Number(y.toFixed(4)), Number(z.toFixed(4))],
    snappedRotY: Number(rotY.toFixed(4)),
    isWallSnapped,
    isObjectSnapped,
    alignmentGuides,
  };
}
