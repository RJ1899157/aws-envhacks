import * as THREE from 'three';
import { GLTFExporter } from 'three-stdlib';

export interface NormalizationOptions {
  sourceUnit: 'm' | 'cm' | 'mm' | 'in';
  upAxis: 'Y' | 'Z';
  targetSize?: [number, number, number]; // if specified, scale to this size ignoring sourceUnit
  recenterPivot: boolean;
  flattenHierarchy: boolean;
}

export function normalizeGeometry(group: THREE.Group, opts: NormalizationOptions): THREE.Group {
  // Clone to avoid modifying the loaded original prematurely
  const clone = group.clone();

  // 1. Up Axis correction
  if (opts.upAxis === 'Z') {
    // If it was modeled Z-up, we need to rotate it so Y is up
    clone.rotation.x = -Math.PI / 2;
    clone.updateMatrixWorld(true);
  }

  // 2. Compute bounding box BEFORE scale/center but AFTER rotation
  const box = new THREE.Box3().setFromObject(clone);
  const size = new THREE.Vector3();
  box.getSize(size);
  const center = new THREE.Vector3();
  box.getCenter(center);

  // 3. Recenter
  if (opts.recenterPivot) {
    // Center X/Z, base Y = 0
    const offset = new THREE.Vector3(-center.x, -box.min.y, -center.z);
    
    // Apply offset to all children recursively or by wrapping
    // A clean way is to wrap it in a new group
    const wrapper = new THREE.Group();
    clone.position.copy(offset);
    wrapper.add(clone);
    // Flatten step later will bake this transform
  }

  // 4. Scale
  let scaleFactor = 1;
  if (opts.targetSize) {
    // scale to fit the largest dimension constraint
    const maxSource = Math.max(size.x, size.y, size.z);
    const maxTarget = Math.max(opts.targetSize[0], opts.targetSize[1], opts.targetSize[2]);
    if (maxSource > 0.0001) {
      scaleFactor = maxTarget / maxSource;
    }
  } else {
    switch (opts.sourceUnit) {
      case 'cm': scaleFactor = 0.01; break;
      case 'mm': scaleFactor = 0.001; break;
      case 'in': scaleFactor = 0.0254; break;
      case 'm': default: scaleFactor = 1; break;
    }
  }

  if (scaleFactor !== 1) {
    clone.scale.setScalar(scaleFactor);
    clone.updateMatrixWorld(true);
  }

  // 5. Flatten Hierarchy & Bake transforms (optional but recommended for performance/voxels)
  if (opts.flattenHierarchy) {
    return bakeAndFlatten(clone);
  }

  return clone;
}

function bakeAndFlatten(root: THREE.Object3D): THREE.Group {
  const mergedGroup = new THREE.Group();
  root.updateMatrixWorld(true);

  root.traverse((child) => {
    if ((child as THREE.Mesh).isMesh) {
      const mesh = child as THREE.Mesh;
      const geom = mesh.geometry.clone();
      geom.applyMatrix4(mesh.matrixWorld);
      geom.computeBoundingBox();
      geom.computeBoundingSphere();
      
      const newMesh = new THREE.Mesh(geom, mesh.material);
      newMesh.name = mesh.name;
      mergedGroup.add(newMesh);
    }
  });

  return mergedGroup;
}

export async function exportToGLB(group: THREE.Group): Promise<Blob> {
  const exporter = new GLTFExporter();
  return new Promise((resolve, reject) => {
    exporter.parse(
      group,
      (gltf: any) => {
        resolve(new Blob([gltf as ArrayBuffer], { type: 'model/gltf-binary' }));
      },
      (error: any) => reject(error),
      { binary: true }
    );
  });
}
