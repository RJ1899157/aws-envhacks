import React, { useCallback, useMemo, useRef, useState } from 'react';
import type { ThreeEvent } from '@react-three/fiber';
import { Html } from '@react-three/drei';
import * as THREE from 'three';
import { wallSegment } from '../core/parser';
import type { Opening } from '../core/schema';
import {
  computeOpeningSnapGuides,
  findNearestWallForPoint,
  resolveOpeningOverlapOnWall,
  type SnapGuideType,
  type WallSegment,
} from '../core/openingPresets';
import { useSceneStore } from '../store/sceneStore';
import { useUiStore } from '../store/uiStore';
import { sharedOrbitControlsRef } from './Canvas';
import { setCanvasCursor, resetCanvasCursor } from '../core/cursor';

export interface OpeningVisualProps {
  opening: Opening;
  segment?: WallSegment;
  wallThickness: number;
}

/**
 * 3D Airflow direction arrow oriented along wall normal:
 * - Inlet: blue arrow pointing into the room (-normal)
 * - Outlet: orange arrow pointing out of the room (+normal)
 */
export const OpeningAirflowArrow: React.FC<{
  position: [number, number, number];
  normal: [number, number];
  role: 'inlet' | 'outlet';
}> = ({ position, normal, role }) => {
  const { arrowQuat, arrowColor } = useMemo(() => {
    const factor = role === 'inlet' ? -1 : 1;
    const dir = new THREE.Vector3(normal[0] * factor, 0, normal[1] * factor).normalize();
    const up = new THREE.Vector3(0, 1, 0);
    const quat = new THREE.Quaternion().setFromUnitVectors(up, dir);
    const color = role === 'inlet' ? '#38bdf8' : '#f97316';
    return { arrowQuat: quat, arrowColor: color };
  }, [normal, role]);

  return (
    <group position={position} quaternion={arrowQuat}>
      {/* Arrow Shaft */}
      <mesh position={[0, 0.16, 0]}>
        <cylinderGeometry args={[0.02, 0.02, 0.32, 12]} />
        <meshStandardMaterial
          color={arrowColor}
          emissive={arrowColor}
          emissiveIntensity={0.8}
          roughness={0.3}
        />
      </mesh>
      {/* Arrow Cone Head */}
      <mesh position={[0, 0.32 + 0.08, 0]}>
        <coneGeometry args={[0.065, 0.16, 12]} />
        <meshStandardMaterial
          color={arrowColor}
          emissive={arrowColor}
          emissiveIntensity={0.8}
          roughness={0.3}
        />
      </mesh>
    </group>
  );
};

/**
 * 2D Architectural Door Swing Arc on the floor plane
 */
const DoorSwingArc: React.FC<{
  width: number;
  flipHinge: boolean;
  flipSwing: boolean;
}> = ({ width, flipHinge, flipSwing }) => {
  const arcCurve = useMemo(() => {
    // Center of hinge in local door coordinates
    const hingeX = flipHinge ? width / 2 : -width / 2;
    const radius = width;
    const startAngle = flipHinge
      ? flipSwing ? 0 : Math.PI
      : flipSwing ? Math.PI : 0;
    const endAngle = flipHinge
      ? flipSwing ? -Math.PI / 2 : Math.PI / 2
      : flipSwing ? Math.PI / 2 : -Math.PI / 2;

    const points: THREE.Vector3[] = [];
    const steps = 24;
    for (let i = 0; i <= steps; i++) {
      const theta = startAngle + (endAngle - startAngle) * (i / steps);
      const px = hingeX + radius * Math.cos(theta);
      const pz = radius * Math.sin(theta);
      points.push(new THREE.Vector3(px, 0.02, pz));
    }
    const geom = new THREE.BufferGeometry().setFromPoints(points);
    return geom;
  }, [width, flipHinge, flipSwing]);

  React.useEffect(() => {
    return () => {
      arcCurve.dispose();
    };
  }, [arcCurve]);

  return (
    <line>
      <primitive object={arcCurve} attach="geometry" />
      <lineDashedMaterial color="#f59e0b" dashSize={0.06} gapSize={0.04} linewidth={1.5} />
    </line>
  );
};

