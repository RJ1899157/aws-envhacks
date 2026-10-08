import { describe, expect, it } from 'vitest';
import {
  Canvas,
  BlenderAxisLines,
  RoomFloorPreview,
  CameraController,
  sharedOrbitControlsRef,
} from './Canvas';
import { ViewportCanvas } from './ViewportCanvas';

describe('Canvas exports and configuration', () => {
  it('exports Canvas and related subcomponents', () => {
    expect(Canvas).toBeDefined();
    expect(BlenderAxisLines).toBeDefined();
    expect(RoomFloorPreview).toBeDefined();
    expect(CameraController).toBeDefined();
    expect(ViewportCanvas).toBeDefined();
  });

  it('provides a sharedOrbitControlsRef with current null initial state', () => {
    expect(sharedOrbitControlsRef).toBeDefined();
    expect('current' in sharedOrbitControlsRef).toBe(true);
    expect(sharedOrbitControlsRef.current).toBeNull();
  });
});
