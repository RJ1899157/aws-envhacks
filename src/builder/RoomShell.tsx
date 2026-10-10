import React, { useEffect, useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { wallQuaternion } from './wallRotation';
import { wallSegment } from '../core/parser';
import type { Opening, Room, Vec2 } from '../core/schema';
import { sharedWallOpenings, type SharedWallOpening } from '../core/rooms';
import { computeMiterCorner } from '../core/wallOperations';
import { useSceneStore } from '../store/sceneStore';
import { useUiStore, type ViewMode } from '../store/uiStore';
import { useGraphicsStore, type WallOpacityMode } from '../store/graphicsStore';
import { getFloorMaterialProps, getWallMaterialProps } from '../core/materials';
import { OpeningVisual } from './OpeningVisual';
import { isOpeningOpen } from '../simulation/geometry';

/** Simulation cutaway: walls drawn at this share of their thickness, semi-transparent. */
const CUTAWAY_THICKNESS = 0.5;
const CUTAWAY_OPACITY = 0.6;
/** Opening marks on cut walls: open windows sky, open doors teal, closed ones slate (amber is kept for stale air). */
const CUT_MARK_COLORS = { windowOpen: '#38bdf8', windowClosed: '#64748b', doorOpen: '#2dd4bf', doorClosed: '#64748b' } as const;

/**
 * Where walls are cut low for the simulation view, each opening shows as a coloured mark: a frame
 * along the top of the low wall for windows, a threshold strip with jambs across the gap for doors.
 */
const CutawayOpeningMarks: React.FC<{ openings: readonly Opening[]; segment: NonNullable<ReturnType<typeof wallSegment>>; thickness: number; cutHeight: number }> = ({ openings, segment, thickness, cutHeight }) => {
  const quaternion = useMemo(() => wallQuaternion(segment.dir), [segment]);
  return (
    <group name="cutaway-opening-marks">
      {openings.map((op) => {
        const open = isOpeningOpen(op);
        const isDoor = op.type === 'door' || op.sill < 0.05;
        const color = isDoor ? (open ? CUT_MARK_COLORS.doorOpen : CUT_MARK_COLORS.doorClosed) : open ? CUT_MARK_COLORS.windowOpen : CUT_MARK_COLORS.windowClosed;
        const u0 = Math.max(0, op.offset);
        const u1 = Math.min(segment.len, op.offset + op.width);
        if (u1 - u0 < 1e-3) return null;
        const at = (u: number, y: number): [number, number, number] => [
          segment.a[0] + u * segment.dir[0] + (thickness / 2) * segment.normal[0],
          y,
          segment.a[1] + u * segment.dir[1] + (thickness / 2) * segment.normal[1],
        ];
        const depth = thickness + 0.06;
        const mat = <meshBasicMaterial color={color} toneMapped={false} />;
        if (isDoor) {
          const jambH = Math.min(cutHeight, op.sill + op.height);
          return (
            <group key={op.id}>
              <mesh position={at((u0 + u1) / 2, 0.025)} quaternion={quaternion} raycast={() => null}>
                <boxGeometry args={[u1 - u0, 0.05, depth]} />
                {mat}
              </mesh>
              {[u0, u1].map((u) => (
                <mesh key={u} position={at(u, jambH / 2)} quaternion={quaternion} raycast={() => null}>
                  <boxGeometry args={[0.05, jambH, depth]} />
                  {mat}
                </mesh>
              ))}
            </group>
          );
        }
        // Window: a frame on top of the low wall (filling the notch where the sill is below the cut)
        const y0 = Math.min(op.sill, cutHeight - 0.05);
        return (
          <mesh key={op.id} position={at((u0 + u1) / 2, (y0 + cutHeight + 0.02) / 2)} quaternion={quaternion} raycast={() => null}>
            <boxGeometry args={[u1 - u0, cutHeight + 0.02 - y0, depth]} />
            {open ? <meshBasicMaterial color={color} toneMapped={false} transparent opacity={0.85} /> : mat}
          </mesh>
        );
      })}
    </group>
  );
};

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
function isPlacingAsset(): boolean {
  const { toolMode } = useUiStore.getState();
  return toolMode === 'place' || toolMode === 'opening';
}

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
  /** Simulation view: walls cut low, opaque, without opening frames */
  cutaway?: boolean;
  /** Openings from a neighbouring room on this shared wall: cut the hole, but render no door */
  sharedOpenings?: readonly SharedWallOpening[];
  /** False for rooms that aren't active: no selection or dragging, a click activates the room */
  interactive?: boolean;
  onActivateRoom?: () => void;
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
  cutaway?: boolean;
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
  cutaway = false,
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
      polygonOffset: true,
      polygonOffsetFactor: 1,
      polygonOffsetUnits: 1,
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

    if (cutaway) {
      cornerMaterial.opacity = THREE.MathUtils.lerp(cornerMaterial.opacity, CUTAWAY_OPACITY, Math.min(1, delta * 10));
      cornerMaterial.depthWrite = true;
    } else if (view === '2d') {
      cornerMaterial.opacity = THREE.MathUtils.lerp(cornerMaterial.opacity, 0.85, Math.min(1, delta * 10));
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
          Math.min(1, delta * 8)
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
    cutaway = false,
    sharedOpenings,
    interactive = true,
    onActivateRoom,
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
        polygonOffset: true,
        polygonOffsetFactor: 1,
        polygonOffsetUnits: 1,
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

      const pieces = computeWallPieces(segment.len, wallHeight, [...wallOpenings, ...(sharedOpenings ?? [])]);
      const thickness = wallThickness;

      const quaternion = wallQuaternion(segment.dir);

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
    }, [segment, wallHeight, wallThickness, wallOpenings, sharedOpenings, wallIndex]);

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

      if (cutaway) {
        wallMaterial.opacity = THREE.MathUtils.lerp(wallMaterial.opacity, CUTAWAY_OPACITY, Math.min(1, delta * 10));
        wallMaterial.depthWrite = true;
      } else if (view === '2d') {
        // In 2D top-down mode, keep walls crisp and solid
        wallMaterial.opacity = THREE.MathUtils.lerp(wallMaterial.opacity, 0.85, Math.min(1, delta * 10));
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
            Math.min(1, delta * 8)
          );
          wallMaterial.depthWrite = wallMaterial.opacity > 0.45;
        }
      }
    });

    // A fully opened wall has no boxes but still renders its openings (e.g. an Open Wall threshold)
    if (!segment || (wallBoxes.length === 0 && wallOpenings.length === 0)) return null;

    return (
      <group
        name={`wall-segment-${wallIndex}`}
        userData={{ isExportable: true, exportType: 'wall' }}
        onPointerDown={(e) => {
          // A wall faded out for the camera lets clicks through to the furniture behind it
          if (isPlacingAsset() || wallMaterial.opacity < 0.5) return;
          if (!interactive) {
            e.stopPropagation();
            return;
          }
          if (e.button === 0) {
            e.stopPropagation();
            useSceneStore.getState().clearSelection();
            onSelectWall?.(wallIndex);
          }
        }}
        onPointerOver={(e) => {
          if (!interactive || isPlacingAsset() || wallMaterial.opacity < 0.5) return;
          e.stopPropagation();
          onHoverWall?.(wallIndex);
        }}
        onClick={(e) => {
          if (interactive || isPlacingAsset() || wallMaterial.opacity < 0.5 || e.delta > 4) return;
          e.stopPropagation();
          onActivateRoom?.();
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
        {cutaway && <CutawayOpeningMarks openings={wallOpenings} segment={segment} thickness={wallThickness} cutHeight={wallHeight} />}
        {!cutaway && wallOpenings.map((opening) => (
          <OpeningVisual
            key={opening.id}
            opening={opening}
            segment={segment}
            wallThickness={wallThickness}
            interactive={interactive}
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
      prev.cutaway !== next.cutaway ||
      prev.wallMaterialProps.color !== next.wallMaterialProps.color ||
      prev.wallMaterialProps.roughness !== next.wallMaterialProps.roughness ||
      prev.isSelected !== next.isSelected ||
      prev.isHovered !== next.isHovered ||
      prev.view !== next.view ||
      prev.outline !== next.outline ||
      prev.sharedOpenings !== next.sharedOpenings ||
      prev.interactive !== next.interactive ||
      prev.onActivateRoom !== next.onActivateRoom ||
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
  /** Room to draw; defaults to the active room from the store */
  room?: Room;
  /** False for a non-active room: drawn read-only, a click on it calls onActivate */
  interactive?: boolean;
  onActivate?: () => void;
}

/**
 * 3D Room Shell:
 * - Triangulated floor mesh from the room outline
 * - Extruded wall segments with CSG-free opening cutouts and camera-facing fade
 * - Optional ceiling mesh toggled via uiStore
 */
const NO_OVERRIDES: NonNullable<Room['wallOverrides']> = {};

export const RoomShell: React.FC<RoomShellProps> = ({ room: roomProp, interactive = true, onActivate }) => {
  const activeRoom = useSceneStore((state) => state.room);
  const otherRooms = useSceneStore((state) => state.otherRooms);
  const room = roomProp ?? activeRoom;
  const outline = room.outline;
  const wallHeight = room.wallHeight;
  const wallThickness = room.wallThickness;
  const wallOverrides = room.wallOverrides ?? NO_OVERRIDES;
  const openings = room.openings;
  const floorMaterialType = room.floorMaterial ?? 'wood';
  const wallMaterialType = room.wallMaterial ?? 'paint';

  // Holes cut by doors/windows that neighbouring rooms put on a wall shared with this one
  const sharedOpeningsByWall = useMemo(() => {
    const neighbours = [activeRoom, ...otherRooms].filter((r) => r.id !== room.id);
    return outline.map((_, i) => {
      const shared = sharedWallOpenings(room, i, neighbours);
      return shared.length > 0 ? shared : undefined;
    });
  }, [room, outline, activeRoom, otherRooms]);

  const view = useUiStore((state) => state.view);
  const showCeiling = useUiStore((state) => state.showCeiling);
  const selectedWallIndex = useUiStore((state) => state.selectedWallIndex);
  const hoveredWallIndex = useUiStore((state) => state.hoveredWallIndex);
  const setSelectedWallIndex = useUiStore((state) => state.setSelectedWallIndex);
  const setHoveredWallIndex = useUiStore((state) => state.setHoveredWallIndex);

  const wallOpacityMode = useGraphicsStore((state) => state.wallOpacityMode);
  const wallCut = useGraphicsStore((state) => state.wallCutHeight);
  const cutaway = wallCut !== null;

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
    <group name={interactive ? 'room-shell' : `room-shell-${room.id ?? 'inactive'}`}>
      {/* 1. Floor Mesh */}
      <mesh
        rotation={[-Math.PI / 2, 0, 0]}
        position={[0, 0.001, 0]}
        receiveShadow
        userData={{ isExportable: true, exportType: 'wall' }}
        onClick={
          interactive
            ? undefined
            : (e) => {
                if (e.delta > 4 || isPlacingAsset()) return;
                e.stopPropagation();
                onActivate?.();
              }
        }
      >
        <shapeGeometry args={[floorShape]} />
        <meshStandardMaterial
          {...floorProps}
          polygonOffset
          polygonOffsetFactor={-1}
          polygonOffsetUnits={-1}
        />
      </mesh>

      {/* Floor Outline Perimeter Line */}
      <primitive object={outlineLine} />

      {/* 2. Wall Segments with Cutouts & Camera-Facing Fade */}
      {outline.map((_, index) => {
        const wallOpenings = openings.filter((op) => op.wallIndex === index);
        const override = wallOverrides[index];
        const fullHeight = override?.height ?? wallHeight;
        const segHeight = cutaway ? Math.min(fullHeight, wallCut) : fullHeight;
        const segThickness = (override?.thickness ?? wallThickness) * (cutaway ? CUTAWAY_THICKNESS : 1);
        const segColor = override?.color ?? '#e2e8f0';
        
        const wallMaterialProps = getWallMaterialProps(wallMaterialType, segColor);

        if (override?.isHidden) return null;

        return (
          <WallSegmentMesh
            key={`wall-${index}`}
            wallIndex={index}
            outline={outline}
            wallHeight={segHeight}
            wallThickness={segThickness}
            isSelected={interactive && selectedWallIndex === index}
            isHovered={interactive && hoveredWallIndex === index}
            wallOpenings={wallOpenings}
            sharedOpenings={sharedOpeningsByWall[index]}
            interactive={interactive}
            onActivateRoom={onActivate}
            view={view}
            wallOpacityMode={wallOpacityMode}
            wallMaterialProps={wallMaterialProps}
            cutaway={cutaway}
            onSelectWall={override?.isLocked ? () => {} : setSelectedWallIndex}
            onHoverWall={override?.isLocked ? () => {} : setHoveredWallIndex}
          />
        );
      })}

      {/* 3. Mitered Corner Prisms */}
      {outline.map((_, index) => {
        const prevIndex = (index - 1 + outline.length) % outline.length;
        const thin = cutaway ? CUTAWAY_THICKNESS : 1;
        const tIn = (wallOverrides[prevIndex]?.thickness ?? wallThickness) * thin;
        const tOut = (wallOverrides[index]?.thickness ?? wallThickness) * thin;
        const hFull = Math.max(
          wallOverrides[prevIndex]?.height ?? wallHeight,
          wallOverrides[index]?.height ?? wallHeight
        );
        const hCorner = cutaway ? Math.min(hFull, wallCut) : hFull;
        const cornerColor = wallOverrides[index]?.color ?? '#e2e8f0';
        const cornerWallMaterialProps = getWallMaterialProps(wallMaterialType, cornerColor);

        if (wallOverrides[index]?.isHidden && wallOverrides[prevIndex]?.isHidden) return null;

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
            cutaway={cutaway}
          />
        );
      })}

      {/* 4. Optional Ceiling Mesh */}
      {showCeiling && !cutaway && (
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, wallHeight, 0]} receiveShadow userData={{ isExportable: true, exportType: 'wall' }}>
          <shapeGeometry args={[floorShape]} />
          {/* BackSide: visible from inside the room, invisible when orbiting from above */}
          <meshStandardMaterial
            color="#e4e4e7"
            roughness={0.9}
            side={THREE.BackSide}
          />
        </mesh>
      )}
    </group>
  );
};

export default RoomShell;
