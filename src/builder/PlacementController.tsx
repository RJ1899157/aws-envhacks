import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Html } from '@react-three/drei';
import { useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { wallQuaternion } from './wallRotation';
import { getCatalogAsset } from '../core/catalog';
import type { Room, SceneObject } from '../core/schema';
import { roomGridOrigin } from '../core/rooms';
import { computeSmartSnap } from '../core/smartSnap';
import { pointInPolygon, wallSegment } from '../core/parser';
import { isPollutionSourceObject, surfaceHeightAt } from '../core/surfaces';
import {
  computeOpeningSnapGuides,
  createOpeningFromPreset,
  findNearestWallForPoint,
  fitOpeningToWall,
  openingSubTypeFor,
  placeOnNearestWall,
  resolveOpeningOverlapOnWall,
} from '../core/openingPresets';
import { useSceneStore } from '../store/sceneStore';
import { useUiStore, type ViewMode } from '../store/uiStore';
import { AssetMesh } from './AssetMesh';
import { useDropFeedbackStore } from '../store/dropFeedbackStore';
import { setCanvasCursor, resetCanvasCursor } from '../core/cursor';

function generateId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).substring(2, 6)}`;
}

/**
 * Handles asset placement, wall-snapping for openings,
 * translucent ghost preview with valid/invalid states, and repeated placement.
 */
export const PlacementController: React.FC = () => {
  const room = useSceneStore((state) => state.room);
  const addObject = useSceneStore((state) => state.addObject);
  const addOpening = useSceneStore((state) => state.addOpening);

  const toolMode = useUiStore((state) => state.toolMode);
  const setToolMode = useUiStore((state) => state.setToolMode);
  const activeAssetId = useUiStore((state) => state.activeAssetId);
  const setActiveAssetId = useUiStore((state) => state.setActiveAssetId);
  const snapEnabled = useUiStore((state) => state.snapEnabled);
  const gridStep = useUiStore((state) => state.gridStep);

  const catalogDef = activeAssetId ? getCatalogAsset(activeAssetId) : undefined;
  // Openings (doors, windows, arches, vents...) are holes in a wall; other wall-mounted assets
  // (AC, exhaust fan, curtains) are objects hung on the wall's face
  const openingSubType = catalogDef ? openingSubTypeFor(catalogDef.id) : null;
  const isWallMounted = openingSubType !== null;
  const isWallObject = Boolean(catalogDef?.wallMounted) && !isWallMounted;
  const [wallObjectRotY, setWallObjectRotY] = useState(0);

  // Ghost placement position state
  const [ghostPos, setGhostPos] = useState<[number, number, number] | null>(null);

  // Wall-snapped opening state
  const [wallOpeningData, setWallOpeningData] = useState<{
    wallIndex: number;
    offset: number;
    position: [number, number, number];
    quaternion: THREE.Quaternion;
    width: number;
    height: number;
  } | null>(null);

  const [placementRotY, setPlacementRotY] = useState(0);
  /** Whether the opening under the cursor fits on its wall (green) or overlaps another (red) */
  const [openingFits, setOpeningFits] = useState(true);
  /** Wall a wall-mounted object (exhaust fan, AC) would go on, for the wall highlight */
  const [targetWall, setTargetWall] = useState<number | null>(null);
  const view = useUiStore((state) => state.view);
  const lastPointerPoint = useRef<THREE.Vector3 | null>(null);

  // Shift key repeat placement tracking
  const isShiftPressed = useRef<boolean>(false);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Shift') isShiftPressed.current = true;
      if ((e.key === 'r' || e.key === 'R') && toolMode === 'place' && !e.metaKey && !e.ctrlKey) {
        e.preventDefault();
        setPlacementRotY((r) => (r + Math.PI / 2) % (2 * Math.PI));
      }
      if (e.key === 'Escape' && (toolMode === 'place' || toolMode === 'opening')) {
        e.preventDefault();
        setActiveAssetId(null);
        setToolMode('select');
      }
    };
    const handleKeyUp = (e: KeyboardEvent) => {
      if (e.key === 'Shift') isShiftPressed.current = false;
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
    };
  }, [toolMode, setActiveAssetId, setToolMode]);

  // Pointer move handler on ground plane
  const handleGroundPointerMove = useCallback(
    (point: THREE.Vector3) => {
      if (!catalogDef || (toolMode !== 'place' && toolMode !== 'opening')) {
        return;
      }

      const rawX = point.x;
      const rawZ = point.z;

      if (isWallMounted) {
        // --- WALL-MOUNTED PLACEMENT (Windows & Doors) ---
        const nearest = findNearestWallForPoint(rawX, rawZ, room);
        if (!nearest) return;

        const seg = nearest.seg;
        // An Open Wall always covers the whole wall
        const isOpenWall = catalogDef.id === 'open-wall';
        const w = isOpenWall ? seg.len : catalogDef.size[0];
        const h = isOpenWall ? (room.wallOverrides?.[nearest.wallIndex]?.height ?? room.wallHeight) : catalogDef.size[1];
        const rawOffset = nearest.t - w / 2;

        const snapRes = computeOpeningSnapGuides(
          room,
          nearest.wallIndex,
          w,
          rawOffset,
          undefined,
          gridStep
        );
        const offset = isOpenWall ? 0 : snapEnabled ? snapRes.snappedOffset : Math.max(0, Math.min(seg.len - w, rawOffset));

        const uMid = offset + w / 2;
        const vMid = catalogDef.elevation + h / 2;
        const tMid = room.wallThickness / 2;

        const posX = seg.a[0] + uMid * seg.dir[0] + tMid * seg.normal[0];
        const posY = vMid;
        const posZ = seg.a[1] + uMid * seg.dir[1] + tMid * seg.normal[1];

        const quaternion = wallQuaternion(seg.dir);

        setOpeningFits(resolveOpeningOverlapOnWall(room, nearest.wallIndex, offset, w).canPlace);
        setTargetWall(nearest.wallIndex);
        setWallOpeningData({
          wallIndex: nearest.wallIndex,
          offset,
          position: [posX, posY, posZ],
          quaternion,
          width: w,
          height: h,
        });
        setGhostPos([posX, 0, posZ]);
      } else if (isWallObject) {
        const placed = placeOnNearestWall(rawX, rawZ, room, catalogDef.size, snapEnabled ? gridStep : undefined);
        if (!placed) return;
        setTargetWall(findNearestWallForPoint(rawX, rawZ, room)?.wallIndex ?? null);
        setGhostPos([placed.position[0], catalogDef.elevation, placed.position[2]]);
        setWallObjectRotY(placed.rotY);
        setWallOpeningData(null);
      } else {
        const { snappedPos } = computeSmartSnap({
          candidatePos: [rawX, 0, rawZ],
          candidateRotY: placementRotY,
          objectSize: catalogDef.size,
          startPos: [rawX, 0, rawZ],
          room,
          gridStep,
          gridOrigin: roomGridOrigin(room),
          snapEnabled,
        });
        // Pollution sources rest on whatever is under them (floor, counter, table…)
        const y = isPollutionSourceObject({ assetId: catalogDef.id }) ? surfaceHeightAt(room, snappedPos[0], snappedPos[2]) : catalogDef.elevation;
        setGhostPos([snappedPos[0], y, snappedPos[2]]);
        setWallOpeningData(null);
      }
    },
    [catalogDef, toolMode, isWallMounted, isWallObject, room, snapEnabled, gridStep, placementRotY]
  );

  // Pointer down handler for committing placement
  const handleGroundPointerDown = useCallback(
    () => {
      if (!catalogDef) return;
      if (toolMode !== 'place' && toolMode !== 'opening') return;

      if (isWallMounted && wallOpeningData) {
        // Non-overlapping check and push
        const resolution = resolveOpeningOverlapOnWall(
          room,
          wallOpeningData.wallIndex,
          wallOpeningData.offset,
          wallOpeningData.width
        );

        if (!resolution.canPlace) {
          useUiStore.getState().setToastMessage(resolution.errorMessage ?? 'Openings cannot overlap on the same wall');
          return;
        }

        const opening = fitOpeningToWall(createOpeningFromPreset(openingSubType!, wallOpeningData.wallIndex, resolution.finalOffset), room);
        addOpening(opening);

        for (const pushed of resolution.pushedOpenings) {
          useSceneStore.getState().updateOpening(pushed.id, { offset: pushed.offset });
        }
      } else if (!isWallMounted && ghostPos) {
        // Add floor object
        const object: SceneObject = {
          id: generateId('obj'),
          assetId: catalogDef.id,
          name: catalogDef.label,
          position: [ghostPos[0], 0, ghostPos[2]],
          rotation: [0, isWallObject ? wallObjectRotY : placementRotY, 0],
          size: [...catalogDef.size],
          scale: [1, 1, 1],
          elevation: ghostPos[1],
          role: catalogDef.role,
          wallMounted: isWallObject,
          color: catalogDef.color,
          defaultAirflow: catalogDef.defaultAirflow,
        };
        addObject(object);
        useDropFeedbackStore.getState().triggerDropFeedback(
          object.id,
          object.position[0],
          object.position[2],
          Math.max(object.size[0], object.size[2]) * 0.7
        );
      }

      // Check Shift key for repeated placement
      if (!isShiftPressed.current) {
        setActiveAssetId(null);
        setToolMode('select');
        setGhostPos(null);
        setWallOpeningData(null);
      }
    },
    [
      catalogDef,
      toolMode,
      isWallMounted,
      wallOpeningData,
      ghostPos,
      isWallObject,
      wallObjectRotY,
      openingSubType,
      addOpening,
      addObject,
      setActiveAssetId,
      setToolMode,
      room,
      placementRotY,
    ]
  );

  // Raycast against the floor plane directly so walls and objects never block placement
  const camera = useThree((state) => state.camera);
  const canvas = useThree((state) => state.gl.domElement);
  useEffect(() => {
    if (toolMode !== 'place' && toolMode !== 'opening') return;
    const raycaster = new THREE.Raycaster();
    const ndc = new THREE.Vector2();
    // In 3D, wall items aim at their own height, so the wall under the cursor is the one picked
    const onWall = isWallMounted || isWallObject;
    const aimY = view === '3d' && onWall && catalogDef ? catalogDef.elevation + catalogDef.size[1] / 2 : 0;
    const floor = new THREE.Plane(new THREE.Vector3(0, 1, 0), -aimY);
    const hit = new THREE.Vector3();

    const floorPointAt = (e: PointerEvent): THREE.Vector3 | null => {
      const rect = canvas.getBoundingClientRect();
      ndc.set(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
      raycaster.setFromCamera(ndc, camera);
      return raycaster.ray.intersectPlane(floor, hit);
    };
    const onMove = (e: PointerEvent) => {
      const p = floorPointAt(e);
      if (!p) return;
      lastPointerPoint.current = p.clone();
      // Pointing at another room while placing furniture makes that room the target
      if (toolMode === 'place') {
        const { otherRooms, setActiveRoom } = useSceneStore.getState();
        const target = otherRooms.find((r) => pointInPolygon([p.x, p.z], r.outline));
        if (target?.id) {
          setActiveRoom(target.id);
          return;
        }
      }
      handleGroundPointerMove(p);
    };
    const onDown = (e: PointerEvent) => {
      if (e.button !== 0 || !floorPointAt(e)) return;
      handleGroundPointerDown();
      // The click that completes a placement must not also activate/select what's under it
      const swallowClick = (ev: MouseEvent) => ev.stopPropagation();
      window.addEventListener('click', swallowClick, { capture: true, once: true });
      setTimeout(() => window.removeEventListener('click', swallowClick, { capture: true }), 500);
    };

    canvas.addEventListener('pointermove', onMove);
    canvas.addEventListener('pointerdown', onDown);
    return () => {
      canvas.removeEventListener('pointermove', onMove);
      canvas.removeEventListener('pointerdown', onDown);
    };
  }, [toolMode, camera, canvas, handleGroundPointerMove, handleGroundPointerDown, view, isWallMounted, isWallObject, catalogDef]);

  useEffect(() => {
    if (lastPointerPoint.current) handleGroundPointerMove(lastPointerPoint.current);
  }, [placementRotY, handleGroundPointerMove]);

  // Switch to the top-down plan view while placing, then restore the previous view
  const isPlacing = toolMode === 'place' || toolMode === 'opening';
  const viewBeforePlacing = useRef<ViewMode | null>(null);
  useEffect(() => {
    const ui = useUiStore.getState();
    if (isPlacing && viewBeforePlacing.current === null) {
      useSceneStore.getState().clearSelection();
      viewBeforePlacing.current = ui.view;
      // Floor items only: windows, doors and wall devices go on walls, which the plan view hides
      if (ui.view !== '2d' && !isWallMounted && !isWallObject) ui.setView('2d');
    } else if (!isPlacing && viewBeforePlacing.current !== null) {
      setPlacementRotY(0);
      const previous = viewBeforePlacing.current;
      viewBeforePlacing.current = null;
      if (ui.view !== previous) ui.setView(previous);
    }
    // Only when placing starts or ends: picking another item mid-placement must not flip the view
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isPlacing]);

  // Manage placement cursor
  useEffect(() => {
    if (toolMode === 'place' || toolMode === 'opening') {
      setCanvasCursor('copy');
    } else {
      resetCanvasCursor();
    }
    return () => {
      resetCanvasCursor();
    };
  }, [toolMode]);

  if (!catalogDef || (toolMode !== 'place' && toolMode !== 'opening')) {
    return null;
  }

  return (
    <group name="placement-controller">
      {/* 0. Where it can go: every wall of the room tinted, the targeted one green */}
      {(isWallMounted || isWallObject) && <WallTargets room={room} target={isWallMounted ? (wallOpeningData?.wallIndex ?? null) : targetWall} />}

      {/* 1. Wall-Mounted Opening Ghost Preview: green where it fits, red where it would overlap */}
      {isWallMounted && wallOpeningData && (
        <group position={wallOpeningData.position} quaternion={wallOpeningData.quaternion}>
          <mesh renderOrder={20}>
            <boxGeometry args={[wallOpeningData.width, wallOpeningData.height, room.wallThickness * 1.3]} />
            <meshBasicMaterial color={openingFits ? '#22c55e' : '#ef4444'} transparent opacity={0.75} depthTest={false} toneMapped={false} />
          </mesh>
          {!openingFits && (
            <Html center position={[0, wallOpeningData.height / 2 + 0.25, 0]} className="pointer-events-none select-none">
              <div className="whitespace-nowrap rounded bg-red-950/90 border border-red-400/60 px-1.5 py-0.5 text-[11px] font-semibold text-red-200">Overlaps another opening</div>
            </Html>
          )}
        </group>
      )}

      {/* 2. Floor Object Ghost Preview */}
      {!isWallMounted && ghostPos && (
        <AssetMesh
          object={{
            id: 'placement-ghost',
            assetId: catalogDef.id,
            // The ghost's height is its elevation (drawn at position.y + elevation)
            position: [ghostPos[0], 0, ghostPos[2]],
            rotation: [0, isWallObject ? wallObjectRotY : placementRotY, 0],
            size: catalogDef.size,
            scale: [1, 1, 1],
            elevation: ghostPos[1],
            role: catalogDef.role,
            color: catalogDef.color,
          }}
          isGhost
          isValidPlacement={true}
        />
      )}
    </group>
  );
};

export default PlacementController;

/** Translucent tint over the inner face of every wall (where wall items can go); the target wall in green. */
const WallTargets: React.FC<{ room: Room; target: number | null }> = ({ room, target }) => {
  const walls = useMemo(
    () =>
      room.outline.map((_, i) => {
        const seg = wallSegment(room, i);
        const h = room.wallOverrides?.[i]?.height ?? room.wallHeight;
        return {
          i,
          len: seg.len,
          h,
          position: [seg.a[0] + (seg.dir[0] * seg.len) / 2 - seg.normal[0] * 0.02, h / 2, seg.a[1] + (seg.dir[1] * seg.len) / 2 - seg.normal[1] * 0.02] as [number, number, number],
          quaternion: wallQuaternion(seg.dir),
        };
      }),
    [room]
  );
  return (
    <group name="placement-wall-targets">
      {walls.map((w) => (
        <mesh key={w.i} position={w.position} quaternion={w.quaternion} renderOrder={19} raycast={() => null}>
          <boxGeometry args={[w.len, w.h, 0.02]} />
          <meshBasicMaterial color={w.i === target ? '#22c55e' : '#22d3ee'} transparent opacity={w.i === target ? 0.3 : 0.12} depthWrite={false} toneMapped={false} />
        </mesh>
      ))}
    </group>
  );
};
