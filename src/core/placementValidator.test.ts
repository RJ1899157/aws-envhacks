import { describe, expect, it, beforeEach } from 'vitest';
import {
  computeFootprintPenetration,
  validateObject,
  validateAllObjects,
  findNearestValidPosition,
} from './placementValidator';
import { usePlacementIssuesStore } from '../store/placementIssuesStore';
import type { Room, SceneObject, Vec2 } from './schema';
import { createDefaultRoom } from './defaultRoom';

describe('Phase B Placement Validator', () => {
  const baseRoom: Room = {
    version: 1,
    name: 'Test Room',
    outline: [
      [0, 0],
      [4, 0],
      [4, 4],
      [0, 4],
    ],
    wallHeight: 2.7,
    wallThickness: 0.15,
    openings: [],
    objects: [],
    floorMaterial: "wood", wallMaterial: "paint", params: {
      windSpeed: 2.5,
      windDirDeg: 180,
      pressurePa: 101325,
      indoorTempC: 22,
      outdoorTempC: 28,
      humidity: 50,
      datetime: '2026-10-05T12:00:00Z',
    },
  };

  function mockObject(
    data: Partial<SceneObject> & Pick<SceneObject, 'id' | 'assetId' | 'name' | 'position' | 'size'>
  ): SceneObject {
    return {
      rotation: [0, 0, 0],
      scale: [1, 1, 1],
      elevation: 0,
      role: 'solid',
      wallMounted: false,
      ...data,
    };
  }

  beforeEach(() => {
    usePlacementIssuesStore.getState().clearAll();
  });

  describe('computeFootprintPenetration (2D SAT)', () => {
    it('returns null for disjoint axis-aligned footprints', () => {
      const boxA: Vec2[] = [
        [0, 0],
        [1, 0],
        [1, 1],
        [0, 1],
      ];
      const boxB: Vec2[] = [
        [2, 0],
        [3, 0],
        [3, 1],
        [2, 1],
      ];
      expect(computeFootprintPenetration(boxA, boxB)).toBeNull();
    });

    it('returns exact penetration distance for overlapping axis-aligned footprints', () => {
      // Box A from [0,0] to [1,1]
      // Box B from [0.8, 0] to [1.8, 1] -> overlaps by 0.2m along X
      const boxA: Vec2[] = [
        [0, 0],
        [1, 0],
        [1, 1],
        [0, 1],
      ];
      const boxB: Vec2[] = [
        [0.8, 0],
        [1.8, 0],
        [1.8, 1],
        [0.8, 1],
      ];
      const penetration = computeFootprintPenetration(boxA, boxB);
      expect(penetration).not.toBeNull();
      expect(penetration).toBeCloseTo(0.2, 3);
    });

    it('handles rotated footprints and correctly detects separation', () => {
      // Diamond centered at [0, 0] with radius ~0.707
      const diamond: Vec2[] = [
        [1, 0],
        [0, 1],
        [-1, 0],
        [0, -1],
      ];
      // Separated box at [3, 3]
      const farBox: Vec2[] = [
        [2, 2],
        [3, 2],
        [3, 3],
        [2, 3],
      ];
      expect(computeFootprintPenetration(diamond, farBox)).toBeNull();
    });
  });

  describe('validateObject', () => {
    it('passes for an object nicely placed within room boundaries without overlaps', () => {
      const desk = mockObject({
        id: 'desk-1',
        assetId: 'desk-office',
        name: 'Desk',
        position: [2, 0, 2],
        size: [1.2, 0.75, 0.6],
      });
      const issues = validateObject(desk, baseRoom);
      expect(issues).toHaveLength(0);
    });

    it('flags objects located outside room outline', () => {
      const outsideObj = mockObject({
        id: 'obj-out',
        assetId: 'chair-armchair',
        name: 'Armchair',
        position: [5, 0, 5], // Base room is 4x4
        size: [0.8, 0.8, 0.8],
      });
      const issues = validateObject(outsideObj, baseRoom);
      expect(issues.some((i) => i.type === 'outside')).toBe(true);
      expect(issues[0]?.message).toBe('Outside room');
    });

    it('flags objects penetrating boundary walls', () => {
      // Room perimeter wall goes from [4,0] to [4,4]
      // Object centered at x=4.0 spans from 3.6 to 4.4, cutting through the wall
      const wallCutter = mockObject({
        id: 'cutter-1',
        assetId: 'wardrobe-double',
        name: 'Wardrobe',
        position: [4, 0, 2],
        size: [0.8, 2.0, 0.8],
      });
      const issues = validateObject(wallCutter, baseRoom);
      expect(issues.some((i) => i.type === 'wall' || i.type === 'outside')).toBe(true);
    });

    it('flags solid overlap with exact penetration distance in cm', () => {
      const bed = mockObject({
        id: 'bed-1',
        assetId: 'bed-double',
        name: 'Bed',
        position: [2.0, 0, 2.0],
        size: [1.6, 0.9, 2.0],
      });
      // Wardrobe overlaps bed by 10 cm along X (bed extends from 1.2 to 2.8; wardrobe from 2.7 to 3.7)
      const wardrobe = mockObject({
        id: 'wardrobe-1',
        assetId: 'wardrobe-double',
        name: 'Wardrobe',
        position: [3.2, 0, 2.0],
        size: [1.0, 2.0, 0.8],
      });

      const roomWithBed: Room = {
        ...baseRoom,
        objects: [bed],
      };

      const issues = validateObject(wardrobe, roomWithBed);
      const overlapIssue = issues.find((i) => i.type === 'solid-overlap');
      expect(overlapIssue).toBeDefined();
      expect(overlapIssue?.message).toContain('Overlaps Bed by 10 cm');
      expect(overlapIssue?.collidedWithId).toBe('bed-1');
      expect(overlapIssue?.collidedWithName).toBe('Bed');
    });

    it('does not flag overlap if objects are vertically separated in elevation (Y axis)', () => {
      // Table on the floor
      const table = mockObject({
        id: 'table-1',
        assetId: 'table-dining',
        name: 'Table',
        position: [2.0, 0, 2.0],
        size: [1.2, 0.75, 1.2],
        elevation: 0,
      });
      // Hanging item elevated at y=2.0m
      const hangingLamp = mockObject({
        id: 'lamp-1',
        assetId: 'plant-potted',
        name: 'Hanging Plant',
        position: [2.0, 0, 2.0],
        size: [0.5, 0.4, 0.5],
        elevation: 2.0, // Above table (table top is 0.75m)
      });

      const roomWithTable: Room = {
        ...baseRoom,
        objects: [table],
      };

      const issues = validateObject(hangingLamp, roomWithTable);
      expect(issues.filter((i) => i.type === 'solid-overlap')).toHaveLength(0);
    });

    it('does not flag solid-overlap against porous or source objects', () => {
      const airPurifier = mockObject({
        id: 'purifier-1',
        assetId: 'air-purifier',
        name: 'Purifier',
        position: [2.0, 0, 2.0],
        size: [0.4, 0.6, 0.4],
        role: 'source',
      });
      const chair = mockObject({
        id: 'chair-1',
        assetId: 'chair-armchair',
        name: 'Chair',
        position: [2.1, 0, 2.0],
        size: [0.8, 0.8, 0.8],
        role: 'solid',
      });

      const roomWithPurifier: Room = {
        ...baseRoom,
        objects: [airPurifier],
      };

      const issues = validateObject(chair, roomWithPurifier);
      expect(issues.filter((i) => i.type === 'solid-overlap')).toHaveLength(0);
    });

    it('requires wall-mounted items to be within 0.15m of a room wall', () => {
      // Wall mounted item placed in the middle of room (x=2, z=2, base room wall at x=0, x=4)
      const floatingAC = mockObject({
        id: 'ac-1',
        assetId: 'ac-unit',
        name: 'AC Unit',
        position: [2.0, 0, 2.0],
        size: [0.9, 0.3, 0.25],
        wallMounted: true,
      });

      const issuesFar = validateObject(floatingAC, baseRoom);
      expect(issuesFar.some((i) => i.type === 'wall-mounted')).toBe(true);
      expect(issuesFar[0]?.message).toBe('Wall-mounted item must sit on a wall');

      // Now place it flush against the wall at x=0.05m
      const wallAC = mockObject({
        ...floatingAC,
        position: [0.05, 0, 2.0],
      });
      const issuesNear = validateObject(wallAC, baseRoom);
      expect(issuesNear.filter((i) => i.type === 'wall-mounted')).toHaveLength(0);
    });
  });

  describe('validateAllObjects', () => {
    it('returns an empty map when all objects are valid', () => {
      const room: Room = {
        ...baseRoom,
        objects: [
          mockObject({
            id: 'o1',
            assetId: 'chair-armchair',
            name: 'Chair 1',
            position: [1.0, 0, 1.0],
            size: [0.6, 0.8, 0.6],
          }),
          mockObject({
            id: 'o2',
            assetId: 'chair-armchair',
            name: 'Chair 2',
            position: [3.0, 0, 3.0],
            size: [0.6, 0.8, 0.6],
          }),
        ],
      };

      const map = validateAllObjects(room);
      expect(Object.keys(map)).toHaveLength(0);
    });

    it('maps objectId to its specific placement issues', () => {
      const room: Room = {
        ...baseRoom,
        objects: [
          mockObject({
            id: 'o1',
            assetId: 'chair-armchair',
            name: 'Chair 1',
            position: [2.0, 0, 2.0],
            size: [0.8, 0.8, 0.8],
          }),
          mockObject({
            id: 'o2',
            assetId: 'chair-armchair',
            name: 'Chair 2',
            position: [2.1, 0, 2.0], // Overlaps o1
            size: [0.8, 0.8, 0.8],
          }),
        ],
      };

      const map = validateAllObjects(room);
      expect(map['o1']).toBeDefined();
      expect(map['o2']).toBeDefined();
      expect(map['o1']![0]!.type).toBe('solid-overlap');
    });
  });

  describe('findNearestValidPosition (Spiral Search Nudge)', () => {
    it('returns original position immediately if object is already valid', () => {
      const validObj = mockObject({
        id: 'valid-1',
        assetId: 'desk-office',
        name: 'Desk',
        position: [2.0, 0, 2.0],
        size: [1.0, 0.75, 0.6],
      });
      const pos = findNearestValidPosition(validObj, baseRoom, 0.05);
      expect(pos).toEqual([2.0, 0, 2.0]);
    });

    it('finds a nearby non-overlapping valid position for a colliding object', () => {
      const obstacle = mockObject({
        id: 'obs',
        assetId: 'bed-double',
        name: 'Obstacle Bed',
        position: [2.0, 0, 2.0],
        size: [1.6, 0.9, 2.0],
      });

      // Colliding object initially right on top of obstacle
      const collidingObj = mockObject({
        id: 'colliding',
        assetId: 'chair-armchair',
        name: 'Chair',
        position: [2.0, 0, 2.0],
        size: [0.6, 0.8, 0.6],
      });

      const roomWithObstacle: Room = {
        ...baseRoom,
        objects: [obstacle, collidingObj],
      };

      const newPos = findNearestValidPosition(collidingObj, roomWithObstacle, 0.05);
      expect(newPos).not.toBeNull();

      // Verify the new position actually clears all issues!
      const nudgedObj: SceneObject = {
        ...collidingObj,
        position: newPos!,
      };
      const issues = validateObject(nudgedObj, roomWithObstacle);
      expect(issues).toHaveLength(0);
    });
  });

  describe('Placement Issues Store', () => {
    it('tracks flagged timestamps for 1.5s pulse and resets on issue resolution', () => {
      const store = usePlacementIssuesStore.getState();

      // Flag an issue on obj1
      store.setIssues({
        obj1: [
          {
            id: 'obj1-overlap',
            objectId: 'obj1',
            type: 'solid-overlap',
            message: 'Overlaps Desk by 10 cm',
          },
        ],
      });

      const flagged = usePlacementIssuesStore.getState().flaggedTimestamps['obj1'];
      expect(flagged).toBeDefined();
      expect(Date.now() - flagged!).toBeLessThan(100);

      // Dismiss object (Keep anyway)
      store.dismissObject('obj1');
      expect(usePlacementIssuesStore.getState().dismissedObjectIds).toContain('obj1');

      // Clear issue when moved to valid spot
      store.setIssues({});
      expect(usePlacementIssuesStore.getState().issues).toEqual({});
      expect(usePlacementIssuesStore.getState().flaggedTimestamps['obj1']).toBeUndefined();
      expect(usePlacementIssuesStore.getState().dismissedObjectIds).not.toContain('obj1');
    });
  });
});

describe('validateObject wall contact', () => {
  it('does not flag an object sitting flush in a corner', () => {
    const room = createDefaultRoom();
    const bed: SceneObject = {
      id: 'bed',
      assetId: 'single-bed',
      name: 'Single Bed',
      position: [-1.5, 0, -0.5],
      rotation: [0, 0, 0],
      size: [1.0, 0.5, 2.0],
      elevation: 0,
      role: 'solid',
      wallMounted: false,
    };
    expect(validateObject(bed, room)).toEqual([]);
  });
});
