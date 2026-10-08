import type { Opening, OpeningRole, OpeningSubType, OpeningType, Room } from './schema';
import { wallSegment } from './parser';
import { snap } from './units';

export type WallSegment = ReturnType<typeof wallSegment>;

export interface OpeningPresetDef {
  subType: OpeningSubType;
  type: OpeningType;
  label: string;
  width: number;
  height: number;
  sill: number;
  defaultRole: OpeningRole;
  description: string;
}

export const OPENING_PRESETS: Record<OpeningSubType, OpeningPresetDef> = {
  'single-door': {
    subType: 'single-door',
    type: 'door',
    label: 'Single Door',
    width: 0.9,
    height: 2.1,
    sill: 0,
    defaultRole: 'closed',
    description: 'Standard residential single leaf entry door',
  },
  'double-door': {
    subType: 'double-door',
    type: 'door',
    label: 'Double Door',
    width: 1.6,
    height: 2.1,
    sill: 0,
    defaultRole: 'closed',
    description: 'Wide double swinging French interior or exterior door',
  },
  'sliding-door': {
    subType: 'sliding-door',
    type: 'door',
    label: 'Sliding Door',
    width: 1.8,
    height: 2.1,
    sill: 0,
    defaultRole: 'closed',
    description: 'Bypass patio or balcony glass sliding door',
  },
  'archway': {
    subType: 'archway',
    type: 'door',
    label: 'Archway',
    width: 1.0,
    height: 2.2,
    sill: 0,
    defaultRole: 'outlet',
    description: 'Full-height open architectural pass-through archway',
  },
  'window': {
    subType: 'window',
    type: 'window',
    label: 'Window',
    width: 1.2,
    height: 1.2,
    sill: 0.9,
    defaultRole: 'inlet',
    description: 'Standard operable casement or hung window',
  },
  'wide-window': {
    subType: 'wide-window',
    type: 'window',
    label: 'Wide Window',
    width: 1.8,
    height: 1.2,
    sill: 0.9,
    defaultRole: 'inlet',
    description: 'Expansive multi-pane picture or horizontal slider window',
  },
  'french-window': {
    subType: 'french-window',
    type: 'window',
    label: 'French Window',
    width: 1.5,
    height: 2.1,
    sill: 0,
    defaultRole: 'inlet',
    description: 'Floor-to-ceiling balcony operable French window',
  },
  'vent': {
    subType: 'vent',
    type: 'window',
    label: 'Small Vent',
    width: 0.4,
    height: 0.4,
    sill: 2.0,
    defaultRole: 'outlet',
    description: 'High-elevation bathroom or natural draft exhaust vent',
  },
};

/**
 * Creates an Opening object initialized from a preset
 */
export function createOpeningFromPreset(
  subType: OpeningSubType,
  wallIndex: number,
  offset: number,
  customId?: string
): Opening {
  const preset = OPENING_PRESETS[subType];
  const id = customId ?? `op-${Date.now().toString(36)}-${Math.random().toString(36).substring(2, 6)}`;
  return {
    id,
    wallIndex,
    type: preset.type,
    subType,
    offset,
    width: preset.width,
    height: preset.height,
    sill: preset.sill,
    role: preset.defaultRole,
    openFraction: preset.defaultRole === 'closed' ? 0 : 0.5,
    flipHinge: false,
    flipSwing: false,
  };
}

export interface NearestWallResult {
  wallIndex: number;
  t: number;
  dist: number;
  seg: WallSegment;
  projX: number;
  projZ: number;
}

/**
 * Projects a 2D floor point (x, z) onto all room walls and returns the closest wall segment
 */
