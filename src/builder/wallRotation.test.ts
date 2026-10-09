import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { wallQuaternion } from './wallRotation';
import { wallSegment } from '../core/parser';
import { createDefaultRoom } from '../core/defaultRoom';

describe('wallQuaternion', () => {
  it('aligns local +X with every wall direction and local +Z with the inward normal', () => {
    const room = createDefaultRoom();
    for (let i = 0; i < room.outline.length; i++) {
      const seg = wallSegment(room, i);
      const q = wallQuaternion(seg.dir);
      const x = new THREE.Vector3(1, 0, 0).applyQuaternion(q);
      const z = new THREE.Vector3(0, 0, 1).applyQuaternion(q);
      expect(x.x).toBeCloseTo(seg.dir[0]);
      expect(x.z).toBeCloseTo(seg.dir[1]);
      expect(z.x).toBeCloseTo(-seg.normal[0]);
      expect(z.z).toBeCloseTo(-seg.normal[1]);
    }
  });
});
