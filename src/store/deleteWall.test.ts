import { beforeEach, describe, expect, it } from 'vitest';
import { RoomSchema } from '../core/schema';
import { simulateHouseNetwork } from '../simulation/house/network';
import { useSceneStore } from './sceneStore';

const s = () => useSceneStore.getState();

describe('deleting walls', () => {
  beforeEach(() => {
    s().loadRoom(RoomSchema.parse({ id: 'r1', name: 'Living', outline: [[0, 0], [5, 0], [5, 4], [0, 4]], openings: [{ id: 'w', wallIndex: 0, type: 'window', offset: 1, width: 1, height: 1, sill: 1, role: 'inlet', openFraction: 1 }] }));
  });

  it('an outside wall opens completely to outdoors (and its window goes); restoring puts it back', () => {
    s().deleteWall(0);
    const open = s().room.openings;
    expect(open).toHaveLength(1);
    expect(open[0]).toMatchObject({ subType: 'open-wall', wallIndex: 0, offset: 0, width: 5, sill: 0 });
    const path = simulateHouseNetwork([s().room]).paths.find((p) => p.openingId === open[0]!.id)!;
    expect(path.to).toBe(-1);
    expect(path.areaM2).toBeCloseTo(5 * 2.7, 1);
    s().restoreWall(0);
    expect(s().room.openings).toHaveLength(0);
  });

  it('a wall between two rooms becomes open plan, from either side, and can be put back', () => {
    expect(s().divideRoom('x', 2.5)).toBeNull();
    const east = s().room.outline.findIndex((p, i) => {
      const q = s().room.outline[(i + 1) % s().room.outline.length]!;
      return Math.abs(p[0] - 2.425) < 1e-6 && Math.abs(q[0] - 2.425) < 1e-6;
    });
    s().deleteWall(east);
    const net = simulateHouseNetwork([s().room, ...s().otherRooms]);
    const between = net.paths.find((p) => p.kind === 'opening' && p.to >= 0)!;
    expect(between).toBeDefined();
    expect(between.areaM2).toBeGreaterThan(9);
    // Restore it from the other room's side
    const other = s().otherRooms[0]!.id!;
    s().setActiveRoom(other);
    const west = s().room.outline.findIndex((p, i) => {
      const q = s().room.outline[(i + 1) % s().room.outline.length]!;
      return Math.abs(p[0] - 2.575) < 1e-6 && Math.abs(q[0] - 2.575) < 1e-6;
    });
    s().restoreWall(west);
    expect([s().room, ...s().otherRooms].flatMap((r) => r.openings).some((o) => o.subType === 'open-wall')).toBe(false);
  });

  it('is one undo step', () => {
    s().deleteWall(0);
    useSceneStore.temporal.getState().undo();
    expect(s().room.openings.map((o) => o.id)).toEqual(['w']);
  });
});
