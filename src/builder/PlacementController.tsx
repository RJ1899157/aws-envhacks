import React, { useCallback, useEffect, useRef, useState } from 'react';
import type { ThreeEvent } from '@react-three/fiber';
import * as THREE from 'three';
import { getCatalogAsset } from '../core/catalog';
import type { OpeningSubType, SceneObject } from '../core/schema';
import { snap } from '../core/units';
import {
  computeOpeningSnapGuides,
  createOpeningFromPreset,
  findNearestWallForPoint,
  OPENING_PRESETS,
  resolveOpeningOverlapOnWall,
} from '../core/openingPresets';
import { useSceneStore } from '../store/sceneStore';
import { useUiStore } from '../store/uiStore';
import { AssetMesh } from './AssetMesh';

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
  const isWallMounted = Boolean(catalogDef?.wallMounted);

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

  // Shift key repeat placement tracking
  const isShiftPressed = useRef<boolean>(false);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Shift') isShiftPressed.current = true;
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
    (e: ThreeEvent<PointerEvent>) => {
      if (!catalogDef || (toolMode !== 'place' && toolMode !== 'opening')) {
        return;
      }

      const point = e.point;
      const rawX = point.x;
      const rawZ = point.z;

      if (isWallMounted) {
        // --- WALL-MOUNTED PLACEMENT (Windows & Doors) ---
        const nearest = findNearestWallForPoint(rawX, rawZ, room);
        if (!nearest) return;

        const seg = nearest.seg;
        const w = catalogDef.size[0];
        const h = catalogDef.size[1];
        const rawOffset = nearest.t - w / 2;

        const snapRes = computeOpeningSnapGuides(
          room,
          nearest.wallIndex,
          w,
          rawOffset,
          undefined,
          gridStep
        );
        const offset = snapEnabled ? snapRes.snappedOffset : Math.max(0, Math.min(seg.len - w, rawOffset));

        const uMid = offset + w / 2;
        const vMid = catalogDef.elevation + h / 2;
        const tMid = room.wallThickness / 2;

        const posX = seg.a[0] + uMid * seg.dir[0] + tMid * seg.normal[0];
        const posY = vMid;
        const posZ = seg.a[1] + uMid * seg.dir[1] + tMid * seg.normal[1];

        // Wall basis rotation
        const xAxis = new THREE.Vector3(seg.dir[0], 0, seg.dir[1]).normalize();
        const yAxis = new THREE.Vector3(0, 1, 0);
        const zAxis = new THREE.Vector3(seg.normal[0], 0, seg.normal[1]).normalize();
        const rotMatrix = new THREE.Matrix4().makeBasis(xAxis, yAxis, zAxis);
        const quaternion = new THREE.Quaternion().setFromRotationMatrix(rotMatrix);

        setWallOpeningData({
          wallIndex: nearest.wallIndex,
          offset,
          position: [posX, posY, posZ],
          quaternion,
          width: w,
          height: h,
        });
        setGhostPos([posX, 0, posZ]);
      } else {
        // --- FLOOR OBJECT PLACEMENT (Unobstructed in Phase A) ---
        let x = rawX;
        let z = rawZ;
        if (snapEnabled) {
          x = snap(x, gridStep);
          z = snap(z, gridStep);
        }

        const elev = catalogDef.elevation;
        setGhostPos([x, elev, z]);
        setWallOpeningData(null);
      }
    },
    [catalogDef, toolMode, isWallMounted, room, snapEnabled, gridStep]
  );

  // Pointer down handler for committing placement
  const handleGroundPointerDown = useCallback(
    (e: ThreeEvent<PointerEvent>) => {
      if (e.button !== 0 || !catalogDef) return;
      if (toolMode !== 'place' && toolMode !== 'opening') return;

      e.stopPropagation();

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

        const subTypeCandidate = catalogDef.id as OpeningSubType;
        const subType = subTypeCandidate in OPENING_PRESETS ? subTypeCandidate : (catalogDef.category === 'openings' && catalogDef.id.includes('door') ? 'single-door' : 'window');
        const opening = createOpeningFromPreset(subType, wallOpeningData.wallIndex, resolution.finalOffset);
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
          rotation: [0, 0, 0],
          size: [...catalogDef.size],
          scale: [1, 1, 1],
          elevation: catalogDef.elevation,
          role: catalogDef.role,
          wallMounted: false,
          color: catalogDef.color,
          defaultAirflow: catalogDef.defaultAirflow,
        };
        addObject(object);
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
      addOpening,
      addObject,
      setActiveAssetId,
      setToolMode,
      room,
    ]
  );

  if (!catalogDef || (toolMode !== 'place' && toolMode !== 'opening')) {
    return null;
  }

  return (
    <group name="placement-controller">
      {/* Invisible raycast receiver plane */}
      <mesh
        position={[0, 0, 0]}
        rotation={[-Math.PI / 2, 0, 0]}
        visible={false}
        onPointerMove={handleGroundPointerMove}
        onPointerDown={handleGroundPointerDown}
      >
        <planeGeometry args={[2000, 2000]} />
      </mesh>

      {/* 1. Wall-Mounted Opening Ghost Preview */}
      {isWallMounted && wallOpeningData && (
        <group position={wallOpeningData.position} quaternion={wallOpeningData.quaternion}>
          <mesh>
            <boxGeometry
              args={[wallOpeningData.width, wallOpeningData.height, room.wallThickness * 1.15]}
            />
            <meshStandardMaterial
              color="#38bdf8"
              transparent
              opacity={0.6}
              emissive="#0284c7"
              emissiveIntensity={0.6}
            />
          </mesh>
        </group>
      )}

      {/* 2. Floor Object Ghost Preview */}
      {!isWallMounted && ghostPos && (
        <AssetMesh
          object={{
            id: 'placement-ghost',
            assetId: catalogDef.id,
            position: ghostPos,
            size: catalogDef.size,
            scale: [1, 1, 1],
            elevation: catalogDef.elevation,
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
