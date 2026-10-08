import { describe, expect, it } from 'vitest';
import { createDefaultRoom } from './defaultRoom';
import type { Opening, SceneObject } from './schema';
import {
  checkObjectCollision,
  checkOpeningCollision,
  doObjectsCollide,
  getObjectFootprintCorners,
  isObjectInsideRoom,
} from './collision';

describe('collision module', () => {
  const defaultRoom = createDefaultRoom();

  const createTestObject = (overrides: Partial<SceneObject> = {}): SceneObject => ({
    id: 'test-obj-1',
    assetId: 'single-bed',
    name: 'Single Bed',
    position: [1.5, 0, 1.5],
    rotation: [0, 0, 0],
    size: [1.0, 0.5, 2.0],
    scale: [1, 1, 1],
    elevation: 0,
    role: 'solid',
    wallMounted: false,
    color: '#3b82f6',
    ...overrides,
  });

  describe('getObjectFootprintCorners', () => {
    it('calculates unrotated footprint corners correctly', () => {
      const obj = createTestObject({
        position: [2, 0, 2],
        size: [1.0, 0.5, 2.0],
        rotation: [0, 0, 0],
      });
      const corners = getObjectFootprintCorners(obj);
      expect(corners).toHaveLength(4);
      // Half width = 0.5, half depth = 1.0
      expect(corners).toEqual([
        [1.5, 1.0], // [-0.5, -1.0] + [2, 2]
        [2.5, 1.0], // [0.5, -1.0] + [2, 2]
        [2.5, 3.0], // [0.5, 1.0] + [2, 2]
        [1.5, 3.0], // [-0.5, 1.0] + [2, 2]
      ]);
    });

    it('calculates 90 degree rotated footprint corners correctly', () => {
      const obj = createTestObject({
        position: [2, 0, 2],
        size: [1.0, 0.5, 2.0],
        rotation: [0, Math.PI / 2, 0],
      });
      const corners = getObjectFootprintCorners(obj);
      // Rotated 90 deg around Y: width along Z, depth along X
      expect(corners[0]![0]).toBeCloseTo(3.0, 4);
      expect(corners[0]![1]).toBeCloseTo(1.5, 4);
    });
  });

  describe('isObjectInsideRoom', () => {
    it('returns true when object is safely inside room bounds', () => {
      const obj = createTestObject({
        position: [0.0, 0, 0.0],
        size: [1.0, 0.5, 1.0],
      });
      expect(isObjectInsideRoom(obj, defaultRoom)).toBe(true);
    });

    it('returns false when object center is outside room', () => {
      const obj = createTestObject({
        position: [5.0, 0, 5.0],
      });
      expect(isObjectInsideRoom(obj, defaultRoom)).toBe(false);
    });

    it('returns false when object penetrates a wall', () => {
      // Wall is at X = 2.0. An object centered at [1.8, 0, 0] with width 1.0 extends to X = 2.3
      const obj = createTestObject({
        position: [1.8, 0, 0],
        size: [1.0, 0.5, 1.0],
      });
      expect(isObjectInsideRoom(obj, defaultRoom)).toBe(false);
    });
  });

  describe('doObjectsCollide', () => {
    it('detects collision between overlapping solid objects', () => {
      const objA = createTestObject({
        id: 'obj-a',
        position: [0, 0, 0],
        size: [1.0, 1.0, 1.0],
        role: 'solid',
      });
      const objB = createTestObject({
        id: 'obj-b',
        position: [0.3, 0, 0],
        size: [1.0, 1.0, 1.0],
        role: 'solid',
      });
      expect(doObjectsCollide(objA, objB)).toBe(true);
    });

    it('returns false for separated objects', () => {
      const objA = createTestObject({
        id: 'obj-a',
        position: [-1.0, 0, 0],
        size: [0.8, 1.0, 0.8],
        role: 'solid',
      });
      const objB = createTestObject({
        id: 'obj-b',
        position: [1.0, 0, 0],
        size: [0.8, 1.0, 0.8],
        role: 'solid',
      });
      expect(doObjectsCollide(objA, objB)).toBe(false);
    });

    it('returns false when objects overlap in XZ but differ in elevation (Y clearance)', () => {
      const bed = createTestObject({
        id: 'bed',
        position: [0, 0, 0],
        size: [1.5, 0.5, 2.0],
        elevation: 0,
        role: 'solid',
      });
      const ceilingFan = createTestObject({
        id: 'fan',
        position: [0, 0, 0],
        size: [1.2, 0.3, 1.2],
        elevation: 2.3, // High up, no Y overlap with 0 to 0.5m bed
        role: 'solid',
      });
      expect(doObjectsCollide(bed, ceilingFan)).toBe(false);
    });

    it('returns false if one of the objects is porous or non-solid', () => {
      const objA = createTestObject({
        id: 'obj-a',
        position: [0, 0, 0],
        role: 'solid',
      });
      const objB = createTestObject({
        id: 'obj-b',
        position: [0, 0, 0],
        role: 'porous',
      });
      expect(doObjectsCollide(objA, objB)).toBe(false);
    });
  });

  describe('checkObjectCollision', () => {
    it('returns colliding: false for a valid placement inside empty space', () => {
      const roomWithNoObjects = { ...defaultRoom, objects: [] };
      const obj = createTestObject({ position: [0.0, 0, 0.0] });
      const result = checkObjectCollision(obj, roomWithNoObjects);
      expect(result.colliding).toBe(false);
    });

    it('returns colliding: true with reason outside when penetrating walls', () => {
      const obj = createTestObject({ position: [1.9, 0, 0], size: [1.0, 0.5, 1.0] });
      const result = checkObjectCollision(obj, defaultRoom);
      expect(result.colliding).toBe(true);
      expect(result.reason).toBe('outside');
    });

    it('returns colliding: true with reason solid-overlap when hitting another solid object', () => {
      const existing = createTestObject({ id: 'existing', position: [0.0, 0, 0.0] });
      const room = { ...defaultRoom, objects: [existing] };
      const moving = createTestObject({ id: 'moving', position: [0.2, 0, 0.0] });

      const result = checkObjectCollision(moving, room);
      expect(result.colliding).toBe(true);
      expect(result.reason).toBe('solid-overlap');
      expect(result.collidedWithId).toBe('existing');
    });
  });

  describe('checkOpeningCollision', () => {
    it('returns colliding: false for a valid opening within wall bounds', () => {
      const opening: Opening = {
        id: 'op-test',
        wallIndex: 0,
        type: 'window',
        offset: 1.0,
        width: 1.2,
        height: 1.2,
        sill: 0.9,
        role: 'inlet',
        openFraction: 0,
      };
      const room = { ...defaultRoom, openings: [] };
      expect(checkOpeningCollision(opening, room).colliding).toBe(false);
    });

    it('returns colliding: true when opening exceeds wall length', () => {
      // Wall 0 is 4m long
      const opening: Opening = {
        id: 'op-test',
        wallIndex: 0,
        type: 'window',
        offset: 3.5,
        width: 1.2, // 3.5 + 1.2 = 4.7 > 4.0
        height: 1.2,
        sill: 0.9,
        role: 'inlet',
        openFraction: 0,
      };
      const room = { ...defaultRoom, openings: [] };
      expect(checkOpeningCollision(opening, room).colliding).toBe(true);
      expect(checkOpeningCollision(opening, room).reason).toBe('bounds');
    });

    it('returns colliding: true when two openings overlap on the same wall', () => {
      const op1: Opening = {
        id: 'op-1',
        wallIndex: 0,
        type: 'window',
        offset: 1.0,
        width: 1.2,
        height: 1.2,
        sill: 0.9,
        role: 'inlet',
        openFraction: 0,
      };
      const op2: Opening = {
        id: 'op-2',
        wallIndex: 0,
        type: 'window',
        offset: 1.5, // Overlaps with [1.0, 2.2]
        width: 1.2,
        height: 1.2,
        sill: 0.9,
        role: 'outlet',
        openFraction: 0,
      };
      const room = { ...defaultRoom, openings: [op1] };
      expect(checkOpeningCollision(op2, room).colliding).toBe(true);
      expect(checkOpeningCollision(op2, room).reason).toBe('opening-overlap');
    });
  });
});
