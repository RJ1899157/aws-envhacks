/**
 * Motion System: Shared critically damped spring & easing utilities.
 * Settling time is ~180 ms by default (omega = 25 rad/s).
 * Strictly respects prefers-reduced-motion media query and custom overrides.
 */

let reducedMotionOverride: boolean | null = null;

/**
 * Sets a manual override for prefers-reduced-motion (useful for testing or user settings).
 */
export function setPrefersReducedMotionOverride(override: boolean | null): void {
  reducedMotionOverride = override;
}

/**
 * Checks whether reduced motion is preferred by the user.
 */
export function prefersReducedMotion(): boolean {
  if (reducedMotionOverride !== null) {
    return reducedMotionOverride;
  }
  if (typeof window !== 'undefined' && window.matchMedia) {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  }
  return false;
}

export interface SpringConfig {
  /** Natural angular frequency in rad/s. Default 25 rad/s (~180 ms settle time) */
  omega?: number;
  /** Distance threshold below which motion is considered settled. Default 0.0005 */
  settleThreshold?: number;
}

export interface SpringStepResult {
  position: number;
  velocity: number;
  settled: boolean;
}

/**
 * Calculates one step of a critically damped harmonic oscillator (zeta = 1.0).
 * Analytical solution:
 *   x(t) = target + (c1 + c2 * dt) * exp(-omega * dt)
 *   v(t) = (c2 - omega * (c1 + c2 * dt)) * exp(-omega * dt)
 * where c1 = current - target, c2 = velocity + omega * c1.
 */
export function criticallyDampedSpringStep(
  current: number,
  target: number,
  velocity: number,
  dt: number,
  config?: SpringConfig
): SpringStepResult {
  if (prefersReducedMotion() || dt <= 0) {
    return { position: target, velocity: 0, settled: true };
  }

  const omega = config?.omega ?? 25;
  const threshold = config?.settleThreshold ?? 0.001;

  const c1 = current - target;
  const c2 = velocity + omega * c1;
  const decay = Math.exp(-omega * dt);

  const nextPos = target + (c1 + c2 * dt) * decay;
  const nextVel = (c2 - omega * (c1 + c2 * dt)) * decay;

  if (Math.abs(nextPos - target) < threshold && Math.abs(nextVel) < 0.01) {
    return { position: target, velocity: 0, settled: true };
  }

  return { position: nextPos, velocity: nextVel, settled: false };
}

export interface SpringStepVec3Result {
  position: [number, number, number];
  velocity: [number, number, number];
  settled: boolean;
}

/**
 * 3D vector step using critically damped spring.
 */
export function criticallyDampedSpringStepVec3(
  current: [number, number, number],
  target: [number, number, number],
  velocity: [number, number, number],
  dt: number,
  config?: SpringConfig
): SpringStepVec3Result {
  if (prefersReducedMotion() || dt <= 0) {
    return {
      position: [target[0], target[1], target[2]],
      velocity: [0, 0, 0],
      settled: true,
    };
  }

  const stepX = criticallyDampedSpringStep(current[0], target[0], velocity[0], dt, config);
  const stepY = criticallyDampedSpringStep(current[1], target[1], velocity[1], dt, config);
  const stepZ = criticallyDampedSpringStep(current[2], target[2], velocity[2], dt, config);

  return {
    position: [stepX.position, stepY.position, stepZ.position],
    velocity: [stepX.velocity, stepY.velocity, stepZ.velocity],
    settled: stepX.settled && stepY.settled && stepZ.settled,
  };
}

/**
 * Normalized 0..1 spring ease curve for deterministic ~180ms transitions.
 * If reduced motion is requested, instantly returns 1.
 */
export function springEase(progress: number): number {
  if (prefersReducedMotion()) return 1;
  const p = Math.max(0, Math.min(1, progress));
  if (p >= 1) return 1;

  // Normalized critically damped response with tau = 4.6 (~180ms to 99% settle)
  const tau = 4.6;
  const raw = 1 - (1 + tau * p) * Math.exp(-tau * p);
  const maxVal = 1 - (1 + tau) * Math.exp(-tau);
  return Math.min(1, raw / maxVal);
}

/**
 * CSS Spring transition presets.
 */
export const MOTION_PRESETS = {
  durationMs: 180,
  cssEasing: 'cubic-bezier(0.16, 1, 0.3, 1)',
  cssDuration: '180ms',
} as const;
