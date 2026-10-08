import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { getSourceUnitMultiplier, normalizeModel } from './modelNormalizer';
import type { SourceUnit } from './catalog';

describe('Model Normalizer (normalizeModel)', () => {
  it('correctly maps sourceUnit multipliers', () => {
    expect(getSourceUnitMultiplier('m')).toBe(1.0);
    expect(getSourceUnitMultiplier('cm')).toBe(0.01);
    expect(getSourceUnitMultiplier('mm')).toBe(0.001);
    expect(getSourceUnitMultiplier('in')).toBeCloseTo(0.0254, 5);
    expect(getSourceUnitMultiplier(undefined)).toBe(1.0);
  });

  // Test across all source units: m, cm, mm, in
  const sourceUnits: SourceUnit[] = ['m', 'cm', 'mm', 'in'];

  for (const unit of sourceUnits) {
    it(`returns a bounding box equal to targetSize (within 1 mm) and bottom-centre pivot for sourceUnit '${unit}'`, () => {
      // Create a sample model authored in the given sourceUnit
      const targetSize: [number, number, number] = [1.5, 0.8, 2.0]; // in meters
      const multiplier = getSourceUnitMultiplier(unit);

      // Model authored size in its own unit
      const authoredW = targetSize[0] / multiplier;
      const authoredH = targetSize[1] / multiplier;
      const authoredD = targetSize[2] / multiplier;

      // Create a mesh with geometry in authored units
      const geom = new THREE.BoxGeometry(authoredW, authoredH, authoredD);
      const mat = new THREE.MeshStandardMaterial({ color: 0x4f46e5 });
      const mesh = new THREE.Mesh(geom, mat);

      const scene = new THREE.Group();
      scene.add(mesh);

      const normalized = normalizeModel(scene, targetSize, {
        sourceUnit: unit,
        fitMode: 'contain',
      });

      const box = new THREE.Box3().setFromObject(normalized);
      const size = new THREE.Vector3();
      box.getSize(size);

      // Check bounding box size matches targetSize within 1 mm (0.001 m)
      expect(Math.abs(size.x - targetSize[0])).toBeLessThan(0.001);
      expect(Math.abs(size.y - targetSize[1])).toBeLessThan(0.001);
      expect(Math.abs(size.z - targetSize[2])).toBeLessThan(0.001);

      // Pivot must end at bottom-centre:
      // Bottom is at y = 0
      expect(Math.abs(box.min.y)).toBeLessThan(0.001);
      // Top is at y = targetSize[1]
      expect(Math.abs(box.max.y - targetSize[1])).toBeLessThan(0.001);
      // X is centered at 0
      expect(Math.abs(box.min.x + box.max.x)).toBeLessThan(0.001);
      // Z is centered at 0
      expect(Math.abs(box.min.z + box.max.z)).toBeLessThan(0.001);
    });
  }

  it('correctly handles fitMode stretch vs contain', () => {
    // Model with 1:1:1 aspect ratio
    const geom = new THREE.BoxGeometry(1, 1, 1);
    const mat = new THREE.MeshBasicMaterial();
    const mesh = new THREE.Mesh(geom, mat);
    const scene = new THREE.Group();
    scene.add(mesh);

    const targetSize: [number, number, number] = [2.0, 1.0, 0.5];

    // 1. In 'stretch' mode, all 3 dimensions are stretched to targetSize
    const stretched = normalizeModel(scene, targetSize, {
      sourceUnit: 'm',
      fitMode: 'stretch',
    });
    const stretchBox = new THREE.Box3().setFromObject(stretched);
    const stretchSize = new THREE.Vector3();
    stretchBox.getSize(stretchSize);

    expect(stretchSize.x).toBeCloseTo(2.0, 3);
    expect(stretchSize.y).toBeCloseTo(1.0, 3);
    expect(stretchSize.z).toBeCloseTo(0.5, 3);

    // 2. In 'contain' mode, uniform scale matches min dimension (0.5)
    const contained = normalizeModel(scene, targetSize, {
      sourceUnit: 'm',
      fitMode: 'contain',
    });
    const containBox = new THREE.Box3().setFromObject(contained);
    const containSize = new THREE.Vector3();
    containBox.getSize(containSize);

    expect(containSize.x).toBeCloseTo(0.5, 3);
    expect(containSize.y).toBeCloseTo(0.5, 3);
    expect(containSize.z).toBeCloseTo(0.5, 3);
  });

  it('handles internally transformed and offset geometries', () => {
    // Geometry with vertex offset and child node position
    const geom = new THREE.BoxGeometry(1, 2, 1);
    geom.translate(5, 10, -3); // severely offset geometry
    const mesh = new THREE.Mesh(geom, new THREE.MeshBasicMaterial());
    mesh.position.set(2, -1, 4); // offset node
    mesh.rotation.y = Math.PI / 4; // rotated node

    const scene = new THREE.Group();
    scene.add(mesh);

    const targetSize: [number, number, number] = [1.2, 2.0, 0.6];
    const normalized = normalizeModel(scene, targetSize, {
      fitMode: 'stretch',
    });

    const box = new THREE.Box3().setFromObject(normalized);
    const size = new THREE.Vector3();
    box.getSize(size);

    expect(size.x).toBeCloseTo(1.2, 3);
    expect(size.y).toBeCloseTo(2.0, 3);
    expect(size.z).toBeCloseTo(0.6, 3);

    // Bottom at y=0, centered in X and Z
    expect(box.min.y).toBeCloseTo(0, 3);
    expect(box.min.x + box.max.x).toBeCloseTo(0, 3);
    expect(box.min.z + box.max.z).toBeCloseTo(0, 3);
  });

  it('clones materials and geometries so original models are not mutated', () => {
    const geom = new THREE.BoxGeometry(1, 1, 1);
    const mat = new THREE.MeshStandardMaterial({ color: 0xff0000 });
    const mesh = new THREE.Mesh(geom, mat);
    const scene = new THREE.Group();
    scene.add(mesh);

    const targetSize: [number, number, number] = [2, 2, 2];
    const normalized1 = normalizeModel(scene, targetSize);
    const normalized2 = normalizeModel(scene, [3, 3, 3]);

    let mesh1: THREE.Mesh | null = null;
    let mesh2: THREE.Mesh | null = null;

    normalized1.traverse((c) => {
      if ((c as THREE.Mesh).isMesh) mesh1 = c as THREE.Mesh;
    });
    normalized2.traverse((c) => {
      if ((c as THREE.Mesh).isMesh) mesh2 = c as THREE.Mesh;
    });

    expect(mesh1).not.toBeNull();
    expect(mesh2).not.toBeNull();
    expect(mesh1!.geometry).not.toBe(geom);
    expect(mesh2!.geometry).not.toBe(geom);
    expect(mesh1!.geometry).not.toBe(mesh2!.geometry);
    expect(mesh1!.material).not.toBe(mat);
    expect(mesh2!.material).not.toBe(mat);
    expect(mesh1!.material).not.toBe(mesh2!.material);
  });
});
