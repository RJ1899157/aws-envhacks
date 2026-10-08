import React, { Suspense, useCallback, useEffect, useMemo, useRef } from 'react';
import { Canvas as R3FCanvas, useFrame, useThree } from '@react-three/fiber';
import {
  GizmoHelper,
  GizmoViewport,
  Grid,
  OrbitControls,
  OrthographicCamera,
  PerspectiveCamera,
} from '@react-three/drei';
import * as THREE from 'three';
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib';
import { polygonBounds } from '../core/parser';
import { useSceneStore } from '../store/sceneStore';
import { useUiStore } from '../store/uiStore';
import { RoomShell } from './RoomShell';
import { FloorPlanEditor } from './FloorPlanEditor';
import { PlacedObjects } from './PlacedObjects';
import { PlacementController } from './PlacementController';
import { getCatalogAsset } from '../core/catalog';
import { wallSegment } from '../core/parser';
import { snap } from '../core/units';
import { SelectionGizmo } from './SelectionGizmo';
import { DirectObjectManipulator } from './DirectObjectManipulator';
import { OpeningTaggingPanel } from './OpeningTaggingPanel';
import { VoxelDebugMesh, VoxelDebugControls } from './VoxelDebug';
import { ScaleReference } from './ScaleReference';

/**
 * Shared OrbitControls ref accessible by tools, transform gizmos, and viewport managers
 */
export const sharedOrbitControlsRef = React.createRef<OrbitControlsImpl | null>();

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
    };

    const handleDrop = (e: DragEvent) => {
      e.preventDefault();

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
        let closestWallIndex = 0;
        let minDistance = Infinity;
        let bestT = 0;

        for (let i = 0; i < room.outline.length; i++) {
          const seg = wallSegment(room, i);
          const toCursorX = hit.x - seg.a[0];
          const toCursorZ = hit.z - seg.a[1];
          const t = toCursorX * seg.dir[0] + toCursorZ * seg.dir[1];
          const clampedT = Math.max(0, Math.min(seg.len, t));
          const projX = seg.a[0] + clampedT * seg.dir[0];
          const projZ = seg.a[1] + clampedT * seg.dir[1];
          const dist = Math.hypot(hit.x - projX, hit.z - projZ);

          if (dist < minDistance) {
            minDistance = dist;
            closestWallIndex = i;
            bestT = t;
          }
        }

        const seg = wallSegment(room, closestWallIndex);
        const w = catalogDef.size[0];
        const maxOffset = Math.max(0, seg.len - w);
        let offset = Math.max(0, Math.min(maxOffset, bestT - w / 2));
        if (snapEnabled) {
          offset = snap(offset, gridStep);
          offset = Math.max(0, Math.min(maxOffset, offset));
        }

        addOpening({
          id: `op-${Date.now().toString(36)}-${Math.random().toString(36).substring(2, 6)}`,
          wallIndex: closestWallIndex,
          type: catalogDef.id === 'door' ? 'door' : 'window',
          offset,
          width: catalogDef.size[0],
          height: catalogDef.size[1],
          sill: catalogDef.elevation,
          role: catalogDef.id === 'door' ? 'closed' : 'inlet',
          openFraction: 0,
        });
      } else {
        let x = hit.x;
        let z = hit.z;
        if (snapEnabled) {
          x = snap(x, gridStep);
          z = snap(z, gridStep);
        }

        addObject({
          id: `obj-${Date.now().toString(36)}-${Math.random().toString(36).substring(2, 6)}`,
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
      }

      setActiveAssetId(null);
      setToolMode('select');
    };

    dom.addEventListener('dragover', handleDragOver);
    dom.addEventListener('drop', handleDrop);

    return () => {
      dom.removeEventListener('dragover', handleDragOver);
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
  const { camera } = useThree();
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
  const animateTo = (pos: THREE.Vector3, target: THREE.Vector3) => {
    targetCamPos.current.copy(pos);
    targetLookAt.current.copy(target);
    isTransitioning.current = true;
  };

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

      // Numpad 7: Top View
      if (e.code === 'Numpad7' || e.key === '7') {
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

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [getRoomFraming, view]);

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
  }, [getRoomFraming, view]);

  // Per-frame smooth transition lerp
  useFrame((_, delta) => {
    if (isTransitioning.current) {
      const step = Math.min(delta * 9, 1);
      camera.position.lerp(targetCamPos.current, step);

      if (controlsRef.current) {
        controlsRef.current.target.lerp(targetLookAt.current, step);
        controlsRef.current.update();
      }

      const targetDist = controlsRef.current
        ? controlsRef.current.target.distanceTo(targetLookAt.current)
        : 0;

      if (camera.position.distanceTo(targetCamPos.current) < 0.02 && targetDist < 0.02) {
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
  const isCollisionWarning = useUiStore((state) => state.isCollisionWarning);

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

      {/* Real-time Collision Alert HUD */}
      {isCollisionWarning && (
        <div className="absolute top-16 left-1/2 -translate-x-1/2 z-30 px-4 py-2 bg-red-950/95 border border-red-500/80 rounded-lg shadow-2xl backdrop-blur-md flex items-center gap-2.5 text-xs font-semibold text-red-200 animate-bounce pointer-events-none">
          <svg
            className="w-4 h-4 text-red-400 shrink-0"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
            />
          </svg>
          <span>
            Collision detected! Object penetrates wall or overlaps solid asset. Reverts on release.
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
          >
            <planeGeometry args={[2000, 2000]} />
            <meshBasicMaterial visible={false} />
          </mesh>

          {/* 3D Room Shell (floor triangulation, wall cutouts, camera-facing fade, ceiling) */}
          <RoomShell />

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

          {/* HTML5 Drag & Drop Listener */}
          <CanvasDropListener />

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
        </Suspense>
      </R3FCanvas>

      {/* Floating Voxel Debug Controls (Y-slice slider, opacity, solid toggle, legend) */}
      <VoxelDebugControls />
    </div>
  );
};

export default Canvas;
