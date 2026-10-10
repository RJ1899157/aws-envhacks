import React, { useEffect, useState } from 'react';
import { useThree } from '@react-three/fiber';
import { Html } from '@react-three/drei';
import * as THREE from 'three';
import { pointInPolygon, polygonBounds } from '../core/parser';
import { divideRoom } from '../core/rooms';
import { useSceneStore } from '../store/sceneStore';
import { useUiStore } from '../store/uiStore';

const SNAP_M = 0.05;

/**
 * Dividing-wall tool: while active (uiStore.dividerAxis), a wall preview follows the cursor across the
 * active room (green where the room can be split, red where not); a click splits the room into two
 * rooms along it. R turns the wall 90°, Esc cancels.
 */
export const RoomDivider: React.FC = () => {
  const axis = useUiStore((s) => s.dividerAxis);
  const room = useSceneStore((s) => s.room);
  const { camera, gl } = useThree();
  const [at, setAt] = useState<number | null>(null);
  const [problem, setProblem] = useState<string | null>(null);

  useEffect(() => {
    if (!axis) return;
    const raycaster = new THREE.Raycaster();
    const ndc = new THREE.Vector2();
    const floor = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
    const hit = new THREE.Vector3();
    let current: number | null = null;
    const pointAt = (e: PointerEvent): THREE.Vector3 | null => {
      const rect = gl.domElement.getBoundingClientRect();
      ndc.set(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
      raycaster.setFromCamera(ndc, camera);
      return raycaster.ray.intersectPlane(floor, hit);
    };
    const move = (e: PointerEvent) => {
      const p = pointAt(e);
      const { room: r, otherRooms } = useSceneStore.getState();
      if (!p || !pointInPolygon([p.x, p.z], r.outline)) {
        current = null;
        setAt(null);
        return;
      }
      current = Math.round((axis === 'x' ? p.x : p.z) / SNAP_M) * SNAP_M;
      setAt(current);
      const res = divideRoom(r, axis, current, otherRooms);
      setProblem(res.ok ? null : res.reason);
    };
    const down = (e: PointerEvent) => {
      if (e.button !== 0 || current === null) return;
      const reason = useSceneStore.getState().divideRoom(axis, current);
      const ui = useUiStore.getState();
      if (reason) {
        ui.setToastMessage(reason);
        return;
      }
      ui.setDividerAxis(null);
      ui.setToastMessage('Room divided. Add a door on the new wall (Doors & windows) to connect the two parts.', true);
      // The click that split the room must not also select what's under it
      const swallow = (ev: MouseEvent) => ev.stopPropagation();
      window.addEventListener('click', swallow, { capture: true, once: true });
      window.setTimeout(() => window.removeEventListener('click', swallow, { capture: true }), 400);
    };
    const key = (e: KeyboardEvent) => {
      const ui = useUiStore.getState();
      if (e.key === 'Escape') ui.setDividerAxis(null);
      else if ((e.key === 'r' || e.key === 'R') && !e.metaKey && !e.ctrlKey) ui.setDividerAxis(axis === 'x' ? 'z' : 'x');
    };
    const canvas = gl.domElement;
    canvas.addEventListener('pointermove', move);
    canvas.addEventListener('pointerdown', down);
    window.addEventListener('keydown', key);
    canvas.style.cursor = 'crosshair';
    return () => {
      canvas.removeEventListener('pointermove', move);
      canvas.removeEventListener('pointerdown', down);
      window.removeEventListener('keydown', key);
      canvas.style.cursor = '';
    };
  }, [axis, camera, gl]);

  useEffect(() => {
    if (!axis) setAt(null);
  }, [axis]);

  if (!axis || at === null) return null;
  const b = polygonBounds(room.outline);
  const length = axis === 'x' ? b.depth : b.width;
  const mid = axis === 'x' ? [at, (b.min[1] + b.max[1]) / 2] : [(b.min[0] + b.max[0]) / 2, at];
  const size: [number, number, number] = axis === 'x' ? [room.wallThickness, room.wallHeight, length] : [length, room.wallHeight, room.wallThickness];
  const color = problem ? '#ef4444' : '#22c55e';
  return (
    <group position={[mid[0]!, room.wallHeight / 2, mid[1]!]} name="room-divider-preview">
      <mesh renderOrder={25} raycast={() => null}>
        <boxGeometry args={size} />
        <meshBasicMaterial color={color} transparent opacity={0.55} depthTest={false} depthWrite={false} toneMapped={false} />
      </mesh>
      <Html center position={[0, room.wallHeight / 2 + 0.35, 0]} className="pointer-events-none select-none">
        <div className="whitespace-nowrap rounded px-1.5 py-0.5 text-[11px] font-semibold" style={{ background: problem ? 'rgba(69,10,10,0.9)' : 'rgba(5,46,22,0.9)', color: problem ? '#fecaca' : '#bbf7d0' }}>
          {problem ?? 'Click to divide here'}
        </div>
      </Html>
    </group>
  );
};
