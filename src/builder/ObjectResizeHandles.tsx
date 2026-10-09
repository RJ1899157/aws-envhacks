import React, { useMemo, useState } from 'react';
import { Html } from '@react-three/drei';
import { useThree, type ThreeEvent } from '@react-three/fiber';
import * as THREE from 'three';
import { computeSmartSnap } from '../core/smartSnap';
import { snap } from '../core/units';
import type { SceneObject, Vec3 } from '../core/schema';
import { useSceneStore } from '../store/sceneStore';
import { useUiStore } from '../store/uiStore';
import { useCameraStore } from '../store/cameraStore';
import { setCanvasCursor, resetCanvasCursor, type CursorType } from '../core/cursor';
import { sharedOrbitControlsRef } from './Canvas';

const MIN_SIZE = 0.1;
const HANDLE_GAP = 0.14;
const noRaycast = () => null;

type HandleKey = '+x' | '-x' | '+z' | '-z' | 'top';
const SIDE_HANDLES: { key: HandleKey; local: [number, number]; axis: 0 | 2; label: string }[] = [
  { key: '+x', local: [1, 0], axis: 0, label: 'W' },
  { key: '-x', local: [-1, 0], axis: 0, label: 'W' },
  { key: '+z', local: [0, 1], axis: 2, label: 'D' },
  { key: '-z', local: [0, -1], axis: 2, label: 'D' },
];

/** Local (x, z) direction rotated by rotY into world XZ (three.js Y-rotation) */
function toWorld([lx, lz]: [number, number], rotY: number): [number, number] {
  const c = Math.cos(rotY);
  const s = Math.sin(rotY);
  return [lx * c + lz * s, -lx * s + lz * c];
}

function scaledSize(o: SceneObject): Vec3 {
  return [o.size[0] * (o.scale?.[0] ?? 1), o.size[1] * (o.scale?.[1] ?? 1), o.size[2] * (o.scale?.[2] ?? 1)];
}

/** True if the footprint fits inside the room as-is (containment wouldn't move it) */
function fitsInRoom(position: Vec3, rotY: number, size: Vec3): boolean {
  const room = useSceneStore.getState().room;
  const { snappedPos } = computeSmartSnap({
    candidatePos: position,
    candidateRotY: rotY,
    objectSize: size,
    startPos: position,
    room,
    gridStep: 0.1,
    snapEnabled: true,
    ctrlKey: true,
  });
  return Math.abs(snappedPos[0] - position[0]) < 1e-4 && Math.abs(snappedPos[2] - position[2]) < 1e-4;
}

const Arrows: React.FC<{ size: number }> = ({ size }) => (
  <>
    <mesh position={[size * 0.42, size * 0.18, 0]} rotation={[0, 0, -Math.PI / 2]} raycast={noRaycast}>
      <coneGeometry args={[size * 0.17, size * 0.28, 3]} />
      <meshBasicMaterial color="#ffffff" />
    </mesh>
    <mesh position={[-size * 0.42, size * 0.18, 0]} rotation={[0, 0, Math.PI / 2]} raycast={noRaycast}>
      <coneGeometry args={[size * 0.17, size * 0.28, 3]} />
      <meshBasicMaterial color="#ffffff" />
    </mesh>
  </>
);

/**
 * Stretch handles on the selected object, like the room's wall handles: dragging a side moves only
 * that side (the opposite side stays put), and the top handle changes the height. Sizes snap to the
 * grid and the object can't be stretched through a wall.
 */