export function findNearestWallForPoint(x: number, z: number, room: Room): NearestWallResult | null {
  if (!room.outline || room.outline.length < 2) return null;

  let closestWallIndex = 0;
  let minDistance = Infinity;
  let bestT = 0;
  let bestProjX = 0;
  let bestProjZ = 0;
  let bestSeg = wallSegment(room, 0);

  for (let i = 0; i < room.outline.length; i++) {
    const seg = wallSegment(room, i);
    const toCursorX = x - seg.a[0];
    const toCursorZ = z - seg.a[1];
    const t = toCursorX * seg.dir[0] + toCursorZ * seg.dir[1];
    const clampedT = Math.max(0, Math.min(seg.len, t));
    const projX = seg.a[0] + clampedT * seg.dir[0];
    const projZ = seg.a[1] + clampedT * seg.dir[1];
    const dist = Math.hypot(x - projX, z - projZ);

    if (dist < minDistance) {
      minDistance = dist;
      closestWallIndex = i;
      bestT = t;
      bestProjX = projX;
      bestProjZ = projZ;
      bestSeg = seg;
    }
  }

  return {
    wallIndex: closestWallIndex,
    t: bestT,
    dist: minDistance,
    seg: bestSeg,
    projX: bestProjX,
    projZ: bestProjZ,
  };
}

export type SnapGuideType = 'wall-center' | 'corner-margin' | 'equal-spacing' | 'grid' | 'none';

export interface OpeningSnapResult {
  snappedOffset: number;
  guideType: SnapGuideType;
  guideOffset: number;
  guideLabel?: string;
}

/**
 * Computes smart snapping for an opening along a wall:
 * - 0.05m grid step
 * - Wall centre: (wallLen - width) / 2
 * - Wall corners with 0.1m margin: 0.1m and (wallLen - width - 0.1m)
 * - Equal spacing between neighboring openings and wall edges
 */
export function computeOpeningSnapGuides(
  room: Room,
  wallIndex: number,
  openingWidth: number,
  rawOffset: number,
  ignoreOpeningId?: string,
  gridStep = 0.05
): OpeningSnapResult {
  const seg = wallSegment(room, wallIndex);
  const wallLen = seg.len;
  const maxOffset = Math.max(0, wallLen - openingWidth);
  const clampedRaw = Math.max(0, Math.min(maxOffset, rawOffset));

  const SNAP_THRESHOLD = 0.08; // 8 cm magnetic threshold

  // 1. Wall Center Snap
  const centerOffset = Math.max(0, (wallLen - openingWidth) / 2);
  if (Math.abs(clampedRaw - centerOffset) < SNAP_THRESHOLD) {
    return {
      snappedOffset: Number(centerOffset.toFixed(4)),
      guideType: 'wall-center',
      guideOffset: centerOffset,
      guideLabel: 'Wall Center',
    };
  }

  // 2. Corner Margin Snaps (0.1m from ends)
  const leftCorner = 0.1;
  const rightCorner = Math.max(0, wallLen - openingWidth - 0.1);
  if (wallLen > openingWidth + 0.2) {
    if (Math.abs(clampedRaw - leftCorner) < SNAP_THRESHOLD) {
      return {
        snappedOffset: Number(leftCorner.toFixed(4)),
        guideType: 'corner-margin',
        guideOffset: leftCorner,
        guideLabel: 'Corner 0.1m',
      };
    }
    if (Math.abs(clampedRaw - rightCorner) < SNAP_THRESHOLD) {
      return {
        snappedOffset: Number(rightCorner.toFixed(4)),
        guideType: 'corner-margin',
        guideOffset: rightCorner,
        guideLabel: 'Corner 0.1m',
      };
    }
  }

  // 3. Equal Spacing Snap between neighbours and wall ends
  const otherOpenings = room.openings
    .filter((o) => o.wallIndex === wallIndex && o.id !== ignoreOpeningId)
    .sort((a, b) => a.offset - b.offset);

  if (otherOpenings.length === 1) {
    const other = otherOpenings[0]!;
    // If to the left of other: try equal margin between 0 and other
    if (clampedRaw + openingWidth <= other.offset) {
      const space = other.offset;
      const equalOffset = (space - openingWidth) / 2;
      if (equalOffset >= 0 && Math.abs(clampedRaw - equalOffset) < SNAP_THRESHOLD) {
        return {
          snappedOffset: Number(equalOffset.toFixed(4)),
          guideType: 'equal-spacing',
          guideOffset: equalOffset,
          guideLabel: 'Centered in bay',
        };
      }
    }
    // If to the right of other: try equal margin between other and wall end
    if (clampedRaw >= other.offset + other.width) {
      const spaceStart = other.offset + other.width;
      const remainingSpace = wallLen - spaceStart;
      const equalOffset = spaceStart + (remainingSpace - openingWidth) / 2;
      if (equalOffset <= maxOffset && Math.abs(clampedRaw - equalOffset) < SNAP_THRESHOLD) {
        return {
          snappedOffset: Number(equalOffset.toFixed(4)),
          guideType: 'equal-spacing',
          guideOffset: equalOffset,
          guideLabel: 'Centered in bay',
        };
      }
    }
  }

  // 4. Default to Grid Step Snap
  const gridSnapped = snap(clampedRaw, gridStep);
  const finalOffset = Math.max(0, Math.min(maxOffset, gridSnapped));
  return {
    snappedOffset: Number(finalOffset.toFixed(4)),
    guideType: 'grid',
    guideOffset: finalOffset,
  };
}

