import React, { useEffect, useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { wallSegment } from '../core/parser';
import type { Opening, Vec2 } from '../core/schema';
import { computeMiterCorner } from '../core/wallOperations';
import { useSceneStore } from '../store/sceneStore';
import { useUiStore, type ViewMode } from '../store/uiStore';
import { useGraphicsStore, type WallOpacityMode } from '../store/graphicsStore';
import { getFloorMaterialProps, getWallMaterialProps } from '../core/materials';
import { OpeningVisual } from './OpeningVisual';

export interface WallPiece {
  uStart: number;
  uEnd: number;
  vStart: number;
  vEnd: number;
  width: number;
  height: number;
  type: 'full' | 'sill' | 'lintel' | 'between';
}

/**
 * Splits a wall into rectangular sub-boxes around openings without using CSG booleans.
 *
 * For each opening on the wall [u1, u2] x [v1, v2]:
 * 1. Full-height solid walls before the first opening and between subsequent openings.
 * 2. Sill piece below the opening (if sill > 0).
 * 3. Lintel piece above the opening (if opening doesn't touch the ceiling).
 * 4. Full-height solid wall after the last opening.
 */
function round6(val: number): number {
  return Number(val.toFixed(6));
}

export function computeWallPieces(
  wallLength: number,
  wallHeight: number,
  openings: readonly { offset: number; width: number; height: number; sill: number }[]
): WallPiece[] {
  if (wallLength <= 0 || wallHeight <= 0) return [];

  // Filter and clamp valid openings within the wall segment
  const validOpenings = openings
    .map((op) => {
      const uStart = round6(Math.max(0, Math.min(wallLength, op.offset)));
      const uEnd = round6(Math.max(0, Math.min(wallLength, op.offset + op.width)));
      const vStart = round6(Math.max(0, Math.min(wallHeight, op.sill)));
      const vEnd = round6(Math.max(0, Math.min(wallHeight, op.sill + op.height)));
      return {
        uStart,
        uEnd,
        vStart,
        vEnd,
        width: round6(uEnd - uStart),
        height: round6(vEnd - vStart),
      };
    })
    .filter((op) => op.width > 1e-4 && op.height > 1e-4)
    .sort((a, b) => a.uStart - b.uStart);

  if (validOpenings.length === 0) {
    return [
      {
        uStart: 0,
        uEnd: wallLength,
        vStart: 0,
        vEnd: wallHeight,
        width: wallLength,
        height: wallHeight,
        type: 'full',
      },
    ];
  }

  const pieces: WallPiece[] = [];
  let uCurr = 0;

  for (let i = 0; i < validOpenings.length; i++) {
    const op = validOpenings[i]!;

    // 1. Solid full-height section before or between openings
    if (op.uStart - uCurr > 1e-4) {
      pieces.push({
        uStart: round6(uCurr),
        uEnd: round6(op.uStart),
        vStart: 0,
        vEnd: wallHeight,
        width: round6(op.uStart - uCurr),
        height: wallHeight,
        type: i === 0 ? 'full' : 'between',
      });
    }

    // 2. Sill piece below the opening (if sill > 0)
    if (op.vStart > 1e-4) {
      pieces.push({
        uStart: round6(op.uStart),
        uEnd: round6(op.uEnd),
        vStart: 0,
        vEnd: round6(op.vStart),
        width: round6(op.width),
        height: round6(op.vStart),
        type: 'sill',
      });
    }

    // 3. Lintel piece above the opening (if opening doesn't reach the ceiling)
    if (wallHeight - op.vEnd > 1e-4) {
      pieces.push({
        uStart: round6(op.uStart),
        uEnd: round6(op.uEnd),
        vStart: round6(op.vEnd),
        vEnd: wallHeight,
        width: round6(op.width),
        height: round6(wallHeight - op.vEnd),
        type: 'lintel',
      });
    }

    uCurr = Math.max(uCurr, op.uEnd);
  }

  // 4. Solid full-height section after the last opening
  if (wallLength - uCurr > 1e-4) {
    pieces.push({
      uStart: round6(uCurr),
      uEnd: wallLength,
      vStart: 0,
      vEnd: wallHeight,
      width: round6(wallLength - uCurr),
      height: wallHeight,
      type: 'full',
    });
  }

  return pieces;
}

interface WallSegmentMeshProps {
  wallIndex: number;
  outline: readonly Vec2[];
  wallHeight: number;
  wallThickness: number;
  isSelected?: boolean;
  isHovered?: boolean;
  wallOpenings: readonly Opening[];
  view: ViewMode;
  wallOpacityMode: WallOpacityMode;
  wallMaterialProps: ReturnType<typeof getWallMaterialProps>;
  onSelectWall?: (index: number) => void;
  onHoverWall?: (index: number | null) => void;
}

/**
 * Mitered Corner Join: Seamless corner prism joining wall i-1 and wall i with zero gaps and no overlaps.
 */
interface MiteredCornerMeshProps {
  cornerIndex: number;
  outline: readonly Vec2[];
  height: number;
  tIn: number;
  tOut: number;
  view: ViewMode;
  wallOpacityMode: WallOpacityMode;
  wallMaterialProps: ReturnType<typeof getWallMaterialProps>;
}

const MiteredCornerMesh: React.FC<MiteredCornerMeshProps> = ({
  cornerIndex,
  outline,
  height,
  tIn,
  tOut,
  view,
  wallOpacityMode,
  wallMaterialProps,
}) => {
  const n = outline.length;
  const prevIndex = (cornerIndex - 1 + n) % n;

  const { prismGeometry, cornerPos, normalOut } = useMemo(() => {
    try {
      const segIn = wallSegment({ outline }, prevIndex);
      const segOut = wallSegment({ outline }, cornerIndex);
      const P = outline[cornerIndex]!;

      const miter = computeMiterCorner(
        segIn.dir,
        segIn.normal,
        tIn,
        segOut.dir,
        segOut.normal,
        tOut
      );

      const p1X = P[0] + tIn * segIn.normal[0];
      const p1Z = P[1] + tIn * segIn.normal[1];

      const p2X = P[0] + miter[0];
      const p2Z = P[1] + miter[1];

      const p3X = P[0] + tOut * segOut.normal[0];
      const p3Z = P[1] + tOut * segOut.normal[1];

      const shape = new THREE.Shape();
      shape.moveTo(P[0], -P[1]);
      shape.lineTo(p1X, -p1Z);
      shape.lineTo(p2X, -p2Z);
      shape.lineTo(p3X, -p3Z);
      shape.closePath();

      const geom = new THREE.ExtrudeGeometry(shape, {
        depth: height,
        bevelEnabled: false,
      });

      // Average normal for fade
      const avgNormX = (segIn.normal[0] + segOut.normal[0]) / 2;
      const avgNormZ = (segIn.normal[1] + segOut.normal[1]) / 2;

      return {
        prismGeometry: geom,
        cornerPos: new THREE.Vector3(P[0], height / 2, P[1]),
        normalOut: [avgNormX, avgNormZ] as [number, number],
      };
    } catch {
      return { prismGeometry: null, cornerPos: null, normalOut: null };
    }
  }, [outline, cornerIndex, prevIndex, height, tIn, tOut]);

  const cornerMaterial = useMemo(() => {
    return new THREE.MeshStandardMaterial({
      ...wallMaterialProps,
      transparent: true,
      opacity: 0.85,
    });
  }, [wallMaterialProps]);

  useEffect(() => {
    return () => {
      prismGeometry?.dispose();
      cornerMaterial.dispose();
    };
  }, [prismGeometry, cornerMaterial]);

  useFrame(({ camera }, delta) => {
    if (!cornerPos || !normalOut) return;

    if (view === '2d') {
      cornerMaterial.opacity = THREE.MathUtils.lerp(cornerMaterial.opacity, 0.85, delta * 10);
      cornerMaterial.depthWrite = true;
    } else {
      const toCamX = camera.position.x - cornerPos.x;
      const toCamZ = camera.position.z - cornerPos.z;
      const dist = Math.hypot(toCamX, toCamZ);

      if (dist > 1e-4) {
        const vCamX = toCamX / dist;
        const vCamZ = toCamZ / dist;
        const cosTheta = vCamX * normalOut[0] + vCamZ * normalOut[1];
        const fadeFactor = Math.max(0, Math.min(1, (cosTheta - 0.05) / 0.55));
        
        const baseOpacity = 0.85;
        let minOpacity = 0.15;
        if (wallOpacityMode === 'Solid') minOpacity = 0.85;
        if (wallOpacityMode === 'Cutaway') minOpacity = 0.0;

        const targetOpacity = THREE.MathUtils.lerp(baseOpacity, minOpacity, fadeFactor);

        cornerMaterial.opacity = THREE.MathUtils.lerp(
          cornerMaterial.opacity,
          targetOpacity,
          delta * 8
        );
        cornerMaterial.depthWrite = cornerMaterial.opacity > 0.45;
      }
    }
  });

  if (!prismGeometry) return null;

  return (
    <mesh
      geometry={prismGeometry}
      material={cornerMaterial}
      rotation={[-Math.PI / 2, 0, 0]}
      position={[0, 0, 0]}
      userData={{ isExportable: true, exportType: 'wall' }}
      castShadow
      receiveShadow
    />
  );
};

/**
 * Renders an extruded wall segment with CSG-free cutouts for openings.
 * Automatically fades opacity when camera faces the exterior of the wall.
 * Memoized so changes to other objects/walls do NOT cause re-renders.
 */
const WallSegmentMesh = React.memo<WallSegmentMeshProps>(
  ({
    wallIndex,
    outline,
    wallHeight,
    wallThickness,
    isSelected = false,
    isHovered = false,
    wallOpenings,
    view,
    wallOpacityMode,
    wallMaterialProps,
    onSelectWall,
    onHoverWall,
  }) => {
    const wallMaterial = useMemo(() => {
      const baseColor = isSelected ? '#f59e0b' : isHovered ? '#38bdf8' : wallMaterialProps.color;
      return new THREE.MeshStandardMaterial({
        ...wallMaterialProps,
        color: baseColor,
        transparent: true,
        opacity: isSelected || isHovered ? 0.95 : 0.85,
        emissive: isSelected ? '#b45309' : isHovered ? '#0284c7' : '#000000',
        emissiveIntensity: isSelected || isHovered ? 0.35 : 0,
      });
    }, [wallMaterialProps, isSelected, isHovered]);

    useEffect(() => {
      return () => {
        wallMaterial.dispose();
      };
    }, [wallMaterial]);

    const segment = useMemo(() => {
      try {
        return wallSegment({ outline }, wallIndex);
      } catch {
        return null;
      }
    }, [outline, wallIndex]);

    // Compute sub-boxes for wall around openings
    const wallBoxes = useMemo(() => {
      if (!segment) return [];

      const pieces = computeWallPieces(segment.len, wallHeight, wallOpenings);
      const thickness = wallThickness;

      // Basis quaternion for the wall orientation
      const xAxis = new THREE.Vector3(segment.dir[0], 0, segment.dir[1]).normalize();
      const yAxis = new THREE.Vector3(0, 1, 0);
      const zAxis = new THREE.Vector3(segment.normal[0], 0, segment.normal[1]).normalize();
      const rotMatrix = new THREE.Matrix4().makeBasis(xAxis, yAxis, zAxis);
      const quaternion = new THREE.Quaternion().setFromRotationMatrix(rotMatrix);

      return pieces.map((piece) => {
        const uMid = (piece.uStart + piece.uEnd) / 2;
        const vMid = (piece.vStart + piece.vEnd) / 2;
        const tMid = thickness / 2;

        const posX = segment.a[0] + uMid * segment.dir[0] + tMid * segment.normal[0];
        const posY = vMid;
        const posZ = segment.a[1] + uMid * segment.dir[1] + tMid * segment.normal[1];

        return {
          id: `${wallIndex}-${piece.type}-${piece.uStart.toFixed(2)}`,
          position: [posX, posY, posZ] as [number, number, number],
          dimensions: [piece.width, piece.height, thickness] as [number, number, number],
          quaternion,
        };
      });
    }, [segment, wallHeight, wallThickness, wallOpenings, wallIndex]);

    // Wall center point on floor for camera orientation tests
    const wallCenter = useMemo(() => {
      if (!segment) return new THREE.Vector3();
      const thickness = wallThickness;
      const uMid = segment.len / 2;
      const tMid = thickness / 2;
      return new THREE.Vector3(
        segment.a[0] + uMid * segment.dir[0] + tMid * segment.normal[0],
        wallHeight / 2,
        segment.a[1] + uMid * segment.dir[1] + tMid * segment.normal[1]
      );
    }, [segment, wallHeight, wallThickness]);

    // Dynamic Camera-Facing Fade
    useFrame(({ camera }, delta) => {
      if (!segment) return;

      if (view === '2d') {
        // In 2D top-down mode, keep walls crisp and solid
        wallMaterial.opacity = THREE.MathUtils.lerp(wallMaterial.opacity, 0.85, delta * 10);
        wallMaterial.depthWrite = true;
      } else {
        // Vector from wall center to camera
        const toCamX = camera.position.x - wallCenter.x;
        const toCamZ = camera.position.z - wallCenter.z;
        const dist = Math.hypot(toCamX, toCamZ);

        if (dist > 1e-4) {
          const vCamX = toCamX / dist;
          const vCamZ = toCamZ / dist;

          // Dot product with outward normal
          const cosTheta = vCamX * segment.normal[0] + vCamZ * segment.normal[1];

          // Fade wall when camera looks from outside towards interior (cosTheta > 0.05)
          const fadeFactor = Math.max(0, Math.min(1, (cosTheta - 0.05) / 0.55));
          
          let minOpacity = 0.15;
          if (wallOpacityMode === 'Solid') minOpacity = 0.85;
          if (wallOpacityMode === 'Cutaway') minOpacity = 0.0;

          const targetOpacity = THREE.MathUtils.lerp(
            isSelected || isHovered ? 0.95 : 0.85,
            minOpacity,
            fadeFactor
          );

          wallMaterial.opacity = THREE.MathUtils.lerp(
            wallMaterial.opacity,
            targetOpacity,
            delta * 8
          );
          wallMaterial.depthWrite = wallMaterial.opacity > 0.45;
        }
      }
    });

    if (!segment || wallBoxes.length === 0) return null;

    return (
      <group
        name={`wall-segment-${wallIndex}`}
        userData={{ isExportable: true, exportType: 'wall' }}
        onPointerDown={(e) => {
          if (e.button === 0) {
            e.stopPropagation();
            onSelectWall?.(wallIndex);
          }
        }}
        onPointerOver={(e) => {
          e.stopPropagation();
          onHoverWall?.(wallIndex);
        }}
        onPointerOut={() => {
          onHoverWall?.(null);
        }}
      >
        {wallBoxes.map((box) => (
          <mesh
            key={box.id}
            position={box.position}
            quaternion={box.quaternion}
            material={wallMaterial}
            castShadow
            receiveShadow
          >
            <boxGeometry args={box.dimensions} />
          </mesh>
        ))}

        {/* Render Opening Visuals in the cutouts */}
        {wallOpenings.map((opening) => (
          <OpeningVisual
            key={opening.id}
            opening={opening}
            segment={segment}
            wallThickness={wallThickness}
          />
        ))}
      </group>
    );
  },
  (prev, next) => {
    if (
      prev.wallIndex !== next.wallIndex ||
      prev.wallHeight !== next.wallHeight ||
      prev.wallThickness !== next.wallThickness ||
      prev.wallOpacityMode !== next.wallOpacityMode ||
      prev.wallMaterialProps.color !== next.wallMaterialProps.color ||
      prev.wallMaterialProps.roughness !== next.wallMaterialProps.roughness ||
      prev.isSelected !== next.isSelected ||
      prev.isHovered !== next.isHovered ||
      prev.view !== next.view ||
      prev.outline !== next.outline ||
      prev.wallOpenings.length !== next.wallOpenings.length
    ) {
      return false;
    }
    for (let i = 0; i < prev.wallOpenings.length; i++) {
      const p = prev.wallOpenings[i]!;
      const n = next.wallOpenings[i]!;
      if (
        p.id !== n.id ||
        p.offset !== n.offset ||
        p.width !== n.width ||
        p.height !== n.height ||
        p.sill !== n.sill ||
        p.role !== n.role ||
        p.openFraction !== n.openFraction
      ) {
        return false;
      }
    }
    return true;
  }
);

export interface RoomShellProps {
  className?: string;
}

/**
 * 3D Room Shell:
 * - Triangulated floor mesh from the room outline
 * - Extruded wall segments with CSG-free opening cutouts and camera-facing fade
 * - Optional ceiling mesh toggled via uiStore
 */
export const RoomShell: React.FC<RoomShellProps> = () => {
  const outline = useSceneStore((state) => state.room.outline);
  const wallHeight = useSceneStore((state) => state.room.wallHeight);
  const wallThickness = useSceneStore((state) => state.room.wallThickness);
  const wallOverrides = useSceneStore((state) => state.room.wallOverrides || {});
  const openings = useSceneStore((state) => state.room.openings);
  const floorMaterialType = useSceneStore((state) => state.room.floorMaterial ?? 'wood');
  const wallMaterialType = useSceneStore((state) => state.room.wallMaterial ?? 'paint');
  
  const view = useUiStore((state) => state.view);
  const showCeiling = useUiStore((state) => state.showCeiling);
  const selectedWallIndex = useUiStore((state) => state.selectedWallIndex);
  const hoveredWallIndex = useUiStore((state) => state.hoveredWallIndex);
  const setSelectedWallIndex = useUiStore((state) => state.setSelectedWallIndex);
  const setHoveredWallIndex = useUiStore((state) => state.setHoveredWallIndex);

  const wallOpacityMode = useGraphicsStore((state) => state.wallOpacityMode);

  const floorProps = useMemo(() => getFloorMaterialProps(floorMaterialType), [floorMaterialType]);

  // Floor polygon triangulation using THREE.Shape
  const { floorShape, outlinePoints } = useMemo(() => {
    const shape = new THREE.Shape();
    const points: THREE.Vector3[] = [];

    if (outline.length >= 3) {
      shape.moveTo(outline[0]![0], -outline[0]![1]);
      points.push(new THREE.Vector3(outline[0]![0], 0.002, outline[0]![1]));

      for (let i = 1; i < outline.length; i++) {
        const pt = outline[i]!;
        shape.lineTo(pt[0], -pt[1]);
        points.push(new THREE.Vector3(pt[0], 0.002, pt[1]));
      }
      shape.closePath();
      points.push(new THREE.Vector3(outline[0]![0], 0.002, outline[0]![1]));
    }

    return { floorShape: shape, outlinePoints: points };
  }, [outline]);

  const outlineLine = useMemo(() => {
    const geom = new THREE.BufferGeometry().setFromPoints(outlinePoints);
    const mat = new THREE.LineBasicMaterial({ color: 0x38bdf8 });
    return new THREE.Line(geom, mat);
  }, [outlinePoints]);

  useEffect(() => {
    return () => {
      outlineLine.geometry.dispose();
      (outlineLine.material as THREE.Material).dispose();
    };
  }, [outlineLine]);

  if (outline.length < 3) return null;

  return (
    <group name="room-shell">
      {/* 1. Floor Mesh */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.001, 0]} receiveShadow userData={{ isExportable: true, exportType: 'wall' }}>
        <shapeGeometry args={[floorShape]} />
        <meshStandardMaterial
          {...floorProps}
          polygonOffset
          polygonOffsetFactor={1}
          polygonOffsetUnits={1}
        />
      </mesh>

      {/* Floor Outline Perimeter Line */}
      <primitive object={outlineLine} />

      {/* 2. Wall Segments with Cutouts & Camera-Facing Fade */}
      {outline.map((_, index) => {
        const wallOpenings = openings.filter((op) => op.wallIndex === index);
        const override = wallOverrides[index];
        const segHeight = override?.height ?? wallHeight;
        const segThickness = override?.thickness ?? wallThickness;
        const segColor = override?.color ?? '#e2e8f0';
        
        const wallMaterialProps = getWallMaterialProps(wallMaterialType, segColor);

        return (
          <WallSegmentMesh
            key={`wall-${index}`}
            wallIndex={index}
            outline={outline}
            wallHeight={segHeight}
            wallThickness={segThickness}
            isSelected={selectedWallIndex === index}
            isHovered={hoveredWallIndex === index}
            wallOpenings={wallOpenings}
            view={view}
            wallOpacityMode={wallOpacityMode}
            wallMaterialProps={wallMaterialProps}
            onSelectWall={setSelectedWallIndex}
            onHoverWall={setHoveredWallIndex}
          />
        );
      })}

      {/* 3. Mitered Corner Prisms */}
      {outline.map((_, index) => {
        const prevIndex = (index - 1 + outline.length) % outline.length;
        const tIn = wallOverrides[prevIndex]?.thickness ?? wallThickness;
        const tOut = wallOverrides[index]?.thickness ?? wallThickness;
        const hCorner = Math.max(
          wallOverrides[prevIndex]?.height ?? wallHeight,
          wallOverrides[index]?.height ?? wallHeight
        );
        const cornerColor = wallOverrides[index]?.color ?? '#e2e8f0';
        const cornerWallMaterialProps = getWallMaterialProps(wallMaterialType, cornerColor);

        return (
          <MiteredCornerMesh
            key={`miter-${index}`}
            cornerIndex={index}
            outline={outline}
            height={hCorner}
            tIn={tIn}
            tOut={tOut}
            view={view}
            wallOpacityMode={wallOpacityMode}
            wallMaterialProps={cornerWallMaterialProps}
          />
        );
      })}

      {/* 4. Optional Ceiling Mesh */}
      {showCeiling && (
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, wallHeight, 0]} receiveShadow userData={{ isExportable: true, exportType: 'wall' }}>
          <shapeGeometry args={[floorShape]} />
          <meshStandardMaterial
            color="#52525b"
            roughness={0.9}
            side={THREE.DoubleSide}
            transparent
            opacity={0.7}
          />
        </mesh>
      )}
    </group>
  );
};

export default RoomShell;
