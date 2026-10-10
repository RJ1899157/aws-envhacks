import { signedArea, wallSegment } from '../core/parser';
import { sharedWallOpenings } from '../core/rooms';
import type { Opening, Room, RoomParams, Vec2, Vec3, WindowStyle } from '../core/schema';
import { DISCHARGE_COEFFICIENT, INSECT_MESH_LOSS_K, WINDOW_STYLE_OPEN_AREA } from './constants';

/** Floor area of the room outline (m²). */
export function floorArea(room: Pick<Room, 'outline'>): number {
  return Math.abs(signedArea(room.outline));
}

/** Height of wall `wallIndex`: its `wallOverrides` height if set, else the room's wall height. */
export function wallHeightAt(room: Pick<Room, 'wallHeight' | 'wallOverrides'>, wallIndex: number): number {
  return room.wallOverrides?.[wallIndex]?.height ?? room.wallHeight;
}

/**
 * Effective ceiling height (m): the perimeter-length-weighted mean of the wall heights, so a long
 * wall counts more than a short return. Equals `wallHeight` when there are no overrides.
 */
export function meanCeilingHeight(room: Pick<Room, 'outline' | 'wallHeight' | 'wallOverrides'>): number {
  if (!room.wallOverrides) return room.wallHeight;
  let length = 0;
  let weighted = 0;
  for (let i = 0; i < room.outline.length; i++) {
    const len = wallSegment(room, i).len;
    length += len;
    weighted += len * wallHeightAt(room, i);
  }
  return length > 0 ? weighted / length : room.wallHeight;
}

/**
 * Air volume of the room (m³): floor polygon area × perimeter-weighted mean wall height. A simple
 * stand-in for a sloped/stepped ceiling, which the schema does not describe; furniture volume is
 * not subtracted. The voxelizer still fills every column to the single `wallHeight`; to match it
 * would need a ceiling height per (x, z) column, e.g. interpolated from the wall heights.
 */
export function roomVolume(room: Pick<Room, 'outline' | 'wallHeight' | 'wallOverrides'>): number {
  return floorArea(room) * meanCeilingHeight(room);
}

/** An opening lets air through when it is not tagged closed and is at least partly open. */
export function isOpeningOpen(op: Pick<Opening, 'role' | 'openFraction'>): boolean {
  return op.role !== 'closed' && op.openFraction > 0;
}

/** Geometric opening area clipped to the wall height (m²). */
export function openingArea(op: Pick<Opening, 'width' | 'height' | 'sill'>, wallHeight: number): number {
  const top = Math.min(op.sill + op.height, wallHeight);
  return op.width * Math.max(0, top - op.sill);
}

export type WindowDefaults = RoomParams['windowDefaults'];

/**
 * How a window opens and whether it has insect mesh: its own setting, else the home's default, else
 * a casement without mesh (the behaviour of designs made before these settings existed). Null for
 * doors, vents and pass-throughs, which these settings don't apply to.
 */
export function windowSettings(op: Pick<Opening, 'type' | 'subType' | 'windowStyle' | 'mesh'>, defaults?: WindowDefaults): { style: WindowStyle; mesh: boolean } | null {
  if (op.type !== 'window' || op.subType === 'vent' || op.subType === 'pass-through') return null;
  return { style: op.windowStyle ?? defaults?.style ?? 'casement', mesh: op.mesh ?? defaults?.mesh ?? false };
}

/** Share of the frame that opens (sliding ≤ ½, louvres ~0.4, casement and non-windows 1). */
export function openAreaShare(op: Pick<Opening, 'type' | 'subType' | 'windowStyle' | 'mesh'>, defaults?: WindowDefaults): number {
  const w = windowSettings(op, defaults);
  return w ? WINDOW_STYLE_OPEN_AREA[w.style] : 1;
}

