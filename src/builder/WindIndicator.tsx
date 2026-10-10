import React, { useMemo } from 'react';
import { Html } from '@react-three/drei';
import { polygonBounds } from '../core/parser';
import { bearingToXZ, compassPoint, NORTH_XZ, windFlowXZ } from '../core/wind';
import { useSceneStore } from '../store/sceneStore';
import { useUiStore } from '../store/uiStore';

const ARROW_COLOR = '#38bdf8';
const NORTH_COLOR = '#6366f1';

/**
 * Ground-level wind arrow on the upwind side of the active room, pointing the way the air moves,
 * plus a north marker. Shown while the Airflow tab is open so the compass setting is visible in the
 * scene (convention: src/core/wind.ts).
 */
export const WindIndicator: React.FC = () => {
  const show = useUiStore((s) => s.showWindIndicator);
  const room = useSceneStore((s) => s.room);
  const { windDirDeg, windSpeed } = room.params;

  const layout = useMemo(() => {
    const b = polygonBounds(room.outline);
    const cx = (b.min[0] + b.max[0]) / 2;
    const cz = (b.min[1] + b.max[1]) / 2;
    // How far the room extends from its centre in a direction (to the outermost vertex)
    const reach = (d: readonly [number, number]) =>
      Math.max(...room.outline.map(([x, z]) => (x - cx) * d[0] + (z - cz) * d[1]));
    const from = bearingToXZ(windDirDeg);
    const flow = windFlowXZ(windDirDeg);
    // Arrow lies just outside the upwind side of the room and points at it
    const length = Math.min(2, 0.9 + windSpeed * 0.2);
    const gap = reach(from) + 0.5;
    const tail: [number, number] = [cx + from[0] * (gap + length), cz + from[1] * (gap + length)];
    const mid: [number, number] = [tail[0] + (flow[0] * length) / 2, tail[1] + (flow[1] * length) / 2];
    // Rotation about Y that turns local +X into the flow direction
    const yaw = Math.atan2(-flow[1], flow[0]);
    const northReach = reach(NORTH_XZ) + 0.5;
    const north: [number, number] = [cx + NORTH_XZ[0] * northReach, cz + NORTH_XZ[1] * northReach];
    return { mid, yaw, length, north };
  }, [room.outline, windDirDeg, windSpeed]);

  if (!show) return null;
  const { mid, yaw, length, north } = layout;
  const shaft = length - 0.45;

  return (
    <group>
      <group position={[mid[0], 0.05, mid[1]]} rotation={[0, yaw, 0]}>
        <mesh position={[-0.225, 0, 0]} rotation={[0, 0, Math.PI / 2]}>
          <cylinderGeometry args={[0.07, 0.07, shaft, 12]} />
          <meshBasicMaterial color={ARROW_COLOR} transparent opacity={0.85} />
        </mesh>
        <mesh position={[length / 2 - 0.225, 0, 0]} rotation={[0, 0, -Math.PI / 2]}>
          <coneGeometry args={[0.22, 0.45, 16]} />
          <meshBasicMaterial color={ARROW_COLOR} transparent opacity={0.85} />
        </mesh>
        <Html center position={[0, 0.35, 0]} style={{ pointerEvents: 'none' }}>
          <div className="px-1.5 py-0.5 rounded bg-black/70 text-[10px] font-mono text-sky-300 whitespace-nowrap">
            wind from {compassPoint(windDirDeg)} · {windSpeed.toFixed(1)} m/s
          </div>
        </Html>
      </group>
      <Html center position={[north[0], 0.05, north[1]]} style={{ pointerEvents: 'none' }}>
        <div className="w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold text-white" style={{ background: NORTH_COLOR }}>
          N
        </div>
      </Html>
    </group>
  );
};
