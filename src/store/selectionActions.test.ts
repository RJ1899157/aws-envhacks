import { beforeEach, describe, expect, it } from 'vitest';
import { useSceneStore } from './sceneStore';
import { rotateSelection } from './selectionActions';

const store = () => useSceneStore.getState();

describe('rotateSelection (R key)', () => {
  beforeEach(() => {
    store().resetRoom(); // 4 x 3 m, x in [-2, 2], z in [-1.5, 1.5]
    useSceneStore.temporal.getState().clear();
  });

  it('turns the selected object a quarter turn each way', () => {
    store().addObject({
      id: 'bed', assetId: 'single-bed', name: 'Bed', position: [0, 0, 0], rotation: [0, 0, 0],
      size: [1, 0.5, 2], elevation: 0, role: 'solid', wallMounted: false,
    });
    store().selectObject('bed');

    expect(rotateSelection(Math.PI / 2)).toBe(1);
    expect(store().room.objects[0]!.rotation[1]).toBeCloseTo(Math.PI / 2);
    rotateSelection(-Math.PI / 2);
    expect(store().room.objects[0]!.rotation[1]).toBeCloseTo(0);
  });

  it('keeps the turned footprint inside the walls', () => {
    // 2 m bed along Z, 0.5 m from the x = 2 wall: turned, it spans 2 m along X and must slide in
    store().addObject({
      id: 'bed', assetId: 'single-bed', name: 'Bed', position: [1.5, 0, 0], rotation: [0, 0, 0],
      size: [1, 0.5, 2], elevation: 0, role: 'solid', wallMounted: false,
    });
    store().selectObject('bed');
    rotateSelection(Math.PI / 2);
    expect(store().room.objects[0]!.position[0]).toBeCloseTo(1); // right edge now at the wall
  });

  it('is a single undo step and does nothing without a selection', () => {
    expect(rotateSelection(Math.PI / 2)).toBe(0);
    store().addObject({
      id: 'bed', assetId: 'single-bed', name: 'Bed', position: [0, 0, 0], rotation: [0, 0, 0],
      size: [1, 0.5, 2], elevation: 0, role: 'solid', wallMounted: false,
    });
    store().selectObject('bed');
    rotateSelection(Math.PI / 2);
    useSceneStore.temporal.getState().undo();
    expect(store().room.objects[0]!.rotation[1]).toBeCloseTo(0);
  });
});
