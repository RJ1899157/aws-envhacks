import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import type { ThreeEvent } from '@react-three/fiber';
import { Html } from '@react-three/drei';
import * as THREE from 'three';
import { useSceneStore } from '../store/sceneStore';
import { useUiStore } from '../store/uiStore';
import { computeSmartSnap, type AlignmentGuide } from '../core/smartSnap';
import { degToRad, radToDeg, snap } from '../core/units';
import type { SceneObject, Vec3 } from '../core/schema';
import { getObjectGroup } from './objectRegistry';
import { sharedOrbitControlsRef } from './Canvas';

// Module-level drag starter so PlacedObjects can trigger drag on pointer down
let globalStartDragHandler: ((objectId: string, event: ThreeEvent<PointerEvent>) => void) | null =
  null;

export function startDirectObjectDrag(objectId: string, event: ThreeEvent<PointerEvent>): void {
  if (globalStartDragHandler) {
    globalStartDragHandler(objectId, event);
  }
}

interface DragTargetState {
  objectId: string;
  startPos: Vec3;
  startElevation: number;
  startRotY: number;
  objectSize: Vec3; // [W, H, D]
  grabOffset: THREE.Vector3;
}

/**
 * Alignment Guides visualizer: renders thin cyan lines along snapped wall faces and object edges
 */
const AlignmentGuideLines: React.FC<{ guides: AlignmentGuide[] }> = ({ guides }) => {
  const lineObj = useMemo(() => {
    if (guides.length === 0) return null;
    const points: THREE.Vector3[] = [];
    for (const g of guides) {
      points.push(new THREE.Vector3(g.start[0], 0.006, g.start[2]));
      points.push(new THREE.Vector3(g.end[0], 0.006, g.end[2]));
    }
    const geom = new THREE.BufferGeometry().setFromPoints(points);
    const mat = new THREE.LineBasicMaterial({
      color: 0x06b6d4, // Vibrant cyan
      depthTest: false,
      transparent: true,
      opacity: 0.9,
    });
    return new THREE.LineSegments(geom, mat);
  }, [guides]);

  if (!lineObj) return null;
  return <primitive object={lineObj} />;
};

/**
 * Footprint Decal: renders a faint snapped cell footprint on the floor while dragging (neutral blue)
 */
const FootprintDecal: React.FC<{
  position: Vec3;
  rotationY: number;
  size: Vec3;
}> = ({ position, rotationY, size }) => {
  const [w, , d] = size;
  const color = '#38bdf8';
  const borderColor = '#0284c7';

  const edges = useMemo(() => {
    const hw = w / 2;
    const hd = d / 2;
    const pts = [
      new THREE.Vector3(-hw, 0.003, -hd),
      new THREE.Vector3(hw, 0.003, -hd),
      new THREE.Vector3(hw, 0.003, hd),
      new THREE.Vector3(-hw, 0.003, hd),
      new THREE.Vector3(-hw, 0.003, -hd),
    ];
    const geom = new THREE.BufferGeometry().setFromPoints(pts);
    const mat = new THREE.LineBasicMaterial({ color: borderColor, linewidth: 2 });
    return new THREE.Line(geom, mat);
  }, [w, d, borderColor]);

  return (
    <group position={[position[0], 0, position[2]]} rotation={[0, rotationY, 0]}>
      {/* Semi-transparent floor fill */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.002, 0]}>
        <planeGeometry args={[w, d]} />
        <meshBasicMaterial
          color={color}
          transparent
          opacity={0.3}
          polygonOffset
          polygonOffsetFactor={-1}
          polygonOffsetUnits={-1}
        />
      </mesh>
      {/* Crisp perimeter outline */}
      <primitive object={edges} />
    </group>
  );
};

/**
 * Floor Ring and Rotation Handle around the selected object
 */
