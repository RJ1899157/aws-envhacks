import { beforeEach, describe, expect, it } from 'vitest';
import type { SceneObject } from './schema';
import { isPollutionSourceObject, settleSources, surfaceHeightAt } from './surfaces';
import { useSceneStore } from '../store/sceneStore';

const obj = (id: string, assetId: string, x: number, z: number, size: [number, number, number], extra: Partial<SceneObject> = {}): SceneObject => ({
  id,
  assetId,
  name: id,
  position: [x, 0, z],
  rotation: [0, 0, 0],
  size,
  elevation: 0,
  role: 'solid',
  wallMounted: false,
  ...extra,
});

const counter = () => obj('counter', 'kitchen-counter', 1, 1, [2.4, 0.9, 0.6]);
const wardrobe = () => obj('wardrobe', 'wardrobe', 3, 1, [1.2, 2.0, 0.6]);
const hood = () => obj('hood', 'range-hood', 1, 1, [0.9, 0.45, 0.5], { elevation: 1.6, role: 'source' });
const incense = (x: number, z: number, elevation = 0.6) => obj('incense', 'pm25-incense', x, z, [0.1, 0.3, 0.1], { elevation, role: 'none' });

describe('pollution source surfaces', () => {
  it('finds the floor or the top of the floor-standing furniture under a point', () => {
    const room = { objects: [counter(), wardrobe(), hood()] };
    expect(surfaceHeightAt(room, 1, 1)).toBeCloseTo(0.9); // counter, not the hood hanging above it
    expect(surfaceHeightAt(room, 3, 1)).toBeCloseTo(2.0); // wardrobe top
    expect(surfaceHeightAt(room, 5, 5)).toBe(0); // floor
  });

  it('respects rotation: a counter turned 90° covers a different strip', () => {
    const turned = { objects: [{ ...counter(), rotation: [0, Math.PI / 2, 0] as [number, number, number] }] };
    expect(surfaceHeightAt(turned, 1, 2)).toBeCloseTo(0.9);
    expect(surfaceHeightAt(turned, 2, 1)).toBe(0);
  });

  it('settles sources onto the surface under them, never in mid-air', () => {
    const room = { objects: [counter(), wardrobe(), incense(1, 1, 0.6), { ...incense(3, 1, 0.6), id: 'incense-2' }, { ...incense(6, 6, 0.6), id: 'incense-3' }] };
    settleSources(room);
    const h = (id: string) => room.objects.find((o) => o.id === id)!.elevation;
    expect(h('incense')).toBeCloseTo(0.9);
    expect(h('incense-2')).toBeCloseTo(2.0);
    expect(h('incense-3')).toBe(0);
    // Furniture is never moved
    expect(h('counter')).toBe(0);
  });

  it('recognises sources by tag or catalogue category', () => {
    expect(isPollutionSourceObject({ assetId: 'pm25-candle' })).toBe(true);
    expect(isPollutionSourceObject({ assetId: 'sofa-3-seater' })).toBe(false);
    expect(isPollutionSourceObject({ assetId: 'custom-box', device: 'pm25Source' })).toBe(true);
  });
});

describe('scene store keeps sources on surfaces', () => {
  beforeEach(() => useSceneStore.getState().resetRoom());

  it('when a source is placed, moved, or the furniture under it moves or is deleted', () => {
    const s = () => useSceneStore.getState();
    const elev = () => s().room.objects.find((o) => o.id === 'incense')!.elevation;
    s().addObject(counter());
    s().addObject(incense(1, 1, 0.6));
    expect(elev()).toBeCloseTo(0.9); // dropped onto the counter
    s().updateObject('incense', { position: [-1.5, 0, -1], elevation: 1.7 }); // moved off it (and lifted)
    expect(elev()).toBe(0); // back on the floor
    s().updateObject('incense', { position: [1, 0, 1] });
    expect(elev()).toBeCloseTo(0.9);
    s().updateObject('counter', { position: [-1, 0, -1] }); // counter slides away
    expect(elev()).toBe(0);
    s().updateObject('counter', { position: [1, 0, 1] });
    expect(elev()).toBeCloseTo(0.9);
    s().removeObject('counter');
    expect(elev()).toBe(0);
  });
});
