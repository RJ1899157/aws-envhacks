import { afterEach, describe, it, expect, beforeEach, vi } from 'vitest';
import * as THREE from 'three';
import { cameraController } from './cameraController';
import { createSampleRoom } from '../core/sampleRoom';
import { useCameraStore } from '../store/cameraStore';
import { useUiStore } from '../store/uiStore';

import { polygonBounds } from '../core/parser';

let nextFrameId = 1;
let pendingFrames = new Map<number, FrameRequestCallback>();

const advanceAnimation = (milliseconds: number) => {
  const callbacks = [...pendingFrames.values()];
  pendingFrames.clear();
  const now = performance.now() + milliseconds;
  callbacks.forEach((callback) => callback(now));
};

describe('cameraController', () => {
  const sampleRoom = createSampleRoom();

  beforeEach(() => {
    cameraController.cancelAnimation();
    nextFrameId = 1;
    pendingFrames = new Map();
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      const id = nextFrameId++;
      pendingFrames.set(id, callback);
      return id;
    });
    vi.stubGlobal('cancelAnimationFrame', (id: number) => {
      pendingFrames.delete(id);
    });
    useUiStore.setState({ view: '3d' });
    useCameraStore.setState({
      projection: 'perspective',
      fov: 45,
      dampedInertia: true,
      pivotMode: 'room-center',
    });
  });

  afterEach(() => {
    cameraController.cancelAnimation();
    vi.unstubAllGlobals();
  });

  it('calculates room framing accurately', () => {
    const framing = cameraController.getRoomFraming(sampleRoom);
    const bounds = polygonBounds(sampleRoom.outline);
    const expectedX = (bounds.min[0] + bounds.max[0]) / 2;
    const expectedZ = (bounds.min[1] + bounds.max[1]) / 2;
    expect(framing.center.x).toBeCloseTo(expectedX);
    expect(framing.center.z).toBeCloseTo(expectedZ);
    expect(framing.distance).toBeCloseTo(Math.max(bounds.width, bounds.depth, 3.5) * 1.7);
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

  it('interrupts a camera tween and completes the replacement tween', () => {
    const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 1000);
    const controls = { target: new THREE.Vector3(), update: vi.fn() } as any;
    const firstPosition = new THREE.Vector3(10, 5, 10);
    const finalPosition = new THREE.Vector3(-4, 3, 8);

    cameraController.animateTo(camera, controls, firstPosition, new THREE.Vector3(1, 0, 0), {
      duration: 100,
    });
    advanceAnimation(40);
    const interruptedPosition = camera.position.clone();
    expect(interruptedPosition).not.toEqual(new THREE.Vector3(7, 5, 7));

    cameraController.animateTo(camera, controls, finalPosition, new THREE.Vector3(2, 1, 3), {
      duration: 100,
    });
    expect(cameraController.isAnimationActive()).toBe(true);
    advanceAnimation(101);

    expect(camera.position.toArray()).toEqual(finalPosition.toArray());
    expect(controls.target.toArray()).toEqual([2, 1, 3]);
    expect(cameraController.isAnimationActive()).toBe(false);
  });

  it('clamps vertical orbit nudges above the floor and below the horizon', () => {
    const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 1000);
    camera.position.set(0, 2, 0);
    const controls = { target: new THREE.Vector3(), update: vi.fn() } as any;

    cameraController.nudgeOrbit(0, 1000, camera, controls);
    advanceAnimation(200);
    const lowerLimit = new THREE.Spherical().setFromVector3(camera.position);
    expect(lowerLimit.phi).toBeCloseTo(0.05);
    expect(camera.position.y).toBeGreaterThan(0);

    cameraController.nudgeOrbit(0, -1000, camera, controls);
    advanceAnimation(200);
    const upperLimit = new THREE.Spherical().setFromVector3(camera.position);
    expect(upperLimit.phi).toBeCloseTo(Math.PI / 2 - 0.05);
    expect(camera.position.y).toBeGreaterThan(0);
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

  it('animates into orthographic projection and toggles back to perspective', () => {
    const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 1000);
    const mockControls = {
      target: new THREE.Vector3(0, 0, 0),
      update: vi.fn(),
    } as any;

    expect(useCameraStore.getState().projection).toBe('perspective');
    cameraController.toggleProjectionPreservingFraming(camera, mockControls);
    expect(cameraController.isAnimationActive()).toBe(true);
    advanceAnimation(501);
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

  it('fits a selected object using its center and maximum dimension', () => {
    const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 1000);
    const controls = { target: new THREE.Vector3(), update: vi.fn() } as any;
    const selected = sampleRoom.objects.at(0);
    if (!selected) throw new Error('The sample room must contain an object to frame.');
    const elevation = selected.elevation ?? 0;
    const target = new THREE.Vector3(
      selected.position[0],
      (selected.position[1] ?? 0) + elevation + selected.size[1] / 2,
      selected.position[2]
    );

    cameraController.fitSelection(selected.id, sampleRoom, camera, controls, { duration: 50 });
    advanceAnimation(51);

    const distance = Math.max(...selected.size, 1) * 2.5;
    expect(controls.target.toArray()).toEqual(target.toArray());
    expect(camera.position.x).toBeCloseTo(target.x + distance * 0.7);
    expect(camera.position.y).toBeCloseTo(target.y + distance * 0.6);
    expect(camera.position.z).toBeCloseTo(target.z + distance * 0.7);
  });
});
