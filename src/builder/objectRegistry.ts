import type * as THREE from 'three';

/**
 * Global registry mapping SceneObject ID to its Three.js Group instance.
 * Enables zero-react-render 60fps direct manipulation by mutating Three.js transforms
 * directly during drags, only committing to Zustand store upon release.
 */
export const objectGroupRegistry = new Map<string, THREE.Group>();

export function registerObjectGroup(id: string, group: THREE.Group): void {
  objectGroupRegistry.set(id, group);
}

export function unregisterObjectGroup(id: string): void {
  objectGroupRegistry.delete(id);
}

export function getObjectGroup(id: string): THREE.Group | undefined {
  return objectGroupRegistry.get(id);
}
