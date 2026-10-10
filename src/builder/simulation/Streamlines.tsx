import React, { useEffect, useMemo } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { hexToRgb, SPEED_RAMP } from '../../simulation/viz/colormap';
import { computeStreamlines, type Streamline } from '../../simulation/viz/streamlines';
import type { VoxelSimResult } from '../../simulation/voxel/solver';

/**
 * Animated streamlines: camera-facing ribbons (constant width in pixels) whose dash pattern is laid
 * out in travel time along the line, so a dash moves at the local air speed: quick and long in the
 * window jet, slow and dense where air barely moves. Fast lines are wider and brighter, slow ones
 * thin and dim, so stagnant air reads as quiet.
 */

const vertexShader = /* glsl */ `
  uniform vec2 uResolution;
  uniform float uWidth;
  attribute vec3 prevPos;
  attribute vec3 nextPos;
  attribute float side;
  attribute float tof;
  attribute float speedT;
  varying float vTof;
  varying float vSpeed;
  varying float vSide;
  void main() {
    mat4 mvp = projectionMatrix * modelViewMatrix;
    vec4 c = mvp * vec4(position, 1.0);
    vec4 p = mvp * vec4(prevPos, 1.0);
    vec4 n = mvp * vec4(nextPos, 1.0);
    vec2 dir = (n.xy / n.w - p.xy / p.w) * uResolution;
    float len = length(dir);
    dir = len > 1e-6 ? dir / len : vec2(1.0, 0.0);
    vec2 normal = vec2(-dir.y, dir.x);
    float halfWidth = uWidth * (0.35 + 1.15 * speedT);
    c.xy += normal * side * halfWidth * 2.0 / uResolution * c.w;
    gl_Position = c;
    vTof = tof;
    vSpeed = speedT;
    vSide = side;
  }
`;

const fragmentShader = /* glsl */ `
  uniform float uTime;
  uniform float uPeriod;
  uniform float uOpacity;
  uniform vec3 uRamp[5];
  varying float vTof;
  varying float vSpeed;
  varying float vSide;
  vec3 ramp(float t) {
    float x = clamp(t, 0.0, 1.0) * 4.0;
    int i = int(min(floor(x), 3.0));
    float f = x - float(i);
    vec3 a = uRamp[0]; vec3 b = uRamp[1];
    if (i == 1) { a = uRamp[1]; b = uRamp[2]; }
    else if (i == 2) { a = uRamp[2]; b = uRamp[3]; }
    else if (i == 3) { a = uRamp[3]; b = uRamp[4]; }
    return mix(a, b, f);
  }
  void main() {
    // Comet dashes: bright head downstream, fading tail upstream
    float phase = fract((vTof - uTime) / uPeriod);
    float dash = phase * phase * phase;
    float edge = 1.0 - smoothstep(0.55, 1.0, abs(vSide));
    float a = uOpacity * edge * (0.18 + 0.82 * vSpeed) * (0.2 + 0.8 * dash);
    vec3 col = ramp(vSpeed) * (0.7 + 0.5 * dash);
    gl_FragColor = vec4(col, a);
  }
`;

