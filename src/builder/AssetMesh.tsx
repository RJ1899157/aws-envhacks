import React, { Suspense, useCallback, useMemo, useRef, useState } from 'react';
import { type ThreeEvent, useFrame } from '@react-three/fiber';
import { Html, Outlines, RoundedBox, useGLTF } from '@react-three/drei';
import * as THREE from 'three';
import { getCatalogAsset, type FitMode, type SourceUnit } from '../core/catalog';
import { normalizeModel } from '../core/modelNormalizer';
import type { AirflowRole, SceneObject } from '../core/schema';
import { registerObjectGroup, unregisterObjectGroup } from './objectRegistry';
import { usePlacementIssuesStore } from '../store/placementIssuesStore';
import { useSceneStore } from '../store/sceneStore';
import { useUiStore } from '../store/uiStore';
import { findNearestValidPosition, type PlacementIssue } from '../core/placementValidator';
import { prefersReducedMotion } from '../core/motion';
import { setCanvasCursor, resetCanvasCursor } from '../core/cursor';
import { useDropFeedbackStore } from '../store/dropFeedbackStore';

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
            (mesh.material as THREE.MeshStandardMaterial).emissive = new THREE.Color('#38bdf8');
            (mesh.material as THREE.MeshStandardMaterial).emissiveIntensity = 1.8;
          }
        }
      }
    });

    return norm;
  }, [scene, targetSize, role, isGhost, isValid, fitMode, sourceUnit]);

  React.useEffect(() => {
    return () => {
      normalizedScene.traverse((child) => {
        if ((child as THREE.Mesh).isMesh) {
          const mesh = child as THREE.Mesh;
          if (mesh.geometry) mesh.geometry.dispose();
          if (mesh.material) {
            if (Array.isArray(mesh.material)) {
              mesh.material.forEach((m) => m.dispose());
            } else {
              mesh.material.dispose();
            }
          }
        }
      });
    };
  }, [normalizedScene]);

  return <primitive object={normalizedScene} />;
};

interface SelectedObjectBoundsProps {
  size: [number, number, number];
  isColliding?: boolean;
}

/**
 * Crisp bounding box with animated marching ends on the corners and labelled edges
 * rendered whenever an object is selected.
 */
