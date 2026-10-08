import { beforeEach, describe, expect, it } from 'vitest';
import { useSceneStore } from './sceneStore';
import type { PlacedAsset } from '../core/types';

describe('SceneStore (Zustand + Immer + Zundo)', () => {
  beforeEach(() => {
    useSceneStore.getState().resetScene();
    useSceneStore.temporal.getState().clear();
  });

  it('initializes with default room and empty placed assets', () => {
    const state = useSceneStore.getState();
    expect(state.room.name).toBe('Main Room');
    expect(state.room.wallHeight).toBe(2.8);
    expect(state.room.polygon).toHaveLength(4);
    expect(state.placedAssets).toEqual([]);
    expect(state.snapConfig.translation).toBe(0.05);
    expect(state.snapConfig.rotation).toBe(15);
  });

  it('allows updating wall height and polygon', () => {
    useSceneStore.getState().setWallHeight(3.2);
    expect(useSceneStore.getState().room.wallHeight).toBe(3.2);

    const newPolygon: [number, number][] = [
      [-4, -3],
      [4, -3],
      [4, 3],
      [-4, 3],
    ];
    useSceneStore.getState().updatePolygon(newPolygon);
    expect(useSceneStore.getState().room.polygon).toEqual(newPolygon);
  });

  it('manages openings in the room', () => {
    const opening = {
      id: 'win-1',
      wallIndex: 1,
      type: 'window' as const,
      offset: 0.5,
      width: 1.2,
      height: 1.0,
      sill: 0.9,
      role: 'inlet' as const,
      openFraction: 1,
    };

    useSceneStore.getState().addOpening(opening);
    expect(useSceneStore.getState().room.openings).toHaveLength(1);
    expect(useSceneStore.getState().room.openings[0]?.id).toBe('win-1');

    useSceneStore.getState().removeOpening('win-1');
    expect(useSceneStore.getState().room.openings).toHaveLength(0);
  });

  it('adds, updates, selects, and removes placed assets', () => {
    const asset: PlacedAsset = {
      id: 'asset-1',
      catalogId: 'chair-01',
      name: 'Office Chair',
      position: [1, 0, 1],
      rotation: [0, 0, 0],
      dimensions: [0.6, 0.9, 0.6],
      airflowRole: 'solid',
    };

    useSceneStore.getState().addPlacedAsset(asset);
    expect(useSceneStore.getState().placedAssets).toHaveLength(1);

    useSceneStore.getState().selectObject('asset-1');
    expect(useSceneStore.getState().selectedId).toBe('asset-1');

    useSceneStore.getState().updatePlacedAsset('asset-1', {
      position: [2, 0, 2],
    });
    expect(useSceneStore.getState().placedAssets[0]?.position).toEqual([2, 0, 2]);

    useSceneStore.getState().removePlacedAsset('asset-1');
    expect(useSceneStore.getState().placedAssets).toHaveLength(0);
    expect(useSceneStore.getState().selectedId).toBeNull();
  });

  it('supports undo and redo via zundo temporal store', () => {
    const asset1: PlacedAsset = {
      id: 'asset-1',
      catalogId: 'chair-01',
      name: 'Office Chair',
      position: [0, 0, 0],
      rotation: [0, 0, 0],
      dimensions: [0.6, 0.9, 0.6],
      airflowRole: 'solid',
    };

    useSceneStore.getState().addPlacedAsset(asset1);
    expect(useSceneStore.getState().placedAssets).toHaveLength(1);

    // Undo action
    useSceneStore.temporal.getState().undo();
    expect(useSceneStore.getState().placedAssets).toHaveLength(0);

    // Redo action
    useSceneStore.temporal.getState().redo();
    expect(useSceneStore.getState().placedAssets).toHaveLength(1);
    expect(useSceneStore.getState().placedAssets[0]?.id).toBe('asset-1');
  });
});
