import * as THREE from 'three';
import type { Vec2 } from '../core/schema';

const UP = new THREE.Vector3(0, 1, 0);

/**
 * Rotation mapping local +X onto the wall direction (local +Z then points into the room).
 * A basis of (dir, up, outwardNormal) is left-handed for our outline winding, so it can't be
 * converted to a quaternion directly.
 */
export function wallQuaternion(dir: Vec2): THREE.Quaternion {
  return new THREE.Quaternion().setFromAxisAngle(UP, Math.atan2(-dir[1], dir[0]));
}
