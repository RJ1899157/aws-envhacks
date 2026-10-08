import { describe, expect, it } from 'vitest';
import { createDefaultRoom } from './defaultRoom';
import {
  isPolygonSimple,
  parseRoom,
  pointInPolygon,
  polygonBounds,
  signedArea,
  wallSegment,
} from './parser';
import type { Opening, SceneObject, Vec2 } from './schema';

describe('Room Parser & Geometry Helpers', () => {
  describe('Geometry Helpers', () => {
    it('signedArea computes positive area for CCW and negative for CW', () => {
      const ccwOutline: Vec2[] = [
        [-2, -1.5],
        [2, -1.5],
        [2, 1.5],
        [-2, 1.5],
      ];
      const cwOutline: Vec2[] = [
        [-2, 1.5],
        [2, 1.5],
        [2, -1.5],
        [-2, -1.5],
      ];

      expect(signedArea(ccwOutline)).toBe(12);
      expect(signedArea(cwOutline)).toBe(-12);
      expect(signedArea([])).toBe(0);
    });

    it('pointInPolygon accurately determines interior and exterior points', () => {
      const outline: Vec2[] = [
        [-2, -1.5],
        [2, -1.5],
        [2, 1.5],
        [-2, 1.5],
      ];

      expect(pointInPolygon([0, 0], outline)).toBe(true);
      expect(pointInPolygon([1.5, 1.0], outline)).toBe(true);
      expect(pointInPolygon([5, 5], outline)).toBe(false);
      expect(pointInPolygon([-3, 0], outline)).toBe(false);
    });

    it('wallSegment returns segment endpoints, length, direction, and normal', () => {
      const outline: Vec2[] = [
        [-2, -1.5],
        [2, -1.5],
        [2, 1.5],
        [-2, 1.5],
      ];

      const seg0 = wallSegment({ outline }, 0);
      expect(seg0.a).toEqual([-2, -1.5]);
      expect(seg0.b).toEqual([2, -1.5]);
      expect(seg0.len).toBe(4);
      expect(seg0.dir).toEqual([1, 0]);
      expect(seg0.normal[0]).toBeCloseTo(0);
      expect(seg0.normal[1]).toBeCloseTo(-1); // Points outward (-Z)

      const seg1 = wallSegment({ outline }, 1);
      expect(seg1.a).toEqual([2, -1.5]);
      expect(seg1.b).toEqual([2, 1.5]);
      expect(seg1.len).toBe(3);
      expect(seg1.dir).toEqual([0, 1]);
      expect(seg1.normal[0]).toBeCloseTo(1); // Points outward (+X)
      expect(seg1.normal[1]).toBeCloseTo(0);
    });

    it('polygonBounds computes min, max, width, and depth', () => {
      const outline: Vec2[] = [
        [-2, -1.5],
        [2, -1.5],
        [2, 1.5],
        [-2, 1.5],
      ];

      const bounds = polygonBounds(outline);
      expect(bounds.min).toEqual([-2, -1.5]);
      expect(bounds.max).toEqual([2, 1.5]);
      expect(bounds.width).toBe(4);
      expect(bounds.depth).toBe(3);
    });

    it('isPolygonSimple returns true for simple polygons and false for self-intersecting ones', () => {
      const simpleBox: Vec2[] = [
        [-2, -2],
        [2, -2],
        [2, 2],
        [-2, 2],
      ];
      expect(isPolygonSimple(simpleBox)).toBe(true);

      const selfIntersectingFigure8: Vec2[] = [
        [-2, -2],
        [2, 2],
        [2, -2],
        [-2, 2],
      ];
      expect(isPolygonSimple(selfIntersectingFigure8)).toBe(false);
    });
  });

  describe('parseRoom', () => {
    it('successfully parses the default valid room with no issues', () => {
      const defaultRoom = createDefaultRoom();
      const result = parseRoom(defaultRoom);

      expect(result.room).not.toBeNull();
      expect(result.issues).toEqual([]);
      expect(result.room?.name).toBe('Default Room (4x3m)');
      expect(result.room?.openings).toHaveLength(2);
    });

    it('flips clockwise outline to counter-clockwise with a warning', () => {
      const defaultRoom = createDefaultRoom();
      // Reverse outline to clockwise
      const cwRoom = {
        ...defaultRoom,
        outline: [...defaultRoom.outline].reverse(),
      };

      const result = parseRoom(cwRoom);
      expect(result.room).not.toBeNull();
      expect(signedArea(result.room!.outline)).toBeGreaterThan(0);
      expect(result.issues).toContainEqual(
        expect.objectContaining({
          level: 'warning',
          message: expect.stringMatching(/clockwise/i),
        })
      );
    });

    it('flags error and drops overlong opening exceeding wall length', () => {
      const defaultRoom = createDefaultRoom();
      const overlongOpening: Opening = {
        id: 'overlong-win-1',
        wallIndex: 0, // Wall 0 is 4.0m long
        type: 'window',
        offset: 3.0,
        width: 2.0, // 3.0 + 2.0 = 5.0m > 4.0m
        height: 1.2,
        sill: 0.9,
        role: 'inlet',
        openFraction: 0.5,
      };

      const roomData = {
        ...defaultRoom,
        openings: [defaultRoom.openings[1]!, overlongOpening], // 1 valid door + 1 overlong window
      };

      const result = parseRoom(roomData);
      expect(result.issues).toContainEqual(
        expect.objectContaining({
          level: 'error',
          ref: 'overlong-win-1',
          message: expect.stringMatching(/exceeds wall 0 length/i),
        })
      );
      // Because an error occurred, room is null
      expect(result.room).toBeNull();
    });

    it('flags self-intersecting polygon as error and returns room = null', () => {
      const defaultRoom = createDefaultRoom();
      const selfIntersecting = {
        ...defaultRoom,
        outline: [
          [-2, -2],
          [2, 2],
          [2, -2],
          [-2, 2],
        ] as Vec2[],
      };

      const result = parseRoom(selfIntersecting);
      expect(result.room).toBeNull();
      expect(result.issues).toContainEqual(
        expect.objectContaining({
          level: 'error',
          message: expect.stringMatching(/self-intersection/i),
        })
      );
    });

    it('flags duplicate object IDs as error and drops them', () => {
      const defaultRoom = createDefaultRoom();
      const chair1: SceneObject = {
        id: 'dup-chair',
        assetId: 'office-chair',
        name: 'Desk Chair 1',
        position: [0, 0, 0],
        rotation: [0, 0, 0],
        size: [0.65, 0.95, 0.65],
        elevation: 0,
        role: 'porous',
        wallMounted: false,
      };
      const chair2: SceneObject = {
        id: 'dup-chair', // Duplicate ID
        assetId: 'office-chair',
        name: 'Desk Chair 2',
        position: [1, 0, 0],
        rotation: [0, 0, 0],
        size: [0.65, 0.95, 0.65],
        elevation: 0,
        role: 'porous',
        wallMounted: false,
      };

      const roomData = {
        ...defaultRoom,
        objects: [chair1, chair2],
      };

      const result = parseRoom(roomData);
      expect(result.room).toBeNull();
      expect(result.issues).toContainEqual(
        expect.objectContaining({
          level: 'error',
          ref: 'dup-chair',
          message: expect.stringMatching(/duplicate object id/i),
        })
      );
    });

    it('flags unknown assetId as error and drops the object', () => {
      const defaultRoom = createDefaultRoom();
      const badObject: SceneObject = {
        id: 'unknown-obj-1',
        assetId: 'space-shuttle-reactor', // Unknown asset
        name: 'Reactor',
        position: [0, 0, 0],
        rotation: [0, 0, 0],
        size: [1, 1, 1],
        elevation: 0,
        role: 'source',
        wallMounted: false,
      };

      const result = parseRoom({
        ...defaultRoom,
        objects: [badObject],
      });

      expect(result.room).toBeNull();
      expect(result.issues).toContainEqual(
        expect.objectContaining({
          level: 'error',
          ref: 'unknown-obj-1',
          message: expect.stringMatching(/unknown assetid/i),
        })
      );
    });

    it('errors if any wall length is less than 0.3m', () => {
      const defaultRoom = createDefaultRoom();
      // Introduce tiny 0.1m wall segment
      const roomWithShortWall = {
        ...defaultRoom,
        outline: [
          [-2, -1.5],
          [2, -1.5],
          [2, 1.4],
          [2, 1.5], // 0.1m wall segment between (2, 1.4) and (2, 1.5)
          [-2, 1.5],
        ] as Vec2[],
      };

      const result = parseRoom(roomWithShortWall);
      expect(result.room).toBeNull();
      expect(result.issues).toContainEqual(
        expect.objectContaining({
          level: 'error',
          message: expect.stringMatching(/less than 0\.3m/i),
        })
      );
    });

    it('errors if floor area is zero or degenerate', () => {
      const defaultRoom = createDefaultRoom();
      const collinearRoom = {
        ...defaultRoom,
        outline: [
          [0, 0],
          [2, 0],
          [4, 0],
        ] as Vec2[],
        openings: [],
      };

      const result = parseRoom(collinearRoom);
      expect(result.room).toBeNull();
      expect(result.issues).toContainEqual(
        expect.objectContaining({
          level: 'error',
          message: expect.stringMatching(/zero or degenerate/i),
        })
      );
    });

    it('warns if floor area is less than 4 m²', () => {
      const defaultRoom = createDefaultRoom();
      // 1.5m x 1.5m room -> area = 2.25 m² (< 4 m²)
      const smallRoom = {
        ...defaultRoom,
        outline: [
          [0, 0],
          [1.5, 0],
          [1.5, 1.5],
          [0, 1.5],
        ] as Vec2[],
        openings: [], // Avoid missing wall indices
      };

      const result = parseRoom(smallRoom);
      // Only warnings: area < 4 and lack of cross ventilation
      expect(result.room).not.toBeNull();
      expect(result.issues).toContainEqual(
        expect.objectContaining({
          level: 'warning',
          message: expect.stringMatching(/less than 4 m²/i),
        })
      );
    });

    it('warns if object centre is outside the floor boundary', () => {
      const defaultRoom = createDefaultRoom();
      const outsideObject: SceneObject = {
        id: 'outside-desk',
        assetId: 'desk',
        name: 'Outside Desk',
        position: [10, 0, 10], // Outside 4m x 3m boundary
        rotation: [0, 0, 0],
        size: [1.4, 0.75, 0.7],
        elevation: 0,
        role: 'solid',
        wallMounted: false,
      };

      const result = parseRoom({
        ...defaultRoom,
        objects: [outsideObject],
      });

      expect(result.room).not.toBeNull();
      expect(result.issues).toContainEqual(
        expect.objectContaining({
          level: 'warning',
          ref: 'outside-desk',
          message: expect.stringMatching(/outside the room floor boundary/i),
        })
      );
    });

    it('warns if there is no cross-ventilation (missing inlet or outlet)', () => {
      const defaultRoom = createDefaultRoom();
      // Remove door, leaving only window (inlet)
      const noCrossVentRoom = {
        ...defaultRoom,
        openings: [defaultRoom.openings[0]!], // only 1 inlet
      };

      const result = parseRoom(noCrossVentRoom);
      expect(result.room).not.toBeNull();
      expect(result.issues).toContainEqual(
        expect.objectContaining({
          level: 'warning',
          message: expect.stringMatching(/cross-ventilation/i),
        })
      );
    });

    it('errors and drops openings exceeding wall height', () => {
      const defaultRoom = createDefaultRoom();
      const tallWindow: Opening = {
        id: 'tall-win',
        wallIndex: 0,
        type: 'window',
        offset: 1.0,
        width: 1.0,
        height: 2.0,
        sill: 1.5, // 1.5 + 2.0 = 3.5m > wallHeight (2.7m)
        role: 'inlet',
        openFraction: 0.5,
      };

      const result = parseRoom({
        ...defaultRoom,
        openings: [tallWindow],
      });

      expect(result.room).toBeNull();
      expect(result.issues).toContainEqual(
        expect.objectContaining({
          level: 'error',
          ref: 'tall-win',
          message: expect.stringMatching(/exceeds wall height/i),
        })
      );
    });

    it('errors and drops openings referencing a missing wall index', () => {
      const defaultRoom = createDefaultRoom();
      const badWallOpening: Opening = {
        id: 'win-missing-wall',
        wallIndex: 10, // Default room has only 4 walls (0-3)
        type: 'window',
        offset: 0.5,
        width: 1.0,
        height: 1.0,
        sill: 0.9,
        role: 'inlet',
        openFraction: 0.5,
      };

      const result = parseRoom({
        ...defaultRoom,
        openings: [badWallOpening],
      });

      expect(result.room).toBeNull();
      expect(result.issues).toContainEqual(
        expect.objectContaining({
          level: 'error',
          ref: 'win-missing-wall',
          message: expect.stringMatching(/missing wall index/i),
        })
      );
    });
  });
});
