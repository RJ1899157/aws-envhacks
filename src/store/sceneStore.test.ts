import { beforeEach, describe, expect, it } from 'vitest';
import { useSceneStore } from './sceneStore';
import type { Opening, SceneObject } from '../core/types';

describe('SceneStore (Zustand + Immer + Zundo)', () => {
  beforeEach(() => {
    useSceneStore.getState().resetScene();
    useSceneStore.temporal.getState().clear();
  });

  it('initializes with default 4x3m room containing one window and one door', () => {
    const state = useSceneStore.getState();
    expect(state.room.name).toBe('Default Room (4x3m)');
    expect(state.room.wallHeight).toBe(2.7);
    expect(state.room.wallThickness).toBe(0.15);
    expect(state.room.outline).toHaveLength(4);
    expect(state.room.openings).toHaveLength(2);
    expect(state.room.objects).toEqual([]);
    expect(state.snapConfig.translation).toBe(0.05);
    expect(state.snapConfig.rotation).toBe(15);
  });

  it('allows updating wall height, wall thickness, and outline', () => {
    useSceneStore.getState().setWallHeight(3.2);
    expect(useSceneStore.getState().room.wallHeight).toBe(3.2);

    useSceneStore.getState().setWallThickness(0.2);
    expect(useSceneStore.getState().room.wallThickness).toBe(0.2);

    const newOutline: [number, number][] = [
      [-3, -2],
      [3, -2],
      [3, 2],
      [-3, 2],
    ];
    useSceneStore.getState().updateOutline(newOutline);
    expect(useSceneStore.getState().room.outline).toEqual(newOutline);
  });

  it('manages openings in the room', () => {
    const newOpening: Opening = {
      id: 'custom-window',
      wallIndex: 1,
      type: 'window',
      offset: 0.5,
      width: 1.0,
      height: 1.0,
      sill: 1.0,
      role: 'inlet',
      openFraction: 0.8,
    };

    useSceneStore.getState().addOpening(newOpening);
    expect(useSceneStore.getState().room.openings).toHaveLength(3);

    useSceneStore.getState().removeOpening('custom-window');
    expect(useSceneStore.getState().room.openings).toHaveLength(2);
  });

  it('adds, updates, selects, and removes scene objects', () => {
    const obj: SceneObject = {
      id: 'chair-inst-1',
      assetId: 'office-chair',
      name: 'Office Chair',
      position: [0.5, 0, 0.5],
      rotation: [0, 0, 0],
      size: [0.65, 0.95, 0.65],
      elevation: 0,
      role: 'porous',
      wallMounted: false,
    };

    useSceneStore.getState().addObject(obj);
    expect(useSceneStore.getState().room.objects).toHaveLength(1);

    useSceneStore.getState().selectObject('chair-inst-1');
    expect(useSceneStore.getState().selectedId).toBe('chair-inst-1');

    useSceneStore.getState().updateObject('chair-inst-1', {
      position: [1.0, 0, 1.0],
    });
    expect(useSceneStore.getState().room.objects[0]?.position).toEqual([1.0, 0, 1.0]);

    useSceneStore.getState().removeObject('chair-inst-1');
    expect(useSceneStore.getState().room.objects).toHaveLength(0);
    expect(useSceneStore.getState().selectedId).toBeNull();
  });

  it('supports undo and redo via zundo temporal store', () => {
    const obj: SceneObject = {
      id: 'desk-inst-1',
      assetId: 'desk',
      name: 'Desk',
      position: [0, 0, 0],
      rotation: [0, 0, 0],
      size: [1.4, 0.75, 0.7],
      elevation: 0,
      role: 'solid',
      wallMounted: false,
    };

    useSceneStore.getState().addObject(obj);
    expect(useSceneStore.getState().room.objects).toHaveLength(1);

    // Undo action
    useSceneStore.temporal.getState().undo();
    expect(useSceneStore.getState().room.objects).toHaveLength(0);

    // Redo action
    useSceneStore.temporal.getState().redo();
    expect(useSceneStore.getState().room.objects).toHaveLength(1);
    expect(useSceneStore.getState().room.objects[0]?.id).toBe('desk-inst-1');
  });
});
