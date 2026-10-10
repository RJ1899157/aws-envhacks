import React, { Suspense, useEffect, useMemo, useRef } from 'react';
import { Canvas as R3FCanvas, useFrame, useThree } from '@react-three/fiber';
import {
  GizmoHelper,
  GizmoViewcube,
  Grid,
  Html,
  OrbitControls,
  OrthographicCamera,
  PerspectiveCamera,
  Environment,
  Lightformer,
} from '@react-three/drei';
import { EffectComposer, N8AO, Bloom, SMAA } from '@react-three/postprocessing';
import * as THREE from 'three';
import { wallQuaternion } from './wallRotation';
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib';
import { useGraphicsStore } from '../store/graphicsStore';
import { pointInPolygon, polygonBounds } from '../core/parser';
import { GLTFLoadProgressBar } from '../ui/GLTFLoadProgressBar';
import { SelectedGroundGlow } from './SelectedGroundGlow';
import { DropRipplesVisualizer } from './DropRipplesVisualizer';
import { useDropFeedbackStore } from '../store/dropFeedbackStore';
import { useSceneStore } from '../store/sceneStore';
import { useUiStore } from '../store/uiStore';
import { useCameraStore } from '../store/cameraStore';
import { cameraController } from './cameraController';
import { WalkthroughControls } from './WalkthroughControls';
import { RoomShell } from './RoomShell';
import { InactiveRooms } from './InactiveRooms';
import { PlacementGrid } from './PlacementGrid';
import { KeyboardPanControls } from './KeyboardPanControls';
import { ObjectResizeHandles } from './ObjectResizeHandles';
import { RoomPlacementController } from './RoomPlacementController';
import { FloorPlanEditor } from './FloorPlanEditor';
import { PlacedObjects } from './PlacedObjects';
import { PlacementController } from './PlacementController';
import { getCatalogAsset } from '../core/catalog';
import { wallSegment } from '../core/parser';
import { computeSmartSnap } from '../core/smartSnap';
import { ROOM_TYPES, rectOutline, roomGridOrigin } from '../core/rooms';
import {
  computeOpeningSnapGuides,
  createOpeningFromPreset,
  fitOpeningToWall,
  findNearestWallForPoint,
  resolveOpeningOverlapOnWall,
  openingSubTypeFor,
  placeOnNearestWall,
} from '../core/openingPresets';
import { SelectionGizmo } from './SelectionGizmo';
import { PerformanceOverlay } from '../ui/PerformanceOverlay';
import { DirectObjectManipulator } from './DirectObjectManipulator';
import { OpeningTaggingPanel } from './OpeningTaggingPanel';
import { VoxelDebugMesh, VoxelDebugControls } from './VoxelDebug';
import { WindIndicator } from './WindIndicator';
import { useSimulationStore } from '../store/simulationStore';
import { SimulationLayer } from './simulation/SimulationLayer';
import { SimulationLegend } from './simulation/SimulationLegend';
import { RoomChips } from './simulation/RoomChips';
import { HoverReadout } from './simulation/HoverReadout';
import { FirstUseCard, RunProgress } from './simulation/SimulationOverlays';
import { FloatingInsights } from '../ui/simulation/InsightsPanel';
import { WhatIfBanner } from './simulation/WhatIfBanner';
import { CompareOverlay } from './simulation/CompareOverlay';
import { ScenarioEngine } from './simulation/ScenarioEngine';
import { ExamplesPicker, openExamples } from '../ui/showcase/ExamplesPicker';
import { StoryBar } from '../ui/showcase/StoryBar';
import { registerShowcaseCamera } from '../store/showcaseStore';
import { focusSimulationRoom } from './simulation/simulationCamera';
import { SourceWisps } from './simulation/SourceWisps';
import { ScaleReference } from './ScaleReference';
import { Scenery } from './Scenery';
import { RoomDivider } from './RoomDivider';
import { usePlacementValidation } from './usePlacementValidation';
import { SceneExporter } from './SceneExporter';

/**
 * Shared OrbitControls ref accessible by tools, transform gizmos, and viewport managers
 */
/** The ground grid spans this multiple of the whole floor plan's size */
const GROUND_GRID_SCALE = 1.5;
/** ...but never smaller than this many metres across */
const GROUND_GRID_MIN_SIZE = 100;

/** Simulation view backdrop and how much of the ground grid stays visible on it. */
const SIM_BACKGROUND = '#0e0f12';
const SIM_GRID_STRENGTH = 0.2;
/** `color` blended toward `bg`, keeping `strength` of it (an opacity the Grid shader lacks). */
const fadeToward = (color: string, bg: string, strength: number) => `#${new THREE.Color(bg).lerp(new THREE.Color(color), strength).getHexString()}`;

export const sharedOrbitControlsRef = React.createRef<OrbitControlsImpl | null>();

const FpsCheck: React.FC = () => {
  const setQuality = useGraphicsStore((state) => state.setQuality);
  const quality = useGraphicsStore((state) => state.quality);
  const setFps = useGraphicsStore((state) => state.setFps);
  const frames = useRef(0);
  const prevTime = useRef(performance.now());

  useFrame(() => {
    frames.current++;
    const time = performance.now();
    if (time >= prevTime.current + 1000) {
      const fps = Math.round((frames.current * 1000) / (time - prevTime.current));
      setFps(fps);
      if (fps < 40 && quality !== 'Low') {
        setQuality(quality === 'High' ? 'Medium' : 'Low');
      }
      frames.current = 0;
      prevTime.current = time;
    }
  });
  return null;
};

const PostProcessingStack: React.FC = () => {
  const quality = useGraphicsStore((state) => state.quality);
  if (quality === 'Low') return null;

  return (
    <EffectComposer multisampling={0}>
      {quality === 'High' ? <N8AO aoRadius={0.5} intensity={1} /> : <></>}
      <Bloom luminanceThreshold={1.2} mipmapBlur intensity={1.5} />
      {quality === 'High' ? <SMAA /> : <></>}
    </EffectComposer>
  );
};

/**
 * Handles HTML5 drag-and-drop of catalog assets directly onto the 3D canvas
 */
