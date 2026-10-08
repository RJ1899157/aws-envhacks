import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  setPrefersReducedMotionOverride,
  prefersReducedMotion,
  criticallyDampedSpringStep,
  springEase,
} from '../core/motion';
import { setCanvasCursor, resetCanvasCursor, getActiveCanvasCursor } from '../core/cursor';
import { useDropFeedbackStore } from '../store/dropFeedbackStore';
import { useSceneStore } from '../store/sceneStore';
import { useUiStore } from '../store/uiStore';

describe('Polish Layer', () => {
  beforeEach(() => {
    setPrefersReducedMotionOverride(null);
    useDropFeedbackStore.setState({ ripples: [], pulsingObjectIds: {} });
  });

  afterEach(() => {
    setPrefersReducedMotionOverride(null);
  });

  it('respects prefers-reduced-motion to instantly settle motion', () => {
    setPrefersReducedMotionOverride(true);
    expect(prefersReducedMotion()).toBe(true);

    const step = criticallyDampedSpringStep(0, 10, 5, 0.016);
    expect(step.settled).toBe(true);
    expect(step.position).toBe(10);
    expect(step.velocity).toBe(0);

    expect(springEase(0.2)).toBe(1);
    expect(springEase(0.8)).toBe(1);
  });

  it('sets and resets contextual canvas cursors', () => {
    setCanvasCursor('ew-resize');
    expect(getActiveCanvasCursor()).toBe('ew-resize');

    setCanvasCursor('ns-resize');
    expect(getActiveCanvasCursor()).toBe('ns-resize');

    setCanvasCursor('grab');
    expect(getActiveCanvasCursor()).toBe('grab');

    setCanvasCursor('grabbing');
    expect(getActiveCanvasCursor()).toBe('grabbing');

    resetCanvasCursor();
    expect(getActiveCanvasCursor()).toBe('auto');
  });

  it('triggers drop feedback with floor ripples and object pulse', () => {
    const store = useDropFeedbackStore.getState();
    store.triggerDropFeedback('test-obj-1', 2.5, 3.5, 1.2);

    const updated = useDropFeedbackStore.getState();
    expect(updated.ripples.length).toBe(1);
    expect(updated.ripples[0]!.x).toBe(2.5);
    expect(updated.ripples[0]!.z).toBe(3.5);
    expect(updated.ripples[0]!.radius).toBe(1.2);
    expect(updated.pulsingObjectIds['test-obj-1']).toBeDefined();
  });

  it('skips drop ripple feedback when prefers-reduced-motion is active', () => {
    setPrefersReducedMotionOverride(true);
    const store = useDropFeedbackStore.getState();
    store.triggerDropFeedback('test-obj-2', 0, 0, 1.0);

    const updated = useDropFeedbackStore.getState();
    expect(updated.ripples.length).toBe(0);
    expect(updated.pulsingObjectIds['test-obj-2']).toBeUndefined();
  });

  it('toast notification in uiStore supports string messages and undo actions', () => {
    useSceneStore.setState({
      room: {
        version: 1,
        name: 'Test',
        outline: [[0, 0], [4, 0], [4, 4], [0, 4]],
        wallHeight: 2.7,
        wallThickness: 0.15,
        openings: [],
        objects: [],
        floorMaterial: "wood", wallMaterial: "paint", params: {
          windSpeed: 1.5,
          windDirDeg: 0,
          pressurePa: 101325,
          indoorTempC: 22,
          outdoorTempC: 20,
          humidity: 50,
          datetime: '2026-10-05T12:00:00Z',
        },
      },
    });

    useUiStore.getState().setToastMessage('Item placed successfully');
    expect(useUiStore.getState().toastMessage).toBe('Item placed successfully');

    // Temporal store undo is accessible
    expect(typeof useSceneStore.temporal.getState().undo).toBe('function');
  });
});
