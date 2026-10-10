import React, { useEffect, useMemo } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import type { Room } from '../../core/schema';
import { useScenarioStore } from '../../store/scenarioStore';
import { useSimulationStore } from '../../store/simulationStore';
import { AQI_SCALE_MAX, fieldDomain, isLogScale, type ColorScale } from '../../simulation/viz/colormap';
import { differenceDomain, differenceField, roomUniformField } from '../../simulation/scenarios/compare';
import { sliceCellRooms } from '../../simulation/viz/stagnation';
import type { GridInfo } from '../../simulation/voxel/analysis';
import { FloorHeatmap } from './FloorHeatmap';
import { useCompareSides, type EvaluatedSide } from './useScenarios';

export interface CompareFields {
  grid: GridInfo;
  a: Float32Array;
  b: Float32Array;
  /** One colour scale for both sides */
  scale: ColorScale;
  diff: Float32Array;
  diffScale: ColorScale;
  /** Occupancy-weighted A value the % legend is relative to */
  reference: number;
  unit: string;
  /** Voxel fields on both sides; else each room filled with its network value */
  voxel: boolean;
}

/**
 * The fields the compare view draws for the current mode (PM2.5 or age of air): voxel fields when
 * both sides have a voxel run, otherwise each room filled uniformly with its network value (on the
 * grid of whichever voxel run exists). Null in Airflow (no heatmap) or with no grid at all.
 */
export function useCompareFields(rooms: readonly Room[]): CompareFields | null {
  const sides = useCompareSides();
  const mode = useSimulationStore((s) => s.viz.mode);
  const main = useSimulationStore((s) => s.result);
  const grid = sides?.a.voxel?.grid ?? sides?.b.voxel?.grid ?? main?.grid ?? null;
  const cellRoom = useMemo(() => (grid ? sliceCellRooms(grid, rooms.map((r) => r.outline)) : null), [grid, rooms]);
  return useMemo(() => {
    if (!sides || !grid || !cellRoom || mode === 'airflow') return null;
    const field = mode === 'pollution' ? 'pm25' : 'age';
    const voxel = !!sides.a.voxel && !!sides.b.voxel;
    const of = (s: EvaluatedSide): Float32Array | null => {
      if (voxel) return field === 'pm25' ? s.voxel!.pm25.steady : s.voxel!.ageMinutes;
      const byId = new Map(s.network.rooms.map((r) => [r.roomId, field === 'pm25' ? r.pm25 : r.ageMinutes]));
      return roomUniformField(grid, rooms, (room) => byId.get(room.id ?? '') ?? NaN, cellRoom);
    };
    const a = of(sides.a);
    const b = of(sides.b);
    if (!a || !b) return null;
    let scale: ColorScale;
    if (field === 'pm25') scale = { field, domain: [0, AQI_SCALE_MAX] };
    else {
      const both = new Float32Array(a.length * 2);
      both.set(a);
      both.set(b, a.length);
      const domain = fieldDomain('age', both, true);
      scale = { field, domain, log: isLogScale('age', domain) };
    }
    const diff = differenceField(a, b);
    const diffScale: ColorScale = { field: 'diff', domain: differenceDomain(diff, field === 'pm25' ? 2 : 0.5) };
    const reference = field === 'pm25' ? sides.a.metrics.weightedPm25 : sides.a.metrics.meanAgeMinutes;
    return { grid, a, b, scale, diff, diffScale, reference, unit: field === 'pm25' ? 'µg/m³' : 'min', voxel };
  }, [sides, grid, cellRoom, mode, rooms]);
}

const v = new THREE.Vector3();
/** World plane through the screen-vertical line at x (0–1 of the width); positive on the left. */
function swipePlane(camera: THREE.Camera, x: number, out: THREE.Plane): THREE.Plane {
  const sx = x * 2 - 1;
  const p0 = new THREE.Vector3(sx, -1, -1).unproject(camera);
  const p1 = new THREE.Vector3(sx, 1, -1).unproject(camera);
  const p2 = new THREE.Vector3(sx, -1, 1).unproject(camera);
  out.setFromCoplanarPoints(p0, p1, p2);
  // Orient so a point left of the line is on the positive side
  v.set(sx - 0.2, 0, 0).unproject(camera);
  if (out.distanceToPoint(v) < 0) out.negate();
  return out;
}

/**
 * Compare heatmaps on the floor: A, B, A|B split by the swipe line (same camera, same scale), or
 * the difference B − A on a diverging scale.
 */
export const CompareLayer: React.FC<{ rooms: readonly Room[]; sampleY: number }> = ({ rooms, sampleY }) => {
  const compare = useScenarioStore((s) => s.compare);
  const fields = useCompareFields(rooms);
  const gl = useThree((s) => s.gl);
  const planes = useMemo(() => ({ left: [new THREE.Plane()], right: [new THREE.Plane()] }), []);
  useEffect(() => {
    const prev = gl.localClippingEnabled;
    gl.localClippingEnabled = true;
    return () => {
      gl.localClippingEnabled = prev;
    };
  }, [gl]);
  useFrame(({ camera }) => {
    if (!compare || compare.view !== 'swipe') return;
    swipePlane(camera, compare.swipe, planes.left[0]!);
    planes.right[0]!.copy(planes.left[0]!).negate();
  });
  if (!compare || !fields) return null;
  const { grid } = fields;
  return (
    <group name="sim-compare-layer">
      {compare.view === 'a' && <FloorHeatmap rooms={rooms} grid={grid} values={fields.a} scale={fields.scale} sampleY={sampleY} />}
      {compare.view === 'b' && <FloorHeatmap rooms={rooms} grid={grid} values={fields.b} scale={fields.scale} sampleY={sampleY} />}
      {compare.view === 'swipe' && (
        <>
          <FloorHeatmap rooms={rooms} grid={grid} values={fields.a} scale={fields.scale} sampleY={sampleY} clippingPlanes={planes.left} />
          <FloorHeatmap rooms={rooms} grid={grid} values={fields.b} scale={fields.scale} sampleY={sampleY} clippingPlanes={planes.right} />
        </>
      )}
      {compare.view === 'diff' && <FloorHeatmap rooms={rooms} grid={grid} values={fields.diff} scale={fields.diffScale} sampleY={sampleY} />}
    </group>
  );
};