const CanvasDropListener: React.FC = () => {
  const { gl, camera } = useThree();
  const room = useSceneStore((state) => state.room);
  const addObject = useSceneStore((state) => state.addObject);
  const addOpening = useSceneStore((state) => state.addOpening);
  const snapEnabled = useUiStore((state) => state.snapEnabled);
  const gridStep = useUiStore((state) => state.gridStep);
  const setActiveAssetId = useUiStore((state) => state.setActiveAssetId);
  const setToolMode = useUiStore((state) => state.setToolMode);

  useEffect(() => {
    const dom = gl.domElement;

    const handleDragOver = (e: DragEvent) => {
      e.preventDefault();
      if (e.dataTransfer) {
        e.dataTransfer.dropEffect = 'copy';
      }

      const activeAssetId = useUiStore.getState().activeAssetId;
      if (!activeAssetId) return;
      const catalogDef = getCatalogAsset(activeAssetId);
      if (!catalogDef || !openingSubTypeFor(catalogDef.id)) return;

      const rect = dom.getBoundingClientRect();
      const ndcX = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      const ndcY = -(((e.clientY - rect.top) / rect.height) * 2 - 1);

      const raycaster = new THREE.Raycaster();
      raycaster.setFromCamera(new THREE.Vector2(ndcX, ndcY), camera);

      const groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
      const hit = new THREE.Vector3();
      if (!raycaster.ray.intersectPlane(groundPlane, hit)) return;

      const nearest = findNearestWallForPoint(hit.x, hit.z, room);
      if (nearest) {
        const w = catalogDef.size[0];
        const rawOffset = nearest.t - w / 2;
        const snapRes = computeOpeningSnapGuides(
          room,
          nearest.wallIndex,
          w,
          rawOffset,
          undefined,
          gridStep
        );
        useUiStore.getState().setDraggedOpeningPreview({
          wallIndex: nearest.wallIndex,
          offset: snapEnabled ? snapRes.snappedOffset : Math.max(0, Math.min(nearest.seg.len - w, rawOffset)),
          width: w,
          height: catalogDef.size[1],
          sill: catalogDef.elevation,
          type: catalogDef.category === 'openings' && catalogDef.id.includes('door') ? 'door' : 'window',
          subType: catalogDef.id,
          snapLabel: snapRes.guideLabel,
        });
      }
    };

    const handleDragLeave = () => {
      useUiStore.getState().setDraggedOpeningPreview(null);
    };

    const handleDrop = (e: DragEvent) => {
      e.preventDefault();
      useUiStore.getState().setDraggedOpeningPreview(null);

      // Check if a .json room file was dropped onto the canvas
      const file = e.dataTransfer?.files?.[0];
      if (file && (file.name.toLowerCase().endsWith('.json') || file.type === 'application/json')) {
        const reader = new FileReader();
        reader.onload = (event) => {
          const text = event.target?.result as string;
          if (text) {
            window.dispatchEvent(new CustomEvent('airforce:import-json', { detail: text }));
          }
        };
        reader.readAsText(file);
        return;
      }

      const assetId = e.dataTransfer?.getData('text/plain');
      if (!assetId) return;

      const catalogDef = getCatalogAsset(assetId);
      if (!catalogDef) return;

      const rect = dom.getBoundingClientRect();
      const ndcX = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      const ndcY = -(((e.clientY - rect.top) / rect.height) * 2 - 1);

      const raycaster = new THREE.Raycaster();
      raycaster.setFromCamera(new THREE.Vector2(ndcX, ndcY), camera);

      const groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
      const hit = new THREE.Vector3();
      const intersects = raycaster.ray.intersectPlane(groundPlane, hit);

      if (!intersects) return;

      // Drop into whichever room is under the cursor
      const scene = useSceneStore.getState();
      const targetRoom = scene.otherRooms.find((r) => pointInPolygon([hit.x, hit.z], r.outline));
      if (targetRoom?.id) scene.setActiveRoom(targetRoom.id);
      const room = useSceneStore.getState().room;

      const dropSubType = openingSubTypeFor(catalogDef.id);
      const wallSpot = catalogDef.wallMounted && !dropSubType ? placeOnNearestWall(hit.x, hit.z, room, catalogDef.size, snapEnabled ? gridStep : undefined) : null;
      if (dropSubType) {
        if (room.outline.length < 2) return;
        const nearest = findNearestWallForPoint(hit.x, hit.z, room);
        if (!nearest) return;

        const isOpenWall = catalogDef.id === 'open-wall';
        const w = isOpenWall ? nearest.seg.len : catalogDef.size[0];
        const rawOffset = nearest.t - w / 2;
        const snapRes = computeOpeningSnapGuides(
          room,
          nearest.wallIndex,
          w,
          rawOffset,
          undefined,
          gridStep
        );
        const offset = isOpenWall
          ? 0
          : snapEnabled
          ? snapRes.snappedOffset
          : Math.max(0, Math.min(nearest.seg.len - w, rawOffset));

        const resolution = resolveOpeningOverlapOnWall(
          room,
          nearest.wallIndex,
          offset,
          w
        );

        if (!resolution.canPlace) {
          useUiStore.getState().setToastMessage(resolution.errorMessage ?? 'Openings cannot overlap on the same wall');
          return;
        }

        const subType = dropSubType;
        const opening = fitOpeningToWall(createOpeningFromPreset(subType, nearest.wallIndex, resolution.finalOffset), room);
        addOpening(opening);

        for (const pushed of resolution.pushedOpenings) {
          useSceneStore.getState().updateOpening(pushed.id, { offset: pushed.offset });
        }
      } else {
        const { snappedPos } = computeSmartSnap({
          candidatePos: [hit.x, 0, hit.z],
          candidateRotY: 0,
          objectSize: catalogDef.size,
          startPos: [hit.x, 0, hit.z],
          room,
          gridStep,
          gridOrigin: roomGridOrigin(room),
          snapEnabled,
        });
        // Wall-mounted appliances hang on the nearest wall, facing into the room
        const [x, , z] = wallSpot ? wallSpot.position : snappedPos;

        const objId = `obj-${Date.now().toString(36)}-${Math.random().toString(36).substring(2, 6)}`;
        addObject({
          id: objId,
          assetId: catalogDef.id,
          name: catalogDef.label,
          position: [x, 0, z],
          rotation: [0, wallSpot?.rotY ?? 0, 0],
          size: [...catalogDef.size],
          scale: [1, 1, 1],
          elevation: catalogDef.elevation,
          role: catalogDef.role,
          wallMounted: Boolean(wallSpot),
          color: catalogDef.color,
          defaultAirflow: catalogDef.defaultAirflow,
        });

        useDropFeedbackStore.getState().triggerDropFeedback(
          objId,
          x,
          z,
          Math.max(catalogDef.size[0], catalogDef.size[2]) * 0.7
        );
      }

      setActiveAssetId(null);
      setToolMode('select');
    };

    dom.addEventListener('dragover', handleDragOver);
    dom.addEventListener('dragleave', handleDragLeave);
    dom.addEventListener('drop', handleDrop);

    return () => {
      dom.removeEventListener('dragover', handleDragOver);
      dom.removeEventListener('dragleave', handleDragLeave);
      dom.removeEventListener('drop', handleDrop);
    };
  }, [
    gl,
    camera,
    room,
    snapEnabled,
    gridStep,
    addOpening,
    addObject,
    setActiveAssetId,
    setToolMode,
  ]);

  return null;
};