export const SelectedObjectBounds: React.FC<SelectedObjectBoundsProps> = ({
  size,
  isColliding = false,
}) => {
  const [width, height, depth] = size;
  const outlineColor = isColliding ? '#ef4444' : '#f59e0b';
  const marchingMatRef = useRef<THREE.LineDashedMaterial | null>(null);

  // 1. Crisp full bounding box outline
  const crispOutline = useMemo(() => {
    const geom = new THREE.BoxGeometry(width * 1.008, height * 1.008, depth * 1.008);
    const edges = new THREE.EdgesGeometry(geom);
    const mat = new THREE.LineBasicMaterial({
      color: outlineColor,
      transparent: true,
      opacity: 0.5,
      linewidth: 1,
    });
    return new THREE.LineSegments(edges, mat);
  }, [width, height, depth, outlineColor]);

  // 2. 8 Corner brackets with animated marching ends
  const cornerLines = useMemo(() => {
    const hw = (width * 1.01) / 2;
    const hh = (height * 1.01) / 2;
    const hd = (depth * 1.01) / 2;
    const clen = Math.min(width, height, depth) * 0.22;

    const points: THREE.Vector3[] = [];
    const signs: Array<[number, number, number]> = [
      [-1, -1, -1],
      [1, -1, -1],
      [-1, 1, -1],
      [1, 1, -1],
      [-1, -1, 1],
      [1, -1, 1],
      [-1, 1, 1],
      [1, 1, 1],
    ];

    for (const [sx, sy, sz] of signs) {
      const cx = sx * hw;
      const cy = sy * hh;
      const cz = sz * hd;
      // segment along X
      points.push(new THREE.Vector3(cx, cy, cz));
      points.push(new THREE.Vector3(cx - sx * clen, cy, cz));
      // segment along Y
      points.push(new THREE.Vector3(cx, cy, cz));
      points.push(new THREE.Vector3(cx, cy - sy * clen, cz));
      // segment along Z
      points.push(new THREE.Vector3(cx, cy, cz));
      points.push(new THREE.Vector3(cx, cy, cz - sz * clen));
    }

    const geom = new THREE.BufferGeometry().setFromPoints(points);
    const mat = new THREE.LineDashedMaterial({
      color: outlineColor,
      dashSize: 0.035,
      gapSize: 0.02,
      linewidth: 2.5,
    });
    marchingMatRef.current = mat;

    const lines = new THREE.LineSegments(geom, mat);
    lines.computeLineDistances();
    return lines;
  }, [width, height, depth, outlineColor]);

  // Per-frame animated marching ends on the corners
  useFrame(() => {
    if (marchingMatRef.current && !prefersReducedMotion()) {
      const t = performance.now() * 0.006;
      marchingMatRef.current.scale = 1.0 + 0.35 * Math.sin(t);
    }
  });

  // Clean up Three.js resources
  React.useEffect(() => {
    return () => {
      crispOutline.geometry.dispose();
      (crispOutline.material as THREE.Material).dispose();
      cornerLines.geometry.dispose();
      (cornerLines.material as THREE.Material).dispose();
    };
  }, [crispOutline, cornerLines]);

  return (
    <group position={[0, height / 2, 0]}>
      {/* Crisp bounding box line */}
      <primitive object={crispOutline} />

      {/* Animated marching ends on corners */}
      <primitive object={cornerLines} />

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
export const RoundedBoxPlaceholder: React.FC<PlaceholderProps & { id?: string }> = ({
  size,
  color,
  role,
  isGhost = false,
  isValid = true,
  isSelected = false,
  isColliding = false,
  id = '',
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
      return new THREE.MeshStandardMaterial({ color, roughness: 0.35, metalness: 0.2, emissive: color, emissiveIntensity: 1.8 });
    }
    if (role === 'porous') {
      return new THREE.MeshStandardMaterial({ color, roughness: 0.65, metalness: 0.05, transparent: true, opacity: 0.72 });
    }
    return new THREE.MeshStandardMaterial({ color, roughness: 0.55, metalness: 0.1 });
  }, [color, role, isGhost, isValid]);

  React.useEffect(() => {
    return () => {
      material.dispose();
    };
  }, [material]);

  const outline = isSelected && <Outlines thickness={0.03} color={outlineColor} />;

  // Procedural geometry logic
  const lid = id.toLowerCase();
  
  const mattressMat = useMemo(() => new THREE.MeshStandardMaterial({ color: '#f8fafc' }), []);
  React.useEffect(() => { return () => { mattressMat.dispose(); }; }, [mattressMat]);

  if (lid.includes('bed')) {
    // Bed: Base + Mattress + Headboard
    return (
      <group position={[0, 0, 0]}>
        <RoundedBox args={[width, height * 0.4, depth]} position={[0, height * 0.2, 0]} radius={radius} material={material}>{outline}</RoundedBox>
        <RoundedBox args={[width * 0.95, height * 0.4, depth * 0.95]} position={[0, height * 0.6, 0]} radius={radius} material={mattressMat}>{outline}</RoundedBox>
        <RoundedBox args={[width, height, depth * 0.1]} position={[0, height * 0.5, -depth / 2 + depth * 0.05]} radius={radius} material={material}>{outline}</RoundedBox>
      </group>
    );
  }
  if (lid.includes('sofa')) {
    // Sofa: Base seat + backrest + armrests
    const armW = Math.min(width * 0.15, 0.2);
    const seatH = height * 0.45;
    return (
      <group position={[0, 0, 0]}>
        {/* Seat */}
        <RoundedBox args={[width - armW * 2, seatH, depth * 0.8]} position={[0, seatH / 2, depth * 0.1]} radius={radius} material={material}>{outline}</RoundedBox>
        {/* Backrest */}
        <RoundedBox args={[width, height, depth * 0.2]} position={[0, height / 2, -depth / 2 + depth * 0.1]} radius={radius} material={material}>{outline}</RoundedBox>
        {/* Arms */}
        <RoundedBox args={[armW, height * 0.7, depth]} position={[-width / 2 + armW / 2, height * 0.35, 0]} radius={radius} material={material}>{outline}</RoundedBox>
        <RoundedBox args={[armW, height * 0.7, depth]} position={[width / 2 - armW / 2, height * 0.35, 0]} radius={radius} material={material}>{outline}</RoundedBox>
      </group>
    );
  }
  if (lid.includes('table') || lid.includes('desk')) {
    // Table: Top + 4 legs
    const legW = Math.min(width, depth) * 0.08;
    const topH = Math.min(height * 0.1, 0.05);
    return (
      <group position={[0, 0, 0]}>
        <RoundedBox args={[width, topH, depth]} position={[0, height - topH / 2, 0]} radius={radius} material={material}>{outline}</RoundedBox>
        <RoundedBox args={[legW, height - topH, legW]} position={[-width / 2 + legW, (height - topH) / 2, -depth / 2 + legW]} radius={radius / 2} material={material}>{outline}</RoundedBox>
        <RoundedBox args={[legW, height - topH, legW]} position={[width / 2 - legW, (height - topH) / 2, -depth / 2 + legW]} radius={radius / 2} material={material}>{outline}</RoundedBox>
        <RoundedBox args={[legW, height - topH, legW]} position={[-width / 2 + legW, (height - topH) / 2, depth / 2 - legW]} radius={radius / 2} material={material}>{outline}</RoundedBox>
        <RoundedBox args={[legW, height - topH, legW]} position={[width / 2 - legW, (height - topH) / 2, depth / 2 - legW]} radius={radius / 2} material={material}>{outline}</RoundedBox>
      </group>
    );
  }
  if (lid.includes('chair')) {
    // Chair: Seat + Back + Legs
    const seatH = height * 0.45;
    const legW = 0.04;
    return (
      <group position={[0, 0, 0]}>
        <RoundedBox args={[width, 0.05, depth * 0.8]} position={[0, seatH, depth * 0.1]} radius={radius} material={material}>{outline}</RoundedBox>
        <RoundedBox args={[width, height - seatH, 0.05]} position={[0, seatH + (height - seatH) / 2, -depth / 2 + 0.1]} radius={radius} material={material}>{outline}</RoundedBox>
        <RoundedBox args={[legW, seatH, legW]} position={[-width / 2 + legW, seatH / 2, -depth / 2 + 0.1]} radius={radius / 2} material={material}>{outline}</RoundedBox>
        <RoundedBox args={[legW, seatH, legW]} position={[width / 2 - legW, seatH / 2, -depth / 2 + 0.1]} radius={radius / 2} material={material}>{outline}</RoundedBox>
        <RoundedBox args={[legW, seatH, legW]} position={[-width / 2 + legW, seatH / 2, depth / 2 - 0.05]} radius={radius / 2} material={material}>{outline}</RoundedBox>
        <RoundedBox args={[legW, seatH, legW]} position={[width / 2 - legW, seatH / 2, depth / 2 - 0.05]} radius={radius / 2} material={material}>{outline}</RoundedBox>
      </group>
    );
  }
  if (lid.includes('wardrobe') || lid.includes('fridge') || lid.includes('cabinet')) {
    return (
      <group position={[0, height / 2, 0]}>
        <RoundedBox args={[width, height, depth]} radius={radius} material={material}>{outline}</RoundedBox>
        {/* Doors split */}
        <mesh position={[0, 0, depth / 2 + 0.005]}>
          <planeGeometry args={[width * 0.95, height * 0.95]} />
          <meshBasicMaterial color="#000" opacity={0.1} transparent />
        </mesh>
      </group>
    );
  }
  if (lid.includes('fan') || lid.includes('purifier')) {
    // Cylinder base + top
    return (
      <group position={[0, 0, 0]}>
        <mesh position={[0, height * 0.05, 0]} receiveShadow castShadow>
          <cylinderGeometry args={[width / 2, width / 2 + 0.05, height * 0.1, 32]} />
          <primitive object={material} attach="material" />
        </mesh>
        <mesh position={[0, height / 2 + height * 0.05, 0]} receiveShadow castShadow>
          <cylinderGeometry args={[width / 2 - 0.02, width / 2 - 0.02, height * 0.9, 32]} />
          <primitive object={material} attach="material" />
          {outline}
        </mesh>
      </group>
    );
  }

  // Fallback box
  return (
    <group position={[0, height / 2, 0]}>
      <RoundedBox args={[width, height, depth]} radius={radius} smoothness={4} material={material} castShadow={!isGhost} receiveShadow={!isGhost}>
        {outline}
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

const EMPTY_ISSUES: PlacementIssue[] = [];

/**
 * 3D Asset renderer:
 * - Loads GLTF model if catalog.model is present, auto-scaled to exact dimensions
 * - Falls back to a clean rounded box placeholder with bottom-centre pivot
 * - Displays role-based cues (solid, porous, source) and fan direction arrows
 * - Phase B calm placement feedback: soft red emissive pulse for 1.5s, persistent thin red outline,
 *   and floating hover tooltip with "Nudge to nearest valid position" and "Keep anyway" actions.
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
  const groupRef = React.useRef<THREE.Group>(null);
  const pulseMatRef = React.useRef<THREE.MeshBasicMaterial>(null);

  // Subscribe to Phase B placement issues for this object
  const objectIssues = usePlacementIssuesStore((state) =>
    object.id && !isGhost ? (state.issues[object.id] ?? EMPTY_ISSUES) : EMPTY_ISSUES
  );
  const isDismissed = usePlacementIssuesStore((state) =>
    object.id && !isGhost ? state.dismissedObjectIds.includes(object.id) : false
  );
  const flaggedTime = usePlacementIssuesStore((state) =>
    object.id && !isGhost ? (state.flaggedTimestamps[object.id] ?? 0) : 0
  );
  const hasIssues = !isGhost && !isDismissed && objectIssues.length > 0;

  // Hover state for interactive tooltip
  const [isHovered, setIsHovered] = useState(false);
  const hoverTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  React.useEffect(() => {
    if (groupRef.current && object.id && !isGhost) {
      registerObjectGroup(object.id, groupRef.current);
      return () => {
        unregisterObjectGroup(object.id);
      };
    }
  }, [object.id, isGhost]);

  // Clean up hover timeout on unmount
  React.useEffect(() => {
    return () => {
      if (hoverTimeoutRef.current) {
        clearTimeout(hoverTimeoutRef.current);
      }
    };
  }, []);

  // Soft red emissive pulse for 1.5s after issue flagged (runs at 60fps in R3F useFrame with zero React re-renders)
  useFrame(() => {
    if (!pulseMatRef.current) return;
    if (!hasIssues || !flaggedTime) {
      pulseMatRef.current.opacity = 0;
      return;
    }

    const elapsed = Date.now() - flaggedTime;
    if (elapsed < 1500) {
      const t = elapsed / 1500;
      // Gentle sine-modulated decay
      const wave = Math.sin(t * Math.PI * 4) * 0.5 + 0.5;
      const op = (1 - t) * (0.12 + 0.22 * wave);
      pulseMatRef.current.opacity = Math.max(0, Math.min(1, op));
    } else {
      pulseMatRef.current.opacity = 0;
    }
  });

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

  // Persistent thin red outline segments for objects with issues
  const redOutlineLines = useMemo(() => {
    if (!hasIssues) return null;
    const geom = new THREE.BoxGeometry(
      targetSize[0] * 1.008,
      targetSize[1] * 1.008,
      targetSize[2] * 1.008
    );
    const edges = new THREE.EdgesGeometry(geom);
    const mat = new THREE.LineBasicMaterial({
      color: '#ef4444',
      linewidth: 1.5,
      transparent: true,
      opacity: 0.9,
    });
    return new THREE.LineSegments(edges, mat);
  }, [hasIssues, targetSize]);

  // Clean up Three.js red outline resources
  React.useEffect(() => {
    return () => {
      if (redOutlineLines) {
        redOutlineLines.geometry.dispose();
        if (Array.isArray(redOutlineLines.material)) {
          redOutlineLines.material.forEach((m) => m.dispose());
        } else {
          redOutlineLines.material.dispose();
        }
      }
    };
  }, [redOutlineLines]);

  // Placement drop scale pulse (1.0 -> 1.03 -> 1.0 over ~180 ms)
  const pulsingTimestamp = useDropFeedbackStore((state) =>
    object.id ? state.pulsingObjectIds[object.id] : undefined
  );

  useFrame(() => {
    if (!groupRef.current) return;
    if (pulsingTimestamp && !prefersReducedMotion()) {
      const elapsed = performance.now() - pulsingTimestamp;
      if (elapsed < 180) {
        const p = elapsed / 180;
        const pulse = 1.0 + 0.03 * Math.sin(p * Math.PI);
        groupRef.current.scale.set(pulse, pulse, pulse);
      } else {
        groupRef.current.scale.set(1, 1, 1);
      }
    }
  });

  // Pointer hover handlers
  const handlePointerOver = useCallback(
    (e: ThreeEvent<PointerEvent>) => {
      if (isGhost || object.isLocked) return;
      e.stopPropagation();
      if (hoverTimeoutRef.current) clearTimeout(hoverTimeoutRef.current);
      setCanvasCursor('grab');
      setIsHovered(true);
    },
    [isGhost, object.isLocked]
  );

  const handlePointerOut = useCallback(() => {
    if (hoverTimeoutRef.current) clearTimeout(hoverTimeoutRef.current);
    resetCanvasCursor();
    hoverTimeoutRef.current = setTimeout(() => {
      setIsHovered(false);
    }, 250);
  }, []);

  const handlePointerDownInternal = useCallback(
    (e: ThreeEvent<PointerEvent>) => {
      if (object.isLocked) return;
      setCanvasCursor('grabbing');
      onPointerDown?.(e);
    },
    [onPointerDown, object.isLocked]
  );

  const handleDoubleClick = useCallback(
    (e: ThreeEvent<MouseEvent>) => {
      e.stopPropagation();
      window.dispatchEvent(
        new CustomEvent('fly-focus-object', { detail: { objectId: object.id } })
      );
    },
    [object.id]
  );

  const handleTooltipPointerEnter = useCallback(() => {
    if (hoverTimeoutRef.current) clearTimeout(hoverTimeoutRef.current);
    setIsHovered(true);
  }, []);

  const handleTooltipPointerLeave = useCallback(() => {
    setIsHovered(false);
  }, []);

  // Action: Nudge to nearest valid position using spiral search
  const handleNudge = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      const room = useSceneStore.getState().room;
      const gridStep = useUiStore.getState().gridStep;
      const targetPos = findNearestValidPosition(object as SceneObject, room, gridStep);

      if (!targetPos) {
        return;
      }

      if (groupRef.current) {
        const startX = groupRef.current.position.x;
        const startY = groupRef.current.position.y;
        const startZ = groupRef.current.position.z;
        const endX = targetPos[0];
        const endY = (targetPos[1] ?? 0) + (object.elevation ?? 0);
        const endZ = targetPos[2];
        const startTime = performance.now();
        const duration = 160;

        const animate = (currentTime: number) => {
          const elapsed = currentTime - startTime;
          const progress = Math.min(1, elapsed / duration);
          // Ease-out cubic
          const ease = 1 - Math.pow(1 - progress, 3);
          if (groupRef.current) {
            groupRef.current.position.set(
              startX + (endX - startX) * ease,
              startY + (endY - startY) * ease,
              startZ + (endZ - startZ) * ease
            );
          }

          if (progress < 1) {
            requestAnimationFrame(animate);
          } else {
            useSceneStore.getState().updateObject(object.id, {
              position: [targetPos[0], 0, targetPos[2]],
              elevation: targetPos[1],
            });
            usePlacementIssuesStore.getState().clearDismissed(object.id);
            setIsHovered(false);
          }
        };

        requestAnimationFrame(animate);
      } else {
        useSceneStore.getState().updateObject(object.id, {
          position: [targetPos[0], 0, targetPos[2]],
          elevation: targetPos[1],
        });
        usePlacementIssuesStore.getState().clearDismissed(object.id);
        setIsHovered(false);
      }
    },
    [object]
  );

  // Action: Keep anyway (dismisses the warning for this object)
  const handleKeepAnyway = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      usePlacementIssuesStore.getState().dismissObject(object.id);
      setIsHovered(false);
    },
    [object.id]
  );

  const effectiveColliding = isColliding || hasIssues;

  if (object.isHidden) {
    return null;
  }

  return (
    <group
      ref={groupRef}
      name={`asset-${object.id}`}
      position={position}
      rotation={rotation}
      userData={{ isExportable: !isGhost, exportType: 'furniture' }}
      onPointerDown={handlePointerDownInternal}
      onDoubleClick={handleDoubleClick}
      onPointerOver={handlePointerOver}
      onPointerOut={handlePointerOut}
    >
      {/* Hover feedback: soft outline + slight emissive lift */}
      {isHovered && !isSelected && !isGhost && (
        <group position={[0, targetSize[1] / 2, 0]}>
          <lineSegments>
            <edgesGeometry
              args={[
                new THREE.BoxGeometry(
                  targetSize[0] * 1.012,
                  targetSize[1] * 1.012,
                  targetSize[2] * 1.012
                ),
              ]}
            />
            <lineBasicMaterial color="#38bdf8" transparent opacity={0.4} linewidth={1.5} />
          </lineSegments>
          <mesh>
            <boxGeometry
              args={[
                targetSize[0] * 1.01,
                targetSize[1] * 1.01,
                targetSize[2] * 1.01,
              ]}
            />
            <meshBasicMaterial
              color="#38bdf8"
              transparent
              opacity={0.08}
              depthWrite={false}
            />
          </mesh>
        </group>
      )}
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
          id={catalogDef?.id}
          size={targetSize}
          color={color}
          role={role}
          isGhost={isGhost}
          isValid={isValidPlacement}
          isSelected={isSelected}
          isColliding={effectiveColliding}
        />
      )}

      {/* Phase B: Soft red emissive pulse mesh (active for 1.5s upon flagging) */}
      {hasIssues && (
        <mesh position={[0, targetSize[1] / 2, 0]}>
          <boxGeometry
            args={[targetSize[0] * 1.025, targetSize[1] * 1.025, targetSize[2] * 1.025]}
          />
          <meshBasicMaterial
            ref={pulseMatRef}
            color="#ef4444"
            transparent
            opacity={0}
            depthWrite={false}
          />
        </mesh>
      )}

      {/* Phase B: Persistent thin red outline for objects with issues */}
      {redOutlineLines && (
        <group position={[0, targetSize[1] / 2, 0]}>
          <primitive object={redOutlineLines} />
        </group>
      )}

      {/* Phase B: Floating interactive hover tooltip with issue text, Nudge, and Keep anyway */}
      {hasIssues && isHovered && (
        <Html
          center
          position={[0, targetSize[1] + 0.35, 0]}
          className="pointer-events-auto select-none"
        >
          <div
            onMouseEnter={handleTooltipPointerEnter}
            onMouseLeave={handleTooltipPointerLeave}
            onPointerDown={(e) => e.stopPropagation()}
            className="bg-neutral-900/95 border border-red-500/80 rounded-xl shadow-2xl p-2.5 backdrop-blur-md text-xs text-white min-w-56 max-w-72 flex flex-col gap-2 z-50 animate-in fade-in zoom-in-95 duration-100"
          >
            <div className="flex flex-col gap-1 border-b border-neutral-800 pb-1.5">
              {objectIssues.map((iss) => (
                <div
                  key={iss.id}
                  className="flex items-start gap-1.5 text-xs text-red-300 font-medium leading-snug"
                >
                  <span className="text-red-400 shrink-0 text-sm">⚠️</span>
                  <span>{iss.message}</span>
                </div>
              ))}
            </div>
            <div className="flex items-center gap-1.5 pt-0.5">
              <button
                type="button"
                onClick={handleNudge}
                className="flex-1 px-2 py-1 text-[11px] font-semibold bg-sky-600 hover:bg-sky-500 active:bg-sky-700 text-white rounded-md shadow transition-colors flex items-center justify-center gap-1 cursor-pointer"
                title="Find closest non-overlapping snapped position"
              >
                <span>🧭</span>
                <span>Nudge to nearest valid position</span>
              </button>
              <button
                type="button"
                onClick={handleKeepAnyway}
                className="px-2 py-1 text-[11px] font-medium bg-neutral-800 hover:bg-neutral-700 active:bg-neutral-900 text-neutral-300 hover:text-white rounded-md border border-neutral-700 transition-colors cursor-pointer shrink-0"
                title="Dismiss this warning"
              >
                Keep anyway
              </button>
            </div>
          </div>
        </Html>
      )}

      {/* Dashed bounding box with labelled dimension edges when selected */}
      {isSelected && !isGhost && (
        <SelectedObjectBounds size={targetSize} isColliding={effectiveColliding} />
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
