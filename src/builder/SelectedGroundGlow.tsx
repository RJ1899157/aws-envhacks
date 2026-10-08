import React, { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { useSceneStore } from '../store/sceneStore';

/**
 * Creates a soft procedural radial blur canvas texture for ground glow.
 */
function createRadialGlowTexture(): THREE.CanvasTexture {
  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;

  const gradient = ctx.createRadialGradient(
    size / 2,
    size / 2,
    0,
    size / 2,
    size / 2,
    size / 2
  );
  gradient.addColorStop(0, 'rgba(245, 158, 11, 0.45)');
  gradient.addColorStop(0.5, 'rgba(245, 158, 11, 0.2)');
  gradient.addColorStop(0.8, 'rgba(245, 158, 11, 0.05)');
  gradient.addColorStop(1, 'rgba(245, 158, 11, 0)');

  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, size, size);

  const texture = new THREE.CanvasTexture(canvas);
  texture.needsUpdate = true;
  return texture;
}

let cachedGlowTexture: THREE.CanvasTexture | null = null;
function getGlowTexture(): THREE.CanvasTexture {
  if (!cachedGlowTexture) {
    cachedGlowTexture = createRadialGlowTexture();
  }
  return cachedGlowTexture;
}

const SingleObjectGroundGlow: React.FC<{
  position: [number, number, number];
  size: [number, number, number];
  scale?: [number, number, number];
}> = ({ position, size, scale = [1, 1, 1] }) => {
  const meshRef = useRef<THREE.Mesh>(null);
  const matRef = useRef<THREE.MeshBasicMaterial>(null);

  const [w, , d] = size;
  const sx = scale[0] ?? 1;
  const sz = scale[2] ?? 1;
  const radius = Math.max(w * sx, d * sz) * 0.9 + 0.3;

  const texture = useMemo(() => getGlowTexture(), []);

  useFrame(() => {
    if (!matRef.current) return;
    const t = performance.now() * 0.003;
    // Gentle breathing pulse
    const pulse = 0.85 + 0.15 * Math.sin(t);
    matRef.current.opacity = 0.45 * pulse;
  });

  return (
    <mesh
      ref={meshRef}
      position={[position[0], 0.002, position[2]]}
      rotation={[-Math.PI / 2, 0, 0]}
    >
      <planeGeometry args={[radius * 2, radius * 2]} />
      <meshBasicMaterial
        ref={matRef}
        map={texture}
        transparent
        opacity={0.45}
        depthWrite={false}
        blending={THREE.AdditiveBlending}
      />
    </mesh>
  );
};

export const SelectedGroundGlow: React.FC = () => {
  const room = useSceneStore((state) => state.room);
  const selectedObjectId = useSceneStore((state) => state.selectedObjectId);
  const selectedObjectIds = useSceneStore((state) => state.selectedObjectIds);

  const activeObjects = useMemo(() => {
    const ids = new Set(
      selectedObjectIds.length > 0 ? selectedObjectIds : selectedObjectId ? [selectedObjectId] : []
    );
    return room.objects.filter((o) => ids.has(o.id));
  }, [room.objects, selectedObjectIds, selectedObjectId]);

  if (activeObjects.length === 0) return null;

  return (
    <group name="selected-ground-glow">
      {activeObjects.map((obj) => (
        <SingleObjectGroundGlow
          key={`glow-${obj.id}`}
          position={obj.position}
          size={obj.size}
          scale={obj.scale}
        />
      ))}
    </group>
  );
};

export default SelectedGroundGlow;
