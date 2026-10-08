import * as THREE from 'three';
import type { FitMode, SourceUnit } from './catalog';

export interface NormalizeModelOptions {
  fitMode?: FitMode;
  sourceUnit?: SourceUnit;
}

/**
 * Returns conversion multiplier from authored sourceUnit to standard simulation meters (m).
 */
export function getSourceUnitMultiplier(unit?: SourceUnit): number {
  switch (unit) {
    case 'cm':
      return 0.01;
    case 'mm':
      return 0.001;
    case 'in':
      return 0.0254;
    case 'm':
    default:
      return 1.0;
  }
}

/**
 * Pure function that normalizes a 3D model:
 * 1. Deep clones geometries and materials so repeated assets never mutate a shared model
 * 2. Applies catalog.sourceUnit pre-scale (converting cm, mm, in to meters)
 * 3. Computes Box3 AFTER internal transforms
 * 4. Scales to targetSize (non-uniformly for 'stretch', uniformly for 'contain' default)
 * 5. Recentres pivot to bottom-centre (x/z centred, y = 0)
 *
 * @param scene The source Object3D (e.g. from useGLTF or GLTFLoader)
 * @param targetSize [width(x), height(y), depth(z)] in meters
 * @param options fitMode ('contain' | 'stretch') and sourceUnit ('m' | 'cm' | 'mm' | 'in')
 * @returns A normalized THREE.Object3D with bottom-centre pivot
 */
export function normalizeModel(
  scene: THREE.Object3D,
  targetSize: [number, number, number],
  options: NormalizeModelOptions = {}
): THREE.Object3D {
  // 1. Deep clone materials and geometry
  const cloned = scene.clone(true);
  cloned.traverse((child) => {
    if ((child as THREE.Mesh).isMesh) {
      const mesh = child as THREE.Mesh;
      if (mesh.geometry) {
        mesh.geometry = mesh.geometry.clone();
      }
      if (mesh.material) {
        if (Array.isArray(mesh.material)) {
          mesh.material = mesh.material.map((m) => m.clone());
        } else {
          mesh.material = mesh.material.clone();
        }
      }
    }
  });

  // 2. Apply authored sourceUnit pre-scale
  const unitFactor = getSourceUnitMultiplier(options.sourceUnit);
  if (Math.abs(unitFactor - 1.0) > 1e-6) {
    cloned.scale.multiplyScalar(unitFactor);
  }

  // 3. Compute model's Box3 AFTER internal transforms and unit pre-scale
  cloned.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(cloned);
  const modelSize = new THREE.Vector3();
  box.getSize(modelSize);
  const modelCenter = new THREE.Vector3();
  box.getCenter(modelCenter);

  const rawX = modelSize.x > 1e-6 ? modelSize.x : 1e-4;
  const rawY = modelSize.y > 1e-6 ? modelSize.y : 1e-4;
  const rawZ = modelSize.z > 1e-6 ? modelSize.z : 1e-4;

  // 4. Scale: non-uniformly only if fitMode === 'stretch', otherwise uniformly ('contain')
  const fitMode = options.fitMode ?? 'contain';
  let scaleX: number;
  let scaleY: number;
  let scaleZ: number;

  if (fitMode === 'stretch') {
    scaleX = targetSize[0] / rawX;
    scaleY = targetSize[1] / rawY;
    scaleZ = targetSize[2] / rawZ;
  } else {
    // 'contain' (default): uniform scale matching the most constrained dimension
    const uniformScale = Math.min(targetSize[0] / rawX, targetSize[1] / rawY, targetSize[2] / rawZ);
    scaleX = uniformScale;
    scaleY = uniformScale;
    scaleZ = uniformScale;
  }

  // 5. Apply scale and offset so the pivot is bottom-centre (x=0, y=0, z=0 is bottom-centre)
  const root = new THREE.Group();
  root.name = 'normalized-model-root';

  cloned.scale.x *= scaleX;
  cloned.scale.y *= scaleY;
  cloned.scale.z *= scaleZ;

  // Recentre offset:
  // Center in X: -modelCenter.x * scaleX
  // Bottom at Y=0: -box.min.y * scaleY
  // Center in Z: -modelCenter.z * scaleZ
  cloned.position.set(-modelCenter.x * scaleX, -box.min.y * scaleY, -modelCenter.z * scaleZ);

  root.add(cloned);
  root.updateMatrixWorld(true);

  return root;
}
