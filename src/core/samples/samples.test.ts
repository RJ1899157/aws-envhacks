import { describe, expect, it } from 'vitest';
import { createStudioSample } from './studio';
import { createBedroomSample } from './bedroom';
import { createLivingRoomSample } from './livingRoom';
import { parseRoom, signedArea, isPolygonSimple } from '../parser';
import { useSceneStore } from '../../store/sceneStore';

describe('Sample Rooms Suite', () => {
  describe('Studio Sample Room (3.5x4m)', () => {
    it('creates a valid studio with zero validation errors', () => {
      const studio = createStudioSample();
      expect(studio.name).toBe('Studio Apartment (3.5x4m)');
      expect(studio.wallHeight).toBe(2.6);
      expect(studio.outline).toHaveLength(4);
      expect(studio.openings).toHaveLength(2);
      expect(studio.objects.length).toBeGreaterThanOrEqual(4);

      const parsed = parseRoom(studio);
      expect(parsed.room).not.toBeNull();
      const errors = parsed.issues.filter((i) => i.level === 'error');
      expect(errors).toHaveLength(0);

      // Verify cross-ventilation inlet and outlet
      const hasInlet = studio.openings.some((op) => op.role === 'inlet');
      const hasOutlet = studio.openings.some((op) => op.role === 'outlet');
      expect(hasInlet).toBe(true);
      expect(hasOutlet).toBe(true);
    });
  });

  describe('Bedroom Sample Room with Two Windows (4x3.5m)', () => {
    it('creates a valid cross-ventilated bedroom with zero validation errors', () => {
      const bedroom = createBedroomSample();
      expect(bedroom.name).toBe('Bedroom with Two Windows (4x3.5m)');
      expect(bedroom.outline).toHaveLength(4);

      // Verify two windows + one door
      const windows = bedroom.openings.filter((op) => op.type === 'window');
      const doors = bedroom.openings.filter((op) => op.type === 'door');
      expect(windows).toHaveLength(2);
      expect(doors).toHaveLength(1);

      const parsed = parseRoom(bedroom);
      expect(parsed.room).not.toBeNull();
      const errors = parsed.issues.filter((i) => i.level === 'error');
      expect(errors).toHaveLength(0);
    });
  });

  describe('L-Shaped Living Room (Non-Rectangular Polygon)', () => {
    it('creates a valid non-rectangular 6-vertex L-shaped room with zero validation errors', () => {
      const livingRoom = createLivingRoomSample();
      expect(livingRoom.name).toBe('L-Shaped Living Room');
      expect(livingRoom.outline).toHaveLength(6);

      // Verify non-rectangular polygon properties
      expect(isPolygonSimple(livingRoom.outline)).toBe(true);
      expect(signedArea(livingRoom.outline)).toBeGreaterThan(0); // Counter-clockwise winding

      const parsed = parseRoom(livingRoom);
      expect(parsed.room).not.toBeNull();
      const errors = parsed.issues.filter((i) => i.level === 'error');
      expect(errors).toHaveLength(0);

      // Verify openings on multiple walls
      expect(livingRoom.openings.length).toBeGreaterThanOrEqual(3);
      const hasInlet = livingRoom.openings.some((op) => op.role === 'inlet');
      const hasOutlet = livingRoom.openings.some((op) => op.role === 'outlet');
      expect(hasInlet).toBe(true);
      expect(hasOutlet).toBe(true);
    });

    it('loads and edits correctly in sceneStore without geometric breakdown', () => {
      const livingRoom = createLivingRoomSample();
      useSceneStore.getState().loadRoom(livingRoom);

      expect(useSceneStore.getState().room.outline).toHaveLength(6);

      // Move a vertex within valid bounds
      useSceneStore.getState().moveVertex(0, [-3.2, -2.5]);
      expect(useSceneStore.getState().room.outline[0]).toEqual([-3.2, -2.5]);

      // Split a wall (insert a vertex)
      useSceneStore.getState().insertVertex(0, [-1.0, -2.5]);
      expect(useSceneStore.getState().room.outline).toHaveLength(7);

      // Verify outline remains simple
      expect(isPolygonSimple(useSceneStore.getState().room.outline)).toBe(true);

      // Verify undo reverts the insertion
      useSceneStore.temporal.getState().undo();
      expect(useSceneStore.getState().room.outline).toHaveLength(6);
    });
  });
});
