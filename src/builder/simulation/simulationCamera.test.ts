import { describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { RoomSchema } from '../../core/schema';
import { rectRoom } from '../../test/simulationFixtures';
import { cameraController } from '../cameraController';
import { fitRoomsToRect } from './simulationCamera';

describe('fitRoomsToRect', () => {
  it('frames a room at a fill below the legend fallback range (e.g. 0.45) without failing', () => {
    const animate = vi.spyOn(cameraController, 'animateTo').mockImplementation(() => {});
    const camera = new THREE.PerspectiveCamera(45, 1440 / 900, 0.1, 1000);
    const room = RoomSchema.parse(rectRoom(3, 3, 2.7));
    const viewport = { full: { x: 320, y: 56, w: 1100, h: 784 }, avoid: [] };
    expect(() => fitRoomsToRect([room], camera, null, { width: 1440, height: 900 }, viewport, { fill: 0.45 })).not.toThrow();
    expect(animate).toHaveBeenCalledTimes(1);
    // Smaller fill: the camera ends up further away than at the default house fill
    const far = (animate.mock.calls[0]![2] as THREE.Vector3).distanceTo(animate.mock.calls[0]![3] as THREE.Vector3);
    fitRoomsToRect([room], camera, null, { width: 1440, height: 900 }, viewport);
    const near = (animate.mock.calls[1]![2] as THREE.Vector3).distanceTo(animate.mock.calls[1]![3] as THREE.Vector3);
    expect(far).toBeGreaterThan(near);
    animate.mockRestore();
  });
});
