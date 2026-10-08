import React, { Suspense, useCallback, useEffect, useMemo, useRef } from 'react';
import { Canvas as R3FCanvas, useFrame, useThree } from '@react-three/fiber';
import {
  ContactShadows,
  GizmoHelper,
  GizmoViewport,
  Grid,
  Html,
  OrbitControls,
  OrthographicCamera,
  PerspectiveCamera,
  Environment,
} from '@react-three/drei';
import { EffectComposer, N8AO, Bloom, SMAA } from '@react-three/postprocessing';
import * as THREE from 'three';
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib';
import { useGraphicsStore } from '../store/graphicsStore';
import { polygonBounds } from '../core/parser';
import { prefersReducedMotion } from '../core/motion';
import { GLTFLoadProgressBar } from '../ui/GLTFLoadProgressBar';
import { SelectedGroundGlow } from './SelectedGroundGlow';
import { DropRipplesVisualizer } from './DropRipplesVisualizer';
import { useDropFeedbackStore } from '../store/dropFeedbackStore';
import { useSceneStore } from '../store/sceneStore';
import { useUiStore } from '../store/uiStore';
import { RoomShell } from './RoomShell';
import { FloorPlanEditor } from './FloorPlanEditor';
import { PlacedObjects } from './PlacedObjects';
import { PlacementController } from './PlacementController';
import { getCatalogAsset } from '../core/catalog';
import { wallSegment } from '../core/parser';
import { snap } from '../core/units';
import {
  computeOpeningSnapGuides,
  createOpeningFromPreset,
  findNearestWallForPoint,
  OPENING_PRESETS,
  resolveOpeningOverlapOnWall,
} from '../core/openingPresets';
import type { OpeningSubType } from '../core/schema';
import { SelectionGizmo } from './SelectionGizmo';
import { PerformanceOverlay } from '../ui/PerformanceOverlay';
import { DirectObjectManipulator } from './DirectObjectManipulator';
import { OpeningTaggingPanel } from './OpeningTaggingPanel';
import { VoxelDebugMesh, VoxelDebugControls } from './VoxelDebug';
import { ScaleReference } from './ScaleReference';
import { usePlacementValidation } from './usePlacementValidation';
import { SceneExporter } from './SceneExporter';

