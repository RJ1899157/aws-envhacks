import React, { useEffect, useMemo } from 'react';
import * as THREE from 'three';
import { polygonBounds } from '../core/parser';
import { useSceneStore } from '../store/sceneStore';
import { useUiStore } from '../store/uiStore';

const Y = 0.01;
const noRaycast = () => null;

/**
 * Snapping grid drawn over the active room only, measured from the room's min corner so the
 * lines start at the walls and match the placement snapping lattice. Bold line every metre.
 */
export const PlacementGrid: React.FC = () => {
  const outline = useSceneStore((state) => state.room.outline);
  const gridStep = useUiStore((state) => state.gridStep);
  const step = Math.max(gridStep, 0.1);

  const { minor, major } = useMemo(() => {
    const b = polygonBounds(outline);
    const minorPts: number[] = [];
    const majorPts: number[] = [];
    const majorEvery = Math.max(1, Math.round(1 / step));
    const add = (i: number, pts: [number, number, number, number]) =>
      (i % majorEvery === 0 ? majorPts : minorPts).push(pts[0], Y, pts[1], pts[2], Y, pts[3]);

    for (let i = 0; b.min[0] + i * step <= b.max[0] + 1e-6; i++) {
      const x = b.min[0] + i * step;
      add(i, [x, b.min[1], x, b.max[1]]);
    }
    for (let i = 0; b.min[1] + i * step <= b.max[1] + 1e-6; i++) {
      const z = b.min[1] + i * step;
      add(i, [b.min[0], z, b.max[0], z]);
    }
    const toGeom = (pts: number[]) =>
      new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
    return { minor: toGeom(minorPts), major: toGeom(majorPts) };
  }, [outline, step]);

  useEffect(
    () => () => {
      minor.dispose();
      major.dispose();
    },
    [minor, major]
  );

  return (
    <group name="placement-grid">
      <lineSegments geometry={minor} raycast={noRaycast}>
        <lineBasicMaterial color="#71717a" transparent opacity={0.45} />
      </lineSegments>
      <lineSegments geometry={major} raycast={noRaycast}>
        <lineBasicMaterial color="#6366f1" transparent opacity={0.9} />
      </lineSegments>
    </group>
  );
};
