/**
 * Global AirForce Coordinate & Measurement Conventions
 * - Units: METERS
 * - Coordinate System: Y is UP, Floor plane is XZ
 */

export const DEFAULT_TRANSLATION_SNAP_METERS = 0.05; // 0.05m (5cm)
export const DEFAULT_ROTATION_SNAP_DEGREES = 15; // 15 degrees
export const DEFAULT_ROTATION_SNAP_RADIANS = (DEFAULT_ROTATION_SNAP_DEGREES * Math.PI) / 180;
export const DEFAULT_WALL_HEIGHT_METERS = 2.8; // Standard room wall height in meters
