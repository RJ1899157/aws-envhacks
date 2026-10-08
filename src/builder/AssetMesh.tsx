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

  // Clean up Three.js resources to prevent memory leaks
  React.useEffect(() => {
    return () => {
      dashedLines.geometry.dispose();
      if (Array.isArray(dashedLines.material)) {
        dashedLines.material.forEach((m) => m.dispose());
      } else {
        dashedLines.material.dispose();
      }
    };
  }, [dashedLines]);

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

  // Pointer hover handlers
  const handlePointerOver = useCallback(
    (e: ThreeEvent<PointerEvent>) => {
      if (isGhost) return;
      e.stopPropagation();
      if (hoverTimeoutRef.current) clearTimeout(hoverTimeoutRef.current);
      setIsHovered(true);
    },
    [isGhost]
  );

  const handlePointerOut = useCallback(() => {
    if (hoverTimeoutRef.current) clearTimeout(hoverTimeoutRef.current);
    hoverTimeoutRef.current = setTimeout(() => {
      setIsHovered(false);
    }, 250);
  }, []);

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

  return (
    <group
      ref={groupRef}
      name={`asset-${object.id}`}
      position={position}
      rotation={rotation}
      onPointerDown={onPointerDown}
      onPointerOver={handlePointerOver}
      onPointerOut={handlePointerOut}
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
