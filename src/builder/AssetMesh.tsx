import React, { Suspense, useMemo } from 'react';
import type { ThreeEvent } from '@react-three/fiber';
import { Html, Outlines, RoundedBox, useGLTF } from '@react-three/drei';
import * as THREE from 'three';
import { getCatalogAsset, type FitMode, type SourceUnit } from '../core/catalog';
import { normalizeModel } from '../core/modelNormalizer';
import type { AirflowRole, SceneObject } from '../core/schema';

interface GLTFModelProps {
  url: string;
  targetSize: [number, number, number];
  role: AirflowRole;
  isGhost?: boolean;
  isValid?: boolean;
  fitMode?: FitMode;
  sourceUnit?: SourceUnit;
}

/**
 * Loads a GLTF/GLB model, normalizes it using pure normalizeModel,
 * and applies simulation role styling.
 */
const GLTFModel: React.FC<GLTFModelProps> = ({
  url,
  targetSize,
  role,
  isGhost = false,
  isValid = true,
  fitMode = 'contain',
  sourceUnit = 'm',
}) => {
  const { scene } = useGLTF(url);

  const normalizedScene = useMemo(() => {
    const norm = normalizeModel(scene, targetSize, { fitMode, sourceUnit });

    // Apply role-based and ghost materials
    norm.traverse((child) => {
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

    return norm;
  }, [scene, targetSize, role, isGhost, isValid, fitMode, sourceUnit]);

  return <primitive object={normalizedScene} />;
};

interface SelectedObjectBoundsProps {
  size: [number, number, number];
  isColliding?: boolean;
}

/**
 * Dashed bounding box with labelled edges (Width, Height, Depth in meters)
 * rendered whenever an object is selected.
 */
export const SelectedObjectBounds: React.FC<SelectedObjectBoundsProps> = ({
  size,
  isColliding = false,
}) => {
  const [width, height, depth] = size;
  const outlineColor = isColliding ? '#ef4444' : '#f59e0b';

  const dashedLines = useMemo(() => {
    const geom = new THREE.BoxGeometry(width * 1.01, height * 1.01, depth * 1.01);
    const edges = new THREE.EdgesGeometry(geom);
    const mat = new THREE.LineDashedMaterial({
      color: outlineColor,
      dashSize: 0.08,
      gapSize: 0.04,
      linewidth: 2,
    });
    const lines = new THREE.LineSegments(edges, mat);
    lines.computeLineDistances();
    return lines;
  }, [width, height, depth, outlineColor]);

  return (
    <group position={[0, height / 2, 0]}>
      {/* Dashed bounding box wireframe */}
      <primitive object={dashedLines} />

      {/* Labelled Dimension Edges */}
      {/* 1. Width (X edge) along front bottom */}
      <Html
        center
        position={[0, -height / 2 + 0.03, depth / 2 + 0.06]}
        className="pointer-events-none select-none"
      >
        <span className="px-1.5 py-0.5 rounded bg-neutral-900/90 text-amber-300 border border-amber-500/60 font-mono text-[10px] shadow whitespace-nowrap">
          W: {width.toFixed(2)}m
        </span>
      </Html>

      {/* 2. Height (Y edge) along front-right vertical corner */}
      <Html
        center
        position={[width / 2 + 0.06, 0, depth / 2 + 0.06]}
        className="pointer-events-none select-none"
      >
        <span className="px-1.5 py-0.5 rounded bg-neutral-900/90 text-sky-300 border border-sky-500/60 font-mono text-[10px] shadow whitespace-nowrap">
          H: {height.toFixed(2)}m
        </span>
      </Html>

      {/* 3. Depth (Z edge) along right bottom */}
      <Html
        center
        position={[width / 2 + 0.06, -height / 2 + 0.03, 0]}
        className="pointer-events-none select-none"
      >
        <span className="px-1.5 py-0.5 rounded bg-neutral-900/90 text-emerald-300 border border-emerald-500/60 font-mono text-[10px] shadow whitespace-nowrap">
          D: {depth.toFixed(2)}m
        </span>
      </Html>
    </group>
  );
};

interface PlaceholderProps {
  size: [number, number, number];
  color: string;
  role: AirflowRole;
  isGhost?: boolean;
  isValid?: boolean;
  isSelected?: boolean;
  isColliding?: boolean;
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
  isColliding = false,
}) => {
  const [width, height, depth] = size;
  const radius = Math.min(Math.min(width, height, depth) * 0.06, 0.04);
  const outlineColor = isColliding ? '#ef4444' : '#f59e0b';

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
      >
        {isSelected && <Outlines thickness={0.03} color={outlineColor} />}
      </RoundedBox>
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

/**
 * Loading state placeholder for GLTF models during asynchronous fetch/parse
 */
const GLTFLoadingPlaceholder: React.FC<{
  size: [number, number, number];
  color: string;
}> = ({ size, color }) => {
  const [width, height, depth] = size;
  return (
    <group position={[0, height / 2, 0]}>
      {/* Semi-transparent bounding box with pulsing emissive glow */}
      <mesh>
        <boxGeometry args={[width, height, depth]} />
        <meshStandardMaterial
          color={color}
          transparent
          opacity={0.35}
          wireframe={false}
          emissive="#38bdf8"
          emissiveIntensity={0.3}
        />
      </mesh>
      {/* Crisp wireframe edges */}
      <lineSegments>
        <edgesGeometry args={[new THREE.BoxGeometry(width, height, depth)]} />
        <lineBasicMaterial color="#38bdf8" linewidth={1.5} />
      </lineSegments>
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
  isColliding?: boolean;
  isGhost?: boolean;
  isValidPlacement?: boolean;
  onPointerDown?: (e: ThreeEvent<PointerEvent>) => void;
}

/**
 * 3D Asset renderer:
 * - Loads GLTF model if catalog.model is present, auto-scaled to exact dimensions
 * - Falls back to a clean rounded box placeholder with bottom-centre pivot
 * - Displays role-based cues (solid, porous, source) and fan direction arrows
 * - Memoized with custom comparator for 60fps performance with 50+ objects
 */
const AssetMeshComponent: React.FC<AssetMeshProps> = ({
  object,
  isSelected = false,
  isColliding = false,
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
    (object.position[1] ?? 0) + elevation,
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
        <Suspense fallback={<GLTFLoadingPlaceholder size={targetSize} color={color} />}>
          <GLTFModel
            url={catalogDef.model}
            targetSize={targetSize}
            role={role}
            isGhost={isGhost}
            isValid={isValidPlacement}
            fitMode={catalogDef.fitMode}
            sourceUnit={catalogDef.sourceUnit}
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
          isColliding={isColliding}
        />
      )}

      {/* Dashed bounding box with labelled dimension edges when selected */}
      {isSelected && !isGhost && (
        <SelectedObjectBounds size={targetSize} isColliding={isColliding} />
      )}

      {/* Fan / Source airflow direction arrow */}
      {hasFanArrow && <FanDirectionArrow assetId={object.assetId} size={targetSize} />}
    </group>
  );
};

export const AssetMesh = React.memo(AssetMeshComponent, (prev, next) => {
  return (
    prev.isSelected === next.isSelected &&
    prev.isColliding === next.isColliding &&
    prev.isGhost === next.isGhost &&
    prev.isValidPlacement === next.isValidPlacement &&
    prev.object.id === next.object.id &&
    prev.object.assetId === next.object.assetId &&
    prev.object.position?.[0] === next.object.position?.[0] &&
    prev.object.position?.[1] === next.object.position?.[1] &&
    prev.object.position?.[2] === next.object.position?.[2] &&
    prev.object.rotation?.[0] === next.object.rotation?.[0] &&
    prev.object.rotation?.[1] === next.object.rotation?.[1] &&
    prev.object.rotation?.[2] === next.object.rotation?.[2] &&
    prev.object.size?.[0] === next.object.size?.[0] &&
    prev.object.size?.[1] === next.object.size?.[1] &&
    prev.object.size?.[2] === next.object.size?.[2] &&
    prev.object.scale?.[0] === next.object.scale?.[0] &&
    prev.object.scale?.[1] === next.object.scale?.[1] &&
    prev.object.scale?.[2] === next.object.scale?.[2] &&
    prev.object.elevation === next.object.elevation &&
    prev.object.role === next.object.role &&
    prev.object.color === next.object.color
  );
});

export default AssetMesh;
