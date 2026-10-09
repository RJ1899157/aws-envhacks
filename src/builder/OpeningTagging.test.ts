import { beforeEach, describe, expect, it } from 'vitest';
import { useSceneStore } from '../store/sceneStore';
import { createVentilatedRoom } from '../test/fixtures';
import { wallSegment, pointInPolygon } from '../core/parser';

describe('Opening Tagging UX and Ventilation Summary', () => {
  beforeEach(() => {
    useSceneStore.getState().loadRoom(createVentilatedRoom());
    useSceneStore.temporal.getState().clear();
  });

  describe('Default roles for windows and doors', () => {
    it('defaults doors to an open "outlet" so air can flow through', () => {
      useSceneStore.getState().addOpening({
        id: 'test-door',
        type: 'door',
        wallIndex: 0,
        offset: 0.5,
        width: 0.9,
        height: 2.1,
        sill: 0,
      });

      const door = useSceneStore.getState().room.openings.find((op) => op.id === 'test-door');
      expect(door).toBeDefined();
      expect(door?.role).toBe('outlet');
      expect(door?.openFraction).toBe(0.5);
    });

    it('defaults windows to "inlet" with openFraction 0.5', () => {
      useSceneStore.getState().addOpening({
        id: 'test-window',
        type: 'window',
        wallIndex: 2,
        offset: 1.0,
        width: 1.2,
        height: 1.2,
        sill: 0.9,
      });

      const win = useSceneStore.getState().room.openings.find((op) => op.id === 'test-window');
      expect(win).toBeDefined();
      expect(win?.role).toBe('inlet');
      expect(win?.openFraction).toBe(0.5);
    });
  });

  describe('Persistence and export/import round-trips', () => {
    it('persists roles, open fractions, and dimensions across export and import', () => {
      // Modify existing default room openings
      const openings = useSceneStore.getState().room.openings;
      const windowOp = openings.find((op) => op.type === 'window')!;
      const doorOp = openings.find((op) => op.type === 'door')!;

      useSceneStore.getState().updateOpening(windowOp.id, {
        role: 'inlet',
        openFraction: 0.75,
        width: 1.4,
        height: 1.3,
        sill: 0.8,
      });

      useSceneStore.getState().updateOpening(doorOp.id, {
        role: 'outlet',
        openFraction: 1.0,
        width: 0.95,
        height: 2.15,
        sill: 0,
      });

      const exportedJson = useSceneStore.getState().exportRoom();
      expect(exportedJson).toBeDefined();

      // Reset room and re-import
      useSceneStore.getState().resetRoom();
      const result = useSceneStore.getState().importRoom(exportedJson);
      expect(result.issues.filter((i) => i.level === 'error')).toHaveLength(0);

      const importedRoom = useSceneStore.getState().room;
      const importedWin = importedRoom.openings.find((op) => op.id === windowOp.id);
      const importedDoor = importedRoom.openings.find((op) => op.id === doorOp.id);

      expect(importedWin).toBeDefined();
      expect(importedWin?.role).toBe('inlet');
      expect(importedWin?.openFraction).toBe(0.75);
      expect(importedWin?.width).toBe(1.4);
      expect(importedWin?.height).toBe(1.3);
      expect(importedWin?.sill).toBe(0.8);

      expect(importedDoor).toBeDefined();
      expect(importedDoor?.role).toBe('outlet');
      expect(importedDoor?.openFraction).toBe(1.0);
      expect(importedDoor?.width).toBe(0.95);
      expect(importedDoor?.height).toBe(2.15);
    });
  });

  describe('Role changes and state synchronization', () => {
    it('sets openFraction to 0 when role is set to closed', () => {
      const windowOp = useSceneStore.getState().room.openings.find((op) => op.type === 'window')!;
      useSceneStore.getState().setOpeningRole(windowOp.id, 'closed');

      const updated = useSceneStore.getState().room.openings.find((op) => op.id === windowOp.id)!;
      expect(updated.role).toBe('closed');
      expect(updated.openFraction).toBe(0);
    });

    it('sets openFraction to 0.5 when reopened from closed', () => {
      const doorOp = useSceneStore.getState().room.openings.find((op) => op.type === 'door')!;
      // Close the door first
      useSceneStore.getState().setOpeningRole(doorOp.id, 'closed');
      let currentDoor = useSceneStore.getState().room.openings.find((op) => op.id === doorOp.id)!;
      expect(currentDoor.role).toBe('closed');
      expect(currentDoor.openFraction).toBe(0);

      // Reopen as outlet
      useSceneStore.getState().setOpeningRole(doorOp.id, 'outlet');
      currentDoor = useSceneStore.getState().room.openings.find((op) => op.id === doorOp.id)!;
      expect(currentDoor.role).toBe('outlet');
      expect(currentDoor.openFraction).toBe(0.5);
    });
  });

  describe('Bulk actions for multiple openings', () => {
    it('updates roles of multiple openings simultaneously in one undo step', () => {
      const openings = useSceneStore.getState().room.openings;
      const ids = openings.map((op) => op.id);
      expect(ids.length).toBeGreaterThanOrEqual(2);

      useSceneStore.getState().setOpeningsRole(ids, 'outlet');

      const updatedRoom = useSceneStore.getState().room;
      for (const id of ids) {
        const op = updatedRoom.openings.find((o) => o.id === id)!;
        expect(op.role).toBe('outlet');
        expect(op.openFraction).toBeGreaterThan(0);
      }

      // Single undo reverts all
      useSceneStore.temporal.getState().undo();
      const revertedRoom = useSceneStore.getState().room;
      const winReverted = revertedRoom.openings.find((o) => o.type === 'window')!;
      const doorReverted = revertedRoom.openings.find((o) => o.type === 'door')!;
      expect(winReverted.role).toBe('inlet');
      expect(doorReverted.role).toBe('outlet');
    });

    it('updates openFraction of multiple openings simultaneously', () => {
      const openings = useSceneStore.getState().room.openings;
      const ids = openings.map((op) => op.id);

      useSceneStore.getState().setOpeningsOpenFraction(ids, 0.85);

      const updatedRoom = useSceneStore.getState().room;
      for (const id of ids) {
        const op = updatedRoom.openings.find((o) => o.id === id)!;
        expect(op.openFraction).toBe(0.85);
      }
    });
  });

  describe('Ventilation summary and cross-ventilation rules', () => {
    it('computes accurate counts and open area', () => {
      const room = useSceneStore.getState().room;
      const door = room.openings.find((op) => op.type === 'door')!;

      // Close the door so only the window is open
      useSceneStore.getState().setOpeningRole(door.id, 'closed');
      const activeRoom = useSceneStore.getState().room;

      // Window: 1.2 x 1.2 = 1.44 m2, fraction 0.5 => 0.72 m2 (inlet)
      // Door: 0.9 x 2.1 = 1.89 m2, fraction 0 => 0 m2 (closed)
      let inletCount = 0;
      let outletCount = 0;
      let totalOpenArea = 0;

      for (const op of activeRoom.openings) {
        if (op.role === 'inlet' && op.openFraction > 0) inletCount++;
        if (op.role === 'outlet' && op.openFraction > 0) outletCount++;
        totalOpenArea += op.width * op.height * op.openFraction;
      }

      expect(inletCount).toBe(1);
      expect(outletCount).toBe(0);
      expect(totalOpenArea).toBeCloseTo(1.2 * 1.2 * 0.5, 4);

      // Cross ventilation requires both inletCount > 0 AND outletCount > 0
      const hasCrossVentilation = inletCount > 0 && outletCount > 0;
      expect(hasCrossVentilation).toBe(false);

      // Now open door as outlet at 100%
      useSceneStore.getState().updateOpening(door.id, {
        role: 'outlet',
        openFraction: 1.0,
      });

      const updatedRoom = useSceneStore.getState().room;
      inletCount = 0;
      outletCount = 0;
      totalOpenArea = 0;
      for (const op of updatedRoom.openings) {
        if (op.role === 'inlet' && op.openFraction > 0) inletCount++;
        if (op.role === 'outlet' && op.openFraction > 0) outletCount++;
        totalOpenArea += op.width * op.height * op.openFraction;
      }

      expect(inletCount).toBe(1);
      expect(outletCount).toBe(1);
      expect(totalOpenArea).toBeCloseTo(1.2 * 1.2 * 0.5 + 0.9 * 2.1 * 1.0, 4);
      expect(inletCount > 0 && outletCount > 0).toBe(true);
    });

    it('flags warning when all openings are closed', () => {
      const openings = useSceneStore.getState().room.openings;
      const ids = openings.map((op) => op.id);
      useSceneStore.getState().setOpeningsRole(ids, 'closed');

      const room = useSceneStore.getState().room;
      const inletCount = room.openings.filter(
        (o) => o.role === 'inlet' && o.openFraction > 0
      ).length;
      const outletCount = room.openings.filter(
        (o) => o.role === 'outlet' && o.openFraction > 0
      ).length;
      const totalArea = room.openings.reduce(
        (sum, o) => sum + o.width * o.height * o.openFraction,
        0
      );

      expect(inletCount).toBe(0);
      expect(outletCount).toBe(0);
      expect(totalArea).toBe(0);
      expect(inletCount > 0 && outletCount > 0).toBe(false);
    });
  });

  describe('3D Airflow arrow direction & wall normal orientation', () => {
    it('verifies inlet arrow points into the room and outlet arrow points out of the room', () => {
      const room = useSceneStore.getState().room;
      // Default room is 4x3 centered at [0,0]: corners [-2, -1.5], [2, -1.5], [2, 1.5], [-2, 1.5]
      // Wall 0: from [-2, -1.5] to [2, -1.5] (bottom wall, dx=4, dz=0)
      const seg0 = wallSegment(room, 0);
      expect(seg0.normal).toEqual([0, -1]); // points in -Z direction (outward)

      // An outward vector from the bottom wall points in +normal = [0, -1]
      // A point stepped by outward vector is further away from center:
      const midWall0 = [
        seg0.a[0] + 0.5 * seg0.len * seg0.dir[0],
        seg0.a[1] + 0.5 * seg0.len * seg0.dir[1],
      ] as [number, number];

      // Stepping in +normal direction (outlet):
      const outsidePoint = [
        midWall0[0] + 0.5 * seg0.normal[0],
        midWall0[1] + 0.5 * seg0.normal[1],
      ] as [number, number];
      expect(pointInPolygon(outsidePoint, room.outline)).toBe(false);

      // Stepping in -normal direction (inlet):
      const insidePoint = [
        midWall0[0] - 0.5 * seg0.normal[0],
        midWall0[1] - 0.5 * seg0.normal[1],
      ] as [number, number];
      expect(pointInPolygon(insidePoint, room.outline)).toBe(true);
    });
  });
});
