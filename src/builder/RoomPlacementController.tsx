import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Html } from '@react-three/drei';
import { useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { ROOM_TYPES, rectOutline, roomOverlapsOthers, snapRoomMove } from '../core/rooms';
import { buildPresetObjects } from '../core/roomPresets';
import type { Vec2 } from '../core/schema';
import { snap } from '../core/units';
import { useSceneStore } from '../store/sceneStore';
import { useUiStore, type ViewMode } from '../store/uiStore';
import { setCanvasCursor, resetCanvasCursor } from '../core/cursor';

const noRaycast = () => null;

/**
 * "Add room" works like placing an asset: switches to the plan view, a ghost of the room follows the
 * cursor (snapped to the grid and flush against neighbours, red where it would overlap one),
 * R rotates it, a click places it and Esc cancels.
 */
export const RoomPlacementController: React.FC = () => {
  const toolMode = useUiStore((state) => state.toolMode);
  const pendingRoomType = useUiStore((state) => state.pendingRoomType);
  const furnish = useUiStore((state) => state.furnishNewRooms);
  const active = toolMode === 'room' && pendingRoomType !== null;
  const { camera, gl } = useThree();

  const [rotated, setRotated] = useState(false);
  const [ghost, setGhost] = useState<{ outline: Vec2[]; valid: boolean } | null>(null);
  const viewBefore = useRef<ViewMode | null>(null);
  const lastPoint = useRef<THREE.Vector3 | null>(null);
  const ghostRef = useRef<{ outline: Vec2[]; valid: boolean } | null>(null);
  const rotatedRef = useRef(false);
  rotatedRef.current = rotated;

  const size = useMemo<[number, number]>(() => {
    if (!pendingRoomType) return [0, 0];
    const [w, d] = ROOM_TYPES[pendingRoomType].size;
    return rotated ? [d, w] : [w, d];
  }, [pendingRoomType, rotated]);

  // Enter: plan view. Leave: restore the view and forget the pending room.
  useEffect(() => {
    const ui = useUiStore.getState();
    if (active && viewBefore.current === null) {
      useSceneStore.getState().clearSelection();
      viewBefore.current = ui.view;
      if (ui.view !== '2d') ui.setView('2d');
    } else if (!active && viewBefore.current !== null) {
      const previous = viewBefore.current;
      viewBefore.current = null;
      ghostRef.current = null;
      setGhost(null);
      setRotated(false);
      if (ui.pendingRoomType) ui.setPendingRoomType(null);
      if (ui.view !== previous) ui.setView(previous);
    }
  }, [active]);

  useEffect(() => {
    if (!active) return;
    const raycaster = new THREE.Raycaster();
    const ndc = new THREE.Vector2();
    const floor = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
    const hit = new THREE.Vector3();

    const update = (point: THREE.Vector3) => {
      const { room, otherRooms } = useSceneStore.getState();
      const all = [room, ...otherRooms];
      const { snapEnabled, gridStep } = useUiStore.getState();
      let minX = point.x - size[0] / 2;
      let minZ = point.z - size[1] / 2;
      if (snapEnabled) {
        minX = snap(minX, gridStep);
        minZ = snap(minZ, gridStep);
      }
      let outline = rectOutline(minX, minZ, size[0], size[1]);
      const [dx, dz] = snapRoomMove(outline, [0, 0], all, room.wallThickness);
      outline = outline.map(([x, z]) => [Number((x + dx).toFixed(4)), Number((z + dz).toFixed(4))] as Vec2);
      const next = { outline, valid: !roomOverlapsOthers(outline, all, room.wallThickness) };
      ghostRef.current = next;
      setGhost(next);
    };

    const floorPointAt = (e: PointerEvent) => {
      const rect = gl.domElement.getBoundingClientRect();
      ndc.set(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
      raycaster.setFromCamera(ndc, camera);
      return raycaster.ray.intersectPlane(floor, hit);
    };

    const onMove = (e: PointerEvent) => {
      const p = floorPointAt(e);
      if (!p) return;
      lastPoint.current = p.clone();
      update(p);
    };

    const onDown = (e: PointerEvent) => {
      if (e.button !== 0) return;
      const p = floorPointAt(e);
      if (!p) return;
      update(p);
      const g = ghostRef.current;
      if (g?.valid && pendingRoomType) {
        // Furnished preset for the room type (the basic room has none), turned with the room, unless
        // an empty room was asked for
        const objects = useUiStore.getState().furnishNewRooms ? buildPresetObjects(pendingRoomType, g.outline, rotatedRef.current) : [];
        useSceneStore.getState().addRoom(pendingRoomType, g.outline, objects);
        useUiStore.getState().setToolMode('select');
      } else if (g) {
        useUiStore.getState().setToastMessage('Rooms can’t overlap: move it to free space or against a wall');
      }
      // Don't let the placing click also select or activate what's underneath
      const swallow = (ev: MouseEvent) => ev.stopPropagation();
      window.addEventListener('click', swallow, { capture: true, once: true });
      setTimeout(() => window.removeEventListener('click', swallow, { capture: true }), 500);
    };

    const onKey = (e: KeyboardEvent) => {
      if ((e.key === 'r' || e.key === 'R') && !e.metaKey && !e.ctrlKey) {
        e.preventDefault();
        setRotated((r) => !r);
      }
    };

    if (lastPoint.current) update(lastPoint.current);
    setCanvasCursor('crosshair');
    gl.domElement.addEventListener('pointermove', onMove);
    gl.domElement.addEventListener('pointerdown', onDown);
    window.addEventListener('keydown', onKey);
    return () => {
      gl.domElement.removeEventListener('pointermove', onMove);
      gl.domElement.removeEventListener('pointerdown', onDown);
      window.removeEventListener('keydown', onKey);
      resetCanvasCursor();
    };
  }, [active, camera, gl, size, pendingRoomType]);

  const ghostGeometry = useMemo(() => {
    if (!ghost) return null;
    const shape = new THREE.Shape();
    ghost.outline.forEach(([x, z], i) => (i === 0 ? shape.moveTo(x, -z) : shape.lineTo(x, -z)));
    shape.closePath();
    const fill = new THREE.ShapeGeometry(shape);
    const border = new THREE.BufferGeometry().setFromPoints(
      [...ghost.outline, ghost.outline[0]!].map(([x, z]) => new THREE.Vector3(x, 0.03, z))
    );
    return { fill, border };
  }, [ghost]);

  useEffect(() => () => {
    ghostGeometry?.fill.dispose();
    ghostGeometry?.border.dispose();
  }, [ghostGeometry]);

  if (!active || !ghost || !ghostGeometry || !pendingRoomType) return null;
  const furniture = furnish ? buildPresetObjects(pendingRoomType, ghost.outline, rotated) : [];
  const color = ghost.valid ? '#6366f1' : '#ef4444';
  const xs = ghost.outline.map((p) => p[0]);
  const zs = ghost.outline.map((p) => p[1]);
  const center: [number, number, number] = [(Math.min(...xs) + Math.max(...xs)) / 2, 0.05, (Math.min(...zs) + Math.max(...zs)) / 2];

  return (
    <group name="room-placement-ghost">
      <mesh geometry={ghostGeometry.fill} rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.02, 0]} raycast={noRaycast}>
        <meshBasicMaterial color={color} transparent opacity={0.25} depthWrite={false} />
      </mesh>
      <lineLoop geometry={ghostGeometry.border} raycast={noRaycast}>
        <lineBasicMaterial color={color} />
      </lineLoop>
      {/* Footprints of the furniture that comes with this room */}
      {furniture.map((o) => (
        <mesh
          key={o.id}
          position={[o.position[0], 0.025 + (o.elevation ?? 0) * 0.001, o.position[2]]}
          rotation={[-Math.PI / 2, 0, o.rotation[1]]}
          raycast={noRaycast}
        >
          <planeGeometry args={[o.size[0], o.size[2]]} />
          <meshBasicMaterial color={color} transparent opacity={o.role === 'none' ? 0.15 : 0.45} depthWrite={false} />
        </mesh>
      ))}
      <Html center position={center} className="pointer-events-none select-none" zIndexRange={[30, 0]}>
        <div className={`whitespace-nowrap rounded-full px-2.5 py-1 text-[11px] font-semibold shadow ${ghost.valid ? 'bg-indigo-600 text-white' : 'bg-red-600 text-white'}`}>
          {ROOM_TYPES[pendingRoomType].label} · {size[0]} × {size[1]} m{ghost.valid ? '' : ' · overlaps'}
        </div>
      </Html>
    </group>
  );
};
