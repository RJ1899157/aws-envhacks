import { beforeEach, describe, expect, it } from 'vitest';
import { useSceneStore } from './sceneStore';

const store = () => useSceneStore.getState();

describe('multi-room floor plan', () => {
  beforeEach(() => {
    store().resetRoom();
    useSceneStore.temporal.getState().clear();
  });

  it('adds a typed room as the new active room and keeps the previous one', () => {
    const firstId = store().room.id;
    store().addRoom('bathroom');

    expect(store().room.type).toBe('bathroom');
    expect(store().room.name).toBe('Bathroom');
    expect(store().otherRooms.map((r) => r.id)).toEqual([firstId]);
  });

  it('switches the active room without losing either room’s contents', () => {
    const firstId = store().room.id!;
    store().addObject({
      id: 'bed', assetId: 'single-bed', name: 'Bed', position: [0, 0, 0], rotation: [0, 0, 0],
      size: [1, 0.5, 2], elevation: 0, role: 'solid', wallMounted: false,
    });
    store().addRoom('kitchen');
    const kitchenId = store().room.id!;

    store().setActiveRoom(firstId);
    expect(store().room.id).toBe(firstId);
    expect(store().room.objects.map((o) => o.id)).toEqual(['bed']);
    expect(store().otherRooms.map((r) => r.id)).toEqual([kitchenId]);
  });

  it('removes rooms but always keeps at least one', () => {
    const firstId = store().room.id!;
    store().removeRoom(firstId);
    expect(store().room.id).toBe(firstId);

    store().addRoom('dining');
    const diningId = store().room.id!;
    store().removeRoom(diningId);
    expect(store().room.id).toBe(firstId);
    expect(store().otherRooms).toHaveLength(0);
  });

  it('undoes adding a room', () => {
    store().addRoom('bedroom');
    expect(store().otherRooms).toHaveLength(1);
    useSceneStore.temporal.getState().undo();
    expect(store().otherRooms).toHaveLength(0);
    expect(store().room.type).toBe('basic');
  });

  it('exports and re-imports the whole floor plan', () => {
    store().addRoom('bathroom');
    const json = store().exportRoom();
    store().resetRoom();
    expect(store().otherRooms).toHaveLength(0);

    const result = store().importRoom(json);
    expect(result.success).toBe(true);
    expect(store().room.type).toBe('bathroom');
    expect(store().otherRooms).toHaveLength(1);
  });
});
