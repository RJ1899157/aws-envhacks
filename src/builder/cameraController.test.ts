import { describe, it, expect, beforeEach, vi } from 'vitest';
import * as THREE from 'three';
import { cameraController } from './cameraController';
import { createSampleRoom } from '../core/sampleRoom';
import { useCameraStore } from '../store/cameraStore';
import { useUiStore } from '../store/uiStore';

import { polygonBounds } from '../core/parser';

describe('cameraController', () => {
  const sampleRoom = createSampleRoom();

  beforeEach(() => {
    useUiStore.setState({ view: '3d' });
    useCameraStore.setState({
      projection: 'perspective',
      fov: 45,
      dampedInertia: true,
      pivotMode: 'room-center',
    });
  });

  it('calculates room framing accurately', () => {
    const framing = cameraController.getRoomFraming(sampleRoom);
    const bounds = polygonBounds(sampleRoom.outline);
    const expectedX = (bounds.min[0] + bounds.max[0]) / 2;
    const expectedZ = (bounds.min[1] + bounds.max[1]) / 2;
    expect(framing.center.x).toBeCloseTo(expectedX);
    expect(framing.center.z).toBeCloseTo(expectedZ);
    expect(framing.distance).toBeGreaterThan(4);
  });

  it('navigates to presets and animates camera', () => {
    const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 1000);
    camera.position.set(0, 0, 0);

    const mockControls = {
      target: new THREE.Vector3(0, 0, 0),
      update: vi.fn(),
    } as any;

    cameraController.goToPreset('top', sampleRoom, camera, mockControls, {
      duration: 10,
    });

    expect(cameraController.isAnimationActive()).toBe(true);

    cameraController.cancelAnimation();
    expect(cameraController.isAnimationActive()).toBe(false);
  });

  it('nudges camera orbit by degree increments', () => {
    const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 1000);
    camera.position.set(5, 5, 5);

    const mockControls = {
      target: new THREE.Vector3(0, 0, 0),
      update: vi.fn(),
    } as any;

    cameraController.nudgeOrbit(15, 0, camera, mockControls);
    expect(cameraController.isAnimationActive()).toBe(true);
    cameraController.cancelAnimation();
  });

  it('recenters orbit pivot to target point', () => {
    const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 1000);
    camera.position.set(10, 5, 10);

    const mockControls = {
      target: new THREE.Vector3(0, 0, 0),
      update: vi.fn(),
    } as any;

    const hitPoint = new THREE.Vector3(2.5, 0, 3.5);
    cameraController.recenterPivot(hitPoint, camera, mockControls);
    expect(cameraController.isAnimationActive()).toBe(true);
    cameraController.cancelAnimation();
  });

  it('toggles projection between perspective and orthographic', () => {
    const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 1000);
    const mockControls = {
      target: new THREE.Vector3(0, 0, 0),
      update: vi.fn(),
    } as any;

    expect(useCameraStore.getState().projection).toBe('perspective');
    cameraController.toggleProjectionPreservingFraming(camera, mockControls);
    expect(useCameraStore.getState().projection).toBe('orthographic');

    cameraController.toggleProjectionPreservingFraming(camera, mockControls);
    expect(useCameraStore.getState().projection).toBe('perspective');
  });

  it('fits selected object or fits room', () => {
    const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 1000);
    const mockControls = {
      target: new THREE.Vector3(0, 0, 0),
      update: vi.fn(),
    } as any;

    cameraController.fitSelection('obj-bed', sampleRoom, camera, mockControls);
    expect(cameraController.isAnimationActive()).toBe(true);
    cameraController.cancelAnimation();

    cameraController.fitSelection(null, sampleRoom, camera, mockControls);
    expect(cameraController.isAnimationActive()).toBe(true);
    cameraController.cancelAnimation();
  });
});
