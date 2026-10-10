import React, { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { useSceneStore } from '../../store/sceneStore';
import { useSimulationStore } from '../../store/simulationStore';
import { formatMetric } from '../../simulation/viz/insights';
import { pointInPolygon } from '../../simulation/viz/layout';
import { sampleScalar } from '../../simulation/viz/sampling';
import { bridge } from './cameraBridge';
import { useDisplayedField } from './useDisplayedField';

interface Readout {
  x: number;
  y: number;
  /** Host size, to keep the tooltip on screen */
  w: number;
  h: number;
  room: string;
  pm25: number;
  age: number;
  speed: number;
}

/**
 * Hovering a room's floor shows the simulated values at that spot (at the sampled height): PM2.5,
 * age of air and air speed, each with its unit and band word, and the room's name.
 */
export const HoverReadout: React.FC = () => {
  const displayed = useDisplayedField();
  const show = useSimulationStore((s) => s.viz.show);
  const mode = useSimulationStore((s) => s.viz.mode);
  const sliceHeight = useSimulationStore((s) => s.viz.sliceHeight);
  const [readout, setReadout] = useState<Readout | null>(null);
  const anchorRef = useRef<HTMLDivElement>(null);
  const active = show && displayed !== null;

  useEffect(() => {
    if (!active || !displayed) return;
    const host = anchorRef.current?.parentElement;
    const canvas = host?.querySelector('canvas');
    if (!host || !canvas) return;
    const { result, pm25, speed } = displayed;
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
      const g = result.grid;
      const age = result.ageMinutes ? sampleScalar(g, result.ageMinutes, hit.x, sliceHeight, hit.z) : NaN;
      const hr = host.getBoundingClientRect();
      setReadout({
        x: e.clientX - hr.left,
        y: e.clientY - hr.top,
        w: hr.width,
        h: hr.height,
        room: inRoom.name,
        pm25: sampleScalar(g, pm25, hit.x, sliceHeight, hit.z),
        age,
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
  }, [active, displayed, sliceHeight]);

  const row = (label: string, text: string, on: boolean) => (
    <div className={`flex justify-between gap-3 ${on ? 'text-white font-semibold' : 'text-neutral-300'}`}>
      <span className="text-neutral-400 font-normal">{label}</span>
      <span className="tabular-nums">{text}</span>
    </div>
  );

  return (
    <div ref={anchorRef} className="contents">
      {active && readout && (
        <div
          data-testid="sim-hover-readout"
          className="absolute z-[14] pointer-events-none px-2 py-1.5 rounded-[8px] bg-neutral-950/90 border border-white/15 shadow-xl text-[10.5px] leading-snug min-w-[170px]"
          style={{ left: readout.x + 200 > readout.w ? readout.x - 190 : readout.x + 14, top: readout.y + 110 > readout.h ? readout.y - 100 : readout.y + 14 }}
        >
          <div className="text-[10px] font-semibold text-neutral-100 mb-0.5">{readout.room}</div>
          {Number.isFinite(readout.pm25) && row('PM2.5', formatMetric('pollution', readout.pm25).text, mode === 'pollution')}
          {Number.isFinite(readout.age) && row('Air age', formatMetric('ventilation', readout.age).text, mode === 'ventilation')}
          {Number.isFinite(readout.speed) && row('Air speed', `${readout.speed < 0.1 ? readout.speed.toFixed(3) : readout.speed.toFixed(2)} m/s`, mode === 'airflow')}
          <div className="text-[9px] text-neutral-500 mt-0.5">at {sliceHeight.toFixed(1)} m height · simulated</div>
        </div>
      )}
    </div>
  );
};
