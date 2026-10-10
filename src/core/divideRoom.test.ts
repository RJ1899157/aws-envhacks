import { describe, expect, it } from 'vitest';
import { RoomSchema, type Room } from './schema';
import { divideRoom } from './rooms';
import { interiorOpeningIds } from '../simulation/geometry';
import { simulateHouseNetwork } from '../simulation/house/network';

/** 4 × 3 m room with two windows on its north wall, a door across x = 2 and furniture on both sides. */
export function createQuickRoom(): Room {
  return RoomSchema.parse({
    id: 'r1',
    name: 'Room',
    outline: [[0, 0], [4, 0], [4, 3], [0, 3]],
    openings: [
      { id: 'w1', wallIndex: 0, type: 'window', offset: 0.5, width: 1, height: 1, sill: 1, role: 'inlet', openFraction: 1 },
      { id: 'w2', wallIndex: 0, type: 'window', offset: 2.5, width: 1, height: 1, sill: 1, role: 'inlet', openFraction: 1 },
      { id: 'd1', wallIndex: 2, type: 'door', offset: 1.5, width: 1, height: 2.1, sill: 0, role: 'outlet', openFraction: 1 },
    ],
    objects: [
      { id: 'left', assetId: 'desk', name: 'Desk', position: [1, 0, 1.5], size: [1, 0.75, 0.6] },
      { id: 'right', assetId: 'wardrobe', name: 'Wardrobe', position: [3, 0, 1.5], size: [1.2, 2, 0.6] },
    ],
  });
}


describe('dividing a room with a wall', () => {
  it('splits a 4 × 3 room into two parts one wall thickness apart, keeping windows and furniture', () => {
    const room = createQuickRoom();
    const res = divideRoom(room, 'x', 2, []);
    if (!res.ok) throw new Error(res.reason);
    const xs = (r: Room) => r.outline.map((p) => p[0]);
    expect(Math.max(...xs(res.first))).toBeCloseTo(2 - 0.075);
    expect(Math.min(...xs(res.second))).toBeCloseTo(2 + 0.075);
    // Window at 0.5–1.5 m stays in the first part on the same wall; the one at 2.5–3.5 m moves to the second
    expect(res.first.openings.map((o) => o.id)).toEqual(['w1']);
    expect(res.second.openings.map((o) => o.id)).toEqual(['w2']);
    expect(res.second.openings[0]!.offset).toBeCloseTo(2.5 - 2.075);
    // The door that spanned the cut can't survive
    expect([...res.first.openings, ...res.second.openings].some((o) => o.id === 'd1')).toBe(false);
    expect(res.first.objects.map((o) => o.id)).toEqual(['left']);
    expect(res.second.objects.map((o) => o.id)).toEqual(['right']);
    expect(res.second.name).toBe('Room 2');
    expect(res.second.id).not.toBe(res.first.id);
  });

  it('the new wall is shared: a door on it connects the two parts in the simulation', () => {
    const res = divideRoom(createQuickRoom(), 'x', 2, []);
    if (!res.ok) throw new Error(res.reason);
    // The first part's wall along x = 1.925 (its east side)
    const east = res.first.outline.findIndex((p, i) => {
      const q = res.first.outline[(i + 1) % res.first.outline.length]!;
      return Math.abs(p[0] - 1.925) < 1e-6 && Math.abs(q[0] - 1.925) < 1e-6;
    });
    const withDoor = RoomSchema.parse({ ...res.first, openings: [...res.first.openings, { id: 'mid', wallIndex: east, type: 'door', offset: 1, width: 0.9, height: 2.1, sill: 0, role: 'outlet', openFraction: 1 }] });
    expect(interiorOpeningIds(withDoor, [res.second]).has('mid')).toBe(true);
    const net = simulateHouseNetwork([withDoor, res.second], { outdoorUgM3: 50 });
    const door = net.paths.find((p) => p.openingId === 'mid' && p.kind === 'opening');
    expect(door).toBeDefined();
    expect(door!.to).toBe(1);
    expect(door!.forwardM3s + door!.backwardM3s).toBeGreaterThan(0);
  });

  it('refuses cuts that leave a sliver or cross the room twice', () => {
    expect(divideRoom(createQuickRoom(), 'x', 0.2, []).ok).toBe(false);
    const u = RoomSchema.parse({ name: 'U', outline: [[0, 0], [6, 0], [6, 4], [4, 4], [4, 2], [2, 2], [2, 4], [0, 4]] });
    expect(divideRoom(u, 'z', 3, []).ok).toBe(false);
    expect(divideRoom(u, 'x', 3, []).ok).toBe(true);
  });
});