export const ObjectResizeHandles: React.FC = () => {
  const selectedObjectIds = useSceneStore((state) => state.selectedObjectIds);
  const selectedObjectId = useSceneStore((state) => state.selectedObjectId);
  const objects = useSceneStore((state) => state.room.objects);
  const toolMode = useUiStore((state) => state.toolMode);
  const view = useUiStore((state) => state.view);
  const isWalkthroughActive = useCameraStore((state) => state.isWalkthroughActive);
  const { camera, gl } = useThree();

  const [hovered, setHovered] = useState<HandleKey | null>(null);
  const [dragging, setDragging] = useState<HandleKey | null>(null);

  const id = selectedObjectIds.length === 1 ? selectedObjectIds[0] : selectedObjectIds.length === 0 ? selectedObjectId : null;
  const object = useMemo(() => objects.find((o) => o.id === id) ?? null, [objects, id]);

  if (!object || object.isLocked || toolMode !== 'select' || isWalkthroughActive || object.wallMounted) return null;

  const rotY = object.rotation?.[1] ?? 0;
  const size = scaledSize(object);
  const [px, , pz] = object.position;
  const elevation = object.elevation ?? 0;
  const handleY = elevation + Math.max(size[1] / 2, 0.15);
  const handleSize = THREE.MathUtils.clamp(Math.min(size[0], size[2]) * 0.35, 0.12, 0.24);

  const startDrag = (key: HandleKey, e: ThreeEvent<PointerEvent>) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    const store = useSceneStore.getState();
    store.setIsDragging(true);
    if (sharedOrbitControlsRef.current) sharedOrbitControlsRef.current.enabled = false;
    setDragging(key);

    const start = { size: scaledSize(object), position: [...object.position] as Vec3 };
    const scale: Vec3 = [object.scale?.[0] ?? 1, object.scale?.[1] ?? 1, object.scale?.[2] ?? 1];
    const raycaster = new THREE.Raycaster();
    const ndc = new THREE.Vector2();
    const hit = new THREE.Vector3();

    // Sides drag on a horizontal plane at handle height; the top handle on a vertical, camera-facing plane
    const side = SIDE_HANDLES.find((h) => h.key === key);
    const plane =
      key === 'top'
        ? (() => {
            const n = new THREE.Vector3();
            camera.getWorldDirection(n);
            n.y = 0;
            if (n.lengthSq() < 1e-6) n.set(0, 0, 1);
            return new THREE.Plane().setFromNormalAndCoplanarPoint(n.normalize(), e.point.clone());
          })()
        : new THREE.Plane(new THREE.Vector3(0, 1, 0), -handleY);

    const pointOn = (evt: PointerEvent): THREE.Vector3 | null => {
      const rect = gl.domElement.getBoundingClientRect();
      ndc.set(((evt.clientX - rect.left) / rect.width) * 2 - 1, -((evt.clientY - rect.top) / rect.height) * 2 + 1);
      raycaster.setFromCamera(ndc, camera);
      return raycaster.ray.intersectPlane(plane, hit)?.clone() ?? null;
    };
    const origin = pointOn(e.nativeEvent) ?? e.point.clone();

    const onMove = (evt: PointerEvent) => {
      const p = pointOn(evt);
      if (!p) return;
      const { snapEnabled, gridStep } = useUiStore.getState();
      const doSnap = snapEnabled && !evt.ctrlKey;

      if (key === 'top') {
        const room = useSceneStore.getState().room;
        let h = start.size[1] + (p.y - origin.y);
        if (doSnap) h = snap(h, gridStep);
        h = THREE.MathUtils.clamp(h, MIN_SIZE, Math.max(MIN_SIZE, room.wallHeight - elevation));
        const next: Vec3 = [object.size[0], h / scale[1], object.size[2]];
        useSceneStore.getState().updateObject(object.id, { size: next });
        return;
      }
      if (!side) return;

      const dir = toWorld(side.local, rotY);
      const startLen = start.size[side.axis];
      const raw = (p.x - origin.x) * dir[0] + (p.z - origin.z) * dir[1];
      let len = Math.max(MIN_SIZE, startLen + raw);
      if (doSnap) len = Math.max(MIN_SIZE, snap(len, gridStep));

      // Grow toward the dragged side only: shift the centre by half the change
      const sized = (l: number) => {
        const delta = l - startLen;
        const s: Vec3 = [...start.size];
        s[side.axis] = l;
        const pos: Vec3 = [start.position[0] + (dir[0] * delta) / 2, start.position[1], start.position[2] + (dir[1] * delta) / 2];
        return { s, pos };
      };

      // Never stretch through a wall: back off to the largest length that still fits
      let { s, pos } = sized(len);
      if (len > startLen && !fitsInRoom(pos, rotY, s)) {
        let lo = startLen;
        let hi = len;
        for (let i = 0; i < 20; i++) {
          const mid = (lo + hi) / 2;
          const c = sized(mid);
          if (fitsInRoom(c.pos, rotY, c.s)) lo = mid;
          else hi = mid;
        }
        ({ s, pos } = sized(lo));
      }

      useSceneStore.getState().updateObject(object.id, {
        size: [s[0] / scale[0], s[1] / scale[1], s[2] / scale[2]],
        position: [Number(pos[0].toFixed(4)), pos[1], Number(pos[2].toFixed(4))],
      });
    };

    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      useSceneStore.getState().setIsDragging(false);
      if (sharedOrbitControlsRef.current) sharedOrbitControlsRef.current.enabled = true;
      setDragging(null);
      resetCanvasCursor();
    };

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };

  const hoverProps = (key: HandleKey, cursor: CursorType) => ({
    onPointerOver: (e: ThreeEvent<PointerEvent>) => {
      e.stopPropagation();
      setHovered(key);
      setCanvasCursor(cursor);
    },
    onPointerOut: () => {
      setHovered(null);
      if (!dragging) resetCanvasCursor();
    },
    onPointerDown: (e: ThreeEvent<PointerEvent>) => startDrag(key, e),
  });

  const colorFor = (key: HandleKey) => (dragging === key ? '#10b981' : hovered === key ? '#818cf8' : '#6366f1');

  return (
    <group name="object-resize-handles">
      {SIDE_HANDLES.map((h) => {
        const dir = toWorld(h.local, rotY);
        const half = size[h.axis] / 2;
        const x = px + dir[0] * (half + HANDLE_GAP);
        const z = pz + dir[1] * (half + HANDLE_GAP);
        const handleRot = Math.atan2(-dir[1], dir[0]);
        const active = dragging === h.key || hovered === h.key;
        return (
          <group key={h.key} position={[x, handleY, z]} rotation={[0, handleRot, 0]}>
            <mesh {...hoverProps(h.key, Math.abs(dir[0]) > Math.abs(dir[1]) ? 'ew-resize' : 'ns-resize')}>
              <boxGeometry args={[handleSize, handleSize * 0.25, handleSize * 0.65]} />
              <meshBasicMaterial color={colorFor(h.key)} />
            </mesh>
            <Arrows size={handleSize} />
            {active && (
              <Html center position={[0, handleSize * 1.4, 0]} className="pointer-events-none select-none" zIndexRange={[30, 0]}>
                <div className="whitespace-nowrap rounded bg-neutral-950/90 px-1.5 py-0.5 font-mono text-[11px] font-semibold text-emerald-300 shadow">
                  {dragging === h.key ? `${h.label} ${size[h.axis].toFixed(2)} m` : 'Drag to resize'}
                </div>
              </Html>
            )}
          </group>
        );
      })}

      {view === '3d' && (
        <group position={[px, elevation + size[1] + HANDLE_GAP, pz]} rotation={[0, 0, Math.PI / 2]}>
          <mesh {...hoverProps('top', 'ns-resize')}>
            <boxGeometry args={[handleSize, handleSize * 0.25, handleSize * 0.65]} />
            <meshBasicMaterial color={colorFor('top')} />
          </mesh>
          <Arrows size={handleSize} />
          {(dragging === 'top' || hovered === 'top') && (
            <Html center position={[handleSize * 1.4, 0, 0]} className="pointer-events-none select-none" zIndexRange={[30, 0]}>
              <div className="whitespace-nowrap rounded bg-neutral-950/90 px-1.5 py-0.5 font-mono text-[11px] font-semibold text-emerald-300 shadow">
                {dragging === 'top' ? `H ${size[1].toFixed(2)} m` : 'Drag to resize'}
              </div>
            </Html>
          )}
        </group>
      )}
    </group>
  );
};
