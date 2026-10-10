import type { Vec2 } from './schema';

/**
 * THE wind/compass convention for Airforce. Everything that turns a bearing into a direction (the
 * Airflow tab compass, the scene wind indicator, the ventilation model, the voxel solver) goes
 * through this module.
 *
 * - Plan north is −Z and east is +X on the XZ floor plane. That is "up" and "right" in the 2D plan
 *   and in the top camera preset, so the compass (N at the top) matches what is on screen.
 * - `windDirDeg` is the meteorological direction the wind blows FROM, in degrees clockwise from
 *   north (0 = from the north, 90 = from the east). Air moves the opposite way.
 */

/** Unit vector of plan north on the XZ plane: [x, z] */
export const NORTH_XZ: Vec2 = [0, -1];
/** Unit vector of plan east on the XZ plane: [x, z] */
export const EAST_XZ: Vec2 = [1, 0];

/** Unit XZ vector pointing toward compass bearing `deg` (0 = north, clockwise). */
export function bearingToXZ(deg: number): Vec2 {
  const r = (deg * Math.PI) / 180;
  const s = Math.sin(r);
  const c = Math.cos(r);
  return [s * EAST_XZ[0] + c * NORTH_XZ[0], s * EAST_XZ[1] + c * NORTH_XZ[1]];
}

/** Compass bearing (0–360, clockwise from north) of an XZ direction. */
export function xzToBearing(v: Vec2): number {
  const east = v[0] * EAST_XZ[0] + v[1] * EAST_XZ[1];
  const north = v[0] * NORTH_XZ[0] + v[1] * NORTH_XZ[1];
  const deg = (Math.atan2(east, north) * 180) / Math.PI;
  return (deg + 360) % 360;
}

/** Unit XZ vector pointing toward where the wind comes from. */
export function windFromXZ(windDirDeg: number): Vec2 {
  return bearingToXZ(windDirDeg);
}

/** Unit XZ vector of the direction the air moves (downwind). */
export function windFlowXZ(windDirDeg: number): Vec2 {
  const [x, z] = bearingToXZ(windDirDeg);
  return [-x, -z];
}

/**
 * Screen offset (SVG/CSS coordinates, y down) of bearing `deg` on a north-up dial of radius `r`.
 * Matches the plan view because north (−Z) is drawn up and east (+X) right.
 */
export function bearingToScreen(deg: number, r = 1): [number, number] {
  const r0 = (deg * Math.PI) / 180;
  return [r * Math.sin(r0), -r * Math.cos(r0)];
}

const POINTS = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];

/** 16-point compass name of a bearing, e.g. 300 → "WNW". */
export function compassPoint(deg: number): string {
  return POINTS[Math.round((((deg % 360) + 360) % 360) / 22.5) % 16]!;
}
