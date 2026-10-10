import React, { useEffect, useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { useSceneStore } from '../../store/sceneStore';
import { useSimulationStore } from '../../store/simulationStore';
import { placedSourceParams, sourceActiveAt } from '../../simulation/sources';

/** Puffs per wisp. */
const PUFFS = 14;

const vertexShader = /* glsl */ `
  uniform float uTime;
  uniform float uScale;
  attribute float seed;
  varying float vAlpha;
  void main() {
    // Each puff rises ~0.55 m over its cycle, swaying and spreading as it goes
    float phase = fract(uTime * 0.22 + seed);
    vec3 p = position;
    p.y += phase * 0.55;
    p.x += sin(uTime * 1.7 + seed * 40.0) * 0.05 * phase + (seed - 0.5) * 0.08 * phase;
    p.z += cos(uTime * 1.3 + seed * 23.0) * 0.05 * phase;
    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    gl_Position = projectionMatrix * mv;
    gl_PointSize = uScale * (0.035 + 0.11 * phase) / max(0.1, -mv.z);
    vAlpha = 0.42 * sin(phase * 3.14159) * (1.0 - phase * 0.5);
  }
`;
const fragmentShader = /* glsl */ `
  varying float vAlpha;
  void main() {
    vec2 c = gl_PointCoord - 0.5;
    float d = dot(c, c);
    if (d > 0.25) discard;
    gl_FragColor = vec4(vec3(0.86, 0.86, 0.84), vAlpha * (1.0 - d * 4.0));
  }
`;

/**
 * A subtle animated smoke wisp above every active placed PM2.5 source (enabled, and inside its
 * schedule at the playback time when a simulation snapshot is shown). Drawn whatever the
 * simulation layer shows, so a placed source reads as "on" in the builder too.
 */
export const SourceWisps: React.FC = () => {
  const room = useSceneStore((s) => s.room);
  const otherRooms = useSceneStore((s) => s.otherRooms);
  const result = useSimulationStore((s) => s.result);
  const snapshotIndex = useSimulationStore((s) => s.viz.snapshotIndex);
  const show = useSimulationStore((s) => s.viz.show);
  const timeS = show && result && snapshotIndex !== null ? (result.pm25.snapshots[snapshotIndex]?.tS ?? null) : null;

  const geometry = useMemo(() => {
    const pts: number[] = [];
    const seeds: number[] = [];
    for (const r of [room, ...otherRooms])
      for (const o of r.objects) {
        const p = placedSourceParams(o);
        if (!p || !p.enabled || !sourceActiveAt({ schedule: p.schedule }, timeS)) continue;
        for (let i = 0; i < PUFFS; i++) {
          pts.push(o.position[0], p.heightM, o.position[2]);
          seeds.push(i / PUFFS);
        }
      }
    if (pts.length === 0) return null;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(pts), 3));
    g.setAttribute('seed', new THREE.BufferAttribute(new Float32Array(seeds), 1));
    return g;
  }, [room, otherRooms, timeS]);
  useEffect(() => () => geometry?.dispose(), [geometry]);
  const material = useMemo(
    () => new THREE.ShaderMaterial({ vertexShader, fragmentShader, uniforms: { uTime: { value: 0 }, uScale: { value: 600 } }, transparent: true, depthWrite: false }),
    []
  );
  useEffect(() => () => material.dispose(), [material]);
  useFrame(({ clock, size }) => {
    material.uniforms.uTime!.value = clock.elapsedTime;
    material.uniforms.uScale!.value = size.height;
  });
  if (!geometry) return null;
  return <points name="source-wisps" geometry={geometry} material={material} renderOrder={9} frustumCulled={false} raycast={() => null} />;
};
