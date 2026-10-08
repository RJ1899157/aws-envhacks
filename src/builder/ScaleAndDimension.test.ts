import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { CATALOG_ASSETS, getCatalogAsset } from '../core/catalog';
import { normalizeModel, getSourceUnitMultiplier } from '../core/modelNormalizer';
import { useSceneStore } from '../store/sceneStore';
import { useUiStore } from '../store/uiStore';
import type { SceneObject } from '../core/schema';

describe('Root Asset Scaling and Dimension Readout Suite', () => {
  it('verifies all catalog assets have realistic real-world sizes within 0.05 - 4.0 m', () => {
    for (const asset of CATALOG_ASSETS) {
      const [w, h, d] = asset.size;
      expect(w, `${asset.id} width`).toBeGreaterThanOrEqual(0.05);
      expect(w, `${asset.id} width`).toBeLessThanOrEqual(4.0);
      expect(h, `${asset.id} height`).toBeGreaterThanOrEqual(0.05);
      expect(h, `${asset.id} height`).toBeLessThanOrEqual(4.0);
      expect(d, `${asset.id} depth`).toBeGreaterThanOrEqual(0.05);
      expect(d, `${asset.id} depth`).toBeLessThanOrEqual(4.0);
    }
  });

  it('verifies category-specific sanity ranges (beds, doors, windows, tables)', () => {
    const singleBed = getCatalogAsset('single-bed')!;
    const doubleBed = getCatalogAsset('double-bed')!;
    const door = getCatalogAsset('door')!;
    const windowAsset = getCatalogAsset('window')!;

    // Beds: length (depth Z) 0.9 - 2.2 m
    expect(singleBed.size[2]).toBeGreaterThanOrEqual(0.9);
    expect(singleBed.size[2]).toBeLessThanOrEqual(2.2);
    expect(doubleBed.size[2]).toBeGreaterThanOrEqual(0.9);
    expect(doubleBed.size[2]).toBeLessThanOrEqual(2.2);

    // Doors: 0.8-1.0 m wide x 1.9-2.2 m tall
    expect(door.size[0]).toBeGreaterThanOrEqual(0.8);
    expect(door.size[0]).toBeLessThanOrEqual(1.0);
    expect(door.size[1]).toBeGreaterThanOrEqual(1.9);
    expect(door.size[1]).toBeLessThanOrEqual(2.2);

    // Windows: 0.4-2.4 m wide
    expect(windowAsset.size[0]).toBeGreaterThanOrEqual(0.4);
    expect(windowAsset.size[0]).toBeLessThanOrEqual(2.4);
  });

  it('normalizes models authored in m, cm, mm, and in so they match targetSize within 1 mm with bottom-centre pivot', () => {
    const units = ['m', 'cm', 'mm', 'in'] as const;
    const targetSize: [number, number, number] = [1.2, 2.1, 0.6]; // e.g. wardrobe

    for (const unit of units) {
      const mult = getSourceUnitMultiplier(unit);
      const geom = new THREE.BoxGeometry(
        targetSize[0] / mult,
        targetSize[1] / mult,
        targetSize[2] / mult
      );
      const mesh = new THREE.Mesh(geom, new THREE.MeshBasicMaterial());
      const scene = new THREE.Group();
      scene.add(mesh);

      const normalized = normalizeModel(scene, targetSize, {
        sourceUnit: unit,
        fitMode: 'stretch',
      });

      const box = new THREE.Box3().setFromObject(normalized);
      const size = new THREE.Vector3();
      box.getSize(size);

      // Matches target size within 1 mm (0.001 m)
      expect(Math.abs(size.x - targetSize[0])).toBeLessThan(0.001);
      expect(Math.abs(size.y - targetSize[1])).toBeLessThan(0.001);
      expect(Math.abs(size.z - targetSize[2])).toBeLessThan(0.001);

      // Pivot is at bottom-centre
      expect(box.min.y).toBeCloseTo(0, 3);
      expect(box.min.x + box.max.x).toBeCloseTo(0, 3);
      expect(box.min.z + box.max.z).toBeCloseTo(0, 3);
    }
  });

  it('resizes an object when typing a target height (e.g. 2.1 m) by back-computing the scale multiplier', () => {
    const wardDef = getCatalogAsset('wardrobe')!; // base size [1.2, 2.0, 0.6]
    const testObj: SceneObject = {
      id: 'test-wardrobe-1',
      name: 'Wardrobe',
      assetId: 'wardrobe',
      position: [1, 0, 1],
      rotation: [0, 0, 0],
      size: [...wardDef.size],
      scale: [1, 1, 1],
      elevation: 0,
      role: 'solid',
      wallMounted: false,
      color: wardDef.color,
    };

    useSceneStore.setState({
      room: {
        version: 1,
        name: 'Test Room',
        outline: [
          [0, 0],
          [5, 0],
          [5, 5],
          [0, 5],
        ],
        wallHeight: 2.7,
        wallThickness: 0.15,
        openings: [],
        objects: [testObj],
        params: {
          windSpeed: 3,
          windDirDeg: 270,
          outdoorTempC: 28,
          indoorTempC: 24,
          humidity: 50,
          pressurePa: 101325,
          datetime: '2026-10-05T12:00:00Z',
        },
      },
      selectedObjectId: 'test-wardrobe-1',
    });

    // Desired target height: 2.1 m (instead of base 2.0 m)
    const targetHeight = 2.1;
    const baseHeight = wardDef.size[1]; // 2.0 m
    const backComputedScaleY = targetHeight / baseHeight; // 1.05
    expect(backComputedScaleY).toBe(1.05);

    // Apply update to store (replicating commitTargetSize)
    useSceneStore.getState().updateObject('test-wardrobe-1', {
      scale: [backComputedScaleY, backComputedScaleY, backComputedScaleY],
    });

    const updated = useSceneStore.getState().room.objects[0]!;
    expect(updated.scale?.[1]).toBe(1.05);

    // Final real-world height in meters
    const finalRealHeight = updated.size[1] * updated.scale![1];
    expect(finalRealHeight).toBeCloseTo(2.1, 2);
  });

  it('toggles scale reference in uiStore', () => {
    expect(useUiStore.getState().showScaleReference).toBe(false);

    useUiStore.getState().toggleScaleReference();
    expect(useUiStore.getState().showScaleReference).toBe(true);

    useUiStore.getState().setShowScaleReference(false);
    expect(useUiStore.getState().showScaleReference).toBe(false);
  });
});
