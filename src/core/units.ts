/**
 * Unit conversions and mathematical helper utilities for the AirForce core layer.
 * All spatial coordinates in AirForce are internally represented in METERS.
 */

/**
 * Snaps a numerical value to the nearest multiple of `step`.
 * Works correctly for positive, negative, and zero values.
 *
 * @param value The value to snap
 * @param step The snap interval (must be positive)
 * @returns Snapped value
 */
export function snap(value: number, step: number): number {
  if (step <= 0 || !Number.isFinite(step) || !Number.isFinite(value)) {
    return value;
  }
  const factor = 1 / step;
  const snapped = Math.round(value * factor) / factor;
  // Eliminate floating point precision quirks (e.g. -1.0500000000000003)
  return Number(snapped.toFixed(6));
}

/**
 * Converts degrees to radians.
 */
export function degToRad(deg: number): number {
  return (deg * Math.PI) / 180;
}

/**
 * Converts radians to degrees.
 */
export function radToDeg(rad: number): number {
  return (rad * 180) / Math.PI;
}

/**
 * Clamps a number between min and max bounds.
 */
export function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

/**
 * Converts meters into a standard architectural feet and inches string (e.g., 3' 5").
 *
 * @param meters Length in meters
 * @returns Formatted feet and inches string
 */
export function metersToFeetInches(meters: number): string {
  if (!Number.isFinite(meters)) {
    return "0' 0\"";
  }

  const isNegative = meters < 0;
  const absMeters = Math.abs(meters);

  // 1 meter = 39.37007874 inches
  const totalInches = Math.round(absMeters * 39.37007874);
  let feet = Math.floor(totalInches / 12);
  let inches = totalInches % 12;

  if (inches === 12) {
    feet += 1;
    inches = 0;
  }

  const prefix = isNegative ? '-' : '';
  return `${prefix}${feet}' ${inches}"`;
}