export interface OverlapResolutionResult {
  canPlace: boolean;
  finalOffset: number;
  pushedOpenings: { id: string; offset: number }[];
  errorMessage?: string;
}

/**
 * Checks for opening overlaps on the specified wall.
 * If overlapping, gently pushes the other opening aside if space permits.
 * If cannot be pushed (hits wall end or another opening), returns canPlace = false.
 */
export function resolveOpeningOverlapOnWall(
  room: Room,
  targetWallIndex: number,
  targetOffset: number,
  width: number,
  movingOpeningId?: string
): OverlapResolutionResult {
  const seg = wallSegment(room, targetWallIndex);
  const wallLen = seg.len;
  const maxOffset = Math.max(0, wallLen - width);
  const clampedTarget = Math.max(0, Math.min(maxOffset, targetOffset));

  const otherOpenings = room.openings
    .filter((o) => o.wallIndex === targetWallIndex && o.id !== movingOpeningId)
    .sort((a, b) => a.offset - b.offset);

  // Check if target interval [clampedTarget, clampedTarget + width] overlaps any opening
  const overlaps = otherOpenings.filter(
    (o) => clampedTarget < o.offset + o.width - 0.001 && clampedTarget + width > o.offset + 0.001
  );

  if (overlaps.length === 0) {
    return {
      canPlace: true,
      finalOffset: clampedTarget,
      pushedOpenings: [],
    };
  }

  // We have an overlap. Attempt gentle push on the overlapping opening
  if (overlaps.length === 1) {
    const other = overlaps[0]!;
    const otherMid = other.offset + other.width / 2;
    const targetMid = clampedTarget + width / 2;

    // Determine push direction: push right if target is to the left, push left if target is to the right
    if (targetMid <= otherMid) {
      // Push 'other' to the right
      const pushedOtherOffset = Number((clampedTarget + width + 0.05).toFixed(4));
      // Check if pushed 'other' fits before the next opening or wall end
      const nextOther = otherOpenings.find((o) => o.id !== other.id && o.offset > other.offset);
      const rightLimit = nextOther ? nextOther.offset - 0.05 : wallLen;
      if (pushedOtherOffset + other.width <= rightLimit) {
        return {
          canPlace: true,
          finalOffset: clampedTarget,
          pushedOpenings: [{ id: other.id, offset: pushedOtherOffset }],
        };
      }
    } else {
      // Push 'other' to the left
      const pushedOtherOffset = Number((clampedTarget - other.width - 0.05).toFixed(4));
      // Check if pushed 'other' fits after previous opening or wall start
      const prevOther = [...otherOpenings].reverse().find((o) => o.id !== other.id && o.offset < other.offset);
      const leftLimit = prevOther ? prevOther.offset + prevOther.width + 0.05 : 0;
      if (pushedOtherOffset >= leftLimit) {
        return {
          canPlace: true,
          finalOffset: clampedTarget,
          pushedOpenings: [{ id: other.id, offset: pushedOtherOffset }],
        };
      }
    }
  }

  // Cannot push or multiple overlaps
  return {
    canPlace: false,
    finalOffset: clampedTarget,
    pushedOpenings: [],
    errorMessage: 'Openings cannot overlap on the same wall',
  };
}
