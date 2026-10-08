import React, { useMemo } from 'react';
import { Html } from '@react-three/drei';
import * as THREE from 'three';
import { useSceneStore } from '../store/sceneStore';
import { useUiStore } from '../store/uiStore';

/**
 * Procedural 1.7 m Human Silhouette and 1.0 m³ Reference Cube.
 * Renders beside the selected object (or at a default room reference position)
 * to provide immediate, intuitive scale verification.
 */
export const ScaleReference: React.FC = () => {
  const showScaleReference = useUiStore((state) => state.showScaleReference);
  const selectedObjectId = useSceneStore((state) => state.selectedObjectId);
  const selectedObjectIds = useSceneStore((state) => state.selectedObjectIds);
  const objects = useSceneStore((state) => state.room.objects);

  const activeId = selectedObjectId ?? selectedObjectIds[0];
  const selectedObject = useMemo(() => {
    return objects.find((o) => o.id === activeId) ?? null;
  }, [objects, activeId]);

  // Position reference beside the selected object
  const position = useMemo<[number, number, number]>(() => {
    if (selectedObject) {
      const sx = selectedObject.scale?.[0] ?? 1;
      const width = selectedObject.size[0] * sx;
      // Position 0.75m to the right of the object, at floor level (Y=0)
      return [selectedObject.position[0] + width / 2 + 0.75, 0, selectedObject.position[2]];
    }
    return [0, 0, 0];
  }, [selectedObject]);

  // Human materials
  const humanMaterial = useMemo(() => {
    return new THREE.MeshStandardMaterial({
      color: '#38bdf8',
      roughness: 0.4,
      metalness: 0.1,
      transparent: true,
      opacity: 0.75,
      emissive: '#0284c7',
      emissiveIntensity: 0.35,
    });
  }, []);

  // 1m cube materials
  const cubeMaterial = useMemo(() => {
    return new THREE.MeshStandardMaterial({
      color: '#f59e0b',
      roughness: 0.5,
      metalness: 0.1,
      transparent: true,
      opacity: 0.35,
      emissive: '#d97706',
      emissiveIntensity: 0.25,
    });
  }, []);

  const cubeEdges = useMemo(() => {
    const geom = new THREE.BoxGeometry(1.0, 1.0, 1.0);
    return new THREE.EdgesGeometry(geom);
  }, []);

  if (!showScaleReference) return null;

  return (
    <group name="scale-reference-group" position={position}>
      {/* =========================================================
          1.7 METER HUMAN SILHOUETTE (Standing on floor, Y=0 to Y=1.70m)
          ========================================================= */}
      <group name="human-silhouette" position={[0, 0, 0]}>
        {/* Legs: from y=0 to y=0.85m (height 0.85m, center 0.425m) */}
        <mesh position={[-0.1, 0.425, 0]} material={humanMaterial}>
          <cylinderGeometry args={[0.065, 0.065, 0.85, 16]} />
        </mesh>
        <mesh position={[0.1, 0.425, 0]} material={humanMaterial}>
          <cylinderGeometry args={[0.065, 0.065, 0.85, 16]} />
        </mesh>

        {/* Torso / Upper Body: from y=0.85m to y=1.45m (height 0.60m, center 1.15m) */}
        <mesh position={[0, 1.15, 0]} material={humanMaterial}>
          <boxGeometry args={[0.38, 0.6, 0.2]} />
        </mesh>

        {/* Arms: from y=0.85m to y=1.40m (height 0.55m, center 1.125m) */}
        <mesh position={[-0.24, 1.125, 0]} material={humanMaterial}>
          <cylinderGeometry args={[0.045, 0.045, 0.55, 12]} />
        </mesh>
        <mesh position={[0.24, 1.125, 0]} material={humanMaterial}>
          <cylinderGeometry args={[0.045, 0.045, 0.55, 12]} />
        </mesh>

        {/* Neck: from y=1.45m to y=1.50m (height 0.05m, center 1.475m) */}
        <mesh position={[0, 1.475, 0]} material={humanMaterial}>
          <cylinderGeometry args={[0.05, 0.05, 0.05, 12]} />
        </mesh>

        {/* Head: sphere at y=1.59m with radius 0.11m (top reaches exactly 1.70m) */}
        <mesh position={[0, 1.59, 0]} material={humanMaterial}>
          <sphereGeometry args={[0.11, 24, 24]} />
        </mesh>

        {/* Height guide line & label */}
        <lineSegments position={[0.28, 0.85, 0]}>
          <bufferGeometry
            attach="geometry"
            onUpdate={(self) => {
              const pts = [
                new THREE.Vector3(0, -0.85, 0),
                new THREE.Vector3(0, 0.85, 0),
                new THREE.Vector3(-0.04, 0.85, 0),
                new THREE.Vector3(0.04, 0.85, 0),
                new THREE.Vector3(-0.04, -0.85, 0),
                new THREE.Vector3(0.04, -0.85, 0),
              ];
              self.setFromPoints(pts);
            }}
          />
          <lineBasicMaterial color="#38bdf8" linewidth={2} />
        </lineSegments>

        <Html position={[0, 1.82, 0]} center className="pointer-events-none select-none">
          <div className="px-2 py-0.5 rounded-full bg-neutral-900/90 text-sky-300 border border-sky-500/70 font-mono text-[11px] font-semibold shadow-xl whitespace-nowrap flex items-center gap-1.5">
            <span>🧍</span>
            <span>1.70 m Human</span>
          </div>
        </Html>
      </group>

      {/* =========================================================
          1.0 M³ REFERENCE CUBE (Positioned beside human)
          ========================================================= */}
      <group name="one-meter-cube" position={[0.9, 0.5, 0]}>
        <mesh material={cubeMaterial}>
          <boxGeometry args={[1.0, 1.0, 1.0]} />
        </mesh>
        <lineSegments geometry={cubeEdges}>
          <lineBasicMaterial color="#f59e0b" linewidth={1.5} />
        </lineSegments>

        <Html position={[0, 0.65, 0]} center className="pointer-events-none select-none">
          <div className="px-2 py-0.5 rounded-full bg-neutral-900/90 text-amber-300 border border-amber-500/70 font-mono text-[11px] font-semibold shadow-xl whitespace-nowrap flex items-center gap-1.5">
            <span>📦</span>
            <span>1.0 m³ Cube</span>
          </div>
        </Html>
      </group>
    </group>
  );
};

export default ScaleReference;