/**
 * Renders the live translucent preview of a window/door being dragged from the library onto any wall
 */
const DraggedOpeningPreviewMesh: React.FC = () => {
  const preview = useUiStore((state) => state.draggedOpeningPreview);
  const room = useSceneStore((state) => state.room);

  const previewData = useMemo(() => {
    if (!preview || room.outline.length < 2) return null;
    const seg = wallSegment(room, preview.wallIndex);
    const uMid = preview.offset + preview.width / 2;
    const vMid = preview.sill + preview.height / 2;
    const tMid = room.wallThickness / 2;

    const posX = seg.a[0] + uMid * seg.dir[0] + tMid * seg.normal[0];
    const posY = vMid;
    const posZ = seg.a[1] + uMid * seg.dir[1] + tMid * seg.normal[1];

    const rot = wallQuaternion(seg.dir);

    return {
      position: [posX, posY, posZ] as [number, number, number],
      quaternion: rot,
      width: preview.width,
      height: preview.height,
      snapLabel: preview.snapLabel,
    };
  }, [preview, room]);

  if (!previewData) return null;

  return (
    <group position={previewData.position} quaternion={previewData.quaternion}>
      <mesh>
        <boxGeometry args={[previewData.width, previewData.height, room.wallThickness * 1.15]} />
        <meshStandardMaterial
          color="#38bdf8"
          transparent
          opacity={0.65}
          emissive="#0284c7"
          emissiveIntensity={0.6}
        />
      </mesh>
      {previewData.snapLabel && (
        <Html center position={[0, previewData.height / 2 + 0.25, 0]} className="pointer-events-none select-none">
          <div className="bg-cyan-950/90 border border-cyan-400 text-cyan-200 text-[10px] font-mono font-bold px-1.5 py-0.5 rounded shadow whitespace-nowrap animate-pulse">
            🧲 {previewData.snapLabel}
          </div>
        </Html>
      )}
    </group>
  );
};

/**
 * Blender-like X (Red) and Z (Blue) axis floor lines
 */
export const BlenderAxisLines: React.FC<{ faded?: boolean }> = ({ faded = false }) => {
  const xLine = useMemo(() => {
    const geom = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(-500, 0.001, 0),
      new THREE.Vector3(500, 0.001, 0),
    ]);
    const mat = new THREE.LineBasicMaterial({ color: 0xef4444, depthTest: true });
    return new THREE.Line(geom, mat);
  }, []);

  const zLine = useMemo(() => {
    const geom = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(0, 0.001, -500),
      new THREE.Vector3(0, 0.001, 500),
    ]);
    const mat = new THREE.LineBasicMaterial({ color: 0x3b82f6, depthTest: true });
    return new THREE.Line(geom, mat);
  }, []);

  // Faded with the ground grid in the simulation view
  useEffect(() => {
    for (const line of [xLine, zLine]) {
      const mat = line.material as THREE.LineBasicMaterial;
      mat.transparent = faded;
      mat.opacity = faded ? SIM_GRID_STRENGTH : 1;
      mat.needsUpdate = true;
    }
  }, [faded, xLine, zLine]);

  return (
    <group name="blender-axes">
      {/* X Axis (Red) */}
      <primitive object={xLine} />
      {/* Z Axis on XZ floor (Blue) */}
      <primitive object={zLine} />
    </group>
  );
};

/**
 * Floor outline visualization for the active room
 */
export const RoomFloorPreview: React.FC = () => {
  const room = useSceneStore((state) => state.room);

  const { floorShape, outlineLine } = useMemo(() => {
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
      // Close loop
      points.push(new THREE.Vector3(room.outline[0]![0], 0.002, room.outline[0]![1]));
    }

    const outlineGeom = new THREE.BufferGeometry().setFromPoints(points);
    const outlineMat = new THREE.LineBasicMaterial({ color: 0x38bdf8 });
    const lineObj = new THREE.Line(outlineGeom, outlineMat);

    return { floorShape: shape, outlineLine: lineObj };
  }, [room.outline]);

  if (room.outline.length < 3) return null;

  return (
    <group name="room-floor-preview">
      {/* Floor surface polygon */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.0005, 0]} receiveShadow>
        <shapeGeometry args={[floorShape]} />
        <meshStandardMaterial
          color="#27272a"
          roughness={0.8}
          polygonOffset
          polygonOffsetFactor={1}
          polygonOffsetUnits={1}
        />
      </mesh>

      {/* Perimeter boundary line */}
      <primitive object={outlineLine} />
    </group>
  );
};

interface CameraControllerProps {
  controlsRef: React.RefObject<OrbitControlsImpl | null>;
}

/**
 * Handles smooth camera transitions, mode switching (2D/3D), FOV updates,
 * Blender keyboard shortcuts, and trackpad/mouse navigation gestures.
 */
