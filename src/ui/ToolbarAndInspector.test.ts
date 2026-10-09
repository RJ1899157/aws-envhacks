import { beforeEach, describe, expect, it } from 'vitest';
import { useSceneStore } from '../store/sceneStore';
import { useUiStore } from '../store/uiStore';
import { Toolbar, Inspector, HudOverlay } from './index';
import { createSampleRoom } from '../core/sampleRoom';
import { parseRoom } from '../core/parser';
import { RoomParamsSchema } from '../core/schema';
import type { SceneObject } from '../core/types';

describe('Toolbar, Inspector, and HUD Overlay Integration', () => {
  beforeEach(() => {
    useSceneStore.getState().resetRoom();
    useSceneStore.temporal.getState().clear();
    useUiStore.getState().resetUi();
  });

  describe('Exports and Component Registration', () => {
    it('exports Toolbar, Inspector, and HudOverlay from ui index', () => {
      expect(Toolbar).toBeDefined();
      expect(Inspector).toBeDefined();
      expect(HudOverlay).toBeDefined();
    });
  });

  describe('Sample Room Factory', () => {
    it('generates a valid, cross-ventilated master bedroom suite', () => {
      const sample = createSampleRoom();
      expect(sample.name).toContain('Sample Master Suite');
      expect(sample.outline).toHaveLength(4);
      expect(sample.openings.length).toBeGreaterThanOrEqual(3);
      expect(sample.objects.length).toBeGreaterThanOrEqual(5);

      const parsed = parseRoom(sample);
      expect(parsed.room).not.toBeNull();
      const errors = parsed.issues.filter((i) => i.level === 'error');
      expect(errors).toHaveLength(0);

      // Verify inlet and outlet openings exist
      const hasInlet = sample.openings.some((op) => op.role === 'inlet');
      const hasOutlet = sample.openings.some((op) => op.role === 'outlet');
      expect(hasInlet).toBe(true);
      expect(hasOutlet).toBe(true);
    });
  });

  describe('Toolbar Actions and State Control', () => {
    it('reaches all UI tool modes and toggles via store actions', () => {
      // Tool modes
      useUiStore.getState().setToolMode('draw-floor');
      expect(useUiStore.getState().toolMode).toBe('draw-floor');

      useUiStore.getState().setToolMode('place');
      expect(useUiStore.getState().toolMode).toBe('place');

      useUiStore.getState().setToolMode('select');
      expect(useUiStore.getState().toolMode).toBe('select');

      // Transform mode
      useUiStore.getState().setTransformMode('rotate');
      expect(useUiStore.getState().transformMode).toBe('rotate');

      // 2D / 3D View mode
      useUiStore.getState().setView('2d');
      expect(useUiStore.getState().view).toBe('2d');

      // Snapping & Grid Step dropdown values
      useUiStore.getState().setSnapEnabled(false);
      expect(useUiStore.getState().snapEnabled).toBe(false);
      useUiStore.getState().toggleSnap();
      expect(useUiStore.getState().snapEnabled).toBe(true);

      const supportedSteps = [0.01, 0.05, 0.1, 0.25];
      for (const step of supportedSteps) {
        useUiStore.getState().setGridStep(step);
        expect(useUiStore.getState().gridStep).toBe(step);
      }

      // Dimension labels and ceiling toggles
      useUiStore.getState().toggleDimensions();
      expect(useUiStore.getState().showDimensions).toBe(false);
      useUiStore.getState().toggleCeiling();
      expect(useUiStore.getState().showCeiling).toBe(false);
    });

    it('executes New Room, Load Sample Room, Undo, Redo, and JSON Import/Export', () => {
      // Load sample room
      const sample = createSampleRoom();
      useSceneStore.getState().loadRoom(sample);
      expect(useSceneStore.getState().room.name).toBe(sample.name);

      // Export JSON
      const exported = useSceneStore.getState().exportRoom();
      expect(typeof exported).toBe('string');
      expect(exported).toContain('Sample Master Suite');

      // Reset Room (New room)
      useSceneStore.getState().resetRoom();
      expect(useSceneStore.getState().room.name).toBe('Default Room (4x3m)');

      // Import JSON back
      const importResult = useSceneStore.getState().importRoom(exported);
      expect(importResult.success).toBe(true);
      expect(useSceneStore.getState().room.name).toBe(sample.name);

      // Modify room and test Undo / Redo
      useSceneStore.getState().setWallHeight(3.5);
      expect(useSceneStore.getState().room.wallHeight).toBe(3.5);

      useSceneStore.temporal.getState().undo();
      expect(useSceneStore.getState().room.wallHeight).toBe(2.8);

      useSceneStore.temporal.getState().redo();
      expect(useSceneStore.getState().room.wallHeight).toBe(3.5);
    });
  });

  describe('Inspector: Room & Simulation Parameters with Zod Validation', () => {
    it('updates room name, wall height, and wall thickness', () => {
      useSceneStore.getState().setRoomName('Executive Suite');
      expect(useSceneStore.getState().room.name).toBe('Executive Suite');

      useSceneStore.getState().setWallHeight(3.2);
      expect(useSceneStore.getState().room.wallHeight).toBe(3.2);

      useSceneStore.getState().setWallThickness(0.25);
      expect(useSceneStore.getState().room.wallThickness).toBe(0.25);
    });

    it('validates simulation parameters with Zod schema and catches invalid inputs', () => {
      // Valid parameters update
      const validParams = {
        windSpeed: 4.5,
        windDirDeg: 180,
        pressurePa: 101000,
        indoorTempC: 21.5,
        outdoorTempC: 30.0,
        humidity: 45.0,
      };

      const parsedValid = RoomParamsSchema.safeParse(validParams);
      expect(parsedValid.success).toBe(true);

      useSceneStore.getState().setParams(validParams);
      expect(useSceneStore.getState().room.params.windSpeed).toBe(4.5);
      expect(useSceneStore.getState().room.params.windDirDeg).toBe(180);
      expect(useSceneStore.getState().room.params.humidity).toBe(45.0);

      // Invalid windSpeed: negative
      const invalidWind = RoomParamsSchema.safeParse({ windSpeed: -2.0 });
      expect(invalidWind.success).toBe(false);
      if (!invalidWind.success) {
        expect(invalidWind.error.errors[0]?.message).toMatch(/cannot be negative/i);
      }

      // Invalid windDirDeg: > 360
      const invalidDir = RoomParamsSchema.safeParse({ windDirDeg: 400 });
      expect(invalidDir.success).toBe(false);
      if (!invalidDir.success) {
        expect(invalidDir.error.errors[0]?.message).toMatch(/0-360/i);
      }

      // Invalid humidity: > 100
      const invalidHumidity = RoomParamsSchema.safeParse({ humidity: 150 });
      expect(invalidHumidity.success).toBe(false);
      if (!invalidHumidity.success) {
        expect(invalidHumidity.error.errors[0]?.message).toMatch(/0-100/i);
      }

      // Reset to defaults
      const defaults = RoomParamsSchema.parse({});
      useSceneStore.getState().setParams(defaults);
      expect(useSceneStore.getState().room.params.windSpeed).toBe(2.5);
      expect(useSceneStore.getState().room.params.windDirDeg).toBe(0);
      expect(useSceneStore.getState().room.params.humidity).toBe(50.0);
    });

    it('configures pollutant source parameters and toggling', () => {
      // Enable pollutant source
      useSceneStore.getState().setParams({
        pollutantSource: {
          type: 'VOC',
          emissionRateMgH: 25,
          position: [1.0, 0, -0.5],
        },
      });

      const paramsWithPollutant = useSceneStore.getState().room.params;
      expect(paramsWithPollutant.pollutantSource).toBeDefined();
      expect(paramsWithPollutant.pollutantSource?.emissionRateMgH).toBe(25);
      expect(paramsWithPollutant.pollutantSource?.position).toEqual([1.0, 0, -0.5]);

      // Disable pollutant source
      useSceneStore.getState().setParams({ pollutantSource: undefined });
      expect(useSceneStore.getState().room.params.pollutantSource).toBeUndefined();
    });
  });

  describe('Inspector: Selected Object Transformations and Controls', () => {
    const testDesk: SceneObject = {
      id: 'desk-inspect',
      assetId: 'desk',
      name: 'Executive Desk',
      position: [0.5, 0, 0.5],
      rotation: [0, 0, 0],
      size: [1.4, 0.75, 0.7],
      elevation: 0,
      role: 'solid',
      wallMounted: false,
    };

    beforeEach(() => {
      useSceneStore.getState().addObject(testDesk);
      useSceneStore.getState().selectObject('desk-inspect');
    });

    it('edits object name, position, rotation, and elevation', () => {
      useSceneStore.getState().updateObject('desk-inspect', {
        name: 'Custom Corner Desk',
        position: [1.0, 0, 0.8],
        rotation: [0, Math.PI / 2, 0],
        elevation: 0.1,
      });

      const updated = useSceneStore.getState().room.objects.find((o) => o.id === 'desk-inspect')!;
      expect(updated.name).toBe('Custom Corner Desk');
      expect(updated.position).toEqual([1.0, 0, 0.8]);
      expect(updated.rotation[1]).toBeCloseTo(Math.PI / 2, 4);
      expect(updated.elevation).toBe(0.1);
    });

    it('supports duplicating and deleting the selected object', () => {
      const duplicated = useSceneStore.getState().duplicateObject('desk-inspect');
      expect(duplicated).not.toBeNull();
      expect(useSceneStore.getState().room.objects).toHaveLength(2);
      expect(duplicated?.id).not.toBe('desk-inspect');

      // Delete the original
      useSceneStore.getState().removeObject('desk-inspect');
      expect(
        useSceneStore.getState().room.objects.find((o) => o.id === 'desk-inspect')
      ).toBeUndefined();
    });
  });

  describe('HUD Overlay and Clickable Validation Issues', () => {
    it('tracks cursor coordinates, current tool, snap status, and selection count', () => {
      // Set cursor coords
      useUiStore.getState().setCursorCoords([2.45, -1.3]);
      expect(useUiStore.getState().cursorCoords).toEqual([2.45, -1.3]);

      // Tool mode
      useUiStore.getState().setToolMode('draw-floor');
      expect(useUiStore.getState().toolMode).toBe('draw-floor');

      // Snap status
      useUiStore.getState().setSnapEnabled(true);
      useUiStore.getState().setGridStep(0.25);
      expect(useUiStore.getState().snapEnabled).toBe(true);
      expect(useUiStore.getState().gridStep).toBe(0.25);

      // Selection state
      expect(useSceneStore.getState().selectedObjectId).toBeNull();
      useSceneStore.getState().selectObject('any-id');
      expect(useSceneStore.getState().selectedObjectId).toBe('any-id');
    });

    it('generates validation issues with ref and clicking ref selects the offending object', () => {
      // Place an object outside the floor polygon (e.g. at [10, 0, 10])
      const outsideObject: SceneObject = {
        id: 'outside-sofa',
        assetId: 'sofa',
        name: 'Stray Sofa',
        position: [10, 0, 10], // Outside the 4x3 room boundary [-2..2, -1.5..1.5]
        rotation: [0, 0, 0],
        size: [2.1, 0.85, 0.9],
        elevation: 0,
        role: 'solid',
        wallMounted: false,
      };

      useSceneStore.getState().addObject(outsideObject);

      // Run parser validation
      const parseResult = parseRoom(useSceneStore.getState().room);
      expect(parseResult.room).not.toBeNull();

      // Find the issue corresponding to outsideObject
      const outsideIssue = parseResult.issues.find(
        (i) => i.ref === 'outside-sofa' && i.message.includes('outside the room floor boundary')
      );

      expect(outsideIssue).toBeDefined();
      expect(outsideIssue?.ref).toBe('outside-sofa');

      // Verify that clicking the issue ref selects the object in sceneStore
      useSceneStore.getState().clearSelection();
      expect(useSceneStore.getState().selectedObjectId).toBeNull();

      // Simulate clicking on the issue item with ref
      if (outsideIssue?.ref) {
        useSceneStore.getState().selectObject(outsideIssue.ref);
      }

      expect(useSceneStore.getState().selectedObjectId).toBe('outside-sofa');
      expect(useSceneStore.getState().selectedObjectIds).toContain('outside-sofa');
    });
  });
});