/**
 * Shared OrbitControls ref accessible by tools, transform gizmos, and viewport managers
 */
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
      if (!catalogDef || !catalogDef.wallMounted) return;

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

      if (catalogDef.wallMounted) {
        if (room.outline.length < 2) return;
        const nearest = findNearestWallForPoint(hit.x, hit.z, room);
        if (!nearest) return;

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
        const offset = snapEnabled
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

        const subTypeCandidate = catalogDef.id as OpeningSubType;
        const subType = subTypeCandidate in OPENING_PRESETS ? subTypeCandidate : (catalogDef.category === 'openings' && catalogDef.id.includes('door') ? 'single-door' : 'window');
        const opening = createOpeningFromPreset(subType, nearest.wallIndex, resolution.finalOffset);
        addOpening(opening);

        for (const pushed of resolution.pushedOpenings) {
          useSceneStore.getState().updateOpening(pushed.id, { offset: pushed.offset });
        }
      } else {
        let x = hit.x;
        let z = hit.z;
        if (snapEnabled) {
          x = snap(x, gridStep);
          z = snap(z, gridStep);
        }

        const objId = `obj-${Date.now().toString(36)}-${Math.random().toString(36).substring(2, 6)}`;
        addObject({
          id: objId,
          assetId: catalogDef.id,
          name: catalogDef.label,
          position: [x, 0, z],
          rotation: [0, 0, 0],
          size: [...catalogDef.size],
          scale: [1, 1, 1],
          elevation: catalogDef.elevation,
          role: catalogDef.role,
          wallMounted: false,
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

    const xAxis = new THREE.Vector3(seg.dir[0], 0, seg.dir[1]).normalize();
    const yAxis = new THREE.Vector3(0, 1, 0);
    const zAxis = new THREE.Vector3(seg.normal[0], 0, seg.normal[1]).normalize();
    const rotMatrix = new THREE.Matrix4().makeBasis(xAxis, yAxis, zAxis);
    const rot = new THREE.Quaternion().setFromRotationMatrix(rotMatrix);

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
export const BlenderAxisLines: React.FC = () => {
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
 * Handles smooth camera transitions, mode switching (2D/3D), and Blender keyboard shortcuts
 */
export const CameraController: React.FC<CameraControllerProps> = ({ controlsRef }) => {
  const { camera, gl } = useThree();
  const view = useUiStore((state) => state.view);
  const room = useSceneStore((state) => state.room);

  // Target animation state
  const targetCamPos = useRef<THREE.Vector3>(new THREE.Vector3(8, 6, 8));
  const targetLookAt = useRef<THREE.Vector3>(new THREE.Vector3(0, 1.35, 0));
  const isTransitioning = useRef<boolean>(false);

  // Calculates room center and framing distance
  const getRoomFraming = useCallback(() => {
    const bounds = polygonBounds(room.outline);
    const centerX = (bounds.min[0] + bounds.max[0]) / 2;
    const centerZ = (bounds.min[1] + bounds.max[1]) / 2;
    const centerY = room.wallHeight / 2;
    const maxDim = Math.max(bounds.width, bounds.depth, room.wallHeight, 4);
    const distance = maxDim * 1.6;

    return {
      center: new THREE.Vector3(centerX, centerY, centerZ),
      floorCenter: new THREE.Vector3(centerX, 0, centerZ),
      distance,
    };
  }, [room.outline, room.wallHeight]);

  // Animate camera to specific preset views
  const animateTo = useCallback((pos: THREE.Vector3, target: THREE.Vector3) => {
    targetCamPos.current.copy(pos);
    targetLookAt.current.copy(target);
    isTransitioning.current = true;
  }, []);

  // Smoothly fly-focuses to a specific object's bounding center
  const flyFocusToObject = useCallback(
    (objectId: string) => {
      const obj = room.objects.find((o) => o.id === objectId);
      if (!obj) return;
      const [w, h, d] = obj.size;
      const sx = obj.scale?.[0] ?? 1;
      const sy = obj.scale?.[1] ?? 1;
      const sz = obj.scale?.[2] ?? 1;
      const maxDim = Math.max(w * sx, h * sy, d * sz, 0.8);
      const elev = obj.elevation ?? 0;
      const objCenter = new THREE.Vector3(
        obj.position[0],
        (obj.position[1] ?? 0) + elev + (h * sy) / 2,
        obj.position[2]
      );
      const flyDist = Math.max(maxDim * 2.5, 2.5);

      if (view === '2d') {
        animateTo(
          new THREE.Vector3(objCenter.x, objCenter.y + flyDist * 1.5, objCenter.z + 0.0001),
          new THREE.Vector3(objCenter.x, 0, objCenter.z)
        );
      } else {
        animateTo(
          new THREE.Vector3(
            objCenter.x + flyDist * 0.7,
            objCenter.y + flyDist * 0.5,
            objCenter.z + flyDist * 0.7
          ),
          objCenter
        );
      }
    },
    [room.objects, view, animateTo]
  );

  // Mouse-wheel zooms toward cursor position
  useEffect(() => {
    const dom = gl.domElement;
    const onWheel = (e: WheelEvent) => {
      if (isTransitioning.current) return;
      if (e.deltaY >= 0) return; // Only zoom-to-cursor when zooming in

      const rect = dom.getBoundingClientRect();
      const ndcX = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      const ndcY = -(((e.clientY - rect.top) / rect.height) * 2 - 1);

      const raycaster = new THREE.Raycaster();
      raycaster.setFromCamera(new THREE.Vector2(ndcX, ndcY), camera);

      const targetY = controlsRef.current ? controlsRef.current.target.y : 0;
      const groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -targetY);
      const hit = new THREE.Vector3();

      if (raycaster.ray.intersectPlane(groundPlane, hit)) {
        if (controlsRef.current) {
          const shiftFactor = 0.07;
          const shift = new THREE.Vector3()
            .subVectors(hit, controlsRef.current.target)
            .multiplyScalar(shiftFactor);
          controlsRef.current.target.add(shift);
          camera.position.add(shift);
        }
      }
    };

    dom.addEventListener('wheel', onWheel, { passive: true });
    return () => dom.removeEventListener('wheel', onWheel);
  }, [camera, gl.domElement, controlsRef]);

  // Keyboard shortcut handler
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Ignore keystrokes when typing into input / textarea fields
      const target = e.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)
      ) {
        return;
      }

      const { center, distance } = getRoomFraming();

      // F key: Fly-focus to selected object
      if (e.code === 'KeyF' || e.key === 'f' || e.key === 'F') {
        e.preventDefault();
        const selId =
          useSceneStore.getState().selectedObjectId ??
          useSceneStore.getState().selectedObjectIds[0];
        if (selId) {
          flyFocusToObject(selId);
        } else {
          // If nothing selected, frame the whole room
          if (view === '2d') {
            animateTo(
              new THREE.Vector3(center.x, center.y + distance * 1.2, center.z + 0.0001),
              new THREE.Vector3(center.x, 0, center.z)
            );
          } else {
            animateTo(
              new THREE.Vector3(
                center.x + distance * 0.7,
                center.y + distance * 0.5,
                center.z + distance * 0.7
              ),
              center
            );
          }
        }
      }
      // Numpad 7: Top View
      else if (e.code === 'Numpad7' || e.key === '7') {
        e.preventDefault();
        animateTo(new THREE.Vector3(center.x, center.y + distance, center.z + 0.0001), center);
      }
      // Numpad 1: Front View (along +Z looking towards -Z)
      else if (e.code === 'Numpad1' || e.key === '1') {
        e.preventDefault();
        animateTo(new THREE.Vector3(center.x, center.y, center.z + distance), center);
      }
      // Numpad 3: Right View (along +X looking towards -X)
      else if (e.code === 'Numpad3' || e.key === '3') {
        e.preventDefault();
        animateTo(new THREE.Vector3(center.x + distance, center.y, center.z), center);
      }
      // Numpad 5: Toggle 2D / 3D
      else if (e.code === 'Numpad5' || e.key === '5') {
        e.preventDefault();
        const currentView = useUiStore.getState().view;
        useUiStore.getState().setView(currentView === '3d' ? '2d' : '3d');
      }
      // Home: Frame the room
      else if (e.code === 'Home' || e.key === 'Home') {
        e.preventDefault();
        if (view === '2d') {
          animateTo(
            new THREE.Vector3(center.x, center.y + distance * 1.2, center.z + 0.0001),
            new THREE.Vector3(center.x, 0, center.z)
          );
        } else {
          animateTo(
            new THREE.Vector3(
              center.x + distance * 0.7,
              center.y + distance * 0.5,
              center.z + distance * 0.7
            ),
            center
          );
        }
      }
    };

    const handleFlyFocusEvent = (e: Event) => {
      const custom = e as CustomEvent<{ objectId: string }>;
      if (custom.detail?.objectId) {
        flyFocusToObject(custom.detail.objectId);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('fly-focus-object', handleFlyFocusEvent);

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('fly-focus-object', handleFlyFocusEvent);
    };
  }, [getRoomFraming, view, animateTo, flyFocusToObject]);

  // Adjust camera when view mode switches between 2D and 3D
  useEffect(() => {
    const { center, distance } = getRoomFraming();

    if (view === '2d') {
      animateTo(
        new THREE.Vector3(center.x, center.y + distance * 1.2, center.z + 0.0001),
        new THREE.Vector3(center.x, 0, center.z)
      );
    } else {
      animateTo(
        new THREE.Vector3(
          center.x + distance * 0.7,
          center.y + distance * 0.5,
          center.z + distance * 0.7
        ),
        center
      );
    }
  }, [getRoomFraming, view, animateTo]);

  // Per-frame smooth transition using critically damped spring easing
  useFrame((_, delta) => {
    if (isTransitioning.current) {
      if (prefersReducedMotion()) {
        camera.position.copy(targetCamPos.current);
        controlsRef.current?.target.copy(targetLookAt.current);
        controlsRef.current?.update();
        isTransitioning.current = false;
        return;
      }

      const step = Math.min(delta * 12, 1);
      camera.position.lerp(targetCamPos.current, step);

      if (controlsRef.current) {
        controlsRef.current.target.lerp(targetLookAt.current, step);
        controlsRef.current.update();
      }

      const targetDist = controlsRef.current
        ? controlsRef.current.target.distanceTo(targetLookAt.current)
        : 0;

      if (camera.position.distanceTo(targetCamPos.current) < 0.015 && targetDist < 0.015) {
        camera.position.copy(targetCamPos.current);
        controlsRef.current?.target.copy(targetLookAt.current);
        controlsRef.current?.update();
        isTransitioning.current = false;
      }
    }
  });

  return null;
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

