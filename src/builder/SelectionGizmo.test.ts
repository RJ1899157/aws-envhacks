import { beforeEach, describe, expect, it } from 'vitest';
import { useSceneStore } from '../store/sceneStore';
import { useUiStore } from '../store/uiStore';
import { checkObjectCollision, checkOpeningCollision } from '../core/collision';
import type { Opening, SceneObject } from '../core/schema';

describe('SelectionGizmo logic and keyboard handling', () => {
  const chairA: SceneObject = {
    id: 'chair-a',
    assetId: 'office-chair',
    name: 'Chair A',
    position: [0, 0, 0],
    rotation: [0, 0, 0],
    size: [0.65, 0.95, 0.65],
    elevation: 0,
    role: 'solid',
    wallMounted: false,
  };

  const chairB: SceneObject = {
    id: 'chair-b',
    assetId: 'office-chair',
    name: 'Chair B',
    position: [1.2, 0, 0],
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
  });

  describe('Selection & Multi-Select', () => {
    it('selects single object and deselects on clearSelection', () => {
      useSceneStore.getState().addObject(chairA);
      useSceneStore.getState().selectObject('chair-a');

      expect(useSceneStore.getState().selectedObjectId).toBe('chair-a');
      expect(useSceneStore.getState().selectedObjectIds).toEqual(['chair-a']);

      useSceneStore.getState().clearSelection();
      expect(useSceneStore.getState().selectedObjectId).toBeNull();
      expect(useSceneStore.getState().selectedObjectIds).toEqual([]);
    });

    it('supports multi-selection toggling', () => {
      useSceneStore.getState().addObject(chairA);
      useSceneStore.getState().addObject(chairB);

      useSceneStore.getState().selectObject('chair-a');
      expect(useSceneStore.getState().selectedObjectIds).toEqual(['chair-a']);

      // Shift+select chair-b
      useSceneStore.getState().selectObject('chair-b', true);
      expect(useSceneStore.getState().selectedObjectIds).toEqual(['chair-a', 'chair-b']);

      // Shift+select chair-a again to toggle it off
      useSceneStore.getState().selectObject('chair-a', true);
      expect(useSceneStore.getState().selectedObjectIds).toEqual(['chair-b']);
      expect(useSceneStore.getState().selectedObjectId).toBe('chair-b');
    });

    it('selects opening and deselects objects', () => {
      useSceneStore.getState().addObject(chairA);
      useSceneStore.getState().selectObject('chair-a');

      const op = useSceneStore.getState().room.openings[0]!;
      useSceneStore.getState().selectOpening(op.id);

      expect(useSceneStore.getState().selectedOpeningId).toBe(op.id);
      expect(useSceneStore.getState().selectedOpeningIds).toEqual([op.id]);
      expect(useSceneStore.getState().selectedObjectId).toBeNull();
      expect(useSceneStore.getState().selectedObjectIds).toEqual([]);
    });

    it('selectAll selects all objects in the room', () => {
      useSceneStore.getState().addObject(chairA);
      useSceneStore.getState().addObject(chairB);

      useSceneStore.getState().selectAll();
      expect(useSceneStore.getState().selectedObjectIds).toEqual(['chair-a', 'chair-b']);
      expect(useSceneStore.getState().selectedObjectId).toBe('chair-a');
    });
  });

  describe('Transform & Batch Operations', () => {
    it('duplicates selected objects with 0.3m offset', () => {
      useSceneStore.getState().addObject(chairA);
      useSceneStore.getState().selectObject('chair-a');

      const duplicated = useSceneStore.getState().duplicateSelected();
      expect(duplicated).toHaveLength(1);
      expect(duplicated[0]!.position[0]).toBeCloseTo(0.3);
      expect(duplicated[0]!.position[2]).toBeCloseTo(0.3);
      expect(useSceneStore.getState().selectedObjectIds).toEqual([duplicated[0]!.id]);
    });

    it('deletes selected objects', () => {
      useSceneStore.getState().addObject(chairA);
      useSceneStore.getState().selectObject('chair-a');

      useSceneStore.getState().deleteSelected();
      expect(useSceneStore.getState().room.objects).toHaveLength(0);
      expect(useSceneStore.getState().selectedObjectIds).toEqual([]);
    });

    it('deletes selected opening', () => {
      const op = useSceneStore.getState().room.openings[0]!;
      useSceneStore.getState().selectOpening(op.id);

      useSceneStore.getState().deleteSelected();
      expect(useSceneStore.getState().room.openings.find((o) => o.id === op.id)).toBeUndefined();
      expect(useSceneStore.getState().selectedOpeningId).toBeNull();
    });
  });

  describe('Collision Detection and Revert Behavior', () => {
    it('detects collision when solid objects overlap and allows reverting', () => {
      useSceneStore.getState().addObject(chairA);
      useSceneStore.getState().addObject(chairB);

      const room = useSceneStore.getState().room;

      // Position chairB directly on top of chairA
      const candidate: SceneObject = {
        ...chairB,
        position: [0.1, 0, 0],
      };

      const result = checkObjectCollision(candidate, room, chairB.id);
      expect(result.colliding).toBe(true);
      expect(result.reason).toBe('solid-overlap');
      expect(result.collidedWithId).toBe('chair-a');

      // Revert simulation: original position is preserved
      expect(chairB.position).toEqual([1.2, 0, 0]);
    });

    it('detects collision when object penetrates room walls', () => {
      useSceneStore.getState().addObject(chairA);
      const room = useSceneStore.getState().room;

      // Room X goes from -2 to +2. An object at X = 2.2 penetrates the wall
      const candidate: SceneObject = {
        ...chairA,
        position: [2.2, 0, 0],
      };

      const result = checkObjectCollision(candidate, room, chairA.id);
      expect(result.colliding).toBe(true);
      expect(result.reason).toBe('outside');
    });

    it('detects collision when opening exceeds wall length', () => {
      const room = useSceneStore.getState().room;
      const op = room.openings[0]!;

      // Wall 0 is 4m long. Offset 3.5 + width 1.2 = 4.7m > 4m
      const invalidOp: Opening = {
        ...op,
        offset: 3.5,
      };

      const result = checkOpeningCollision(invalidOp, room, op.id);
      expect(result.colliding).toBe(true);
      expect(result.reason).toBe('bounds');
    });
  });

  describe('Drag Coalescing: One Drag = One Undo Step', () => {
    it('coalesces multiple transform updates during a drag into exactly one undo step', () => {
      useSceneStore.getState().addObject(chairA);
      useSceneStore.temporal.getState().clear();

      // Begin drag session
      useSceneStore.getState().setIsDragging(true);

      // Rapid intermediate drag position updates
      useSceneStore.getState().updateObject('chair-a', { position: [0.1, 0, 0] });
      useSceneStore.getState().updateObject('chair-a', { position: [0.3, 0, 0] });
      useSceneStore.getState().updateObject('chair-a', { position: [0.6, 0, 0] });
      useSceneStore.getState().updateObject('chair-a', { position: [0.8, 0, 0] });

      // End drag session
      useSceneStore.getState().setIsDragging(false);

      expect(useSceneStore.getState().room.objects[0]?.position).toEqual([0.8, 0, 0]);

      // Exactly ONE undo reverts from final position [0.8, 0, 0] back to initial [0, 0, 0]
      useSceneStore.temporal.getState().undo();
      expect(useSceneStore.getState().room.objects[0]?.position).toEqual([0, 0, 0]);

      // Redo restores final dragged position
      useSceneStore.temporal.getState().redo();
      expect(useSceneStore.getState().room.objects[0]?.position).toEqual([0.8, 0, 0]);
    });
  });

  describe('Numeric Input & Shortcuts State', () => {
    it('updates numeric input buffer in uiStore', () => {
      useUiStore.getState().setNumericInputBuffer('0.75');
      expect(useUiStore.getState().numericInputBuffer).toBe('0.75');

      useUiStore.getState().setNumericInputBuffer(null);
      expect(useUiStore.getState().numericInputBuffer).toBeNull();
    });

    it('toggles transformMode and view mode', () => {
      useUiStore.getState().setTransformMode('rotate');
      expect(useUiStore.getState().transformMode).toBe('rotate');

      useUiStore.getState().setTransformMode('translate');
      expect(useUiStore.getState().transformMode).toBe('translate');

      useUiStore.getState().setView('2d');
      expect(useUiStore.getState().view).toBe('2d');
    });

    it('toggles Y elevation transformation', () => {
      expect(useUiStore.getState().transformY).toBe(false);
      useUiStore.getState().toggleTransformY();
      expect(useUiStore.getState().transformY).toBe(true);
      useUiStore.getState().toggleTransformY();
      expect(useUiStore.getState().transformY).toBe(false);
    });
  });
});
