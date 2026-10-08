import React, { Suspense, useMemo } from 'react';
import type { ThreeEvent } from '@react-three/fiber';
import { RoundedBox, useGLTF } from '@react-three/drei';
import * as THREE from 'three';
import { getCatalogAsset } from '../core/catalog';
import type { AirflowRole, SceneObject } from '../core/schema';

interface GLTFModelProps {
  url: string;
  targetSize: [number, number, number];
  role: AirflowRole;
  isGhost?: boolean;
  isValid?: boolean;
}

/**
 * Loads a GLTF/GLB model, auto-scales to target bounding box,
 * and recentres pivot to bottom centre.
 */
const GLTFModel: React.FC<GLTFModelProps> = ({
  url,
  targetSize,
  role,
  isGhost = false,
  isValid = true,
}) => {
  const { scene } = useGLTF(url);

  const clonedScene = useMemo(() => {
    const clone = scene.clone(true);
    const box = new THREE.Box3().setFromObject(clone);
    const modelSize = new THREE.Vector3();
    box.getSize(modelSize);
    const modelCenter = new THREE.Vector3();
    box.getCenter(modelCenter);

    // Compute scale multipliers to match targetSize exactly
    const scaleX = targetSize[0] / (modelSize.x || 1);
    const scaleY = targetSize[1] / (modelSize.y || 1);
    const scaleZ = targetSize[2] / (modelSize.z || 1);

    clone.scale.set(scaleX, scaleY, scaleZ);

    // Recenter pivot to bottom centre
    clone.position.set(-modelCenter.x * scaleX, -box.min.y * scaleY, -modelCenter.z * scaleZ);

    // Apply role-based and ghost materials
    clone.traverse((child) => {
      if ((child as THREE.Mesh).isMesh) {
        const mesh = child as THREE.Mesh;
        mesh.castShadow = !isGhost;
        mesh.receiveShadow = !isGhost;

        if (isGhost) {
          mesh.material = new THREE.MeshStandardMaterial({
            color: isValid ? '#38bdf8' : '#ef4444',
            transparent: true,
            opacity: 0.55,
            emissive: isValid ? '#0284c7' : '#991b1b',
            emissiveIntensity: 0.5,
          });
        } else if (role === 'porous') {
          if (Array.isArray(mesh.material)) {
            mesh.material.forEach((m) => {
              m.transparent = true;
              m.opacity = 0.72;
            });
          } else if (mesh.material) {
            mesh.material.transparent = true;
            mesh.material.opacity = 0.72;
          }
        } else if (role === 'source') {
          if (mesh.material && !Array.isArray(mesh.material)) {
            (mesh.material as THREE.MeshStandardMaterial).emissive = new THREE.Color('#0284c7');
            (mesh.material as THREE.MeshStandardMaterial).emissiveIntensity = 0.4;
          }
        }
      }
    });

    return clone;
  }, [scene, targetSize, role, isGhost, isValid]);

  return <primitive object={clonedScene} />;
};

interface PlaceholderProps {
  size: [number, number, number];
  color: string;
  role: AirflowRole;
  isGhost?: boolean;
  isValid?: boolean;
  isSelected?: boolean;
}

/**
 * Fallback procedural rounded box placeholder matching exact catalog dimensions
 * with bottom-centre pivot.
 */
export const RoundedBoxPlaceholder: React.FC<PlaceholderProps> = ({
  size,
  color,
  role,
  isGhost = false,
  isValid = true,
  isSelected = false,
}) => {
  const [width, height, depth] = size;
  const radius = Math.min(Math.min(width, height, depth) * 0.06, 0.04);

  const material = useMemo(() => {
    if (isGhost) {
      return new THREE.MeshStandardMaterial({
        color: isValid ? '#38bdf8' : '#ef4444',
        transparent: true,
        opacity: 0.55,
        emissive: isValid ? '#0284c7' : '#991b1b',
        emissiveIntensity: 0.5,
      });
    }

    if (role === 'source') {
      return new THREE.MeshStandardMaterial({
        color,
        roughness: 0.35,
        metalness: 0.2,
        emissive: color,
        emissiveIntensity: 0.45,
      });
    }

    if (role === 'porous') {
      return new THREE.MeshStandardMaterial({
        color,
        roughness: 0.65,
        metalness: 0.05,
        transparent: true,
        opacity: 0.72,
      });
    }

    // solid
    return new THREE.MeshStandardMaterial({
      color,
      roughness: 0.55,
      metalness: 0.1,
    });
  }, [color, role, isGhost, isValid]);

  return (
    <group position={[0, height / 2, 0]}>
      <RoundedBox
        args={[width, height, depth]}
        radius={radius}
        smoothness={4}
        material={material}
        castShadow={!isGhost}
        receiveShadow={!isGhost}
      />
      {isSelected && (
        <lineSegments>
          <edgesGeometry
            args={[new THREE.BoxGeometry(width * 1.02, height * 1.02, depth * 1.02)]}
          />
          <lineBasicMaterial color="#f59e0b" linewidth={2} />
        </lineSegments>
      )}
    </group>
  );
};