export const CameraController: React.FC<CameraControllerProps> = ({ controlsRef }) => {
  const { camera, gl, size } = useThree();
  const view = useUiStore((state) => state.view);
  const room = useSceneStore((state) => state.room);
  const selectedObjectId = useSceneStore((state) => state.selectedObjectId);
  const fov = useCameraStore((state) => state.fov);
  const pivotMode = useCameraStore((state) => state.pivotMode);

  // Sync camera FOV when changed in store
  useEffect(() => {
    if ('fov' in camera) {
      (camera as THREE.PerspectiveCamera).fov = fov;
      (camera as THREE.PerspectiveCamera).updateProjectionMatrix();
    }
  }, [camera, fov]);

  // Cancel any active animation when user starts dragging OrbitControls
  useEffect(() => {
    const controls = controlsRef.current;
    if (!controls) return;

    const onStart = () => {
      cameraController.cancelAnimation();
    };

    controls.addEventListener('start', onStart);
    return () => {
      controls.removeEventListener('start', onStart);
    };
  }, [controlsRef]);

  // Pivot Mode: Orbit around selection when an object is selected
  useEffect(() => {
    if (pivotMode === 'selection' && selectedObjectId && controlsRef.current) {
      const obj = room.objects.find((o) => o.id === selectedObjectId);
      if (obj) {
        const elev = obj.elevation ?? 0;
        const targetPos = new THREE.Vector3(
          obj.position[0],
          (obj.position[1] ?? 0) + elev + obj.size[1] / 2,
          obj.position[2]
        );
        cameraController.recenterPivot(targetPos, camera, controlsRef.current);
      }
    }
  }, [pivotMode, selectedObjectId, room.objects, camera, controlsRef]);

  // Mouse & Trackpad gestures:
  // - Pinch zoom (or Ctrl+wheel) zooms towards cursor
  // - Shift + two-finger scroll pans
  // - Trackpad two-finger scroll orbits around target
  // - Regular mouse-wheel zooms toward cursor position
  useEffect(() => {
    const dom = gl.domElement;

    const onWheel = (e: WheelEvent) => {
      if (useCameraStore.getState().isWalkthroughActive) return;
      cameraController.cancelAnimation();

      const rect = dom.getBoundingClientRect();
      const ndcX = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      const ndcY = -(((e.clientY - rect.top) / rect.height) * 2 - 1);

      // 1. Pinch Zoom on Trackpad (Ctrl + wheel on macOS)
      if (e.ctrlKey) {
        e.preventDefault();
        const raycaster = new THREE.Raycaster();
        raycaster.setFromCamera(new THREE.Vector2(ndcX, ndcY), camera);
        const targetY = controlsRef.current ? controlsRef.current.target.y : 0;
        const groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -targetY);
        const hit = new THREE.Vector3();

        if (raycaster.ray.intersectPlane(groundPlane, hit) && controlsRef.current) {
          const zoomDelta = e.deltaY * 0.01;
          const shiftFactor = 0.04 * Math.sign(-zoomDelta);
          const shift = new THREE.Vector3()
            .subVectors(hit, controlsRef.current.target)
            .multiplyScalar(shiftFactor);
          controlsRef.current.target.add(shift);
          camera.position.add(shift);
          const camToTarget = camera.position.clone().sub(controlsRef.current.target);
          const scale = Math.max(0.1, 1 + zoomDelta);
          camera.position.copy(controlsRef.current.target).add(camToTarget.multiplyScalar(scale));
          controlsRef.current.update();
        }
        return;
      }

      // 2. Shift + Two-Finger Scroll: Screen-space Pan
      if (e.shiftKey) {
        e.preventDefault();
        if (controlsRef.current) {
          const panSpeed = 0.003 * camera.position.distanceTo(controlsRef.current.target);
          const forward = new THREE.Vector3();
          camera.getWorldDirection(forward);
          const right = new THREE.Vector3().crossVectors(forward, camera.up).normalize();
          const up = new THREE.Vector3().crossVectors(right, forward).normalize();

          const panOffset = new THREE.Vector3()
            .addScaledVector(right, -e.deltaX * panSpeed)
            .addScaledVector(up, e.deltaY * panSpeed);

          camera.position.add(panOffset);
          controlsRef.current.target.add(panOffset);
          controlsRef.current.update();
        }
        return;
      }

      // 3. Trackpad Two-Finger Scroll: Orbit around target
      const isTrackpad = Math.abs(e.deltaX) > 0 || !Number.isInteger(e.deltaY) || Math.abs(e.deltaY) < 35;
      if (isTrackpad && view === '3d' && controlsRef.current) {
        e.preventDefault();
        const rotSpeed = 0.003;
        cameraController.nudgeOrbit(
          -e.deltaX * rotSpeed * 30,
          -e.deltaY * rotSpeed * 30,
          camera,
          controlsRef.current
        );
        return;
      }

      // 4. Mouse-wheel: Zoom toward cursor position
      if (e.deltaY < 0) {
        const raycaster = new THREE.Raycaster();
        raycaster.setFromCamera(new THREE.Vector2(ndcX, ndcY), camera);
        const targetY = controlsRef.current ? controlsRef.current.target.y : 0;
        const groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -targetY);
        const hit = new THREE.Vector3();

        if (raycaster.ray.intersectPlane(groundPlane, hit) && controlsRef.current) {
          const shiftFactor = 0.07;
          const shift = new THREE.Vector3()
            .subVectors(hit, controlsRef.current.target)
            .multiplyScalar(shiftFactor);
          controlsRef.current.target.add(shift);
          camera.position.add(shift);
        }
      }
    };

    dom.addEventListener('wheel', onWheel, { passive: false });
    return () => dom.removeEventListener('wheel', onWheel);
  }, [camera, gl.domElement, controlsRef, view]);

  // Keyboard shortcut handler
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)
      ) {
        return;
      }

      // F key: Fly-focus to selected object
      if (e.code === 'KeyF' || e.key === 'f' || e.key === 'F') {
        e.preventDefault();
        const selId =
          useSceneStore.getState().selectedObjectId ??
          useSceneStore.getState().selectedObjectIds[0] ??
          null;
        cameraController.fitSelection(selId, room, camera, controlsRef.current);
      }
      // Numpad 7: Top View (Ctrl+Numpad 7: Bottom View)
      else if (e.code === 'Numpad7' || (e.key === '7' && !e.shiftKey)) {
        e.preventDefault();
        if (e.ctrlKey || e.metaKey) {
          cameraController.goToPreset('bottom', room, camera, controlsRef.current);
        } else {
          cameraController.goToPreset('top', room, camera, controlsRef.current);
        }
      }
      // Numpad 1: Front View (Ctrl+Numpad 1: Back View)
      else if (e.code === 'Numpad1' || (e.key === '1' && !e.shiftKey)) {
        e.preventDefault();
        if (e.ctrlKey || e.metaKey) {
          cameraController.goToPreset('back', room, camera, controlsRef.current);
        } else {
          cameraController.goToPreset('front', room, camera, controlsRef.current);
        }
      }
      // Numpad 3: Right View (Ctrl+Numpad 3: Left View)
      else if (e.code === 'Numpad3' || (e.key === '3' && !e.shiftKey)) {
        e.preventDefault();
        if (e.ctrlKey || e.metaKey) {
          cameraController.goToPreset('left', room, camera, controlsRef.current);
        } else {
          cameraController.goToPreset('right', room, camera, controlsRef.current);
        }
      }
      // Numpad 5: Toggle Ortho / Perspective preserving framing
      else if (e.code === 'Numpad5' || (e.key === '5' && !e.shiftKey)) {
        e.preventDefault();
        cameraController.toggleProjectionPreservingFraming(camera, controlsRef.current);
      }
      // Numpad 4: Nudge orbit left 15°
      else if (e.code === 'Numpad4' || (e.key === '4' && !e.shiftKey)) {
        e.preventDefault();
        cameraController.nudgeOrbit(-15, 0, camera, controlsRef.current);
      }
      // Numpad 6: Nudge orbit right 15°
      else if (e.code === 'Numpad6' || (e.key === '6' && !e.shiftKey)) {
        e.preventDefault();
        cameraController.nudgeOrbit(15, 0, camera, controlsRef.current);
      }
      // Numpad 8: Nudge orbit up 15°
      else if (e.code === 'Numpad8' || (e.key === '8' && !e.shiftKey)) {
        e.preventDefault();
        cameraController.nudgeOrbit(0, 15, camera, controlsRef.current);
      }
      // Numpad 2: Nudge orbit down 15°
      else if (e.code === 'Numpad2' || (e.key === '2' && !e.shiftKey)) {
        e.preventDefault();
        cameraController.nudgeOrbit(0, -15, camera, controlsRef.current);
      }
      // Home: Frame the room
      else if (e.code === 'Home' || e.key === 'Home') {
        e.preventDefault();
        cameraController.fitRoom(room, camera, controlsRef.current);
      }
    };

    const handleFlyFocusEvent = (e: Event) => {
      const custom = e as CustomEvent<{ objectId: string }>;
      if (custom.detail?.objectId) {
        cameraController.fitSelection(custom.detail.objectId, room, camera, controlsRef.current);
      }
    };

    // "Simulation view": top-down isometric framing of the whole house
    const handleSimulationView = () => {
      const { room: active, otherRooms } = useSceneStore.getState();
      cameraController.goToHouseView([active, ...otherRooms], camera, controlsRef.current);
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('fly-focus-object', handleFlyFocusEvent);
    window.addEventListener('airforce:simulation-view', handleSimulationView);

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('fly-focus-object', handleFlyFocusEvent);
      window.removeEventListener('airforce:simulation-view', handleSimulationView);
    };
  }, [camera, controlsRef, room]);

  // Adjust camera when view mode switches between 2D and 3D
  // Room is read from the store (not a dependency) so editing the room doesn't reset the camera.
  useEffect(() => {
    let currentRoom = useSceneStore.getState().room;
    // Placing a new room: frame the whole floor plan plus room for the new one around it
    const { toolMode, pendingRoomType } = useUiStore.getState();
    if (view === '2d' && toolMode === 'room' && pendingRoomType) {
      const { otherRooms } = useSceneStore.getState();
      const margin = Math.max(...ROOM_TYPES[pendingRoomType].size) + 0.5;
      let minX = Infinity, minZ = Infinity, maxX = -Infinity, maxZ = -Infinity;
      for (const r of [currentRoom, ...otherRooms]) {
        const rb = polygonBounds(r.outline);
        minX = Math.min(minX, rb.min[0]);
        minZ = Math.min(minZ, rb.min[1]);
        maxX = Math.max(maxX, rb.max[0]);
        maxZ = Math.max(maxZ, rb.max[1]);
      }
      currentRoom = { ...currentRoom, outline: rectOutline(minX - margin, minZ - margin, maxX - minX + 2 * margin, maxZ - minZ + 2 * margin) };
    } else if (view === '2d') {
      // A whole-house simulation result is on show: frame every room, not just the active one
      const sim = useSimulationStore.getState();
      const { otherRooms } = useSceneStore.getState();
      if (sim.viz.show && sim.result && otherRooms.length > 0) {
        let minX = Infinity, minZ = Infinity, maxX = -Infinity, maxZ = -Infinity;
        for (const r of [currentRoom, ...otherRooms]) {
          const rb = polygonBounds(r.outline);
          minX = Math.min(minX, rb.min[0]);
          minZ = Math.min(minZ, rb.min[1]);
          maxX = Math.max(maxX, rb.max[0]);
          maxZ = Math.max(maxZ, rb.max[1]);
        }
        currentRoom = { ...currentRoom, outline: rectOutline(minX, minZ, maxX - minX, maxZ - minZ) };
      }
    }
    if (view === '2d') {
      if (camera instanceof THREE.OrthographicCamera) {
        const b = polygonBounds(currentRoom.outline);
        const margin = 1.5;
        camera.zoom = Math.min(
          (size.width * 0.6) / (b.width + margin),
          (size.height * 0.8) / (b.depth + margin)
        );
        camera.updateProjectionMatrix();
      }
      cameraController.goToPreset('top', currentRoom, camera, controlsRef.current);
    } else {
      cameraController.goToPreset('perspective', currentRoom, camera, controlsRef.current);
    }
  }, [view, camera, controlsRef, size]);

  return null;
};