/**
 * Architectural Opening Visual:
 * - Real reveals / jambs lining the wall cutout
 * - Window glass with subtle reflection and opening casement sash
 * - Door leaf with handle, realistic pivot, and floor swing arc
 * - Direct manipulation (gliding drag along wall + wall transferring + smart snap guides)
 * - Resize handles (width, height, sill) + door swing flip handle with live meter readouts
 */
export const OpeningVisual: React.FC<OpeningVisualProps> = ({ opening, segment, wallThickness }) => {
  const room = useSceneStore((state) => state.room);
  const selectedOpeningId = useSceneStore((state) => state.selectedOpeningId);
  const selectedOpeningIds = useSceneStore((state) => state.selectedOpeningIds);
  const selectOpening = useSceneStore((state) => state.selectOpening);
  const updateOpening = useSceneStore((state) => state.updateOpening);
  const flipOpening = useSceneStore((state) => state.flipOpening);
  const toolMode = useUiStore((state) => state.toolMode);
  const setToastMessage = useUiStore((state) => state.setToastMessage);

  const isSelected = selectedOpeningIds.includes(opening.id) || selectedOpeningId === opening.id;

  // --------------------------------------------------------------------------
  // DRAG STATE (Direct Manipulation along wall & between walls)
  // --------------------------------------------------------------------------
  const [isDragging, setIsDragging] = useState(false);
  const [dragOffset, setDragOffset] = useState<number | null>(null);
  const [dragWallIndex, setDragWallIndex] = useState<number | null>(null);
  const [snapGuideInfo, setSnapGuideInfo] = useState<{
    type: SnapGuideType;
    label?: string;
    position: [number, number, number];
  } | null>(null);

  const initialDragRef = useRef<{
    startWallIndex: number;
    startOffset: number;
    grabDeltaT: number;
  } | null>(null);

  // Active wall segment and offset (either during live drag or committed state)
  const currentWallIndex = dragWallIndex ?? opening.wallIndex;
  const currentSeg = useMemo(() => {
    if (dragWallIndex === null && segment) return segment;
    return wallSegment(room, currentWallIndex);
  }, [room, currentWallIndex, dragWallIndex, segment]);

  const currentOffset = dragOffset ?? opening.offset;

  // Calculate 3D transformation basis
  const { position, quaternion } = useMemo(() => {
    const uMid = currentOffset + opening.width / 2;
    const vMid = opening.sill + opening.height / 2;
    const tMid = wallThickness / 2;

    const posX = currentSeg.a[0] + uMid * currentSeg.dir[0] + tMid * currentSeg.normal[0];
    const posY = vMid;
    const posZ = currentSeg.a[1] + uMid * currentSeg.dir[1] + tMid * currentSeg.normal[1];

    const xAxis = new THREE.Vector3(currentSeg.dir[0], 0, currentSeg.dir[1]).normalize();
    const yAxis = new THREE.Vector3(0, 1, 0);
    const zAxis = new THREE.Vector3(currentSeg.normal[0], 0, currentSeg.normal[1]).normalize();
    const rotMatrix = new THREE.Matrix4().makeBasis(xAxis, yAxis, zAxis);
    const rot = new THREE.Quaternion().setFromRotationMatrix(rotMatrix);

    return {
      position: [posX, posY, posZ] as [number, number, number],
      quaternion: rot,
    };
  }, [currentOffset, opening.width, opening.sill, opening.height, wallThickness, currentSeg]);

  // Pointer down to initiate direct opening drag along wall
  const handleOpeningPointerDown = useCallback(
    (e: ThreeEvent<PointerEvent>) => {
      if (toolMode !== 'select' || e.button !== 0) return;
      e.stopPropagation();

      selectOpening(opening.id, e.shiftKey);

      // Project cursor onto wall segment to capture grab offset
      const toCursorX = e.point.x - currentSeg.a[0];
      const toCursorZ = e.point.z - currentSeg.a[1];
      const cursorT = toCursorX * currentSeg.dir[0] + toCursorZ * currentSeg.dir[1];
      const grabDelta = cursorT - opening.offset;

      initialDragRef.current = {
        startWallIndex: opening.wallIndex,
        startOffset: opening.offset,
        grabDeltaT: grabDelta,
      };

      setIsDragging(true);
      setDragOffset(opening.offset);
      setDragWallIndex(opening.wallIndex);

      if (sharedOrbitControlsRef.current) {
        sharedOrbitControlsRef.current.enabled = false;
      }
    },
    [toolMode, selectOpening, opening.id, opening.wallIndex, opening.offset, currentSeg]
  );

  // Pointer move handler while dragging opening
  const handlePointerMove = useCallback(
    (e: ThreeEvent<PointerEvent>) => {
      if (!isDragging || !initialDragRef.current) return;
      e.stopPropagation();

      const point = e.point;

      // 1. Check distance to all walls; auto-switch wall if user drags near another wall
      const nearest = findNearestWallForPoint(point.x, point.z, room);
      let targetWall = currentWallIndex;
      if (nearest && nearest.wallIndex !== currentWallIndex && nearest.dist < 0.75) {
        targetWall = nearest.wallIndex;
        setDragWallIndex(targetWall);
      }

      const activeSeg = wallSegment(room, targetWall);
      const toCursorX = point.x - activeSeg.a[0];
      const toCursorZ = point.z - activeSeg.a[1];
      const cursorT = toCursorX * activeSeg.dir[0] + toCursorZ * activeSeg.dir[1];

      // Maintain grab offset on same wall; if transferred wall, center around cursor
      const rawOffset =
        targetWall === initialDragRef.current.startWallIndex
          ? cursorT - initialDragRef.current.grabDeltaT
          : cursorT - opening.width / 2;

      // Smart snapping along the wall
      const snapRes = computeOpeningSnapGuides(
        room,
        targetWall,
        opening.width,
        rawOffset,
        opening.id
      );

      setDragOffset(snapRes.snappedOffset);

      if (snapRes.guideType !== 'grid' && snapRes.guideType !== 'none') {
        const guideU = snapRes.snappedOffset + opening.width / 2;
        const gX = activeSeg.a[0] + guideU * activeSeg.dir[0];
        const gZ = activeSeg.a[1] + guideU * activeSeg.dir[1];
        setSnapGuideInfo({
          type: snapRes.guideType,
          label: snapRes.guideLabel,
          position: [gX, 0.4, gZ],
        });
      } else {
        setSnapGuideInfo(null);
      }
    },
    [isDragging, currentWallIndex, room, opening.width, opening.id]
  );

  // Pointer up handler to commit drag or revert with toast if overlapping
  const handlePointerUp = useCallback(
    (e: ThreeEvent<PointerEvent>) => {
      if (!isDragging || !initialDragRef.current) return;
      e.stopPropagation();

      const targetWall = dragWallIndex ?? opening.wallIndex;
      const targetOff = dragOffset ?? opening.offset;

      // Check non-overlap rule & gentle push
      const resolution = resolveOpeningOverlapOnWall(
        room,
        targetWall,
        targetOff,
        opening.width,
        opening.id
      );

      if (!resolution.canPlace) {
        // Revert with toast
        setToastMessage('Openings cannot overlap on the same wall');
        updateOpening(opening.id, {
          wallIndex: initialDragRef.current.startWallIndex,
          offset: initialDragRef.current.startOffset,
        });
      } else {
        // Commit new position
        updateOpening(opening.id, {
          wallIndex: targetWall,
          offset: resolution.finalOffset,
        });

        // Apply gentle pushes to any neighbouring openings
        for (const pushed of resolution.pushedOpenings) {
          updateOpening(pushed.id, { offset: pushed.offset });
        }
      }

      setIsDragging(false);
      setDragOffset(null);
      setDragWallIndex(null);
      setSnapGuideInfo(null);
      initialDragRef.current = null;

      if (sharedOrbitControlsRef.current) {
        sharedOrbitControlsRef.current.enabled = true;
      }
    },
    [
      isDragging,
      dragWallIndex,
      dragOffset,
      opening.id,
      opening.wallIndex,
      opening.offset,
      opening.width,
      room,
      updateOpening,
      setToastMessage,
    ]
  );

  // --------------------------------------------------------------------------
  // RESIZE HANDLES (Width Left/Right, Height Top, Sill Bottom)
  // --------------------------------------------------------------------------
  const [resizingHandle, setResizingHandle] = useState<'left' | 'right' | 'top' | 'sill' | null>(
    null
  );
  const [handleReadout, setHandleReadout] = useState<string | null>(null);

  const handleResizePointerDown = (
    handle: 'left' | 'right' | 'top' | 'sill',
    e: ThreeEvent<PointerEvent>
  ) => {
    e.stopPropagation();
    setResizingHandle(handle);
    if (sharedOrbitControlsRef.current) {
      sharedOrbitControlsRef.current.enabled = false;
    }
  };

  const handleResizePointerMove = (e: ThreeEvent<PointerEvent>) => {
    if (!resizingHandle) return;
    e.stopPropagation();

    const seg = currentSeg;
    const wallLen = seg.len;

    if (resizingHandle === 'right') {
      // Adjust width from right edge
      const toCursorX = e.point.x - seg.a[0];
      const toCursorZ = e.point.z - seg.a[1];
      const cursorT = toCursorX * seg.dir[0] + toCursorZ * seg.dir[1];
      const newWidth = Math.max(0.3, Math.min(wallLen - opening.offset, cursorT - opening.offset));
      const rounded = Number(newWidth.toFixed(2));
      updateOpening(opening.id, { width: rounded });
      setHandleReadout(`Width: ${rounded.toFixed(2)} m`);
    } else if (resizingHandle === 'left') {
      // Adjust width and offset from left edge
      const toCursorX = e.point.x - seg.a[0];
      const toCursorZ = e.point.z - seg.a[1];
      const cursorT = toCursorX * seg.dir[0] + toCursorZ * seg.dir[1];
      const currentRight = opening.offset + opening.width;
      const newOffset = Math.max(0, Math.min(currentRight - 0.3, cursorT));
      const newWidth = currentRight - newOffset;
      const roundedOffset = Number(newOffset.toFixed(2));
      const roundedWidth = Number(newWidth.toFixed(2));
      updateOpening(opening.id, { offset: roundedOffset, width: roundedWidth });
      setHandleReadout(`Width: ${roundedWidth.toFixed(2)} m`);
    } else if (resizingHandle === 'top') {
      // Adjust height from top edge
      const cursorY = Math.max(opening.sill + 0.3, Math.min(room.wallHeight, e.point.y));
      const newHeight = cursorY - opening.sill;
      const rounded = Number(newHeight.toFixed(2));
      updateOpening(opening.id, { height: rounded });
      setHandleReadout(`Height: ${rounded.toFixed(2)} m`);
    } else if (resizingHandle === 'sill') {
      // Adjust sill height from bottom edge
      const cursorY = Math.max(0, Math.min(room.wallHeight - opening.height, e.point.y));
      const rounded = Number(cursorY.toFixed(2));
      updateOpening(opening.id, { sill: rounded });
      setHandleReadout(`Sill: ${rounded.toFixed(2)} m`);
    }
  };

  const handleResizePointerUp = (e: ThreeEvent<PointerEvent>) => {
    if (!resizingHandle) return;
    e.stopPropagation();
    setResizingHandle(null);
    setHandleReadout(null);
    if (sharedOrbitControlsRef.current) {
      sharedOrbitControlsRef.current.enabled = true;
    }
  };

  // --------------------------------------------------------------------------
  // VISUAL ELEMENTS: FRAME JAMBS, GLASS SASH, DOOR LEAF & HANDLE
  // --------------------------------------------------------------------------
  const frameThickness = 0.04;
  const jambDepth = wallThickness * 1.02;

  // Door leaf hinge pivot calculation
  const isDoor = opening.type === 'door';
  const flipHinge = Boolean(opening.flipHinge);
  const flipSwing = Boolean(opening.flipSwing);
  const openFraction = opening.openFraction ?? 0;

  // Swing rotation angle
  const leafAngle = isDoor
    ? openFraction * (Math.PI / 2) * (flipSwing ? -1 : 1) * (flipHinge ? -1 : 1)
    : 0;

  // Window casement sash angle
  const windowAngle = !isDoor && openFraction > 0 ? openFraction * (Math.PI / 3) * (flipHinge ? -1 : 1) : 0;

  if (opening.isHidden) {
    return null;
  }

  return (
    <group name={`opening-group-${opening.id}`} userData={{ isExportable: true, exportType: 'opening' }}>
      {/* Snap Guide Line & Label in 3D */}
      {snapGuideInfo && (
        <Html center position={snapGuideInfo.position} className="pointer-events-none select-none">
          <div className="bg-cyan-950/90 border border-cyan-400 text-cyan-200 text-[11px] font-mono font-bold px-2 py-0.5 rounded shadow-lg flex items-center gap-1.5 whitespace-nowrap animate-pulse">
            <span>🧲</span>
            <span>{snapGuideInfo.label}</span>
          </div>
        </Html>
      )}

      {/* Primary Opening Group placed and oriented along wall */}
      <group
        position={position}
        quaternion={quaternion}
        onPointerOver={(e) => {
          if (!isDragging && !opening.isLocked) {
            e.stopPropagation();
            setCanvasCursor('grab');
          }
        }}
        onPointerOut={() => {
          if (!isDragging) resetCanvasCursor();
        }}
        onPointerDown={(e) => {
          if (opening.isLocked) return;
          setCanvasCursor('grabbing');
          handleOpeningPointerDown(e);
        }}
        onPointerMove={(e) => {
          handlePointerMove(e);
          handleResizePointerMove(e);
        }}
        onPointerUp={(e) => {
          resetCanvasCursor();
          handlePointerUp(e);
          handleResizePointerUp(e);
        }}
      >
        {/* 1. ARCHITECTURAL CUTOUT FRAME (Jambs, Lintel, Sill Lining) */}
        <group name="opening-frame">
          {/* Left Jamb */}
          <mesh position={[-opening.width / 2 + frameThickness / 2, 0, 0]}>
            <boxGeometry args={[frameThickness, opening.height, jambDepth]} />
            <meshStandardMaterial color="#334155" roughness={0.6} />
          </mesh>
          {/* Right Jamb */}
          <mesh position={[opening.width / 2 - frameThickness / 2, 0, 0]}>
            <boxGeometry args={[frameThickness, opening.height, jambDepth]} />
            <meshStandardMaterial color="#334155" roughness={0.6} />
          </mesh>
          {/* Top Lintel */}
          <mesh position={[0, opening.height / 2 - frameThickness / 2, 0]}>
            <boxGeometry args={[opening.width, frameThickness, jambDepth]} />
            <meshStandardMaterial color="#334155" roughness={0.6} />
          </mesh>
          {/* Bottom Sill / Threshold */}
          <mesh position={[0, -opening.height / 2 + frameThickness / 2, 0]}>
            <boxGeometry args={[opening.width, frameThickness, jambDepth]} />
            <meshStandardMaterial color="#1e293b" roughness={0.5} />
          </mesh>
        </group>

        {/* 2. WINDOW VISUALS: GLASS & ROTATING SASH */}
        {!isDoor && (
          <group
            name="window-sash"
            position={[flipHinge ? opening.width / 2 : -opening.width / 2, 0, 0]}
            rotation={[0, windowAngle, 0]}
          >
            <group position={[flipHinge ? -opening.width / 2 : opening.width / 2, 0, 0]}>
              {/* Window Glass Pane */}
              <mesh>
                <boxGeometry
                  args={[opening.width - frameThickness * 2, opening.height - frameThickness * 2, 0.016]}
                />
                <meshStandardMaterial
                  color="#bae6fd"
                  transparent
                  opacity={0.35}
                  roughness={0.1}
                  metalness={0.2}
                />
              </mesh>
              {/* Inner Sash Frame Outline */}
              <lineSegments>
                <edgesGeometry
                  args={[
                    new THREE.BoxGeometry(
                      opening.width - frameThickness * 2,
                      opening.height - frameThickness * 2,
                      0.03
                    ),
                  ]}
                />
                <lineBasicMaterial color="#64748b" linewidth={1.5} />
              </lineSegments>
            </group>
          </group>
        )}

        {/* 3. DOOR VISUALS: LEAF, HANDLE, & PIVOT */}
        {isDoor && (
          <group
            name="door-leaf-pivot"
            position={[flipHinge ? opening.width / 2 - 0.02 : -opening.width / 2 + 0.02, 0, 0]}
            rotation={[0, leafAngle, 0]}
          >
            <group position={[flipHinge ? -(opening.width - 0.04) / 2 : (opening.width - 0.04) / 2, 0, 0]}>
              {/* Door Leaf Mesh */}
              <mesh position={[0, 0, 0]}>
                <boxGeometry
                  args={[opening.width - 0.04, opening.height - frameThickness * 1.5, 0.04]}
                />
                <meshStandardMaterial
                  color="#b45309"
                  roughness={0.5}
                  metalness={0.05}
                />
              </mesh>

              {/* Door Lever Handle */}
              <group
                position={[
                  flipHinge ? (opening.width - 0.04) / 2 - 0.08 : -(opening.width - 0.04) / 2 + 0.08,
                  -opening.height / 2 + 1.0,
                  0.03,
                ]}
              >
                <mesh>
                  <cylinderGeometry args={[0.015, 0.015, 0.06, 12]} />
                  <meshStandardMaterial color="#cbd5e1" metalness={0.8} roughness={0.2} />
                </mesh>
                <mesh position={[flipHinge ? -0.04 : 0.04, 0, 0.03]} rotation={[0, 0, Math.PI / 2]}>
                  <cylinderGeometry args={[0.01, 0.01, 0.08, 12]} />
                  <meshStandardMaterial color="#cbd5e1" metalness={0.8} roughness={0.2} />
                </mesh>
              </group>
            </group>
          </group>
        )}

        {/* 4. SELECTION OUTLINE */}
        {isSelected && (
          <lineSegments>
            <edgesGeometry
              args={[
                new THREE.BoxGeometry(
                  opening.width * 1.02,
                  opening.height * 1.02,
                  wallThickness * 1.06
                ),
              ]}
            />
            <lineBasicMaterial color="#f59e0b" linewidth={2} />
          </lineSegments>
        )}

        {/* 5. 2D / 3D ARCHITECTURAL DOOR SWING ARC */}
        {isDoor && (
          <DoorSwingArc
            width={opening.width}
            flipHinge={flipHinge}
            flipSwing={flipSwing}
          />
        )}

        {/* 6. RESIZE HANDLES (Visible when opening is selected) */}
        {isSelected && toolMode === 'select' && (
          <group name="opening-resize-handles">
            {/* Left Edge Handle (Width) */}
            <mesh
              position={[-opening.width / 2, 0, 0]}
              onPointerOver={(e) => {
                e.stopPropagation();
                setCanvasCursor('ew-resize');
              }}
              onPointerOut={() => resetCanvasCursor()}
              onPointerDown={(e) => handleResizePointerDown('left', e)}
            >
              <sphereGeometry args={[0.08, 16, 16]} />
              <meshStandardMaterial
                color="#f59e0b"
                emissive="#d97706"
                emissiveIntensity={0.6}
              />
            </mesh>

            {/* Right Edge Handle (Width) */}
            <mesh
              position={[opening.width / 2, 0, 0]}
              onPointerOver={(e) => {
                e.stopPropagation();
                setCanvasCursor('ew-resize');
              }}
              onPointerOut={() => resetCanvasCursor()}
              onPointerDown={(e) => handleResizePointerDown('right', e)}
            >
              <sphereGeometry args={[0.08, 16, 16]} />
              <meshStandardMaterial
                color="#f59e0b"
                emissive="#d97706"
                emissiveIntensity={0.6}
              />
            </mesh>

            {/* Top Edge Handle (Height) */}
            <mesh
              position={[0, opening.height / 2, 0]}
              onPointerOver={(e) => {
                e.stopPropagation();
                setCanvasCursor('ns-resize');
              }}
              onPointerOut={() => resetCanvasCursor()}
              onPointerDown={(e) => handleResizePointerDown('top', e)}
            >
              <sphereGeometry args={[0.08, 16, 16]} />
              <meshStandardMaterial
                color="#38bdf8"
                emissive="#0284c7"
                emissiveIntensity={0.6}
              />
            </mesh>

            {/* Bottom Edge Handle (Sill Height) */}
            <mesh
              position={[0, -opening.height / 2, 0]}
              onPointerOver={(e) => {
                e.stopPropagation();
                setCanvasCursor('ns-resize');
              }}
              onPointerOut={() => resetCanvasCursor()}
              onPointerDown={(e) => handleResizePointerDown('sill', e)}
            >
              <sphereGeometry args={[0.08, 16, 16]} />
              <meshStandardMaterial
                color="#38bdf8"
                emissive="#0284c7"
                emissiveIntensity={0.6}
              />
            </mesh>

            {/* Swing Flip Handle (Single Click Toggles Door Hinge Side) */}
            {isDoor && (
              <group
                position={[
                  flipHinge ? opening.width / 2 + 0.12 : -opening.width / 2 - 0.12,
                  0,
                  0,
                ]}
                onPointerOver={(e) => {
                  e.stopPropagation();
                  setCanvasCursor('pointer');
                }}
                onPointerOut={() => resetCanvasCursor()}
                onClick={(e) => {
                  e.stopPropagation();
                  flipOpening(opening.id, 'hinge');
                }}
              >
                <mesh>
                  <sphereGeometry args={[0.09, 16, 16]} />
                  <meshStandardMaterial
                    color="#10b981"
                    emissive="#059669"
                    emissiveIntensity={0.7}
                  />
                </mesh>
                <Html center position={[0, 0.15, 0]} className="pointer-events-none select-none">
                  <div className="bg-emerald-950/90 border border-emerald-500 text-emerald-200 text-[10px] font-mono px-1.5 py-0.5 rounded shadow whitespace-nowrap">
                    Flip Hinge
                  </div>
                </Html>
              </group>
            )}

            {/* Live Readout Tooltip while resizing */}
            {handleReadout && (
              <Html center position={[0, opening.height / 2 + 0.25, 0]} className="pointer-events-none select-none">
                <div className="bg-neutral-900/95 border border-amber-400 text-amber-200 font-mono text-xs font-bold px-2 py-1 rounded shadow-xl">
                  {handleReadout}
                </div>
              </Html>
            )}
          </group>
        )}
      </group>

      {/* 7. 3D Airflow Direction Arrow */}
      {opening.role !== 'closed' && (opening.openFraction ?? 0) > 0 && (
        <OpeningAirflowArrow
          position={position}
          normal={currentSeg.normal}
          role={opening.role as 'inlet' | 'outlet'}
        />
      )}
    </group>
  );
};

export default OpeningVisual;
