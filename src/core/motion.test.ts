import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  criticallyDampedSpringStep,
  criticallyDampedSpringStepVec3,
  springEase,
  setPrefersReducedMotionOverride,
  prefersReducedMotion,
  MOTION_PRESETS,
} from './motion';

describe('Motion System (critically damped spring & reduced motion)', () => {
  beforeEach(() => {
    setPrefersReducedMotionOverride(null);
  });

  afterEach(() => {
    setPrefersReducedMotionOverride(null);
  });

  it('settles towards target in ~180 ms', () => {
    let pos = 0;
    let vel = 0;
    const target = 1.0;
    const dt = 1 / 60; // 60 FPS (~16.6ms)

    // Simulate 12 frames (~200ms)
    for (let frame = 0; frame < 12; frame++) {
      const res = criticallyDampedSpringStep(pos, target, vel, dt);
      pos = res.position;
      vel = res.velocity;
    }

    // Within 180-200ms, critically damped spring with omega=25 reaches >98% of target
    expect(pos).toBeGreaterThan(0.95);
    expect(pos).toBeLessThanOrEqual(1.001); // Critically damped does not overshoot substantially
  });

  it('settles fully after sufficient iterations', () => {
    let pos = 0;
    let vel = 0;
    const target = 5.0;
    const dt = 1 / 60;
    let settled = false;

    for (let i = 0; i < 30; i++) {
      const res = criticallyDampedSpringStep(pos, target, vel, dt);
      pos = res.position;
      vel = res.velocity;
      settled = res.settled;
      if (settled) break;
    }

    expect(settled).toBe(true);
    expect(pos).toBe(target);
    expect(vel).toBe(0);
  });

  it('criticallyDampedSpringStepVec3 calculates 3D coordinates simultaneously', () => {
    const current: [number, number, number] = [0, 1, 2];
    const target: [number, number, number] = [3, 4, 5];
    const vel: [number, number, number] = [0, 0, 0];
    const dt = 0.05;

    const res = criticallyDampedSpringStepVec3(current, target, vel, dt);
    expect(res.position[0]).toBeGreaterThan(0);
    expect(res.position[1]).toBeGreaterThan(1);
    expect(res.position[2]).toBeGreaterThan(2);
    expect(res.settled).toBe(false);
  });

  it('disables springs and snaps immediately when prefers-reduced-motion is active', () => {
    setPrefersReducedMotionOverride(true);
    expect(prefersReducedMotion()).toBe(true);

    const res = criticallyDampedSpringStep(0, 10, 5, 0.016);
    expect(res.position).toBe(10);
    expect(res.velocity).toBe(0);
    expect(res.settled).toBe(true);

    const vecRes = criticallyDampedSpringStepVec3([0, 0, 0], [1, 2, 3], [1, 1, 1], 0.016);
    expect(vecRes.position).toEqual([1, 2, 3]);
    expect(vecRes.velocity).toEqual([0, 0, 0]);
    expect(vecRes.settled).toBe(true);
  });

  it('springEase returns normalized easing values from 0 to 1', () => {
    expect(springEase(0)).toBe(0);
    expect(springEase(0.5)).toBeGreaterThan(0.6);
    expect(springEase(1)).toBe(1);
  });

  it('springEase returns 1 immediately when reduced-motion is requested', () => {
    setPrefersReducedMotionOverride(true);
    expect(springEase(0.1)).toBe(1);
    expect(springEase(0.5)).toBe(1);
  });

  it('provides CSS presets for 180 ms', () => {
    expect(MOTION_PRESETS.durationMs).toBe(180);
    expect(MOTION_PRESETS.cssDuration).toBe('180ms');
  });
});