/** Ribbon geometry: two vertices per point (sides ±1), triangles between consecutive points. */
function ribbonGeometry(lines: readonly Streamline[], speedRef: number): THREE.BufferGeometry {
  let nPts = 0;
  let nSeg = 0;
  for (const l of lines) {
    nPts += l.times.length;
    nSeg += l.times.length - 1;
  }
  const position = new Float32Array(nPts * 2 * 3);
  const prev = new Float32Array(nPts * 2 * 3);
  const next = new Float32Array(nPts * 2 * 3);
  const side = new Float32Array(nPts * 2);
  const tof = new Float32Array(nPts * 2);
  const speedT = new Float32Array(nPts * 2);
  const index = new Uint32Array(nSeg * 6);
  let v = 0;
  let t = 0;
  for (const l of lines) {
    const n = l.times.length;
    for (let p = 0; p < n; p++) {
      const pp = Math.max(0, p - 1);
      const np = Math.min(n - 1, p + 1);
      const s = Math.min(1, Math.sqrt(l.speeds[p]! / speedRef));
      for (let k = 0; k < 2; k++) {
        const o = v + k;
        position.set(l.points.subarray(3 * p, 3 * p + 3), o * 3);
        prev.set(l.points.subarray(3 * pp, 3 * pp + 3), o * 3);
        next.set(l.points.subarray(3 * np, 3 * np + 3), o * 3);
        side[o] = k === 0 ? -1 : 1;
        tof[o] = l.times[p]!;
        speedT[o] = s;
      }
      if (p < n - 1) {
        index.set([v, v + 1, v + 2, v + 1, v + 3, v + 2], t);
        t += 6;
      }
      v += 2;
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(position, 3));
  g.setAttribute('prevPos', new THREE.BufferAttribute(prev, 3));
  g.setAttribute('nextPos', new THREE.BufferAttribute(next, 3));
  g.setAttribute('side', new THREE.BufferAttribute(side, 1));
  g.setAttribute('tof', new THREE.BufferAttribute(tof, 1));
  g.setAttribute('speedT', new THREE.BufferAttribute(speedT, 1));
  g.setIndex(new THREE.BufferAttribute(index, 1));
  return g;
}

export interface StreamlinesProps {
  result: VoxelSimResult;
  /** Speed (m/s) at the top of the colour / width scale */
  speedRef: number;
  /** Flow playback speed-up */
  timeScale: number;
  /** Seed-grid density multiplier */
  density: number;
  /** Line half-width at full speed (px) and overall opacity */
  width?: number;
  opacity?: number;
  /** Seed heights (m) */
  heightsM?: readonly number[];
}

export const Streamlines: React.FC<StreamlinesProps> = ({ result, speedRef, timeScale, density, width = 2.2, opacity = 0.95, heightsM = [1.2] }) => {
  const size = useThree((s) => s.size);
  const dpr = useThree((s) => s.viewport.dpr);
  const lines = useMemo(() => {
    const seeds = new Float32Array(result.spawn.inflow.length + result.spawn.devices.length);
    seeds.set(result.spawn.inflow, 0);
    seeds.set(result.spawn.devices, result.spawn.inflow.length);
    return computeStreamlines(result.grid, result.velocity.faces, seeds, { spacingM: 0.6 / Math.sqrt(density), heightsM, maxForward: Math.round(60 * density) });
  }, [result, density, heightsM]);
  const geometry = useMemo(() => ribbonGeometry(lines, speedRef), [lines, speedRef]);
  useEffect(() => () => geometry.dispose(), [geometry]);
  const material = useMemo(
    () =>
      new THREE.ShaderMaterial({
        vertexShader,
        fragmentShader,
        uniforms: {
          uResolution: { value: new THREE.Vector2(1, 1) },
          uWidth: { value: width },
          uTime: { value: 0 },
          // One dash per ~0.8 m at the reference speed
          uPeriod: { value: 0.8 / speedRef },
          uOpacity: { value: opacity },
          uRamp: { value: SPEED_RAMP.map((c) => new THREE.Color(...hexToRgb(c).map((x) => x / 255)).convertSRGBToLinear()) },
        },
        transparent: true,
        depthWrite: false,
        side: THREE.DoubleSide,
      }),
    [speedRef, width, opacity]
  );
  useEffect(() => () => material.dispose(), [material]);
  useEffect(() => {
    material.uniforms.uResolution!.value.set(size.width * dpr, size.height * dpr);
    material.uniforms.uWidth!.value = width * dpr;
  }, [material, size, dpr, width]);
  useFrame((_, delta) => {
    material.uniforms.uTime!.value += Math.min(delta, 0.05) * timeScale;
  });
  return <mesh name="sim-streamlines" geometry={geometry} material={material} renderOrder={6} frustumCulled={false} raycast={() => null} />;
};