/** Insect mesh in series with the opening: effective Cd / Cd = 1 / sqrt(1 + K·Cd²) (≈ 0.76). */
export const MESH_FLOW_FACTOR = 1 / Math.sqrt(1 + INSECT_MESH_LOSS_K * DISCHARGE_COEFFICIENT ** 2);

/**
 * Multiplier on an opening's geometric open area that carries its window style and mesh into every
 * model: flows scale with Cd·A, so a lower effective Cd is the same as a smaller area.
 */
export function openingFlowFactor(op: Pick<Opening, 'type' | 'subType' | 'windowStyle' | 'mesh'>, defaults?: WindowDefaults): number {
  const w = windowSettings(op, defaults);
  return w ? WINDOW_STYLE_OPEN_AREA[w.style] * (w.mesh ? MESH_FLOW_FACTOR : 1) : 1;
}

/** Effective open area (m²): width × height × open fraction × window style and mesh, 0 when closed. */
export function effectiveOpenArea(op: Opening, wallHeight: number, defaults?: WindowDefaults): number {
  return isOpeningOpen(op) ? openingArea(op, wallHeight) * op.openFraction * openingFlowFactor(op, defaults) : 0;
}

export interface OpeningGeometry {
  id: string;
  wallIndex: number;
  type: Opening['type'];
  role: Opening['role'];
  /** Geometric area of the hole (m²) */
  area: number;
  /** Area actually open to flow (m²) */
  effectiveArea: number;
  /** Outward unit normal of the wall on the XZ plane: [nx, nz] */
  normal: Vec2;
  /** Unit vector along the wall (from vertex wallIndex to wallIndex + 1): [dx, dz] */
  along: Vec2;
  /** Centre of the opening on the inner wall face, world coordinates [x, y, z] */
  center: Vec3;
  /** Height of the centre above the floor (m) */
  centerHeight: number;
  /** Clear height of the opening (m), clipped to the wall */
  clearHeight: number;
  /** True when the opening sits on a wall shared with a neighbouring room (interior opening) */
  interior: boolean;
}

/**
 * Ids of `room`'s openings that sit on a wall shared with one of `neighbours`. Reuses Phase 1's
 * `sharedWallOpenings` in reverse: asking each neighbour which of *our* openings land on its walls.
 */
export function interiorOpeningIds(room: Room, neighbours: readonly Room[]): Set<string> {
  const ids = new Set<string>();
  for (const other of neighbours) {
    if (other === room || (other.id && other.id === room.id)) continue;
    for (let w = 0; w < other.outline.length; w++) {
      for (const shared of sharedWallOpenings(other, w, [room])) {
        ids.add(shared.id.replace(/^shared-/, ''));
      }
    }
  }
  return ids;
}

/** Geometry of every opening in the room (open or not). */
export function openingGeometries(room: Room, neighbours: readonly Room[] = []): OpeningGeometry[] {
  const interior = neighbours.length > 0 ? interiorOpeningIds(room, neighbours) : new Set<string>();
  return room.openings
    .filter((op) => op.wallIndex >= 0 && op.wallIndex < room.outline.length)
    .map((op) => {
      const seg = wallSegment(room, op.wallIndex);
      const wallH = wallHeightAt(room, op.wallIndex);
      const area = openingArea(op, wallH);
      const clearHeight = Math.max(0, Math.min(op.sill + op.height, wallH) - op.sill);
      const centerHeight = op.sill + clearHeight / 2;
      const u = op.offset + op.width / 2;
      return {
        id: op.id,
        wallIndex: op.wallIndex,
        type: op.type,
        role: op.role,
        area,
        effectiveArea: effectiveOpenArea(op, wallH, room.params.windowDefaults),
        normal: seg.normal,
        along: seg.dir,
        center: [seg.a[0] + u * seg.dir[0], centerHeight, seg.a[1] + u * seg.dir[1]],
        centerHeight,
        clearHeight,
        interior: interior.has(op.id),
      };
    });
}
