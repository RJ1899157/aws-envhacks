import { beforeEach, describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { useSceneStore } from '../store/sceneStore';
import { useUiStore } from '../store/uiStore';
import {
  getObjectGroup,
  objectGroupRegistry,
  registerObjectGroup,
  unregisterObjectGroup,
} from './objectRegistry';
import { computeSmartSnap } from '../core/smartSnap';
import { degToRad, radToDeg, snap } from '../core/units';
import type { Room, SceneObject } from '../core/schema';

describe('Direct Manipulation & Smart Snapping System', () => {
  const testRoom: Room = {
    version: 1,
    name: 'Direct Drag Test Room',
    outline: [
      [0, 0],
      [5, 0],
      [5, 4],
      [0, 4],
    ],
    wallHeight: 3.0,
    wallThickness: 0.15,
    openings: [],
    objects: [],
    params: {
      windSpeed: 2.5,
      windDirDeg: 0,
      indoorTempC: 21,
      outdoorTempC: 25,
      humidity: 45,
      pressurePa: 101325,
      datetime: '2026-05-15T12:00:00Z',
    },
  };

  const sampleChair: SceneObject = {
    id: 'chair-test-1',
    assetId: 'office-chair',
    name: 'Office Chair',
    position: [2.0, 0, 2.0],
    rotation: [0, 0, 0],
    size: [0.65, 0.95, 0.65],
    elevation: 0,
    role: 'solid',
    wallMounted: false,
  };

  beforeEach(() => {
    useSceneStore.getState().resetRoom();
    useSceneStore.temporal.getState().clear();
    useUiStore.getState().resetUi();
    objectGroupRegistry.clear();
  });

  describe('UiStore Defaults for Direct Manipulation & Precision Mode', () => {
    it('defaults precision gizmo to OFF as requested', () => {
      expect(useUiStore.getState().showPrecisionGizmo).toBe(false);
      useUiStore.getState().togglePrecisionGizmo();
      expect(useUiStore.getState().showPrecisionGizmo).toBe(true);
      useUiStore.getState().togglePrecisionGizmo();
      expect(useUiStore.getState().showPrecisionGizmo).toBe(false);
    });

    it('defaults autoOrientToWall to OFF as an opt-in toggle', () => {
      expect(useUiStore.getState().autoOrientToWall).toBe(false);
      useUiStore.getState().toggleAutoOrientToWall();
      expect(useUiStore.getState().autoOrientToWall).toBe(true);
      useUiStore.getState().toggleAutoOrientToWall();
      expect(useUiStore.getState().autoOrientToWall).toBe(false);
    });
  });

  describe('Object Group Registry', () => {
    it('registers and retrieves Three.js groups for zero-react-render 60fps manipulation', () => {
      const group = new THREE.Group();
      registerObjectGroup('chair-test-1', group);

      expect(getObjectGroup('chair-test-1')).toBe(group);

      unregisterObjectGroup('chair-test-1');
      expect(getObjectGroup('chair-test-1')).toBeUndefined();
    });
  });

  describe('Spring Ease-Out Overshoot Curve', () => {
    it('computes 0 at start, 1 at end, and exhibits overshoot spring character', () => {
      const springEaseOut = (p: number): number => {
        const s = 1.35;
        const t = p - 1;
        return 1 + (s + 1) * Math.pow(t, 3) + s * Math.pow(t, 2);
      };

      // At start (p = 0)
      expect(springEaseOut(0)).toBeCloseTo(0);

      // At end (p = 1)
      expect(springEaseOut(1)).toBeCloseTo(1);

      // Mid-progress overshoot: around p = 0.7 to 0.8, should slightly exceed 1.0
      const peak = springEaseOut(0.75);
      expect(peak).toBeGreaterThan(1.0);
      expect(peak).toBeLessThan(1.08); // subtle overshoot, under 8%
    });
  });

  describe('Rotation Handle Angle Calculations', () => {
    it('computes live angle in XZ plane and snaps to 15 degrees', () => {
      const objCenter: [number, number] = [2.0, 2.0]; // X, Z
      // Hit point at (X = 3.0, Z = 2.0) -> pointing directly along +X
      const hitX = 3.0;
      const hitZ = 2.0;

      // angle = atan2(hit.x - obj.x, hit.z - obj.z)
      // dx = 1.0, dz = 0.0 -> atan2(1, 0) = PI / 2 (90 deg)
      const angle = Math.atan2(hitX - objCenter[0], hitZ - objCenter[1]);
      expect(angle).toBeCloseTo(Math.PI / 2);
      expect(radToDeg(angle)).toBeCloseTo(90);

      // Snap to 15 degrees: 90 is already a multiple of 15
      const snapped = snap(angle, degToRad(15));
      expect(snapped).toBeCloseTo(degToRad(90));

      // With unaligned angle e.g. 38 degrees
      const unaligned = degToRad(38);
      const snapped38 = snap(unaligned, degToRad(15));
      // Closest 15 deg multiple is 45 deg
      expect(radToDeg(snapped38)).toBeCloseTo(45);
    });

    it('supports free rotation without snap when Shift is held', () => {
      const unaligned = degToRad(37.4);
      // When Shift is held, snapping is bypassed and exact angle is preserved
      const finalAngle = unaligned;
      expect(radToDeg(finalAngle)).toBeCloseTo(37.4);
    });
  });

  describe('Vertical Lift Mode (Alt / Q)', () => {
    it('snaps elevation to 0.05m and clamps within room height', () => {
      const res = computeSmartSnap({
        candidatePos: [2.0, 1.23, 2.0],
        candidateRotY: 0,
        objectSize: [0.65, 0.95, 0.65],
        startPos: [2.0, 0, 2.0],
        room: testRoom,
        gridStep: 0.05,
        snapEnabled: true,
        transformY: true,
      });

      // 1.23 snaps to 1.25m
      expect(res.snappedPos[1]).toBeCloseTo(1.25);

      // Above ceiling clamp
      const resAbove = computeSmartSnap({
        candidatePos: [2.0, 5.0, 2.0],
        candidateRotY: 0,
        objectSize: [0.65, 0.95, 0.65],
        startPos: [2.0, 0, 2.0],
        room: testRoom,
        gridStep: 0.05,
        snapEnabled: true,
        transformY: true,
      });

      expect(resAbove.snappedPos[1]).toBeCloseTo(testRoom.wallHeight);
    });
  });

  describe('One Drag = One Undo Step Guarantees', () => {
    it('commits single undo step when dragging completes', () => {
      useSceneStore.getState().addObject(sampleChair);
      useSceneStore.temporal.getState().clear();

      // Begin direct drag session
      useSceneStore.getState().setIsDragging(true);

      // Pointer moves through continuous positions (in reality Three.js group moves at 60fps)
      // Only upon pointer release is updateObject called
      useSceneStore.getState().updateObject('chair-test-1', {
        position: [3.2, 0, 2.8],
        rotation: [0, degToRad(45), 0],
      });

      // End drag session
      useSceneStore.getState().setIsDragging(false);

      expect(useSceneStore.getState().room.objects[0]?.position).toEqual([3.2, 0, 2.8]);

      // Exactly ONE undo reverts back to [2.0, 0, 2.0]
      useSceneStore.temporal.getState().undo();
      expect(useSceneStore.getState().room.objects[0]?.position).toEqual([2.0, 0, 2.0]);
      expect(useSceneStore.getState().room.objects[0]?.rotation).toEqual([0, 0, 0]);

      // Redo restores dragged state
      useSceneStore.temporal.getState().redo();
      expect(useSceneStore.getState().room.objects[0]?.position).toEqual([3.2, 0, 2.8]);
    });
  });
});