const FloorRotationHandle: React.FC<{
  object: SceneObject;
  isTranslating: boolean;
}> = ({ object, isTranslating }) => {
  const { camera, gl } = useThree();
  const updateObject = useSceneStore((state) => state.updateObject);
  const setIsDragging = useSceneStore((state) => state.setIsDragging);

  const [isRotating, setIsRotating] = useState(false);
  const [liveAngleDeg, setLiveAngleDeg] = useState<number | null>(null);

  const [w, , d] = object.size;
  const sx = object.scale?.[0] ?? 1;
  const sz = object.scale?.[2] ?? 1;
  const scaledW = w * sx;
  const scaledD = d * sz;

  // Ring radius based on object base size
  const ringRadius = Math.max(Math.hypot(scaledW, scaledD) / 2 + 0.35, 0.7);

  const currentRotY = object.rotation?.[1] ?? 0;
  const elevation = object.elevation ?? 0;
  const objPos = object.position;

  // Handle pointer down on the rotation handle
  const handlePointerDown = useCallback(
    (e: ThreeEvent<PointerEvent>) => {
      if (e.button !== 0) return;
      e.stopPropagation();

      const group = getObjectGroup(object.id);
      if (!group) return;

      setIsRotating(true);
      setIsDragging(true);
      if (sharedOrbitControlsRef.current) {
        sharedOrbitControlsRef.current.enabled = false;
      }

      let currentAngle = group.rotation.y;
      setLiveAngleDeg(Math.round(((radToDeg(currentAngle) % 360) + 360) % 360));

      const floorPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
      const raycaster = new THREE.Raycaster();
      const hit = new THREE.Vector3();

      const onPointerMove = (evt: PointerEvent) => {
        const rect = gl.domElement.getBoundingClientRect();
        const ndcX = ((evt.clientX - rect.left) / rect.width) * 2 - 1;
        const ndcY = -(((evt.clientY - rect.top) / rect.height) * 2 - 1);

        raycaster.setFromCamera(new THREE.Vector2(ndcX, ndcY), camera);
        if (raycaster.ray.intersectPlane(floorPlane, hit)) {
          // Angle in XZ plane relative to object center
          const angle = Math.atan2(hit.x - objPos[0], hit.z - objPos[2]);
          currentAngle = angle;
          group.rotation.y = angle;

          const deg = Math.round(((radToDeg(angle) % 360) + 360) % 360);
          setLiveAngleDeg(deg);
        }
      };

      const onPointerUp = (evt: PointerEvent) => {
        window.removeEventListener('pointermove', onPointerMove);
        window.removeEventListener('pointerup', onPointerUp);

        // Snap to 15 degrees unless Shift is held
        let finalAngle = currentAngle;
        if (!evt.shiftKey) {
          finalAngle = snap(finalAngle, degToRad(15));
        }

        // Animate slight ease-out to final snapped angle (100 ms)
        const animStartAngle = group.rotation.y;
        const animTargetAngle = finalAngle;
        const startTime = performance.now();
        const duration = 120;

        const animateSnap = (now: number) => {
          const p = Math.min((now - startTime) / duration, 1);
          // Ease-out cubic
          const ease = 1 - Math.pow(1 - p, 3);
          group.rotation.y = THREE.MathUtils.lerp(animStartAngle, animTargetAngle, ease);

          if (p < 1) {
            requestAnimationFrame(animateSnap);
          } else {
            group.rotation.y = animTargetAngle;
            // Commit to store: single undo step!
            updateObject(object.id, {
              rotation: [0, Number(animTargetAngle.toFixed(4)), 0],
            });
            setIsRotating(false);
            setLiveAngleDeg(null);
            setIsDragging(false);
            if (sharedOrbitControlsRef.current) {
              sharedOrbitControlsRef.current.enabled = true;
            }
          }
        };

        requestAnimationFrame(animateSnap);
      };

      window.addEventListener('pointermove', onPointerMove);
      window.addEventListener('pointerup', onPointerUp);
    },
    [camera, gl.domElement, object.id, objPos, setIsDragging, updateObject]
  );

  if (isTranslating) return null;

  // Handle position on ring facing towards object front
  const handleX = ringRadius * Math.sin(currentRotY);
  const handleZ = ringRadius * Math.cos(currentRotY);

  return (
    <group position={[objPos[0], 0.004, objPos[2]]}>
      {/* Floor Circle Ring */}
      <mesh rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[ringRadius - 0.012, ringRadius + 0.012, 64]} />
        <meshBasicMaterial
          color="#38bdf8"
          transparent
          opacity={isRotating ? 0.8 : 0.45}
          side={THREE.DoubleSide}
        />
      </mesh>

      {/* Circular Rotation Handle on the ring */}
      <group position={[handleX, 0.008, handleZ]} onPointerDown={handlePointerDown}>
        <mesh rotation={[-Math.PI / 2, 0, 0]}>
          <circleGeometry args={[0.08, 32]} />
          <meshBasicMaterial color={isRotating ? '#0284c7' : '#38bdf8'} />
        </mesh>
        <mesh rotation={[-Math.PI / 2, 0, 0]}>
          <ringGeometry args={[0.075, 0.09, 32]} />
          <meshBasicMaterial color="#ffffff" />
        </mesh>

        {/* Small direction pointer */}
        <mesh position={[0, 0.005, 0.03]} rotation={[-Math.PI / 2, 0, 0]}>
          <coneGeometry args={[0.035, 0.07, 16]} />
          <meshBasicMaterial color="#ffffff" />
        </mesh>
      </group>

      {/* Live Angle Readout Badge */}
      {isRotating && liveAngleDeg !== null && (
        <Html
          center
          position={[0, elevation + scaledW * 0.5 + 0.3, 0]}
          className="pointer-events-none select-none"
        >
          <div className="px-2.5 py-1 rounded-md bg-neutral-900/95 border border-sky-400 text-sky-300 font-mono text-xs shadow-xl font-bold whitespace-nowrap">
            ↻ {liveAngleDeg}°
          </div>
        </Html>
      )}
    </group>
  );
};