export interface CanvasProps {
  className?: string;
}

export const Canvas: React.FC<CanvasProps> = ({ className = '' }) => {
  const controlsRef = useRef<OrbitControlsImpl | null>(null);
  const isDragging = useSceneStore((state) => state.isDragging);
  const view = useUiStore((state) => state.view);
  const toolMode = useUiStore((state) => state.toolMode);
  const transformMode = useUiStore((state) => state.transformMode);
  const numericInputBuffer = useUiStore((state) => state.numericInputBuffer);

  // Run Phase B placement validation off the hot path (debounced 100ms)
  usePlacementValidation();

  // Sync ref to shared ref
  useEffect(() => {
    (sharedOrbitControlsRef as React.MutableRefObject<OrbitControlsImpl | null>).current =
      controlsRef.current;
  });

  return (
    <div
      className={`relative w-full h-full overflow-hidden select-none bg-neutral-900 ${className}`}
      onContextMenu={(e) => e.preventDefault()} // Allow right-click orbit without context menu
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
        shadows
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
        <color attach="background" args={['#18181b']} />

        {/* Dual camera setup with makeDefault toggle */}
        {view === '3d' ? (
          <PerspectiveCamera makeDefault position={[7, 5, 7]} fov={45} near={0.1} far={1000} />
        ) : (
          <OrthographicCamera
            makeDefault
            position={[0, 20, 0]}
            zoom={55}
            near={0.1}
            far={1000}
            up={[0, 0, -1]} // Top-down view looking at XZ plane with -Z up
          />
        )}

        <Suspense fallback={null}>
          <FpsCheck />
          <PostProcessingStack />
          <Environment preset="studio" />
          
          {/* Lighting */}
          <ambientLight intensity={0.65} />
          <directionalLight
            position={[12, 20, 10]}
            intensity={1.2}
            castShadow
            shadow-mapSize={[2048, 2048]}
            shadow-camera-left={-12}
            shadow-camera-right={12}
            shadow-camera-top={12}
            shadow-camera-bottom={-12}
            shadow-camera-near={0.5}
            shadow-camera-far={50}
            shadow-bias={-0.0003}
          />
          <directionalLight position={[-12, 10, -10]} intensity={0.35} />

          {/* Infinite Snap Grid: 1.0m major lines, 0.1m minor lines */}
          <Grid
            position={[0, 0, 0]}
            infiniteGrid
            cellSize={0.1}
            cellThickness={0.6}
            cellColor="#2e3039"
            sectionSize={1.0}
            sectionThickness={1.2}
            sectionColor="#52525e"
            fadeDistance={50}
            fadeStrength={1.2}
          />

          {/* Blender X (Red) and Z (Blue) floor axis lines */}
          <BlenderAxisLines />

          {/* Ground click detector to clear selection on empty space & track cursor coordinates */}
          <mesh
            rotation={[-Math.PI / 2, 0, 0]}
            position={[0, -0.0001, 0]}
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
                  return;
                }

                if (toolMode === 'select') {
                  useSceneStore.getState().clearSelection();
                }
              }
            }}
            onContextMenu={(e) => {
              e.stopPropagation();
              window.dispatchEvent(new CustomEvent('canvas-context-menu', {
                detail: { x: e.clientX, y: e.clientY, targetType: 'floor' }
              }));
            }}
          >
            <planeGeometry args={[2000, 2000]} />
            <meshBasicMaterial visible={false} />
          </mesh>

          {/* 3D Room Shell (floor triangulation, wall cutouts, camera-facing fade, ceiling) */}
          <RoomShell />
          <PerformanceOverlay />

          {/* Soft contact shadows on the floor plane */}
          <ContactShadows
            position={[0, 0.001, 0]}
            opacity={0.65}
            scale={30}
            blur={1.8}
            far={3.5}
            resolution={512}
            color="#000000"
          />

          {/* Subtle ground-glow under selected objects */}
          <SelectedGroundGlow />

          {/* Animated drop ripple rings on object placement & snap settle */}
          <DropRipplesVisualizer />

          {/* Interactive Floor Plan Editor (drawing, vertex handles, midpoint splits, live dimensions) */}
          <FloorPlanEditor />

          {/* Placed Objects in the Room */}
          <PlacedObjects />

          {/* Interactive Scale Reference (1.7m human & 1.0m³ cube) */}
          <ScaleReference />

          {/* Interactive Selection & Transform Gizmo (Precision Mode) */}
          <SelectionGizmo />

          {/* Direct Object Manipulation (Direct Drag, Smart Snap, Alignment Guides, Rotation Handle) */}
          <DirectObjectManipulator />

          {/* Floating Opening Tagging Panel (Role buttons, open-fraction, dimensions) */}
          <OpeningTaggingPanel />

          {/* Interactive Placement Controller (Ghost preview, snapping, wall mounting) */}
          <PlacementController />

          {/* Pollutant Source 3D Visual Marker */}
          <PollutantSourceMarker />

          {/* HTML5 Drag & Drop Listener & Live Opening Preview */}
          <CanvasDropListener />
          <DraggedOpeningPreviewMesh />

          {/* Camera Controller & Keyboard Shortcuts */}
          <CameraController controlsRef={controlsRef} />

          {/* Blender-like OrbitControls */}
          <OrbitControls
            ref={controlsRef}
            makeDefault
            enabled={!isDragging}
            enableDamping
            dampingFactor={0.05}
            minDistance={0.5}
            maxDistance={120}
            minPolarAngle={0}
            maxPolarAngle={view === '2d' ? 0 : Math.PI / 2 - 0.01} // Clamped above floor plane in 3D
            enableRotate={view === '3d'} // Locked rotation in 2D mode
            mouseButtons={{
              LEFT: -1 as unknown as THREE.MOUSE, // Left click/drag reserved for object interaction
              MIDDLE: THREE.MOUSE.PAN, // Middle-drag pan
              RIGHT: THREE.MOUSE.ROTATE, // Right-drag orbit
            }}
          />

          {/* Voxel Domain Debug Visualizer (non-fluid InstancedMesh cubes) */}
          <VoxelDebugMesh />

          {/* Top-Right Axis Gizmo Viewport */}
          <GizmoHelper alignment="top-right" margin={[70, 70]}>
            <GizmoViewport
              axisColors={['#ef4444', '#22c55e', '#3b82f6']}
              labelColor="#ffffff"
              labels={['X', 'Y', 'Z']}
            />
          </GizmoHelper>
          <SceneExporter />
        </Suspense>
      </R3FCanvas>

      {/* Floating Voxel Debug Controls (Y-slice slider, opacity, solid toggle, legend) */}
      <VoxelDebugControls />
    </div>
  );
};

export default Canvas;
