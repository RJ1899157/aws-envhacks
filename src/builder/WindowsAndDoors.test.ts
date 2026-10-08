import { beforeEach, describe, expect, it } from 'vitest';
import { useSceneStore } from '../store/sceneStore';
import {
  OPENING_PRESETS,
  createOpeningFromPreset,
  findNearestWallForPoint,
  computeOpeningSnapGuides,
  resolveOpeningOverlapOnWall,
} from '../core/openingPresets';
import { createDefaultRoom } from '../core/defaultRoom';

describe('Windows and Doors Rework', () => {
  beforeEach(() => {
    useSceneStore.getState().resetRoom();
    useSceneStore.temporal.getState().clear();
  });

  describe('Presets definition and sanity ranges', () => {
    it('provides all 8 required opening presets with real-world dimensions and sills', () => {
      const keys = [
        'single-door',
        'double-door',
        'sliding-door',
        'archway',
        'window',
        'wide-window',
        'french-window',
        'vent',
      ] as const;

      for (const k of keys) {
        const preset = OPENING_PRESETS[k];
        expect(preset, `Preset ${k} must be defined`).toBeDefined();
        expect(preset.width).toBeGreaterThanOrEqual(0.3);
        expect(preset.width).toBeLessThanOrEqual(2.5);
        expect(preset.height).toBeGreaterThanOrEqual(0.3);
        expect(preset.height).toBeLessThanOrEqual(2.5);
        expect(preset.sill).toBeGreaterThanOrEqual(0);
        expect(preset.sill).toBeLessThanOrEqual(2.2);
      }

      // Check specific presets
      expect(OPENING_PRESETS['single-door'].width).toBe(0.9);
      expect(OPENING_PRESETS['single-door'].height).toBe(2.1);
      expect(OPENING_PRESETS['single-door'].sill).toBe(0);

      expect(OPENING_PRESETS['double-door'].width).toBe(1.6);
      expect(OPENING_PRESETS['double-door'].height).toBe(2.1);
      expect(OPENING_PRESETS['double-door'].sill).toBe(0);

      expect(OPENING_PRESETS['sliding-door'].width).toBe(1.8);
      expect(OPENING_PRESETS['sliding-door'].height).toBe(2.1);
      expect(OPENING_PRESETS['sliding-door'].sill).toBe(0);

      expect(OPENING_PRESETS['archway'].width).toBe(1.0);
      expect(OPENING_PRESETS['archway'].height).toBe(2.2);
      expect(OPENING_PRESETS['archway'].sill).toBe(0);

      expect(OPENING_PRESETS['window'].width).toBe(1.2);
      expect(OPENING_PRESETS['window'].height).toBe(1.2);
      expect(OPENING_PRESETS['window'].sill).toBe(0.9);

      expect(OPENING_PRESETS['wide-window'].width).toBe(1.8);
      expect(OPENING_PRESETS['wide-window'].height).toBe(1.2);
      expect(OPENING_PRESETS['wide-window'].sill).toBe(0.9);

      expect(OPENING_PRESETS['french-window'].width).toBe(1.5);
      expect(OPENING_PRESETS['french-window'].height).toBe(2.1);
      expect(OPENING_PRESETS['french-window'].sill).toBe(0);

      expect(OPENING_PRESETS['vent'].width).toBe(0.4);
      expect(OPENING_PRESETS['vent'].height).toBe(0.4);
      expect(OPENING_PRESETS['vent'].sill).toBe(2.0);
    });

    it('creates Opening objects properly configured from presets', () => {
      const op = createOpeningFromPreset('french-window', 1, 0.75, 'custom-test-id');
      expect(op.id).toBe('custom-test-id');
      expect(op.wallIndex).toBe(1);
      expect(op.type).toBe('window');
      expect(op.subType).toBe('french-window');
      expect(op.width).toBe(1.5);
      expect(op.height).toBe(2.1);
      expect(op.sill).toBe(0);
      expect(op.role).toBe('inlet');
      expect(op.openFraction).toBe(0.5);
      expect(op.flipHinge).toBe(false);
      expect(op.flipSwing).toBe(false);
    });
  });

  describe('Wall Projection & Snapping (findNearestWallForPoint & computeOpeningSnapGuides)', () => {
    it('projects point onto the closest room wall', () => {
      const room = createDefaultRoom();
      // Default room corners: [-2, -1.5], [2, -1.5], [2, 1.5], [-2, 1.5]
      // Bottom wall (0): [-2, -1.5] to [2, -1.5] (length 4.0, along X)
      // Right wall (1): [2, -1.5] to [2, 1.5] (length 3.0, along Z)

      const result = findNearestWallForPoint(1.0, -1.8, room);
      expect(result).not.toBeNull();
      expect(result?.wallIndex).toBe(0); // Closest to bottom wall
      expect(result?.projX).toBeCloseTo(1.0, 3);
      expect(result?.projZ).toBeCloseTo(-1.5, 3);
      expect(result?.dist).toBeCloseTo(0.3, 3);

      const rightResult = findNearestWallForPoint(2.5, 0.5, room);
      expect(rightResult).not.toBeNull();
      expect(rightResult?.wallIndex).toBe(1); // Closest to right wall
      expect(rightResult?.projX).toBeCloseTo(2.0, 3);
      expect(rightResult?.projZ).toBeCloseTo(0.5, 3);
    });

    it('snaps opening to wall center when within threshold', () => {
      const room = createDefaultRoom();
      // Bottom wall length 4.0m. Window width 1.2m. Center offset = (4.0 - 1.2) / 2 = 1.4m.
      const snapRes = computeOpeningSnapGuides(room, 0, 1.2, 1.43);
      expect(snapRes.guideType).toBe('wall-center');
      expect(snapRes.snappedOffset).toBe(1.4);
    });

    it('snaps opening to 0.1m corner margin when near wall ends', () => {
      const room = createDefaultRoom();
      // Left corner: 0.1m
      const snapLeft = computeOpeningSnapGuides(room, 0, 1.2, 0.08);
      expect(snapLeft.guideType).toBe('corner-margin');
      expect(snapLeft.snappedOffset).toBe(0.1);

      // Right corner: 4.0 - 1.2 - 0.1 = 2.7m
      const snapRight = computeOpeningSnapGuides(room, 0, 1.2, 2.72);
      expect(snapRight.guideType).toBe('corner-margin');
      expect(snapRight.snappedOffset).toBe(2.7);
    });

    it('defaults to 0.05m grid snapping when not near center or corner', () => {
      const room = createDefaultRoom();
      const snapGrid = computeOpeningSnapGuides(room, 0, 1.2, 0.83);
      expect(snapGrid.guideType).toBe('grid');
      expect(snapGrid.snappedOffset).toBe(0.85); // 0.83 snaps to 0.85 on 0.05 grid
    });
  });

  describe('Non-overlapping Hard Rule & Gentle Pushing', () => {
    it('allows placement when there is no overlap', () => {
      const room = createDefaultRoom();
      // Wall 0 (len 4.0): default window is at offset 1.4, width 1.2 (occupies 1.4 to 2.6)
      // Test placing door at 0.1 (occupies 0.1 to 1.0, before 1.4)
      const res = resolveOpeningOverlapOnWall(room, 0, 0.1, 0.9);
      expect(res.canPlace).toBe(true);
      expect(res.finalOffset).toBe(0.1);
      expect(res.pushedOpenings).toHaveLength(0);
    });

    it('gently pushes adjacent opening aside when space permits', () => {
      const room = createDefaultRoom();
      // Default window on wall 0 is at offset 1.4, width 1.2 (occupies 1.4 to 2.6)
      // Moving a new opening to offset 1.2 with width 0.9
      // Moving opening center is at 1.2 + 0.45 = 1.65; window center is at 1.4 + 0.6 = 2.0 (to the right)
      // Pushing window to the right: new window offset = 1.2 + 0.9 + 0.05 = 2.15m.
      // 2.15 + 1.2 = 3.35 <= 4.0m wall length -> space permits!
      const res = resolveOpeningOverlapOnWall(room, 0, 1.2, 0.9);
      expect(res.canPlace).toBe(true);
      expect(res.finalOffset).toBe(1.2);
      expect(res.pushedOpenings).toHaveLength(1);
      expect(res.pushedOpenings[0]?.offset).toBeGreaterThan(2.0);
    });

    it('fails and reports error when gentle push is impossible due to wall boundary', () => {
      const room = createDefaultRoom();
      // Wall 2 (top wall, len 4.0): default window is at offset 1.0, width 1.2 (occupies 1.0 to 2.2)
      // Let's position an opening near the right edge of wall, and another huge opening that overlaps
      const bigWidth = 2.5;
      const res = resolveOpeningOverlapOnWall(room, 2, 0.8, bigWidth);
      // Window at 1.0 pushed right by 0.8 + 2.5 + 0.05 = 3.35 + 1.2 = 4.55 > 4.0m (exceeds wall)
      // Window pushed left: targetMid (2.05) > windowMid (1.6), so push left: 0.8 - 1.2 - 0.05 = -0.45 < 0
      // Cannot push left or right!
      expect(res.canPlace).toBe(false);
      expect(res.errorMessage).toContain('cannot overlap');
    });
  });

  describe('Duplicate and Flip Opening in sceneStore', () => {
    it('duplicates an opening and places it at the nearest valid adjacent position on wall', () => {
      const originalOp = useSceneStore.getState().room.openings[0]!;
      const duplicated = useSceneStore.getState().duplicateOpening(originalOp.id);

      expect(duplicated).not.toBeNull();
      expect(duplicated?.id).not.toBe(originalOp.id);
      expect(duplicated?.wallIndex).toBe(originalOp.wallIndex);
      expect(duplicated?.type).toBe(originalOp.type);
      expect(duplicated?.offset).not.toBe(originalOp.offset);

      // Verify duplicated opening is now in room state
      const found = useSceneStore.getState().room.openings.find((o) => o.id === duplicated?.id);
      expect(found).toBeDefined();

      // Undo reverts duplication
      useSceneStore.temporal.getState().undo();
      const reverted = useSceneStore.getState().room.openings.find((o) => o.id === duplicated?.id);
      expect(reverted).toBeUndefined();
    });

    it('flips opening hinge side and swing direction with 1 call', () => {
      const doorOp = useSceneStore.getState().room.openings.find((o) => o.type === 'door')!;
      expect(doorOp.flipHinge).toBeFalsy();

      useSceneStore.getState().flipOpening(doorOp.id, 'hinge');
      let current = useSceneStore.getState().room.openings.find((o) => o.id === doorOp.id)!;
      expect(current.flipHinge).toBe(true);

      useSceneStore.getState().flipOpening(doorOp.id, 'hinge');
      current = useSceneStore.getState().room.openings.find((o) => o.id === doorOp.id)!;
      expect(current.flipHinge).toBe(false);

      // Flip swing
      useSceneStore.getState().flipOpening(doorOp.id, 'swing');
      current = useSceneStore.getState().room.openings.find((o) => o.id === doorOp.id)!;
      expect(current.flipSwing).toBe(true);
    });
  });
});
