import { describe, it, expect, beforeEach } from 'vitest';
import { useCameraStore } from './cameraStore';

describe('cameraStore', () => {
  beforeEach(() => {
    if (typeof localStorage !== 'undefined') {
      localStorage.clear();
    }
    useCameraStore.setState({
      projection: 'perspective',
      fov: 45,
      dampedInertia: true,
      pivotMode: 'room-center',
      isTurntableActive: false,
      isWalkthroughActive: false,
      savedViews: [],
    });
  });

  it('updates projection mode', () => {
    expect(useCameraStore.getState().projection).toBe('perspective');
    useCameraStore.getState().setProjection('orthographic');
    expect(useCameraStore.getState().projection).toBe('orthographic');
  });

  it('clamps FOV between 30 and 90 degrees', () => {
    useCameraStore.getState().setFov(20);
    expect(useCameraStore.getState().fov).toBe(30);

    useCameraStore.getState().setFov(120);
    expect(useCameraStore.getState().fov).toBe(90);

    useCameraStore.getState().setFov(60);
    expect(useCameraStore.getState().fov).toBe(60);
  });

  it('toggles damped inertia and pivotMode', () => {
    useCameraStore.getState().setDampedInertia(false);
    expect(useCameraStore.getState().dampedInertia).toBe(false);

    useCameraStore.getState().setPivotMode('selection');
    expect(useCameraStore.getState().pivotMode).toBe('selection');

    useCameraStore.getState().setPivotMode('cursor');
    expect(useCameraStore.getState().pivotMode).toBe('cursor');
  });

  it('toggles walkthrough and turntable states', () => {
    expect(useCameraStore.getState().isWalkthroughActive).toBe(false);
    useCameraStore.getState().toggleWalkthrough();
    expect(useCameraStore.getState().isWalkthroughActive).toBe(true);

    expect(useCameraStore.getState().isTurntableActive).toBe(false);
    useCameraStore.getState().toggleTurntable();
    expect(useCameraStore.getState().isTurntableActive).toBe(true);
  });

  it('manages saved views: save, rename, delete', () => {
    const v1 = useCameraStore.getState().saveView({
      name: 'South Angle',
      position: [5, 4, 5],
      target: [0, 0, 0],
      fov: 45,
      projection: 'perspective',
    });

    expect(useCameraStore.getState().savedViews.length).toBe(1);
    expect(useCameraStore.getState().savedViews[0]?.name).toBe('South Angle');

    useCameraStore.getState().renameSavedView(v1.id, 'Renamed Angle');
    expect(useCameraStore.getState().savedViews[0]?.name).toBe('Renamed Angle');

    useCameraStore.getState().deleteSavedView(v1.id);
    expect(useCameraStore.getState().savedViews.length).toBe(0);
  });
});
