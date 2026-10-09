import { beforeEach, describe, expect, it } from 'vitest';
import { useSceneStore } from './sceneStore';
import { copySelection, cutSelection, pasteClipboard } from './clipboard';

const store = () => useSceneStore.getState();

const addBed = (id: string, x: number, z: number) =>
  store().addObject({
    id, assetId: 'single-bed', name: 'Bed', position: [x, 0, z], rotation: [0, 0, 0],
    size: [1, 0.5, 2], elevation: 0, role: 'solid', wallMounted: false,
  });

describe('copy / cut / paste', () => {
  beforeEach(() => {
    store().resetRoom(); // 4 x 3 m, x in [-2, 2], z in [-1.5, 1.5]
    useSceneStore.temporal.getState().clear();
  });

  it('pastes a copy offset from the original and selects it; repeated pastes step further', () => {
    addBed('bed', 0, 0);
    store().selectObject('bed');
    expect(copySelection()).toBe(1);

    expect(pasteClipboard()).toBe(1);
    const first = store().room.objects[1]!;
    expect(first.id).not.toBe('bed');
    expect(first.position[0]).toBeCloseTo(0.3);
    expect(store().selectedObjectIds).toEqual([first.id]);

    pasteClipboard();
    expect(store().room.objects[2]!.position[0]).toBeCloseTo(0.6);
  });

  it('keeps the arrangement of several objects and centres them on the cursor', () => {
    addBed('a', -1, 0);
    addBed('b', 0, 0);
    store().selectAll();
    copySelection();

    pasteClipboard([0.5, 0.2]);
    const pasted = store().room.objects.slice(2);
    expect(pasted.map((o) => o.position[0])).toEqual([0, 1]);
    expect(pasted[0]!.position[2]).toBeCloseTo(0.2);
  });

  it('keeps pasted objects inside the walls', () => {
    addBed('bed', 0, 0);
    store().selectObject('bed');
    copySelection();
    pasteClipboard([1.95, 0]); // would poke 0.45 m through the x = 2 wall
    expect(store().room.objects[1]!.position[0]).toBeCloseTo(1.5);
  });

  it('pastes into the room under the cursor', () => {
    addBed('bed', 0, 0);
    store().selectObject('bed');
    copySelection();
    store().addRoom('bedroom'); // new room to the right of x = 2.15
    const bedroomId = store().room.id;
    store().setActiveRoom('room-1');

    pasteClipboard([3.9, 0]);
    expect(store().room.id).toBe(bedroomId);
    expect(store().room.objects).toHaveLength(1);
  });

  it('cut removes the originals, and a paste undoes in one step', () => {
    addBed('bed', 0, 0);
    store().selectObject('bed');
    expect(cutSelection()).toBe(1);
    expect(store().room.objects).toHaveLength(0);

    pasteClipboard();
    expect(store().room.objects).toHaveLength(1);
    useSceneStore.temporal.getState().undo();
    expect(store().room.objects).toHaveLength(0);
  });

  it('does nothing with an empty selection', () => {
    expect(copySelection()).toBe(0);
  });
});
