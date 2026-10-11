import React, { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { useSceneStore } from '../../store/sceneStore';
import { useScenarioStore } from '../../store/scenarioStore';
import { useSimulationStore } from '../../store/simulationStore';
import { formatMetric } from '../../simulation/viz/insights';
import { pointInPolygon } from '../../simulation/viz/layout';
import { sampleScalar } from '../../simulation/viz/sampling';
import { speedField } from '../../simulation/viz/slice';
import type { VoxelSimResult } from '../../simulation/voxel/solver';
import { bridge } from './cameraBridge';
import { useDisplayedField } from './useDisplayedField';
import { useCompareSides, type EvaluatedSide } from './useScenarios';

interface Values {
  pm25: number;
  age: number;
  speed: number;
}

interface Readout extends Values {
  x: number;
  y: number;
  /** Host size, to keep the tooltip on screen */
  w: number;
  h: number;
  room: string;
  /** While comparing: which design the values are from ('diff' shows both) */
  side?:
    | { letter: 'A' | 'B'; name: string }
    | { diff: true; a: Values; b: Values; aName: string; bName: string };
  /** Room averages from the network model (no voxel run on both compare sides) */
  average?: boolean;
}

const speedCache = new WeakMap<VoxelSimResult, Float32Array>();
const speedOf = (r: VoxelSimResult) => {
  let s = speedCache.get(r);
  if (!s) speedCache.set(r, (s = speedField(r.velocity.cell, r.grid.fluid)));
  return s;
};

/** Values at a point of one compare side: its voxel fields, or its room's network averages. */
function sideValues(
  side: EvaluatedSide,
  voxel: boolean,
  roomId: string,
  x: number,
  y: number,
  z: number
): Values {
  if (voxel && side.voxel) {
    const v = side.voxel;
    return {
      pm25: sampleScalar(v.grid, v.pm25.steady, x, y, z),
      age: v.ageMinutes ? sampleScalar(v.grid, v.ageMinutes, x, y, z) : NaN,
      speed: sampleScalar(v.grid, speedOf(v), x, y, z),
    };
  }
  const r = side.network.rooms.find((rv) => rv.roomId === roomId);
  return { pm25: r?.pm25 ?? NaN, age: r?.ageMinutes ?? NaN, speed: NaN };
}

/**
 * Hovering a room's floor shows the simulated values at that spot (at the sampled height): PM2.5,
 * age of air and air speed, each with its unit and band word, and the room's name. While comparing
 * the values are those of the design under the cursor: A left of the swipe line, B right of it.
 */
export const HoverReadout: React.FC = () => {
  const displayed = useDisplayedField();
  const show = useSimulationStore((s) => s.viz.show);
  const mode = useSimulationStore((s) => s.viz.mode);
  const sliceHeight = useSimulationStore((s) => s.viz.sliceHeight);
  const sides = useCompareSides();
  const [readout, setReadout] = useState<Readout | null>(null);
  const anchorRef = useRef<HTMLDivElement>(null);
  const active = show && (displayed !== null || sides !== null);

  useEffect(() => {
    if (!active) return;
    const host = anchorRef.current?.parentElement;
    const canvas = host?.querySelector('canvas');
    if (!host || !canvas) return;
    const ray = new THREE.Raycaster();
    const ground = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
    const hit = new THREE.Vector3();
    const ndc = new THREE.Vector2();
    let raf = 0;
    let last: PointerEvent | null = null;
    const update = () => {
      raf = 0;
      const e = last;
      if (!e || !bridge.camera || e.buttons !== 0 || e.target !== canvas) return setReadout(null);
      const r = canvas.getBoundingClientRect();
      ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
      ray.setFromCamera(ndc, bridge.camera);
      if (!ray.ray.intersectPlane(ground, hit)) return setReadout(null);
      const { room, otherRooms } = useSceneStore.getState();
      const inRoom = [room, ...otherRooms].find((rm) => pointInPolygon([hit.x, hit.z], rm.outline));
      if (!inRoom) return setReadout(null);
      const hr = host.getBoundingClientRect();
      const base = {
        x: e.clientX - hr.left,
        y: e.clientY - hr.top,
        w: hr.width,
        h: hr.height,
        room: inRoom.name,
      };
      const compare = useScenarioStore.getState().compare;
      if (compare && sides) {
        const voxel = !!sides.a.voxel && !!sides.b.voxel;
        const at = (s: EvaluatedSide) => sideValues(s, voxel, inRoom.id ?? '', hit.x, sliceHeight, hit.z);
        if (compare.view === 'diff') {
          const a = at(sides.a);
          const b = at(sides.b);
          return setReadout({
            ...base,
            ...b,
            average: !voxel,
            side: { diff: true, a, b, aName: sides.a.name, bName: sides.b.name },
          });
        }
        const useB =
          compare.view === 'b' ||
          (compare.view === 'swipe' && (e.clientX - hr.left) / hr.width >= compare.swipe);
        const s = useB ? sides.b : sides.a;
        return setReadout({
          ...base,
          ...at(s),
          average: !voxel,
          side: { letter: useB ? 'B' : 'A', name: s.name },
        });
      }
      if (!displayed) return setReadout(null);
      const { result, pm25, speed } = displayed;
      const g = result.grid;
      setReadout({
        ...base,
        pm25: sampleScalar(g, pm25, hit.x, sliceHeight, hit.z),
        age: result.ageMinutes
          ? sampleScalar(g, result.ageMinutes, hit.x, sliceHeight, hit.z)
          : NaN,
        speed: sampleScalar(g, speed, hit.x, sliceHeight, hit.z),
      });
    };
    const onMove = (e: PointerEvent) => {
      last = e;
      if (!raf) raf = requestAnimationFrame(update);
    };
    const onLeave = () => {
      last = null;
      setReadout(null);
    };
    host.addEventListener('pointermove', onMove);
    host.addEventListener('pointerleave', onLeave);
    return () => {
      host.removeEventListener('pointermove', onMove);
      host.removeEventListener('pointerleave', onLeave);
      if (raf) cancelAnimationFrame(raf);
      setReadout(null);
    };
  }, [active, displayed, sides, sliceHeight]);

  const row = (label: string, text: string, on: boolean) => (
    <div
      className={`flex justify-between gap-3 ${on ? 'text-white font-semibold' : 'text-neutral-300'}`}
    >
      <span className="text-neutral-400 font-normal">{label}</span>
      <span className="tabular-nums">{text}</span>
    </div>
  );
  const pmText = (v: number) => formatMetric('pollution', v).text;
  const ageText = (v: number) => formatMetric('ventilation', v).text;
  const side = readout?.side;

  return (
    <div ref={anchorRef} className="contents">
      {active && readout && (
        <div
          data-testid="sim-hover-readout"
          data-side={side && 'letter' in side ? side.letter : side ? 'diff' : undefined}
          className="absolute z-[14] pointer-events-none px-2 py-1.5 rounded-[8px] bg-neutral-950/90 border border-white/15 shadow-xl text-[10.5px] leading-snug min-w-[170px] max-w-[260px]"
          style={{
            left: readout.x + 200 > readout.w ? readout.x - 190 : readout.x + 14,
            top: readout.y + 110 > readout.h ? readout.y - 100 : readout.y + 14,
          }}
        >
          <div className="flex items-center gap-1.5 mb-0.5">
            {side && 'letter' in side && (
              <span
                className={`shrink-0 px-1 rounded text-[9.5px] font-bold text-white ${side.letter === 'A' ? 'bg-sky-700' : 'bg-orange-700'}`}
              >
                {side.letter}
              </span>
            )}
            <span className="text-[10px] font-semibold text-neutral-100 truncate">
              {readout.room}
            </span>
          </div>
          {side && 'diff' in side ? (
            <>
              {Number.isFinite(side.a.pm25) &&
                row(
                  'PM2.5',
                  `${pmText(side.a.pm25)} → ${pmText(side.b.pm25)}`,
                  mode === 'pollution'
                )}
              {Number.isFinite(side.a.age) &&
                row(
                  'Air age',
                  `${ageText(side.a.age)} → ${ageText(side.b.age)}`,
                  mode === 'ventilation'
                )}
              <div className="text-[9px] text-neutral-500 mt-0.5 truncate">
                A {side.aName} → B {side.bName}
              </div>
            </>
          ) : (
            <>
              {Number.isFinite(readout.pm25) &&
                row('PM2.5', pmText(readout.pm25), mode === 'pollution')}
              {Number.isFinite(readout.age) &&
                row('Air age', ageText(readout.age), mode === 'ventilation')}
              {Number.isFinite(readout.speed) &&
                row(
                  'Air speed',
                  `${readout.speed < 0.1 ? readout.speed.toFixed(3) : readout.speed.toFixed(2)} m/s`,
                  mode === 'airflow'
                )}
              {side && 'letter' in side && (
                <div className="text-[9px] text-neutral-400 mt-0.5 truncate">{side.name}</div>
              )}
            </>
          )}
          <div className="text-[9px] text-neutral-500 mt-0.5">
            {readout.average
              ? 'room average · network model'
              : `at ${sliceHeight.toFixed(1)} m height · simulated`}
          </div>
        </div>
      )}
    </div>
  );
};
