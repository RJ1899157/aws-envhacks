import React, { useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { useDropFeedbackStore, type DropRipple } from '../store/dropFeedbackStore';

const SingleRippleMesh: React.FC<{ ripple: DropRipple }> = ({ ripple }) => {
  const meshRef = useRef<THREE.Mesh>(null);
  const matRef = useRef<THREE.MeshBasicMaterial>(null);

  useFrame(() => {
    if (!meshRef.current || !matRef.current) return;
    const now = performance.now();
    const elapsed = now - ripple.createdAt;
    const p = Math.min(1, Math.max(0, elapsed / 400));

    // Smooth expansion curve
    const currentScale = (0.5 + 1.1 * Math.sin((p * Math.PI) / 2)) * ripple.radius;
    meshRef.current.scale.set(currentScale, currentScale, 1);

    // Easing fade-out
    matRef.current.opacity = (1 - p) * 0.75;
  });

  return (
    <mesh
      ref={meshRef}
      position={[ripple.x, 0.004, ripple.z]}
      rotation={[-Math.PI / 2, 0, 0]}
    >
      <ringGeometry args={[0.85, 1.0, 32]} />
      <meshBasicMaterial
        ref={matRef}
        color="#38bdf8"
        transparent
        opacity={0.7}
        depthWrite={false}
        side={THREE.DoubleSide}
      />
    </mesh>
  );
};

export const DropRipplesVisualizer: React.FC = () => {
  const ripples = useDropFeedbackStore((state) => state.ripples);

  if (ripples.length === 0) return null;

  return (
    <group name="drop-ripples">
      {ripples.map((ripple) => (
        <SingleRippleMesh key={ripple.id} ripple={ripple} />
      ))}
    </group>
  );
};

export default DropRipplesVisualizer;