/**
 * Auto-rotates camera gracefully for turntable presentation, canceled on any user input
 */
const TurntableController: React.FC<{ controlsRef: React.RefObject<OrbitControlsImpl | null> }> = ({
  controlsRef,
}) => {
  const isTurntableActive = useCameraStore((state) => state.isTurntableActive);
  const setTurntableActive = useCameraStore((state) => state.setTurntableActive);

  // Auto-rotate per frame when active
  useFrame((_, delta) => {
    if (!isTurntableActive || !controlsRef.current) return;
    const speed = 0.25; // Graceful spin speed (rad/s)
    const controls = controlsRef.current;
    const cam = controls.object;
    const target = controls.target;

    const offset = cam.position.clone().sub(target);
    offset.applyAxisAngle(new THREE.Vector3(0, 1, 0), speed * delta);
    cam.position.copy(target).add(offset);
    controls.update();
  });

  // Cancel turntable on ANY user input
  useEffect(() => {
    if (!isTurntableActive) return;

    const cancel = () => {
      setTurntableActive(false);
    };

    window.addEventListener('pointerdown', cancel, { passive: true });
    window.addEventListener('keydown', cancel, { passive: true });
    window.addEventListener('wheel', cancel, { passive: true });

    return () => {
      window.removeEventListener('pointerdown', cancel);
      window.removeEventListener('keydown', cancel);
      window.removeEventListener('wheel', cancel);
    };
  }, [isTurntableActive, setTurntableActive]);

  return null;
};

/**
 * Ground click & double click detector to clear selection or re-center orbit pivot
 */
