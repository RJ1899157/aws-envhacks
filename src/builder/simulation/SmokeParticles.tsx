import React, { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import type { Room } from '../../core/schema';
import { EDDY_DIFFUSIVITY } from '../../simulation/constants';
import { aqiColor, scalePosition, ylOrRd, type ColorScale } from '../../simulation/viz/colormap';
import { cellIndexAt, sampleScalar, sampleVector } from '../../simulation/viz/sampling';
import { roomPm25Sources, sourceActiveAt } from '../../simulation/sources';
import type { VoxelSimResult } from '../../simulation/voxel/solver';

/** Points kept per smoke trail (head + tail). */
const TRAIL = 9;
/**
 * Turbulent wander: an Ornstein–Uhlenbeck velocity with decay rate λ (1/s) and spread σ chosen so the
 * puffs' effective diffusivity σ²/λ equals the solver's eddy diffusivity. Where the mean flow is
 * slow (a sheltered stove corner), smoke then leaves the source the way the solver's PM2.5 does.
 */
const WANDER_DECAY = 0.25;
const WANDER_MS = Math.sqrt(EDDY_DIFFUSIVITY * WANDER_DECAY);

const vertexShader = /* glsl */ `
  attribute vec3 color;
  attribute float alpha;
  attribute float size;
  varying vec3 vColor;
  varying float vAlpha;
  uniform float uSize;
  void main() {
    vColor = color;
    vAlpha = alpha;
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * mv;
    gl_PointSize = uSize * size;
  }
`;
const lineFragment = /* glsl */ `
  varying vec3 vColor;
  varying float vAlpha;
  void main() { gl_FragColor = vec4(vColor, vAlpha); }
`;
const pointFragment = /* glsl */ `
  varying vec3 vColor;
  varying float vAlpha;
  void main() {
    vec2 c = gl_PointCoord - 0.5;
    float d = dot(c, c);
    if (d > 0.25) discard;
    // Soft puff: gaussian-ish falloff
    gl_FragColor = vec4(vColor, vAlpha * exp(-d * 14.0));
  }
`;

interface Emitter {
  pos: [number, number, number];
  /** Share of particles (by emission rate) */
  weight: number;
}

/** Emission points of the sources active at time t (null = steady state, all on). */
export function smokeEmitters(rooms: readonly Room[], tS: number | null): Emitter[] {
  const out: Emitter[] = [];
  for (const room of rooms) {
    for (const src of roomPm25Sources(room)) {
      if (!sourceActiveAt(src, tS) || src.emissionRateUgMin <= 0) continue;
      let pos: [number, number, number] | null = null;
      if (src.position) pos = [src.position[0], src.position[1], src.position[2]];
      else if (src.objectId) {
        const o = room.objects.find((x) => x.id === src.objectId);
        if (o) pos = [o.position[0], (o.position[1] ?? 0) + (o.elevation ?? 0) + o.size[1] * (o.scale?.[1] ?? 1) + 0.05, o.position[2]];
      }
      if (pos) out.push({ pos, weight: src.emissionRateUgMin });
    }
  }
  const total = out.reduce((s, e) => s + e.weight, 0);
  for (const e of out) e.weight /= total || 1;
  return out;
}

export interface SmokeParticlesProps {
  result: VoxelSimResult;
  rooms: readonly Room[];
  /** Snapshot time (s) or null for the steady state */
  timeS: number | null;
  /** PM2.5 field now shown, for colouring each puff by the concentration around it */
  pm25: Float32Array;
  scale: ColorScale;
  count: number;
  timeScale: number;
}

/**
 * Smoke: puffs released at active sources, carried by the solved airflow plus a gentle turbulent
 * wander, coloured by the local PM2.5 and fading along short trails. Puffs cross from room to room
 * only where an open face carries flow (the MAC face velocity is non-zero), never through walls.
 */
export const SmokeParticles: React.FC<SmokeParticlesProps> = ({ result, rooms, timeS, pm25, scale, count, timeScale }) => {
  const { grid, velocity } = result;
  const { fluid } = grid;
  const faces = velocity.faces;
  const segs = TRAIL - 1;
  const emitters = useMemo(() => smokeEmitters(rooms, timeS), [rooms, timeS]);

  const lines = useMemo(() => {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(count * segs * 2 * 3), 3));
    g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(count * segs * 2 * 3), 3));
    g.setAttribute('alpha', new THREE.BufferAttribute(new Float32Array(count * segs * 2), 1));
    g.setAttribute('size', new THREE.BufferAttribute(new Float32Array(count * segs * 2).fill(1), 1));
    return g;
  }, [count, segs]);
  const heads = useMemo(() => {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(count * 3), 3));
    g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(count * 3), 3));
    g.setAttribute('alpha', new THREE.BufferAttribute(new Float32Array(count), 1));
    g.setAttribute('size', new THREE.BufferAttribute(new Float32Array(count).fill(1), 1));
    return g;
  }, [count]);
  useEffect(() => () => lines.dispose(), [lines]);
  useEffect(() => () => heads.dispose(), [heads]);
  const lineMat = useMemo(() => new THREE.ShaderMaterial({ vertexShader, fragmentShader: lineFragment, uniforms: { uSize: { value: 1 } }, transparent: true, depthWrite: false }), []);
  const headMat = useMemo(() => new THREE.ShaderMaterial({ vertexShader, fragmentShader: pointFragment, uniforms: { uSize: { value: 26 } }, transparent: true, depthWrite: false }), []);
  useEffect(() => () => lineMat.dispose(), [lineMat]);
  useEffect(() => () => headMat.dispose(), [headMat]);

  const state = useRef({
    hist: new Float32Array(count * TRAIL * 3),
    wander: new Float32Array(count * 3),
    age: new Float32Array(count),
    life: new Float32Array(count),
    head: 0,
  });

  /** Whether moving from cell a to cell b is allowed: same cell, or an adjacent cell across an open face. */
  const passable = (a: number, b: number): boolean => {
    if (a === b) return true;
    if (b < 0 || !fluid[b]) return false;
    const { nx, ny } = grid;
    const ai = a % nx;
    const aj = Math.floor(a / nx) % ny;
    const ak = Math.floor(a / (nx * ny));
    const bi = b % nx;
    const bj = Math.floor(b / nx) % ny;
    const bk = Math.floor(b / (nx * ny));
    const d = Math.abs(ai - bi) + Math.abs(aj - bj) + Math.abs(ak - bk);
    if (d !== 1) return false;
    if (ai !== bi) return faces.u[Math.max(ai, bi) + (nx + 1) * (aj + ny * ak)] !== 0;
    if (aj !== bj) return faces.v[ai + nx * (Math.max(aj, bj) + (ny + 1) * ak)] !== 0;
    return faces.w[ai + nx * (aj + ny * Math.max(ak, bk))] !== 0;
  };

  const respawn = (p: number) => {
    const s = state.current;
    let r = Math.random();
    let e = emitters[0];
    for (const em of emitters) {
      if (r < em.weight) {
        e = em;
        break;
      }
      r -= em.weight;
    }
    const pos = e ? e.pos : [0, -100, 0];
    const jitter = () => (Math.random() - 0.5) * 0.12;
    for (let t = 0; t < TRAIL; t++) s.hist.set([pos[0]! + jitter(), pos[1]! + Math.random() * 0.05, pos[2]! + jitter()], (p * TRAIL + t) * 3);
    s.wander.set([0, 0, 0], p * 3);
    s.age[p] = 0;
    // Long enough (at the default ×20) to carry smoke from a stove into the next room
    s.life[p] = 15 + Math.random() * 20;
  };

  useEffect(() => {
    state.current = { hist: new Float32Array(count * TRAIL * 3), wander: new Float32Array(count * 3), age: new Float32Array(count), life: new Float32Array(count), head: 0 };
    for (let p = 0; p < count; p++) {
      respawn(p);
      state.current.age[p] = Math.random() * state.current.life[p]!;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [count, result, emitters]);

  const v = useRef<[number, number, number]>([0, 0, 0]);
  const rgb = useRef<[number, number, number]>([0, 0, 0]);

  useFrame((_, delta) => {
    if (emitters.length === 0) return;
    const s = state.current;
    const frame = Math.min(delta, 0.05);
    const dtSim = frame * timeScale;
    const prevHead = s.head;
    const head = (s.head + 1) % TRAIL;
    s.head = head;
    const decay = Math.exp(-WANDER_DECAY * dtSim);
    const kick = WANDER_MS * Math.sqrt(1 - decay * decay);
    const maxStep = grid.dx * 0.5;
    for (let p = 0; p < count; p++) {
      const base = p * TRAIL;
      let x = s.hist[(base + prevHead) * 3]!;
      let y = s.hist[(base + prevHead) * 3 + 1]!;
      let z = s.hist[(base + prevHead) * 3 + 2]!;
      for (let a = 0; a < 3; a++) s.wander[p * 3 + a] = s.wander[p * 3 + a]! * decay + kick * (Math.random() + Math.random() + Math.random() - 1.5) * 2;
      sampleVector(grid, velocity.cell, x, y, z, v.current);
      const vx = v.current[0] + s.wander[p * 3]!;
      const vy = v.current[1] + s.wander[p * 3 + 1]! * 0.5;
      const vz = v.current[2] + s.wander[p * 3 + 2]!;
      const n = Math.min(6, Math.max(1, Math.ceil((Math.hypot(vx, vy, vz) * dtSim) / maxStep)));
      const h = dtSim / n;
      let cell = cellIndexAt(grid, x, y, z);
      for (let k = 0; k < n; k++) {
        // Move one axis at a time so a puff slides along a wall instead of sticking to it
        const nxp = x + vx * h;
        let next = cellIndexAt(grid, nxp, y, z);
        if (passable(cell, next)) {
          x = nxp;
          cell = next;
        }
        const nzp = z + vz * h;
        next = cellIndexAt(grid, x, y, nzp);
        if (passable(cell, next)) {
          z = nzp;
          cell = next;
        }
        const nyp = y + vy * h;
        next = cellIndexAt(grid, x, nyp, z);
        if (passable(cell, next)) {
          y = nyp;
          cell = next;
        }
      }
      s.age[p] = s.age[p]! + frame;
      if (s.age[p]! > s.life[p]! || cell < 0) respawn(p);
      else s.hist.set([x, y, z], (base + head) * 3);
    }

    const pos = lines.getAttribute('position').array as Float32Array;
    const col = lines.getAttribute('color').array as Float32Array;
    const alpha = lines.getAttribute('alpha').array as Float32Array;
    const hp = heads.getAttribute('position').array as Float32Array;
    const hc = heads.getAttribute('color').array as Float32Array;
    const ha = heads.getAttribute('alpha').array as Float32Array;
    const hs = heads.getAttribute('size').array as Float32Array;
    for (let p = 0; p < count; p++) {
      const base = p * TRAIL;
      const lifeT = s.age[p]! / s.life[p]!;
      const fade = Math.min(1, lifeT * 6) * Math.min(1, (1 - lifeT) * 3);
      const hx = s.hist[(base + head) * 3]!;
      const hy = s.hist[(base + head) * 3 + 1]!;
      const hz = s.hist[(base + head) * 3 + 2]!;
      const c = sampleScalar(grid, pm25, hx, hy, hz);
      if (scale.relative) ylOrRd(scalePosition(scale, c), rgb.current);
      else aqiColor(c, rgb.current);
      const r = rgb.current[0] / 255;
      const g = rgb.current[1] / 255;
      const b = rgb.current[2] / 255;
      for (let k = 0; k < segs; k++) {
        const ia = (head - k + TRAIL) % TRAIL;
        const ib = (head - k - 1 + TRAIL) % TRAIL;
        const o = (p * segs + k) * 2;
        pos.set(s.hist.subarray((base + ia) * 3, (base + ia) * 3 + 3), o * 3);
        pos.set(s.hist.subarray((base + ib) * 3, (base + ib) * 3 + 3), (o + 1) * 3);
        col.set([r, g, b, r, g, b], o * 3);
        const tail = 1 - k / segs;
        alpha[o] = 0.35 * fade * tail;
        alpha[o + 1] = 0.35 * fade * (tail - 1 / segs);
      }
      hp.set([hx, hy, hz], p * 3);
      hc.set([Math.min(1, r * 1.15 + 0.08), Math.min(1, g * 1.15 + 0.08), Math.min(1, b * 1.15 + 0.08)], p * 3);
      // Puffs grow and thin out as they drift away from the source
      hs[p] = 0.25 + 0.75 * Math.sqrt(lifeT);
      ha[p] = 0.55 * fade * (1 - 0.5 * lifeT);
    }
    heads.getAttribute('size').needsUpdate = true;
    for (const g of [lines, heads]) {
      g.getAttribute('position').needsUpdate = true;
      g.getAttribute('color').needsUpdate = true;
      g.getAttribute('alpha').needsUpdate = true;
    }
  });

  if (emitters.length === 0) return null;
  return (
    <group name="sim-smoke">
      <lineSegments geometry={lines} material={lineMat} renderOrder={7} frustumCulled={false} raycast={() => null} />
      <points geometry={heads} material={headMat} renderOrder={7} frustumCulled={false} raycast={() => null} />
    </group>
  );
};