interface FanDirectionArrowProps {
  assetId: string;
  size: [number, number, number];
}

/**
 * Airflow direction indicator arrow for fans and ventilation sources
 */
export const FanDirectionArrow: React.FC<FanDirectionArrowProps> = ({ assetId, size }) => {
  const isCeilingFan = assetId.includes('ceiling');
  const [, h, d] = size;

  if (isCeilingFan) {
    // Ceiling fan circulates downwards towards the floor
    return (
      <group position={[0, -0.05, 0]} rotation={[Math.PI, 0, 0]}>
        {/* Shaft */}
        <mesh position={[0, 0.15, 0]}>
          <cylinderGeometry args={[0.015, 0.015, 0.25, 12]} />
          <meshStandardMaterial color="#38bdf8" emissive="#0284c7" emissiveIntensity={0.8} />
        </mesh>
        {/* Arrow head cone */}
        <mesh position={[0, 0.32, 0]}>
          <coneGeometry args={[0.05, 0.1, 12]} />
          <meshStandardMaterial color="#38bdf8" emissive="#0284c7" emissiveIntensity={0.8} />
        </mesh>
      </group>
    );
  }

  // Horizontal fans (pedestal fan, air purifier): point forward along -Z
  return (
    <group position={[0, h * 0.7, -d / 2 - 0.15]} rotation={[-Math.PI / 2, 0, 0]}>
      {/* Shaft */}
      <mesh position={[0, 0.12, 0]}>
        <cylinderGeometry args={[0.015, 0.015, 0.2, 12]} />
        <meshStandardMaterial color="#38bdf8" emissive="#0284c7" emissiveIntensity={0.8} />
      </mesh>
      {/* Arrow head cone */}
      <mesh position={[0, 0.26, 0]}>
        <coneGeometry args={[0.05, 0.1, 12]} />
        <meshStandardMaterial color="#38bdf8" emissive="#0284c7" emissiveIntensity={0.8} />
      </mesh>
    </group>
  );
};

export interface AssetMeshProps {
  object: Partial<SceneObject> & {
    id: string;
    assetId: string;
    position: [number, number, number];
    size: [number, number, number];
  };
  isSelected?: boolean;
  isGhost?: boolean;
  isValidPlacement?: boolean;
  onPointerDown?: (e: ThreeEvent<PointerEvent>) => void;
}

/**
 * 3D Asset renderer:
 * - Loads GLTF model if catalog.model is present, auto-scaled to exact dimensions
 * - Falls back to a clean rounded box placeholder with bottom-centre pivot
 * - Displays role-based cues (solid, porous, source) and fan direction arrows
 */
export const AssetMesh: React.FC<AssetMeshProps> = ({
  object,
  isSelected = false,
  isGhost = false,
  isValidPlacement = true,
  onPointerDown,
}) => {
  const catalogDef = getCatalogAsset(object.assetId);

  const role = object.role ?? catalogDef?.role ?? 'solid';
  const color = object.color ?? catalogDef?.color ?? '#4f46e5';

  const targetSize = useMemo<[number, number, number]>(() => {
    const sx = object.scale?.[0] ?? 1;
    const sy = object.scale?.[1] ?? 1;
    const sz = object.scale?.[2] ?? 1;
    return [object.size[0] * sx, object.size[1] * sy, object.size[2] * sz];
  }, [object.size, object.scale]);

  const elevation = object.elevation ?? catalogDef?.elevation ?? 0;
  const position: [number, number, number] = [
    object.position[0],
    object.position[1] + elevation,
    object.position[2],
  ];

  const rotation: [number, number, number] = [
    object.rotation?.[0] ?? 0,
    object.rotation?.[1] ?? 0,
    object.rotation?.[2] ?? 0,
  ];

  const hasFanArrow =
    object.assetId.includes('fan') || role === 'source' || Boolean(catalogDef?.defaultAirflow);

  return (
    <group
      name={`asset-${object.id}`}
      position={position}
      rotation={rotation}
      onPointerDown={onPointerDown}
    >
      {catalogDef?.model ? (
        <Suspense
          fallback={
            <RoundedBoxPlaceholder
              size={targetSize}
              color={color}
              role={role}
              isGhost={isGhost}
              isValid={isValidPlacement}
              isSelected={isSelected}
            />
          }
        >
          <GLTFModel
            url={catalogDef.model}
            targetSize={targetSize}
            role={role}
            isGhost={isGhost}
            isValid={isValidPlacement}
          />
        </Suspense>
      ) : (
        <RoundedBoxPlaceholder
          size={targetSize}
          color={color}
          role={role}
          isGhost={isGhost}
          isValid={isValidPlacement}
          isSelected={isSelected}
        />
      )}

      {/* Fan / Source airflow direction arrow */}
      {hasFanArrow && <FanDirectionArrow assetId={object.assetId} size={targetSize} />}
    </group>
  );
};

export default AssetMesh;