const GroundPlaneDetector: React.FC<{ controlsRef: React.RefObject<OrbitControlsImpl | null> }> = ({
  controlsRef,
}) => {
  const { camera, gl } = useThree();
  // Set only when a press lands on the bare floor (objects and walls stop propagation first)
  const pressStartedOnFloor = useRef(false);
  useEffect(() => {
    const reset = () => {
      pressStartedOnFloor.current = false;
    };
    gl.domElement.addEventListener('pointerdown', reset, true);
    return () => gl.domElement.removeEventListener('pointerdown', reset, true);
  }, [gl]);

  return (
    <mesh
      rotation={[-Math.PI / 2, 0, 0]}
      position={[0, -0.0001, 0]}
      onDoubleClick={(e) => {
        e.stopPropagation();
        cameraController.recenterPivot(e.point, camera, controlsRef.current);
      }}
      onPointerMove={(e) => {
        const x = Number(e.point.x.toFixed(2));
        const z = Number(e.point.z.toFixed(2));
        const current = useUiStore.getState().cursorCoords;
        if (!current || current[0] !== x || current[1] !== z) {
          useUiStore.getState().setCursorCoords([x, z]);
        }
      }}
      onPointerLeave={() => {
        useUiStore.getState().setCursorCoords(null);
      }}
      onPointerDown={(e) => {
        if (e.button === 0) {
          pressStartedOnFloor.current = true;
          const isPlacing = useUiStore.getState().isPlacingPollutantSource;
          if (isPlacing) {
            e.stopPropagation();
            const currentParams = useSceneStore.getState().room.params;
            useSceneStore.getState().setParams({
              pollutantSource: {
                type: currentParams.pollutantSource?.type ?? 'VOC',
                emissionRateMgH: currentParams.pollutantSource?.emissionRateMgH ?? 10,
                position: [Number(e.point.x.toFixed(2)), 0, Number(e.point.z.toFixed(2))],
              },
            });
            useUiStore.getState().setIsPlacingPollutantSource(false);
          }
        }
      }}
      // Deselect on a real click only, so dragging the floor to orbit keeps the selection
      onClick={(e) => {
        if (!pressStartedOnFloor.current || e.delta > 4 || useUiStore.getState().toolMode !== 'select') return;
        useSceneStore.getState().clearSelection();
        useUiStore.getState().setSelectedWallIndex(null);
        useUiStore.getState().setRoomSelected(false);
      }}
      onContextMenu={(e) => {
        e.stopPropagation();
        window.dispatchEvent(
          new CustomEvent('canvas-context-menu', {
            detail: { x: e.clientX, y: e.clientY, targetType: 'floor' },
          })
        );
      }}
    >
      <planeGeometry args={[2000, 2000]} />
      <meshBasicMaterial visible={false} />
    </mesh>
  );
};

/**
 * 3D marker on the floor plane indicating the active pollutant source
 */
const PollutantSourceMarker: React.FC = () => {
  const pollutantSource = useSceneStore((state) => state.room.params.pollutantSource);
  if (!pollutantSource || !pollutantSource.position) return null;
  const [x, , z] = pollutantSource.position;

  return (
    <group position={[x, 0.1, z]}>
      <mesh>
        <cylinderGeometry args={[0.15, 0.2, 0.15, 16]} />
        <meshStandardMaterial
          color="#ec4899"
          emissive="#ec4899"
          emissiveIntensity={0.6}
          roughness={0.3}
        />
      </mesh>
      <mesh position={[0, 0.2, 0]}>
        <sphereGeometry args={[0.1, 16, 16]} />
        <meshStandardMaterial
          color="#f43f5e"
          emissive="#f43f5e"
          emissiveIntensity={0.8}
          roughness={0.2}
        />
      </mesh>
    </group>
  );
};

const NewProjectEmptyState: React.FC = () => {
  const room = useSceneStore((state) => state.room);
  const setToolMode = useUiStore((state) => state.setToolMode);
  const isEmpty = room.name === 'New Room' && room.objects.length === 0 && room.openings.length === 0 && room.outline.length >= 3;
  if (!isEmpty) return null;
  return <Html fullscreen><div className="absolute inset-0 flex items-center justify-center pointer-events-none">
    <div className="pointer-events-auto max-w-md rounded-2xl border border-white/10 bg-neutral-950/80 p-6 text-center text-white shadow-2xl backdrop-blur-md">
      <div className="mx-auto mb-3 h-24 w-36 rounded-xl border border-indigo-400/30 bg-gradient-to-br from-indigo-500/20 to-cyan-400/5 flex items-center justify-center"><div className="h-12 w-20 border-2 border-cyan-300/70 rotate-[-8deg] rounded-sm" /></div>
      <h2 className="text-lg font-semibold">Start with an empty room</h2><p className="mt-1 text-xs text-neutral-400">Build a space, choose a template, or bring in a model.</p>
      <div className="mt-4 grid grid-cols-3 gap-2">
        <button type="button" onClick={() => setToolMode('draw-floor')} className="rounded-lg bg-indigo-600 px-2 py-2 text-xs hover:bg-indigo-500">Draw your room</button>
        <button type="button" onClick={() => window.dispatchEvent(new CustomEvent('airforce:open-templates'))} className="rounded-lg bg-white/10 px-2 py-2 text-xs hover:bg-white/15">Start from a template</button>
        <button type="button" onClick={() => window.dispatchEvent(new CustomEvent('airforce:open-import'))} className="rounded-lg bg-white/10 px-2 py-2 text-xs hover:bg-white/15">Import a model</button>
      </div>
      <button type="button" onClick={openExamples} className="mt-2 w-full rounded-lg border border-indigo-400/40 bg-indigo-500/10 px-2 py-2 text-xs hover:bg-indigo-500/20" data-testid="empty-state-examples">Or explore an example flat with ready-made simulation results</button>
    </div>
  </div></Html>;
};

export interface CanvasProps {
  className?: string;
  /** Guided app: no view cube, empty-state card, floating insights or debug controls */
  minimal?: boolean;
}