/**
 * Direct Object Manipulator:
 * Provides direct manipulation dragging, smart snapping, alignment guides, vertical elevation lift,
 * footprint decals, spring ease-out release animation, and single undo step commits.
 */
export const DirectObjectManipulator: React.FC = () => {
  const { camera, gl } = useThree();

  // Stores
  const room = useSceneStore((state) => state.room);
  const selectedObjectId = useSceneStore((state) => state.selectedObjectId);
  const selectedObjectIds = useSceneStore((state) => state.selectedObjectIds);
  const selectObject = useSceneStore((state) => state.selectObject);
  const updateObject = useSceneStore((state) => state.updateObject);
  const setIsDragging = useSceneStore((state) => state.setIsDragging);

  const toolMode = useUiStore((state) => state.toolMode);
  const snapEnabled = useUiStore((state) => state.snapEnabled);
  const gridStep = useUiStore((state) => state.gridStep);
  const autoOrientToWall = useUiStore((state) => state.autoOrientToWall);

  // Active Drag State Refs
  const isDraggingRef = useRef<boolean>(false);
  const dragTargetRef = useRef<DragTargetState | null>(null);
  const secondaryObjectsRef = useRef<
    Array<{ id: string; startPos: Vec3; startElevation: number; startRotY: number }>
  >([]);

  // Smooth position tracking
  const currentFreePos = useRef<THREE.Vector3>(new THREE.Vector3());
  const targetFreePos = useRef<THREE.Vector3>(new THREE.Vector3());
  const currentRotY = useRef<number>(0);

  // Snapped target computed by smart snap engine
  const snappedTargetRef = useRef<{
    pos: Vec3;
    rotY: number;
    guides: AlignmentGuide[];
  }>({
    pos: [0, 0, 0],
    rotY: 0,
    guides: [],
  });

  // UI state for reactive overlay rendering
  const [activeDecal, setActiveDecal] = useState<{
    position: Vec3;
    rotationY: number;
    size: Vec3;
  } | null>(null);

  const [activeGuides, setActiveGuides] = useState<AlignmentGuide[]>([]);

  // Release animation state
  const isAnimatingRelease = useRef<boolean>(false);
  const animStartTime = useRef<number>(0);
  const animStartPos = useRef<THREE.Vector3>(new THREE.Vector3());
  const animTargetPos = useRef<THREE.Vector3>(new THREE.Vector3());
  const animStartRotY = useRef<number>(0);
  const animTargetRotY = useRef<number>(0);

  // Key tracking for Q (Lift)
  const isQLiftActive = useRef<boolean>(false);

  // Find primary selected object
  const primarySelectedObject = useMemo(() => {
    const id = selectedObjectId ?? selectedObjectIds[0];
    if (!id) return null;
    return room.objects.find((o) => o.id === id) ?? null;
  }, [room.objects, selectedObjectId, selectedObjectIds]);

  // Start direct drag interaction
  const handleStartDrag = useCallback(
    (objectId: string, e: ThreeEvent<PointerEvent>) => {
      if (toolMode !== 'select' || e.button !== 0) return;
      if (isAnimatingRelease.current) return;

      const obj = room.objects.find((o) => o.id === objectId);
      if (!obj) return;

      const isAlreadySelected =
        selectedObjectIds.includes(objectId) || selectedObjectId === objectId;
      if (!isAlreadySelected) {
        selectObject(objectId, e.shiftKey);
      }

      const group = getObjectGroup(objectId);
      if (!group) return;

      const elev = obj.elevation ?? 0;
      const floorPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -elev);
      const hit = new THREE.Vector3();

      // Pointer ray intersection with plane at object elevation
      if (!e.ray.intersectPlane(floorPlane, hit)) {
        hit.set(obj.position[0], elev, obj.position[2]);
      }

      // Maintain grab offset so object never jumps to cursor
      const grabOffset = new THREE.Vector3(obj.position[0] - hit.x, 0, obj.position[2] - hit.z);

      const [w, h, d] = obj.size;
      const sx = obj.scale?.[0] ?? 1;
      const sy = obj.scale?.[1] ?? 1;
      const sz = obj.scale?.[2] ?? 1;
      const scaledSize: Vec3 = [w * sx, h * sy, d * sz];

      dragTargetRef.current = {
        objectId,
        startPos: [...obj.position] as Vec3,
        startElevation: elev,
        startRotY: obj.rotation?.[1] ?? 0,
        objectSize: scaledSize,
        grabOffset,
      };

      // Also track any other selected objects for multi-object moving
      const otherSelected = room.objects.filter(
        (o) => (selectedObjectIds.includes(o.id) || selectedObjectId === o.id) && o.id !== objectId
      );
      secondaryObjectsRef.current = otherSelected.map((o) => ({
        id: o.id,
        startPos: [...o.position] as Vec3,
        startElevation: o.elevation ?? 0,
        startRotY: o.rotation?.[1] ?? 0,
      }));

      currentFreePos.current.set(obj.position[0], elev, obj.position[2]);
      targetFreePos.current.copy(currentFreePos.current);
      currentRotY.current = obj.rotation?.[1] ?? 0;

      snappedTargetRef.current = {
        pos: [obj.position[0], elev, obj.position[2]],
        rotY: currentRotY.current,
        guides: [],
      };

      isDraggingRef.current = true;
      setIsDragging(true);

      // Disable OrbitControls during direct drag
      if (sharedOrbitControlsRef.current) {
        sharedOrbitControlsRef.current.enabled = false;
      }

      let hasMoved = false;
      const startClientX = e.clientX;
      const startClientY = e.clientY;

      // Pointer Move Handler
      const onPointerMove = (evt: PointerEvent) => {
        if (!dragTargetRef.current) return;

        if (!hasMoved) {
          const dist = Math.hypot(evt.clientX - startClientX, evt.clientY - startClientY);
          if (dist > 3) hasMoved = true;
        }

        const rect = gl.domElement.getBoundingClientRect();
        const ndcX = ((evt.clientX - rect.left) / rect.width) * 2 - 1;
        const ndcY = -(((evt.clientY - rect.top) / rect.height) * 2 - 1);

        const raycaster = new THREE.Raycaster();
        raycaster.setFromCamera(new THREE.Vector2(ndcX, ndcY), camera);

        const isLift = evt.altKey || isQLiftActive.current;

        if (isLift) {
          // Vertical movement along Y: raycast onto camera-facing vertical plane passing through object
          const camDir = camera.getWorldDirection(new THREE.Vector3());
          camDir.y = 0;
          camDir.normalize();

          const vPlane = new THREE.Plane().setFromNormalAndCoplanarPoint(
            camDir,
            currentFreePos.current
          );
          const vHit = new THREE.Vector3();
          if (raycaster.ray.intersectPlane(vPlane, vHit)) {
            const rawY = Math.max(0, Math.min(room.wallHeight, vHit.y));
            targetFreePos.current.y = rawY;
          }
        } else {
          // Horizontal movement along XZ plane at current elevation
          const hPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -targetFreePos.current.y);
          const hHit = new THREE.Vector3();
          if (raycaster.ray.intersectPlane(hPlane, hHit)) {
            targetFreePos.current.x = hHit.x + dragTargetRef.current.grabOffset.x;
            targetFreePos.current.z = hHit.z + dragTargetRef.current.grabOffset.z;
          }
        }

        // Run smart snapping calculation
        const candidate: Vec3 = [
          targetFreePos.current.x,
          targetFreePos.current.y,
          targetFreePos.current.z,
        ];

        const snapRes = computeSmartSnap({
          candidatePos: candidate,
          candidateRotY: currentRotY.current,
          objectSize: dragTargetRef.current.objectSize,
          startPos: dragTargetRef.current.startPos,
          room,
          objectId: dragTargetRef.current.objectId,
          gridStep,
          snapEnabled,
          ctrlKey: evt.ctrlKey,
          shiftKey: evt.shiftKey,
          autoOrientToWall,
          transformY: isLift,
        });

        snappedTargetRef.current = {
          pos: snapRes.snappedPos,
          rotY: snapRes.snappedRotY,
          guides: snapRes.alignmentGuides,
        };

        setActiveGuides(snapRes.alignmentGuides);
        setActiveDecal({
          position: snapRes.snappedPos,
          rotationY: snapRes.snappedRotY,
          size: dragTargetRef.current.objectSize,
        });
      };

      // Mouse Wheel for mid-drag 15 degree rotation
      const onWheel = (evt: WheelEvent) => {
        evt.preventDefault();
        const dir = Math.sign(evt.deltaY) > 0 ? -1 : 1;
        currentRotY.current += dir * degToRad(15);

        if (dragTargetRef.current) {
          const snapRes = computeSmartSnap({
            candidatePos: [
              targetFreePos.current.x,
              targetFreePos.current.y,
              targetFreePos.current.z,
            ],
            candidateRotY: currentRotY.current,
            objectSize: dragTargetRef.current.objectSize,
            startPos: dragTargetRef.current.startPos,
            room,
            objectId: dragTargetRef.current.objectId,
            gridStep,
            snapEnabled,
            autoOrientToWall,
          });

          snappedTargetRef.current.pos = snapRes.snappedPos;
          snappedTargetRef.current.rotY = snapRes.snappedRotY;
          setActiveDecal((prev) => (prev ? { ...prev, rotationY: snapRes.snappedRotY } : null));
        }
      };

      // Key Listeners: R to rotate 15°, Q to toggle vertical lift
      const onKeyDown = (evt: KeyboardEvent) => {
        if (evt.key === 'r' || evt.key === 'R') {
          evt.preventDefault();
          currentRotY.current += degToRad(15);
          if (dragTargetRef.current) {
            const snapRes = computeSmartSnap({
              candidatePos: [
                targetFreePos.current.x,
                targetFreePos.current.y,
                targetFreePos.current.z,
              ],
              candidateRotY: currentRotY.current,
              objectSize: dragTargetRef.current.objectSize,
              startPos: dragTargetRef.current.startPos,
              room,
              objectId: dragTargetRef.current.objectId,
              gridStep,
              snapEnabled,
              autoOrientToWall,
            });
            snappedTargetRef.current.pos = snapRes.snappedPos;
            snappedTargetRef.current.rotY = snapRes.snappedRotY;
            setActiveDecal((prev) => (prev ? { ...prev, rotationY: snapRes.snappedRotY } : null));
          }
        } else if (evt.key === 'q' || evt.key === 'Q') {
          isQLiftActive.current = true;
        }
      };

      const onKeyUp = (evt: KeyboardEvent) => {
        if (evt.key === 'q' || evt.key === 'Q') {
          isQLiftActive.current = false;
        }
      };

      // Pointer Up Handler: spring ease-out release animation and store commit
      const onPointerUp = () => {
        window.removeEventListener('pointermove', onPointerMove);
        window.removeEventListener('pointerup', onPointerUp);
        window.removeEventListener('wheel', onWheel);
        window.removeEventListener('keydown', onKeyDown);
        window.removeEventListener('keyup', onKeyUp);
        isQLiftActive.current = false;

        if (!hasMoved) {
          // Just clicked without moving: cancel drag session
          isDraggingRef.current = false;
          dragTargetRef.current = null;
          setActiveDecal(null);
          setActiveGuides([]);
          setIsDragging(false);
          if (sharedOrbitControlsRef.current) {
            sharedOrbitControlsRef.current.enabled = true;
          }
          return;
        }

        // Start 150 ms spring ease-out release animation to snapped target
        isAnimatingRelease.current = true;
        animStartTime.current = performance.now();
        animStartPos.current.copy(currentFreePos.current);
        animTargetPos.current.set(
          snappedTargetRef.current.pos[0],
          snappedTargetRef.current.pos[1],
          snappedTargetRef.current.pos[2]
        );
        animStartRotY.current = currentRotY.current;
        animTargetRotY.current = snappedTargetRef.current.rotY;

        // Decal stays visible during animation, guides fade
        setActiveGuides([]);
      };

      window.addEventListener('pointermove', onPointerMove, { passive: false });
      window.addEventListener('pointerup', onPointerUp);
      window.addEventListener('wheel', onWheel, { passive: false });
      window.addEventListener('keydown', onKeyDown);
      window.addEventListener('keyup', onKeyUp);
    },
    [
      camera,
      gl.domElement,
      gridStep,
      room,
      selectedObjectId,
      selectedObjectIds,
      selectObject,
      setIsDragging,
      snapEnabled,
      toolMode,
      autoOrientToWall,
    ]
  );

  // Register global start drag handler for PlacedObjects
  useEffect(() => {
    globalStartDragHandler = handleStartDrag;
    return () => {
      globalStartDragHandler = null;
    };
  }, [handleStartDrag]);

  // Per-frame 60 FPS animation loop (Direct Three.js transforms with zero React overhead)
  useFrame(() => {
    // 1. While actively dragging: smoothly glide mesh towards cursor
    if (isDraggingRef.current && dragTargetRef.current && !isAnimatingRelease.current) {
      const group = getObjectGroup(dragTargetRef.current.objectId);
      if (group) {
        // Smooth interpolation factor
        currentFreePos.current.x = THREE.MathUtils.lerp(
          currentFreePos.current.x,
          targetFreePos.current.x,
          0.4
        );
        currentFreePos.current.y = THREE.MathUtils.lerp(
          currentFreePos.current.y,
          targetFreePos.current.y,
          0.4
        );
        currentFreePos.current.z = THREE.MathUtils.lerp(
          currentFreePos.current.z,
          targetFreePos.current.z,
          0.4
        );

        group.position.set(
          currentFreePos.current.x,
          currentFreePos.current.y,
          currentFreePos.current.z
        );
        group.rotation.y = currentRotY.current;

        // Apply delta to any secondary selected objects
        const deltaX = currentFreePos.current.x - dragTargetRef.current.startPos[0];
        const deltaY = currentFreePos.current.y - dragTargetRef.current.startElevation;
        const deltaZ = currentFreePos.current.z - dragTargetRef.current.startPos[2];

        for (const sec of secondaryObjectsRef.current) {
          const secGroup = getObjectGroup(sec.id);
          if (secGroup) {
            secGroup.position.set(
              sec.startPos[0] + deltaX,
              sec.startElevation + deltaY,
              sec.startPos[2] + deltaZ
            );
          }
        }
      }
    }

    // 2. Release Animation (150 ms ease-out with slight overshoot spring)
    if (isAnimatingRelease.current && dragTargetRef.current) {
      const now = performance.now();
      const duration = 160; // 160 ms
      const p = Math.min((now - animStartTime.current) / duration, 1);

      const group = getObjectGroup(dragTargetRef.current.objectId);

      if (p < 1) {
        // Slight overshoot spring curve
        const s = 1.35;
        const t = p - 1;
        const ease = 1 + (s + 1) * Math.pow(t, 3) + s * Math.pow(t, 2);

        if (group) {
          group.position.x = THREE.MathUtils.lerp(
            animStartPos.current.x,
            animTargetPos.current.x,
            ease
          );
          group.position.y = THREE.MathUtils.lerp(
            animStartPos.current.y,
            animTargetPos.current.y,
            ease
          );
          group.position.z = THREE.MathUtils.lerp(
            animStartPos.current.z,
            animTargetPos.current.z,
            ease
          );
          group.rotation.y = THREE.MathUtils.lerp(
            animStartRotY.current,
            animTargetRotY.current,
            ease
          );
        }

        const deltaX = (animTargetPos.current.x - dragTargetRef.current.startPos[0]) * ease;
        const deltaY = (animTargetPos.current.y - dragTargetRef.current.startElevation) * ease;
        const deltaZ = (animTargetPos.current.z - dragTargetRef.current.startPos[2]) * ease;

        for (const sec of secondaryObjectsRef.current) {
          const secGroup = getObjectGroup(sec.id);
          if (secGroup) {
            secGroup.position.set(
              sec.startPos[0] + deltaX,
              sec.startElevation + deltaY,
              sec.startPos[2] + deltaZ
            );
          }
        }
      } else {
        // Animation complete!
        isAnimatingRelease.current = false;
        isDraggingRef.current = false;

        const target = dragTargetRef.current;
        const finalPos = animTargetPos.current;
        const finalRotY = animTargetRotY.current;

        // Commit single undo step to Zustand store!
        updateObject(target.objectId, {
          position: [Number(finalPos.x.toFixed(4)), 0, Number(finalPos.z.toFixed(4))],
          elevation: Number(finalPos.y.toFixed(4)),
          rotation: [0, Number(finalRotY.toFixed(4)), 0],
        });

        // Also commit any secondary objects
        const deltaX = finalPos.x - target.startPos[0];
        const deltaY = finalPos.y - target.startElevation;
        const deltaZ = finalPos.z - target.startPos[2];

        for (const sec of secondaryObjectsRef.current) {
          updateObject(sec.id, {
            position: [
              Number((sec.startPos[0] + deltaX).toFixed(4)),
              0,
              Number((sec.startPos[2] + deltaZ).toFixed(4)),
            ],
            elevation: Number((sec.startElevation + deltaY).toFixed(4)),
          });
        }

        // Clean up session
        dragTargetRef.current = null;
        secondaryObjectsRef.current = [];
        setActiveDecal(null);
        setActiveGuides([]);
        setIsDragging(false);

        if (sharedOrbitControlsRef.current) {
          sharedOrbitControlsRef.current.enabled = true;
        }
      }
    }
  });

  return (
    <group name="direct-object-manipulator">
      {/* 1. Alignment Guide Lines (Cyan) */}
      <AlignmentGuideLines guides={activeGuides} />

      {/* 2. Snapped Footprint Decal on the Floor */}
      {activeDecal && (
        <FootprintDecal
          position={activeDecal.position}
          rotationY={activeDecal.rotationY}
          size={activeDecal.size}
        />
      )}

      {/* 3. Floor Ring & Circular Rotation Handle for Selected Object */}
      {primarySelectedObject && (
        <FloorRotationHandle object={primarySelectedObject} isTranslating={isDraggingRef.current} />
      )}
    </group>
  );
};

export default DirectObjectManipulator;
