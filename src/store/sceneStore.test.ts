import { beforeEach, describe, expect, it } from 'vitest';
import { useSceneStore } from './sceneStore';
import type { Opening, SceneObject, Vec2 } from '../core/types';

describe('useSceneStore (Zustand + Immer + Zundo)', () => {
  beforeEach(() => {
    useSceneStore.getState().resetRoom();
    useSceneStore.temporal.getState().clear();
  });

  describe('Object Mutations & Undo/Redo', () => {
    it('adds, undos, and redos an object', () => {
      const obj: SceneObject = {
        id: 'chair-1',
        assetId: 'office-chair',
        name: 'Office Chair',
        position: [0.5, 0, 0.5],
        rotation: [0, 0, 0],
        size: [0.65, 0.95, 0.65],
        elevation: 0,
        role: 'porous',
        wallMounted: false,
      };

      // Initial state
      expect(useSceneStore.getState().room.objects).toHaveLength(0);

      // Add object
      useSceneStore.getState().addObject(obj);
      expect(useSceneStore.getState().room.objects).toHaveLength(1);
      expect(useSceneStore.getState().selectedObjectId).toBe('chair-1');

      // Undo
      useSceneStore.temporal.getState().undo();
      expect(useSceneStore.getState().room.objects).toHaveLength(0);

      // Redo
      useSceneStore.temporal.getState().redo();
      expect(useSceneStore.getState().room.objects).toHaveLength(1);
      expect(useSceneStore.getState().room.objects[0]?.id).toBe('chair-1');
    });

    it('duplicates an object with a new unique id and 0.3m offset', () => {
      const original: SceneObject = {
        id: 'desk-1',
        assetId: 'desk',
        name: 'Desk',
        position: [1.0, 0, 1.0],
        rotation: [0, 0, 0],
        size: [1.4, 0.75, 0.7],
        elevation: 0,
        role: 'solid',
        wallMounted: false,
      };

      useSceneStore.getState().addObject(original);
      expect(useSceneStore.getState().room.objects).toHaveLength(1);

      const duplicated = useSceneStore.getState().duplicateObject('desk-1');
      expect(duplicated).not.toBeNull();
      expect(duplicated?.id).not.toBe('desk-1');
      expect(duplicated?.id).toContain('desk-');
      expect(duplicated?.position[0]).toBeCloseTo(1.3);
      expect(duplicated?.position[2]).toBeCloseTo(1.3);
      expect(useSceneStore.getState().room.objects).toHaveLength(2);
      expect(useSceneStore.getState().selectedObjectId).toBe(duplicated?.id);

      // Undo duplicate
      useSceneStore.temporal.getState().undo();
      expect(useSceneStore.getState().room.objects).toHaveLength(1);
      expect(useSceneStore.getState().room.objects[0]?.id).toBe('desk-1');
    });

    it('updates and removes objects with undo support', () => {
      const obj: SceneObject = {
        id: 'plant-1',
        assetId: 'plant',
        name: 'Houseplant',
        position: [0, 0, 0],
        rotation: [0, 0, 0],
        size: [0.4, 0.8, 0.4],
        elevation: 0,
        role: 'porous',
        wallMounted: false,
      };

      useSceneStore.getState().addObject(obj);
      useSceneStore.getState().updateObject('plant-1', {
        position: [2.0, 0, 1.5],
      });
      expect(useSceneStore.getState().room.objects[0]?.position).toEqual([2.0, 0, 1.5]);

      useSceneStore.getState().removeObject('plant-1');
      expect(useSceneStore.getState().room.objects).toHaveLength(0);
      expect(useSceneStore.getState().selectedObjectId).toBeNull();

      useSceneStore.temporal.getState().undo();
      expect(useSceneStore.getState().room.objects).toHaveLength(1);
      expect(useSceneStore.getState().room.objects[0]?.position).toEqual([2.0, 0, 1.5]);
    });
  });

  describe('Vertex & Outline Mutations', () => {
    it('refuses to remove vertex when outline is at minimum 3 vertices', () => {
      // Default room has 4 vertices
      expect(useSceneStore.getState().room.outline).toHaveLength(4);

      // Remove one vertex -> 3 vertices
      useSceneStore.getState().removeVertex(0);
      expect(useSceneStore.getState().room.outline).toHaveLength(3);

      // Try to remove another vertex -> must be refused!
      useSceneStore.getState().removeVertex(0);
      expect(useSceneStore.getState().room.outline).toHaveLength(3);

      useSceneStore.getState().removeVertex(1);
      expect(useSceneStore.getState().room.outline).toHaveLength(3);
    });

    it('inserts a vertex to split a wall and allows undo', () => {
      expect(useSceneStore.getState().room.outline).toHaveLength(4);

      // Insert new vertex between index 0 and 1
      const splitPoint: Vec2 = [0, -1.5];
      useSceneStore.getState().insertVertex(0, splitPoint);
      expect(useSceneStore.getState().room.outline).toHaveLength(5);
      expect(useSceneStore.getState().room.outline[1]).toEqual(splitPoint);

      useSceneStore.temporal.getState().undo();
      expect(useSceneStore.getState().room.outline).toHaveLength(4);
    });

    it('moves a vertex and tracks history', () => {
      const origVertex = [...useSceneStore.getState().room.outline[0]!];
      useSceneStore.getState().moveVertex(0, [-3, -3]);
      expect(useSceneStore.getState().room.outline[0]).toEqual([-3, -3]);

      useSceneStore.temporal.getState().undo();
      expect(useSceneStore.getState().room.outline[0]).toEqual(origVertex);
    });
  });

  describe('Selection State & History Independence', () => {
    it('does not create history entries for selection changes', () => {
      expect(useSceneStore.temporal.getState().pastStates).toHaveLength(0);

      useSceneStore.getState().selectObject('obj-xyz');
      expect(useSceneStore.getState().selectedObjectId).toBe('obj-xyz');
      expect(useSceneStore.temporal.getState().pastStates).toHaveLength(0);

      useSceneStore.getState().selectOpening('op-abc');
      expect(useSceneStore.getState().selectedOpeningId).toBe('op-abc');
      expect(useSceneStore.getState().selectedObjectId).toBeNull();
      expect(useSceneStore.temporal.getState().pastStates).toHaveLength(0);

      useSceneStore.getState().clearSelection();
      expect(useSceneStore.getState().selectedObjectId).toBeNull();
      expect(useSceneStore.getState().selectedOpeningId).toBeNull();
      expect(useSceneStore.temporal.getState().pastStates).toHaveLength(0);
    });
  });

  describe('Drag Coalescing', () => {
    it('coalesces rapid drag updates into a single history entry using explicit drag session', () => {
      const initialPos = [...useSceneStore.getState().room.outline[0]!];
      expect(useSceneStore.temporal.getState().pastStates).toHaveLength(0);

      // Start drag session
      useSceneStore.getState().setIsDragging(true);

      // Multiple rapid movements during dragging
      useSceneStore.getState().moveVertex(0, [-2.1, -1.6]);
      useSceneStore.getState().moveVertex(0, [-2.2, -1.7]);
      useSceneStore.getState().moveVertex(0, [-2.3, -1.8]);
      useSceneStore.getState().moveVertex(0, [-2.5, -2.0]);

      // Stop drag session
      useSceneStore.getState().setIsDragging(false);

      // Should have coalesced all 4 drag movements into exactly 1 history entry!
      expect(useSceneStore.temporal.getState().pastStates).toHaveLength(1);
      expect(useSceneStore.getState().room.outline[0]).toEqual([-2.5, -2.0]);

      // Undo should revert all the way back to initial position before dragging started
      useSceneStore.temporal.getState().undo();
      expect(useSceneStore.getState().room.outline[0]).toEqual(initialPos);

      // Redo should return to final drag position
      useSceneStore.temporal.getState().redo();
      expect(useSceneStore.getState().room.outline[0]).toEqual([-2.5, -2.0]);
    });

    it('coalesces rapid automatic transform movements into a single history entry', () => {
      const initialPos = [...useSceneStore.getState().room.outline[1]!];
      expect(useSceneStore.temporal.getState().pastStates).toHaveLength(0);

      // Rapid consecutive updates in the same synchronous cycle (< 250ms)
      useSceneStore.getState().moveVertex(1, [2.1, -1.5]);
      useSceneStore.getState().moveVertex(1, [2.2, -1.5]);
      useSceneStore.getState().moveVertex(1, [2.3, -1.5]);

      // Rapid updates coalesce into 1 entry
      expect(useSceneStore.temporal.getState().pastStates).toHaveLength(1);
      expect(useSceneStore.getState().room.outline[1]).toEqual([2.3, -1.5]);

      useSceneStore.temporal.getState().undo();
      expect(useSceneStore.getState().room.outline[1]).toEqual(initialPos);
    });
  });

  describe('Openings Mutations & Roles', () => {
    it('adds, updates, sets role, and removes openings', () => {
      const initialOpeningCount = useSceneStore.getState().room.openings.length;

      const newWindow: Opening = {
        id: 'east-window',
        wallIndex: 1,
        type: 'window',
        offset: 0.5,
        width: 1.0,
        height: 1.0,
        sill: 0.9,
        role: 'closed',
        openFraction: 0,
      };

      useSceneStore.getState().addOpening(newWindow);
      expect(useSceneStore.getState().room.openings).toHaveLength(initialOpeningCount + 1);
      expect(useSceneStore.getState().selectedOpeningId).toBe('east-window');

      // Change role
      useSceneStore.getState().setOpeningRole('east-window', 'inlet');
      const updated = useSceneStore.getState().room.openings.find((o) => o.id === 'east-window');
      expect(updated?.role).toBe('inlet');

      // Update offset and open fraction
      useSceneStore.getState().updateOpening('east-window', {
        offset: 0.8,
        openFraction: 0.75,
      });
      const updated2 = useSceneStore.getState().room.openings.find((o) => o.id === 'east-window');
      expect(updated2?.offset).toBe(0.8);
      expect(updated2?.openFraction).toBe(0.75);

      // Remove opening
      useSceneStore.getState().removeOpening('east-window');
      expect(useSceneStore.getState().room.openings).toHaveLength(initialOpeningCount);

      // Undo removal
      useSceneStore.temporal.getState().undo();
      expect(useSceneStore.getState().room.openings).toHaveLength(initialOpeningCount + 1);
    });
  });

  describe('Room Parameters & Wall Height', () => {
    it('updates wall height and simulation parameters', () => {
      useSceneStore.getState().setWallHeight(3.5);
      expect(useSceneStore.getState().room.wallHeight).toBe(3.5);

      useSceneStore.getState().setParams({
        indoorTempC: 24.5,
        windSpeed: 4.2,
      });
      expect(useSceneStore.getState().room.params.indoorTempC).toBe(24.5);
      expect(useSceneStore.getState().room.params.windSpeed).toBe(4.2);

      useSceneStore.temporal.getState().undo();
      expect(useSceneStore.getState().room.params.indoorTempC).toBe(22.0);
    });
  });

  describe('Import & Export Round-trip', () => {
    it('round-trips exportRoom and importRoom successfully', () => {
      // Modify room with an object
      const obj: SceneObject = {
        id: 'sofa-roundtrip',
        assetId: 'sofa',
        name: 'Living Sofa',
        position: [0, 0, 0],
        rotation: [0, 0, 0],
        size: [2.1, 0.85, 0.9],
        elevation: 0,
        role: 'solid',
        wallMounted: false,
      };
      useSceneStore.getState().addObject(obj);

      // Export JSON
      const exportedJson = useSceneStore.getState().exportRoom();
      expect(typeof exportedJson).toBe('string');
      expect(exportedJson).toContain('sofa-roundtrip');

      // Reset store
      useSceneStore.getState().resetRoom();
      expect(useSceneStore.getState().room.objects).toHaveLength(0);

      // Import JSON back
      const importResult = useSceneStore.getState().importRoom(exportedJson);
      expect(importResult.success).toBe(true);
      expect(useSceneStore.getState().room.objects).toHaveLength(1);
      expect(useSceneStore.getState().room.objects[0]?.id).toBe('sofa-roundtrip');
    });

    it('rejects invalid JSON during importRoom without mutating state', () => {
      const origRoomName = useSceneStore.getState().room.name;
      const result = useSceneStore.getState().importRoom('invalid-not-json{[');

      expect(result.success).toBe(false);
      expect(result.issues).toHaveLength(1);
      expect(result.issues[0]?.level).toBe('error');
      expect(useSceneStore.getState().room.name).toBe(origRoomName);
    });

    it('rejects invalid room data (e.g. wall < 0.3m) without mutating state', () => {
      const defaultRoom = useSceneStore.getState().room;
      const invalidData = {
        ...defaultRoom,
        outline: [
          [-2, -1.5],
          [2, -1.5],
          [2, 1.45],
          [2, 1.5], // 0.05m wall (< 0.3m)
          [-2, 1.5],
        ],
      };

      const result = useSceneStore.getState().importRoom(invalidData);
      expect(result.success).toBe(false);
      expect(result.issues.some((i) => i.level === 'error')).toBe(true);
      expect(useSceneStore.getState().room.outline).toHaveLength(4);
    });
  });
});