export const Canvas: React.FC<CanvasProps> = ({ className = '', minimal = false }) => {
  const controlsRef = useRef<OrbitControlsImpl | null>(null);
  const isDragging = useSceneStore((state) => state.isDragging);
  const room = useSceneStore((state) => state.room);
  const otherRooms = useSceneStore((state) => state.otherRooms);
  // Ground grid: GROUND_GRID_SCALE x the floor plan's size, centred on it and snapped to whole metres
  const groundGrid = useMemo(() => {
    let minX = Infinity, minZ = Infinity, maxX = -Infinity, maxZ = -Infinity;
    for (const r of [room, ...otherRooms]) {
      const b = polygonBounds(r.outline);
      minX = Math.min(minX, b.min[0]);
      minZ = Math.min(minZ, b.min[1]);
      maxX = Math.max(maxX, b.max[0]);
      maxZ = Math.max(maxZ, b.max[1]);
    }
    const cx = (minX + maxX) / 2;
    const cz = (minZ + maxZ) / 2;
    const halfX = ((maxX - minX) * GROUND_GRID_SCALE) / 2;
    const halfZ = ((maxZ - minZ) * GROUND_GRID_SCALE) / 2;
    const center = [Math.round(cx), Math.round(cz)] as const;
    // Half-sizes in whole metres from an integer centre keep the lines on the world metre lattice
    const hx = Math.max(GROUND_GRID_MIN_SIZE / 2, Math.ceil(Math.abs(cx - center[0]) + halfX));
    const hz = Math.max(GROUND_GRID_MIN_SIZE / 2, Math.ceil(Math.abs(cz - center[1]) + halfZ));
    return { center, size: [2 * hx, 2 * hz] as [number, number] };
  }, [room, otherRooms]);
  const view = useUiStore((state) => state.view);
  // While simulation results are on show: darker neutral background and the grid faded to ~20 %
  const simActive = useSimulationStore((state) => state.viz.show && state.result !== null);
  const transformMode = useUiStore((state) => state.transformMode);
  const numericInputBuffer = useUiStore((state) => state.numericInputBuffer);

  const dampedInertia = useCameraStore((state) => state.dampedInertia);
  const isWalkthroughActive = useCameraStore((state) => state.isWalkthroughActive);
  const fov = useCameraStore((state) => state.fov);
  const projection = useCameraStore((state) => state.projection);
  const isPlacing = useUiStore((state) => state.toolMode === 'place' || state.toolMode === 'opening');
  const setTurntableActive = useCameraStore((state) => state.setTurntableActive);

  const roomBounds = useMemo(() => polygonBounds(room.outline), [room.outline]);
  const maxRoomDim = Math.max(roomBounds.width, roomBounds.depth, room.wallHeight || 2.8, 4);
  const maxOrbitDistance = Math.max(100, maxRoomDim * 6);

  // Run Phase B placement validation off the hot path (debounced 100ms)
  usePlacementValidation();

  // Example stories read and move the camera through this
  useEffect(() => {
    registerShowcaseCamera({
      get: () => {
        const c = sharedOrbitControlsRef.current;
        return c ? { position: c.object.position.toArray() as [number, number, number], target: c.target.toArray() as [number, number, number] } : null;
      },
      set: (snap) => {
        const c = sharedOrbitControlsRef.current;
        if (c) cameraController.animateTo(c.object, c, new THREE.Vector3(...snap.position), new THREE.Vector3(...snap.target), { duration: 400 });
      },
      // After the simulation layer mounts with the story's results
      frame: (roomId) => window.setTimeout(() => (roomId ? focusSimulationRoom(roomId) : window.dispatchEvent(new CustomEvent('airforce:simulation-view'))), 350),
    });
    return () => registerShowcaseCamera(null);
  }, []);

  // Sync ref to shared ref
  useEffect(() => {
    (sharedOrbitControlsRef as React.MutableRefObject<OrbitControlsImpl | null>).current =
      controlsRef.current;
  });

  return (
    <div
      className={`relative w-full h-full overflow-hidden select-none bg-neutral-900 ${className}`}
      onContextMenu={(e) => e.preventDefault()} // Allow right-click orbit without context menu
      onPointerDownCapture={(e) => {
        if (e.altKey && e.button === 0) {
          e.preventDefault();
          const canvas = e.currentTarget.querySelector('canvas');
          if (!canvas) return;
          let lastX = e.clientX;
          let lastY = e.clientY;
          const move = (event: PointerEvent) => {
            const deltaX = event.clientX - lastX;
            const deltaY = event.clientY - lastY;
            lastX = event.clientX;
            lastY = event.clientY;
            const controls = sharedOrbitControlsRef.current;
            if (!controls) return;
            cameraController.nudgeOrbit(-deltaX * 0.45, -deltaY * 0.45, controls.object, controls);
          };
          const up = () => {
            window.removeEventListener('pointermove', move);
            window.removeEventListener('pointerup', up);
          };
          window.addEventListener('pointermove', move);
          window.addEventListener('pointerup', up, { once: true });
          setTurntableActive(false);
        }
      }}
    >
      {/* Global GLTF / Asset Loading Progress Bar */}
      <GLTFLoadProgressBar />
      {/* Blender-style Numeric Input HUD */}
      {numericInputBuffer !== null && (
        <div className="absolute top-5 left-1/2 -translate-x-1/2 z-30 px-4 py-2 bg-neutral-900/95 border border-amber-500/70 rounded-lg shadow-2xl backdrop-blur-md flex items-center gap-3 text-sm text-neutral-100 font-mono pointer-events-none">
          <span className="w-2.5 h-2.5 rounded-full bg-amber-400 animate-pulse" />
          <span>
            {transformMode === 'rotate' ? 'Rotate Angle: ' : 'Translate Distance: '}
            <strong className="text-amber-400 font-bold">{numericInputBuffer}</strong>
            {transformMode === 'rotate' ? '°' : ' m'}
          </span>
          <span className="text-xs text-neutral-400 border-l border-neutral-700 pl-3">
            Press <kbd className="px-1.5 py-0.5 bg-neutral-800 rounded text-neutral-200">Enter</kbd>{' '}
            to apply,{' '}
            <kbd className="px-1.5 py-0.5 bg-neutral-800 rounded text-neutral-200">Esc</kbd> to
            cancel
          </span>
        </div>
      )}

      <R3FCanvas
        // Lines are decorative (outlines, guides); three's default 1 m pick radius makes them steal clicks
        raycaster={{ params: { Line: { threshold: 0.01 }, Points: { threshold: 0.01 }, Mesh: {}, LOD: {}, Sprite: {} } }}
        gl={{
          antialias: true,
          alpha: false,
          preserveDrawingBuffer: true,
          powerPreference: 'high-performance',
          toneMapping: THREE.ACESFilmicToneMapping,
          toneMappingExposure: 1.0,
        }}
        className="w-full h-full"
      >
        <color attach="background" args={[simActive ? SIM_BACKGROUND : '#18181b']} />

        {/* Dual camera setup with projection preservation and makeDefault toggle */}
        <PerspectiveCamera
          makeDefault={view === '3d' && projection === 'perspective'}
          position={[7, 5, 7]}
          fov={fov}
          near={0.1}
          far={1000}
        />
        <OrthographicCamera
          makeDefault={view === '2d' || projection === 'orthographic'}
          position={view === '2d' ? [0, 20, 0] : [10, 10, 10]}
          zoom={45}
          near={0.1}
          far={1000}
        />

        <Suspense fallback={null}>
          <FpsCheck />
          <PostProcessingStack />
          {/* Studio lighting built from light panels: no HDR download, and its own Suspense so
              lighting can never blank the scene */}
          <Suspense fallback={null}>
            <Environment resolution={256} frames={1}>
              <Lightformer intensity={2} position={[0, 6, 0]} rotation={[Math.PI / 2, 0, 0]} scale={[12, 12, 1]} />
              <Lightformer intensity={1.2} position={[-6, 3, 0]} rotation={[0, Math.PI / 2, 0]} scale={[10, 4, 1]} />
              <Lightformer intensity={1.2} position={[6, 3, 0]} rotation={[0, -Math.PI / 2, 0]} scale={[10, 4, 1]} />
              <Lightformer intensity={0.8} position={[0, 3, -6]} scale={[10, 4, 1]} />
            </Environment>
          </Suspense>
          
          {/* Lighting */}
          <ambientLight intensity={0.65} />
          <directionalLight position={[12, 20, 10]} intensity={1.2} />
          <directionalLight position={[-12, 10, -10]} intensity={0.35} />

          {/* Guided app in 3D: surroundings that follow the home's answers instead of an empty grid */}
          {minimal && view === '3d' && <Scenery />}
          {minimal && <RoomDivider />}

          {/* Ground grid (1 m major, 0.1 m minor) sized to the floor plan, extending past every room */}
          {(!minimal || view === '2d') && <Grid
            position={[groundGrid.center[0], 0, groundGrid.center[1]]}
            args={groundGrid.size}
            cellSize={0.1}
            cellThickness={0.6}
            cellColor={simActive ? fadeToward('#2e3039', SIM_BACKGROUND, SIM_GRID_STRENGTH) : '#2e3039'}
            sectionSize={1.0}
            sectionThickness={1.2}
            sectionColor={simActive ? fadeToward('#52525e', SIM_BACKGROUND, SIM_GRID_STRENGTH) : '#52525e'}
            fadeDistance={1000}
            fadeStrength={0}
          />}

          {/* Placement grid drawn over the active room's floor */}
          {isPlacing && <PlacementGrid />}

          {/* Blender X (Red) and Z (Blue) floor axis lines */}
          {!minimal && <BlenderAxisLines faded={simActive} />}

          {/* Ground click & double click detector to clear selection or re-center orbit pivot */}
          <GroundPlaneDetector controlsRef={controlsRef} />

          {/* 3D Room Shell (floor triangulation, wall cutouts, camera-facing fade, ceiling) */}
          <RoomShell />
          <InactiveRooms />
          <PerformanceOverlay />

          {/* Subtle ground-glow under selected objects */}
          <SelectedGroundGlow />

          {/* Animated drop ripple rings on object placement & snap settle */}
          <DropRipplesVisualizer />

          {/* Interactive Floor Plan Editor (drawing, vertex handles, midpoint splits, live dimensions) */}
          <FloorPlanEditor />

          {/* Placed Objects in the Room */}
          <PlacedObjects />
          <SourceWisps />

          {/* Interactive Scale Reference (1.7m human & 1.0m³ cube) */}
          <ScaleReference />
          <WindIndicator />

          {/* Interactive Selection & Transform Gizmo (Precision Mode) */}
          <SelectionGizmo />

          {/* Direct Object Manipulation (Direct Drag, Smart Snap, Alignment Guides, Rotation Handle) */}
          <DirectObjectManipulator />
          <ObjectResizeHandles />

          {/* Floating Opening Tagging Panel (Role buttons, open-fraction, dimensions) */}
          <OpeningTaggingPanel />

          {/* Interactive Placement Controller (Ghost preview, snapping, wall mounting) */}
          <PlacementController />
          <RoomPlacementController />

          {/* Pollutant Source 3D Visual Marker */}
          <PollutantSourceMarker />

          {/* HTML5 Drag & Drop Listener & Live Opening Preview */}
          <CanvasDropListener />
          <DraggedOpeningPreviewMesh />

          {/* Camera Controller, Walkthrough first-person controls, & Turntable auto-rotator */}
          <CameraController controlsRef={controlsRef} />
          <WalkthroughControls />
          <KeyboardPanControls controlsRef={controlsRef} />
          <TurntableController controlsRef={controlsRef} />

          {/* Blender-like OrbitControls with trackpad & touch gestures */}
          <OrbitControls
            ref={controlsRef}
            makeDefault
            enabled={!isDragging && !isWalkthroughActive}
            enableDamping={dampedInertia}
            dampingFactor={0.05}
            minDistance={Math.max(0.5, maxRoomDim * 0.08)}
            maxDistance={maxOrbitDistance}
            minPolarAngle={view === '2d' ? 0 : 0.04}
            maxPolarAngle={view === '2d' ? 0 : Math.PI / 2 - 0.04} // Clamped above floor plane in 3D
            enableRotate={view === '3d'} // Locked rotation in 2D mode
            mouseButtons={{
              // Empty-space left drag orbits. Object/wall/gizmo handlers stop
              // propagation before OrbitControls receives their pointer-down.
              LEFT: THREE.MOUSE.ROTATE,
              MIDDLE: THREE.MOUSE.PAN, // Middle-drag pan (Shift+Left drag also pans)
              RIGHT: THREE.MOUSE.ROTATE, // Right-drag orbit
            }}
            touches={{
              ONE: THREE.TOUCH.ROTATE, // Single finger touch rotates
              TWO: THREE.TOUCH.DOLLY_PAN, // Two-finger pinch zooms and pans
            }}
            // Shift+left pan is the standard OrbitControls gesture; Alt+left
            // remains an orbit alternative for trackpads.
          />

          {/* Voxel Domain Debug Visualizer (non-fluid InstancedMesh cubes) */}
          <VoxelDebugMesh />

          {/* Simulation results: heatmap slices, flow particles, hotspots */}
          <SimulationLayer />

          {/* Top-Right Clickable 3D View-Cube (drei GizmoViewcube) */}
          {!minimal && <GizmoHelper
            alignment="top-right"
            margin={[160, 130]}
            onTarget={() => controlsRef.current?.target ?? new THREE.Vector3(0, 0, 0)}
          >
            <GizmoViewcube
              color="#1f2433"
              hoverColor="#4f46e5"
              textColor="#f8fafc"
              strokeColor="#334155"
              opacity={0.92}
            />
          </GizmoHelper>}
          <SceneExporter />
          {!minimal && <NewProjectEmptyState />}
        </Suspense>
      </R3FCanvas>

      {/* Floating Voxel Debug Controls (Y-slice slider, opacity, solid toggle, legend) */}
      {!minimal && <VoxelDebugControls />}
      <RoomChips />
      <HoverReadout />
      <SimulationLegend />
      {!minimal && <FloatingInsights />}
      <CompareOverlay />
      <WhatIfBanner />
      <ScenarioEngine />
      {!minimal && <StoryBar />}
      {!minimal && <ExamplesPicker />}
      {!minimal && <FirstUseCard />}
      <RunProgress />
    </div>
  );
};

export default Canvas;
