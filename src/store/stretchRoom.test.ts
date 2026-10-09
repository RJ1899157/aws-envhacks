import { beforeEach, describe, expect, it } from 'vitest';
import { useSceneStore } from './sceneStore';

const store = () => useSceneStore.getState();

describe('stretching a room (moveWall)', () => {
  beforeEach(() => store().resetRoom()); // 4 x 3 m, x in [-2, 2], z in [-1.5, 1.5]

  it('pushes furniture back inside when the room shrinks', () => {
    store().addObject({
      id: 'wardrobe', assetId: 'wardrobe', name: 'Wardrobe', position: [1.4, 0, 0], rotation: [0, 0, 0],
      size: [1.2, 2, 0.6], elevation: 0, role: 'solid', wallMounted: false,
    });
    store().moveWall(1, -1); // right wall (x = 2) moves in to x = 1

    const [x] = store().room.objects[0]!.position;
    expect(x + 0.6).toBeCloseTo(1); // right edge now flush with the moved wall
  });

  it('keeps doors on the neighbouring wall in place when its corner moves', () => {
    // Wall 1 runs (2,-1.5) -> (2,1.5). Moving wall 0 (z = -1.5) outward by 1 m moves wall 1's start.
    store().addOpening({ id: 'door', wallIndex: 1, type: 'door', offset: 1, width: 0.9, height: 2.1, sill: 0 });
    store().moveWall(0, 1);

    const door = store().room.openings[0]!;
    expect(door.offset).toBeCloseTo(2); // same world spot (z = -0.5), now 2 m from the new start corner
  });

  it('moves furniture standing against the wall along with it, and leaves the rest', () => {
    // Wardrobe flush against the right wall (x = 2), bed in the middle
    store().addObject({
      id: 'wardrobe', assetId: 'wardrobe', name: 'Wardrobe', position: [1.7, 0, 0], rotation: [0, -Math.PI / 2, 0],
      size: [1.2, 2, 0.6], elevation: 0, role: 'solid', wallMounted: false,
    });
    store().addObject({
      id: 'bed', assetId: 'single-bed', name: 'Bed', position: [-0.5, 0, 0], rotation: [0, 0, 0],
      size: [1, 0.5, 2], elevation: 0, role: 'solid', wallMounted: false,
    });

    store().moveWall(1, 1); // stretch the room 1 m to the right
    const byId = Object.fromEntries(store().room.objects.map((o) => [o.id, o.position]));
    expect(byId.wardrobe![0]).toBeCloseTo(2.7); // still flush against the wall, now at x = 3
    expect(byId.bed![0]).toBeCloseTo(-0.5);

    store().moveWall(1, -1.5); // pull it back in past the start
    expect(store().room.objects.find((o) => o.id === 'wardrobe')!.position[0]).toBeCloseTo(1.2);
  });
});
