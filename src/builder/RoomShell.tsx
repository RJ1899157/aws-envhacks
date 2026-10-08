import React, { useEffect, useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { wallSegment } from '../core/parser';
import type { Opening, Room } from '../core/schema';
import { useSceneStore } from '../store/sceneStore';
import { useUiStore, type ViewMode } from '../store/uiStore';

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
  room: Room;
  view: ViewMode;
}

/**
 * Renders an extruded wall segment with CSG-free cutouts for openings.
 * Automatically fades opacity when camera faces the exterior of the wall.
 */
const WallSegmentMesh: React.FC<WallSegmentMeshProps> = ({ wallIndex, room, view }) => {
  const wallMaterial = useMemo(() => {
    return new THREE.MeshStandardMaterial({
      color: '#3f3f46',
      roughness: 0.7,
      metalness: 0.05,
      transparent: true,
      opacity: 0.85,
    });
  }, []);

  useEffect(() => {
    return () => {
      wallMaterial.dispose();
    };
  }, [wallMaterial]);

  const segment = useMemo(() => {
    try {
      return wallSegment(room, wallIndex);
    } catch {
      return null;
    }
  }, [room, wallIndex]);

  const wallOpenings = useMemo(() => {
    return room.openings.filter((op) => op.wallIndex === wallIndex);
  }, [room.openings, wallIndex]);

  // Compute sub-boxes for wall around openings
  const wallBoxes = useMemo(() => {
    if (!segment) return [];

    const pieces = computeWallPieces(segment.len, room.wallHeight, wallOpenings);
    const thickness = room.wallThickness;

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
  }, [segment, room.wallHeight, room.wallThickness, wallOpenings, wallIndex]);

  // Wall center point on floor for camera orientation tests
  const wallCenter = useMemo(() => {
    if (!segment) return new THREE.Vector3();
    const thickness = room.wallThickness;
    const uMid = segment.len / 2;
    const tMid = thickness / 2;
    return new THREE.Vector3(
      segment.a[0] + uMid * segment.dir[0] + tMid * segment.normal[0],
      room.wallHeight / 2,
      segment.a[1] + uMid * segment.dir[1] + tMid * segment.normal[1]
    );
  }, [segment, room.wallHeight, room.wallThickness]);

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
        const targetOpacity = THREE.MathUtils.lerp(0.85, 0.2, fadeFactor);

        wallMaterial.opacity = THREE.MathUtils.lerp(wallMaterial.opacity, targetOpacity, delta * 8);
        wallMaterial.depthWrite = wallMaterial.opacity > 0.45;
      }
    }
  });

  if (!segment || wallBoxes.length === 0) return null;

  return (
    <group name={`wall-segment-${wallIndex}`}>
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
          wallThickness={room.wallThickness}
        />
      ))}
    </group>
  );
};

interface OpeningVisualProps {
  opening: Opening;
  segment: { a: [number, number]; dir: [number, number]; normal: [number, number] };
  wallThickness: number;
}

/**
 * Visual representation of an opening (window glass / door panel) inside the cutout
 */
const OpeningVisual: React.FC<OpeningVisualProps> = ({ opening, segment, wallThickness }) => {
  const { position, quaternion, dimensions, color } = useMemo(() => {
    const uMid = opening.offset + opening.width / 2;
    const vMid = opening.sill + opening.height / 2;
    const tMid = wallThickness / 2;

    const posX = segment.a[0] + uMid * segment.dir[0] + tMid * segment.normal[0];
    const posY = vMid;
    const posZ = segment.a[1] + uMid * segment.dir[1] + tMid * segment.normal[1];

    const xAxis = new THREE.Vector3(segment.dir[0], 0, segment.dir[1]).normalize();
    const yAxis = new THREE.Vector3(0, 1, 0);
    const zAxis = new THREE.Vector3(segment.normal[0], 0, segment.normal[1]).normalize();
    const rotMatrix = new THREE.Matrix4().makeBasis(xAxis, yAxis, zAxis);
    const rot = new THREE.Quaternion().setFromRotationMatrix(rotMatrix);

    let roleColor = '#94a3b8'; // neutral
    if (opening.role === 'inlet') roleColor = '#38bdf8'; // sky blue
    if (opening.role === 'outlet') roleColor = '#f97316'; // amber

    return {
      position: [posX, posY, posZ] as [number, number, number],
      quaternion: rot,
      dimensions: [opening.width * 0.98, opening.height * 0.98, wallThickness * 0.2] as [
        number,
        number,
        number,
      ],
      color: roleColor,
    };
  }, [opening, segment, wallThickness]);

  return (
    <mesh position={position} quaternion={quaternion}>
      <boxGeometry args={dimensions} />
      <meshStandardMaterial
        color={color}
        transparent
        opacity={opening.role === 'closed' ? 0.25 : 0.45}
        roughness={0.2}
      />
    </mesh>
  );
};

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
  const room = useSceneStore((state) => state.room);
  const view = useUiStore((state) => state.view);
  const showCeiling = useUiStore((state) => state.showCeiling);

  // Floor polygon triangulation using THREE.Shape
  const { floorShape, outlinePoints } = useMemo(() => {
    const shape = new THREE.Shape();
    const points: THREE.Vector3[] = [];

    if (room.outline.length >= 3) {
      shape.moveTo(room.outline[0]![0], -room.outline[0]![1]);
      points.push(new THREE.Vector3(room.outline[0]![0], 0.002, room.outline[0]![1]));

      for (let i = 1; i < room.outline.length; i++) {
        const pt = room.outline[i]!;
        shape.lineTo(pt[0], -pt[1]);
        points.push(new THREE.Vector3(pt[0], 0.002, pt[1]));
      }
      shape.closePath();
      points.push(new THREE.Vector3(room.outline[0]![0], 0.002, room.outline[0]![1]));
    }

    return { floorShape: shape, outlinePoints: points };
  }, [room.outline]);

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

  if (room.outline.length < 3) return null;

  return (
    <group name="room-shell">
      {/* 1. Floor Mesh */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.001, 0]} receiveShadow>
        <shapeGeometry args={[floorShape]} />
        <meshStandardMaterial
          color="#27272a"
          roughness={0.8}
          metalness={0.1}
          polygonOffset
          polygonOffsetFactor={1}
          polygonOffsetUnits={1}
        />
      </mesh>

      {/* Floor Outline Perimeter Line */}
      <primitive object={outlineLine} />

      {/* 2. Wall Segments with Cutouts & Camera-Facing Fade */}
      {room.outline.map((_, index) => (
        <WallSegmentMesh key={`wall-${index}`} wallIndex={index} room={room} view={view} />
      ))}

      {/* 3. Optional Ceiling Mesh */}
      {showCeiling && (
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, room.wallHeight, 0]} receiveShadow>
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
