import { beforeEach, describe, expect, it } from 'vitest';
import {
  moveWallPerpendicular,
  extrudeWallAlcove,
  setWallLengthWithAnchor,
  adjustOpeningsForWallLength,
  adjustOpeningsForWallSplit,
  adjustOpeningsForWallMerge,
  moveRoomAndObjects,
  scaleRoomAndObjects,
  computeMiterCorner,
} from './wallOperations';
import {
  createRectangleShape,
  createLShape,
  createUShape,
  createTShape,
  generateQuickShape,
} from './quickShapes';
import { isPolygonSimple, signedArea } from './parser';
import type { Opening, SceneObject, Vec2 } from './schema';
import { useSceneStore } from '../store/sceneStore';
import { useUiStore } from '../store/uiStore';

describe('Wall Operations & Quick Shapes Core Mechanics', () => {
  beforeEach(() => {
    useSceneStore.getState().resetRoom();
    useSceneStore.temporal.getState().clear();
    useUiStore.getState().resetUi();
  });

  describe('Quick Shapes Generators', () => {
    it('creates counter-clockwise rectangle with requested dimensions', () => {
      const rect = createRectangleShape(5.0, 3.5);
      expect(rect).toHaveLength(4);
      expect(isPolygonSimple(rect)).toBe(true);
      expect(signedArea(rect)).toBeGreaterThan(0);
      expect(Math.abs(signedArea(rect))).toBeCloseTo(17.5, 2);
    });

    it('creates valid counter-clockwise L-shaped outline', () => {
      const lShape = createLShape(6.0, 4.0, 2.5, 2.0);
      expect(lShape).toHaveLength(6);
      expect(isPolygonSimple(lShape)).toBe(true);
      expect(signedArea(lShape)).toBeGreaterThan(0);
    });

    it('creates valid counter-clockwise U-shaped outline', () => {
      const uShape = createUShape(6.0, 4.5, 2.0, 2.0);
      expect(uShape).toHaveLength(8);
      expect(isPolygonSimple(uShape)).toBe(true);
      expect(signedArea(uShape)).toBeGreaterThan(0);
    });

    it('creates valid counter-clockwise T-shaped outline', () => {
      const tShape = createTShape(6.0, 5.0, 2.5, 2.5);
      expect(tShape).toHaveLength(8);
      expect(isPolygonSimple(tShape)).toBe(true);
      expect(signedArea(tShape)).toBeGreaterThan(0);
    });

    it('generates all quick shape types via unified generateQuickShape', () => {
      const types = ['rectangle', 'l-shape', 'u-shape', 't-shape'] as const;
      for (const t of types) {
        const poly = generateQuickShape(t, { width: 5, depth: 4 });
        expect(poly.length).toBeGreaterThanOrEqual(4);
        expect(isPolygonSimple(poly)).toBe(true);
        expect(signedArea(poly)).toBeGreaterThan(0);
      }
    });
  });

  describe('Perpendicular Wall Movement', () => {
    it('translates both endpoints along outward normal, stretching neighbouring walls', () => {
      const square: Vec2[] = [
        [0, 0],
        [4, 0],
        [4, 3],
        [0, 3],
      ];
      // Wall 0 runs from [0,0] to [4,0]. Outward normal points in -Z: [0, -1]
      const moved = moveWallPerpendicular(square, 0, 1.0);
      expect(moved).toHaveLength(4);
      // Both corners 0 and 1 should have moved by -1.0 in Z
      expect(moved[0]![1]).toBeCloseTo(-1.0, 2);
      expect(moved[1]![1]).toBeCloseTo(-1.0, 2);
      // Corners 2 and 3 remain at their original positions
      expect(moved[2]).toEqual([4, 3]);
      expect(moved[3]).toEqual([0, 3]);
      expect(isPolygonSimple(moved)).toBe(true);
    });
  });

  describe('Alt-Drag Extrude Wall Alcove', () => {
    it('inserts 4 new corners creating an alcove/bump on the selected wall', () => {
      const square: Vec2[] = [
        [0, 0],
        [4, 0],
        [4, 3],
        [0, 3],
      ];
      // Wall 2 runs from [4,3] to [0,3], normal points in +Z: [0, 1]
      const extruded = extrudeWallAlcove(square, 2, 0.5, 0.25, 0.75);
      expect(extruded).toHaveLength(8); // 4 original + 4 inserted
      expect(isPolygonSimple(extruded)).toBe(true);
      expect(signedArea(extruded)).toBeGreaterThan(signedArea(square)); // area increased
    });
  });

  describe('Set Wall Length with Anchors', () => {
    const square: Vec2[] = [
      [0, 0],
      [4, 0],
      [4, 3],
      [0, 3],
    ];

    it('anchor "start": Corner A stays fixed, Corner B moves along wall direction', () => {
      // Wall 0: [0,0] to [4,0]. Direction is +X: [1, 0]
      const updated = setWallLengthWithAnchor(square, 0, 6.0, 'start');
      expect(updated[0]).toEqual([0, 0]); // Corner A fixed
      expect(updated[1]![0]).toBeCloseTo(6.0, 2); // Corner B extended
      expect(updated[1]![1]).toBeCloseTo(0, 2);
    });

    it('anchor "end": Corner B stays fixed, Corner A moves along opposite wall direction', () => {
      const updated = setWallLengthWithAnchor(square, 0, 6.0, 'end');
      expect(updated[1]).toEqual([4, 0]); // Corner B fixed
      expect(updated[0]![0]).toBeCloseTo(-2.0, 2); // Corner A shifted backwards
      expect(updated[0]![1]).toBeCloseTo(0, 2);
    });

    it('anchor "center": Both corners expand symmetrically from the midpoint', () => {
      const updated = setWallLengthWithAnchor(square, 0, 6.0, 'center');
      // Midpoint was [2, 0]. Half length = 3.0.
      expect(updated[0]![0]).toBeCloseTo(-1.0, 2);
      expect(updated[1]![0]).toBeCloseTo(5.0, 2);
    });
  });

  describe('Openings Resiliency & Adjustment', () => {
    it('scales opening offset proportionally when wall length changes', () => {
      const openings: Opening[] = [
        {
          id: 'w1',
          type: 'window',
          wallIndex: 0,
          offset: 1.0,
          width: 1.2,
          height: 1.2,
          sill: 0.9,
          role: 'inlet',
          openFraction: 1,
        },
      ];

      // Wall length doubles from 4.0 to 8.0
      const { adjustedOpenings, removedOpenings } = adjustOpeningsForWallLength(
        openings,
        0,
        4.0,
        8.0
      );

      expect(removedOpenings).toHaveLength(0);
      expect(adjustedOpenings).toHaveLength(1);
      // Offset should scale proportionally: 1.0 * (8.0 / 4.0) = 2.0
      expect(adjustedOpenings[0]!.offset).toBeCloseTo(2.0, 2);
    });

    it('identifies and removes openings that cannot fit on a shrunk wall', () => {
      const openings: Opening[] = [
        {
          id: 'w1',
          type: 'window',
          wallIndex: 0,
          offset: 1.0,
          width: 1.5,
          height: 1.2,
          sill: 0.9,
          role: 'inlet',
          openFraction: 1,
        },
      ];

      // Wall length shrunk to 1.0m (window width 1.5m cannot fit)
      const { adjustedOpenings, removedOpenings } = adjustOpeningsForWallLength(
        openings,
        0,
        4.0,
        1.0
      );

      expect(removedOpenings).toHaveLength(1);
      expect(removedOpenings[0]!.id).toBe('w1');
      expect(adjustedOpenings).toHaveLength(0);
    });

    it('adjusts opening wallIndex when a wall is split', () => {
      const openings: Opening[] = [
        {
          id: 'w1',
          type: 'window',
          wallIndex: 0,
          offset: 3.0,
          width: 0.8,
          height: 1.0,
          sill: 0.9,
          role: 'inlet',
          openFraction: 1,
        },
      ];

      // Split wall 0 at splitOffset = 2.0
      const adjusted = adjustOpeningsForWallSplit(openings, 0, 2.0);
      expect(adjusted).toHaveLength(1);
      // Opening was at 3.0 (> 2.0), so it transfers to wallIndex 1 with offset 1.0
      expect(adjusted[0]!.wallIndex).toBe(1);
      expect(adjusted[0]!.offset).toBeCloseTo(1.0, 2);
    });

    it('merges openings onto merged wall when a corner is removed', () => {
      const openings: Opening[] = [
        {
          id: 'w1',
          type: 'window',
          wallIndex: 1,
          offset: 0.5,
          width: 0.8,
          height: 1.0,
          sill: 0.9,
          role: 'inlet',
          openFraction: 1,
        },
      ];

      // Delete corner 1: merges wall 0 (len 4.0) and wall 1 (len 3.0)
      const adjusted = adjustOpeningsForWallMerge(openings, 1, 4.0);
      expect(adjusted).toHaveLength(1);
      expect(adjusted[0]!.wallIndex).toBe(0);
      // Offset becomes 4.0 + 0.5 = 4.5
      expect(adjusted[0]!.offset).toBeCloseTo(4.5, 2);
    });
  });

  describe('Move & Scale Entire Room with Objects', () => {
    it('moves room outline and objects together', () => {
      const outline: Vec2[] = [
        [0, 0],
        [4, 0],
        [4, 3],
        [0, 3],
      ];
      const objects: SceneObject[] = [
        {
          id: 'obj-1',
          assetId: 'bed_double',
          name: 'Bed',
          position: [2, 0, 1.5],
          rotation: [0, 0, 0],
          size: [1.6, 0.9, 2.0],
          elevation: 0,
          role: 'solid',
          wallMounted: false,
        },
      ];

      const { outline: movedOutline, objects: movedObjects } = moveRoomAndObjects(
        outline,
        objects,
        [1.5, -0.5]
      );

      expect(movedOutline[0]).toEqual([1.5, -0.5]);
      expect(movedObjects[0]!.position).toEqual([3.5, 0, 1.0]);
    });

    it('scales room outline and objects around centroid to target width and depth', () => {
      const outline: Vec2[] = [
        [0, 0],
        [4, 0],
        [4, 4],
        [0, 4],
      ];
      const objects: SceneObject[] = [
        {
          id: 'obj-1',
          assetId: 'chair',
          name: 'Chair',
          position: [2, 0, 2], // At centroid
          rotation: [0, 0, 0],
          size: [0.6, 0.8, 0.6],
          elevation: 0,
          role: 'solid',
          wallMounted: false,
        },
      ];

      const { outline: scaledOutline, objects: scaledObjects } = scaleRoomAndObjects(
        outline,
        objects,
        8.0,
        8.0
      );

      // Centroid is [2, 2]. Width doubled to 8, bounds should be [-2, 6]
      expect(scaledOutline[0]![0]).toBeCloseTo(-2.0, 2);
      expect(scaledOutline[1]![0]).toBeCloseTo(6.0, 2);
      // Object at centroid remains at [2, 0, 2]
      expect(scaledObjects[0]!.position[0]).toBeCloseTo(2.0, 2);
      expect(scaledObjects[0]!.position[2]).toBeCloseTo(2.0, 2);
    });
  });

  describe('Miter Corner Computation', () => {
    it('computes exact exterior corner intersection vector', () => {
      const outline: Vec2[] = [
        [0, 0],
        [4, 0],
        [4, 3],
        [0, 3],
      ];
      // Corner 1 is at [4, 0] with 90 degree angle
      const miter = computeMiterCorner(outline, 1, 0.2, 0.2);
      expect(miter).not.toBeNull();
      expect(Number.isFinite(miter![0])).toBe(true);
      expect(Number.isFinite(miter![1])).toBe(true);
    });
  });

  describe('SceneStore Wall Operations & Undo/Redo', () => {
    it('executes moveWall, setWallOverride, and undoes them as single atomic steps', () => {
      const store = useSceneStore.getState();
      const initialOutline = [...store.room.outline];

      // 1. Move Wall
      store.moveWall(0, 0.5);
      expect(useSceneStore.getState().room.outline).not.toEqual(initialOutline);

      // 2. Undo moveWall
      useSceneStore.temporal.getState().undo();
      expect(useSceneStore.getState().room.outline).toEqual(initialOutline);

      // 3. Set Wall Override
      useSceneStore.getState().setWallOverride(0, { thickness: 0.35, color: '#991b1b' });
      expect(useSceneStore.getState().room.wallOverrides?.[0]?.thickness).toBe(0.35);
      expect(useSceneStore.getState().room.wallOverrides?.[0]?.color).toBe('#991b1b');

      // 4. Undo override
      useSceneStore.temporal.getState().undo();
      expect(useSceneStore.getState().room.wallOverrides?.[0]?.thickness).toBeUndefined();
    });

    it('splits a wall and merges a corner atomically', () => {
      const store = useSceneStore.getState();
      expect(store.room.outline).toHaveLength(4);

      // Split wall 0
      store.splitWall(0, [2.0, 0]);
      expect(useSceneStore.getState().room.outline).toHaveLength(5);

      // Undo split
      useSceneStore.temporal.getState().undo();
      expect(useSceneStore.getState().room.outline).toHaveLength(4);

      // Merge corner 1
      store.mergeCorner(1);
      expect(useSceneStore.getState().room.outline).toHaveLength(3);

      // Undo merge
      useSceneStore.temporal.getState().undo();
      expect(useSceneStore.getState().room.outline).toHaveLength(4);
    });

    it('sets quick shape and updates room outline', () => {
      const store = useSceneStore.getState();
      store.setQuickShape('l-shape', { width: 5.0, depth: 4.0 });
      expect(useSceneStore.getState().room.outline).toHaveLength(6);

      // Undo restores original 4 corners
      useSceneStore.temporal.getState().undo();
      expect(useSceneStore.getState().room.outline).toHaveLength(4);
    });
  });
});
