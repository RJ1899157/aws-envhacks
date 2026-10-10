import React, { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { polygonBounds } from '../core/parser';
import type { Room, SiteExposure } from '../core/schema';
import { useSceneStore } from '../store/sceneStore';
import { useSimulationStore } from '../store/simulationStore';
import { useUiStore } from '../store/uiStore';
import { STOREY_HEIGHT_M } from '../simulation/constants';

/**
 * Surroundings drawn around the home instead of an empty grid, following the "What's around it?"
 * answer: open ground with trees and hills, a suburb of low houses, or a dense block of towers. Plain
 * silhouettes (no detail, no shadows) so they give context without competing with the design. The
 * home's floor sets how far below the street is, with the home's own building underneath.
 * Visual only: the simulation is unaffected. Hidden in the top-down plan view.
 */

interface Box {
  x: number;
  z: number;
  w: number;
  d: number;
  h: number;
  /** Pitched roof (suburban houses) */
  roof?: boolean;
}
interface Tree {
  x: number;
  z: number;
  s: number;
}
interface Layout {
  boxes: Box[];
  trees: Tree[];
  hills: { x: number; z: number; r: number; h: number }[];
}

/** Small deterministic RNG so the scene doesn't reshuffle on every edit. */
function rng(seed: number) {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return (s >>> 0) / 4294967296;
  };
}

interface Footprint {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

/** Keeps a box (with a margin) clear of the home's footprint. */
const clearOf = (f: Footprint, gap: number, b: { x: number; z: number; w: number; d: number }) =>
  b.x + b.w / 2 < f.minX - gap || b.x - b.w / 2 > f.maxX + gap || b.z + b.d / 2 < f.minZ - gap || b.z - b.d / 2 > f.maxZ + gap;

function layoutFor(exposure: SiteExposure, f: Footprint): Layout {
  const cx = (f.minX + f.maxX) / 2;
  const cz = (f.minZ + f.maxZ) / 2;
  const rand = rng(Math.round(cx * 7 + cz * 13 + (f.maxX - f.minX) * 31 + (f.maxZ - f.minZ) * 17) + exposure.length * 101);
  const boxes: Box[] = [];
  const trees: Tree[] = [];
  const hills: Layout['hills'] = [];
  const treeAt = (x: number, z: number, s: number) => trees.push({ x, z, s });

  if (exposure === 'urbanDense') {
    // City blocks on a 16 m grid with 6 m streets; the home's block is left clear
    const pitch = 16;
    for (let i = -4; i <= 4; i++)
      for (let k = -4; k <= 4; k++) {
        const x = cx + i * pitch + (rand() - 0.5) * 2;
        const z = cz + k * pitch + (rand() - 0.5) * 2;
        const w = 8 + rand() * 4;
        const d = 8 + rand() * 4;
        const b = { x, z, w, d, h: 12 + rand() * rand() * 45 };
        if (clearOf(f, 6, b) && Math.hypot(i, k) < 4.6) boxes.push(b);
      }
  } else if (exposure === 'suburban') {
    // Low houses along two streets, gardens with trees
    for (let n = 0; n < 70; n++) {
      const a = rand() * Math.PI * 2;
      const r = 14 + rand() * 50;
      const b = { x: cx + Math.cos(a) * r, z: cz + Math.sin(a) * r, w: 6 + rand() * 4, d: 7 + rand() * 5, h: 3 + Math.floor(rand() * 3) * 3, roof: rand() > 0.35 };
      if (clearOf(f, 8, b) && boxes.every((o) => Math.abs(o.x - b.x) > (o.w + b.w) / 2 + 2 || Math.abs(o.z - b.z) > (o.d + b.d) / 2 + 2)) boxes.push(b);
    }
    for (let n = 0; n < 60; n++) {
      const a = rand() * Math.PI * 2;
      const r = 9 + rand() * 55;
      const x = cx + Math.cos(a) * r;
      const z = cz + Math.sin(a) * r;
      if (clearOf(f, 3, { x, z, w: 2, d: 2 }) && boxes.every((o) => Math.abs(o.x - x) > o.w / 2 + 1.5 || Math.abs(o.z - z) > o.d / 2 + 1.5)) treeAt(x, z, 0.8 + rand() * 0.7);
    }
  } else {
    // Open: trees in loose clumps and singly, low hills on the horizon
    for (let n = 0; n < 45; n++) {
      const a = rand() * Math.PI * 2;
      const r = 12 + rand() * 60;
      const x = cx + Math.cos(a) * r;
      const z = cz + Math.sin(a) * r;
      if (clearOf(f, 6, { x, z, w: 2, d: 2 })) treeAt(x, z, 0.8 + rand() * 0.8);
    }
    for (let c = 0; c < 14; c++) {
      const a = rand() * Math.PI * 2;
      const r = 16 + rand() * 40;
      const gx = cx + Math.cos(a) * r;
      const gz = cz + Math.sin(a) * r;
      const count = 3 + Math.floor(rand() * 6);
      for (let n = 0; n < count; n++) {
        const x = gx + (rand() - 0.5) * 10;
        const z = gz + (rand() - 0.5) * 10;
        if (clearOf(f, 6, { x, z, w: 2, d: 2 })) treeAt(x, z, 0.9 + rand() * 0.9);
      }
    }
    for (let n = 0; n < 6; n++) {
      const a = (n / 6) * Math.PI * 2 + rand() * 0.6;
      hills.push({ x: cx + Math.cos(a) * (60 + rand() * 20), z: cz + Math.sin(a) * (60 + rand() * 20), r: 22 + rand() * 18, h: 7 + rand() * 9 });
    }
  }
  return { boxes, trees, hills };
}

const PALETTE: Record<SiteExposure, { ground: string; building: string; roof: string; tree: string; trunk: string; hill: string }> = {
  open: { ground: '#34452c', building: '#5a6272', roof: '#6b4e45', tree: '#456b3c', trunk: '#4a3a2e', hill: '#3a4d30' },
  suburban: { ground: '#323c30', building: '#5a6272', roof: '#6e5047', tree: '#41643a', trunk: '#4a3a2e', hill: '#34412d' },
  urbanDense: { ground: '#30343c', building: '#4f5768', roof: '#4f5768', tree: '#3e5c37', trunk: '#4a3a2e', hill: '#30343c' },
};
/** Dusk sky the surroundings fade into */
const SKY = '#1c2230';
const SKY_SIM = '#12151c';

const dim = (hex: string, on: boolean) => (on ? new THREE.Color(hex).multiplyScalar(0.55) : new THREE.Color(hex));

/** One instanced mesh per shape, so dozens of buildings and trees cost a handful of draw calls. */
const Instanced: React.FC<{ geometry: THREE.BufferGeometry; color: THREE.Color; matrices: THREE.Matrix4[] }> = ({ geometry, color, matrices }) => {
  const ref = useRef<THREE.InstancedMesh>(null);
  useEffect(() => {
    const mesh = ref.current;
    if (!mesh) return;
    matrices.forEach((m, i) => mesh.setMatrixAt(i, m));
    mesh.instanceMatrix.needsUpdate = true;
    mesh.computeBoundingSphere();
  }, [matrices]);
  if (matrices.length === 0) return null;
  return (
    <instancedMesh key={matrices.length} ref={ref} args={[geometry, undefined, matrices.length]} raycast={() => null} frustumCulled={false}>
      <meshLambertMaterial color={color} />
    </instancedMesh>
  );
};

const unitBox = new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0);
const unitRoof = new THREE.CylinderGeometry(0, 0.75, 1, 4, 1).rotateY(Math.PI / 4).translate(0, 0.5, 0);
const unitCrown = new THREE.IcosahedronGeometry(1, 0);
const unitTrunk = new THREE.CylinderGeometry(0.12, 0.16, 1, 5).translate(0, 0.5, 0);
const unitHill = new THREE.SphereGeometry(1, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2);

const m4 = (x: number, y: number, z: number, sx: number, sy: number, sz: number) => new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion(), new THREE.Vector3(sx, sy, sz));

export const Scenery: React.FC = () => {
  const room = useSceneStore((s) => s.room);
  const otherRooms = useSceneStore((s) => s.otherRooms);
  const view = useUiStore((s) => s.view);
  const simActive = useSimulationStore((s) => s.viz.show && s.result !== null);
  const exposure: SiteExposure = room.params.exposure ?? 'urbanDense';
  const floorLevel = room.params.floorLevel ?? 0;
  const groundY = -floorLevel * STOREY_HEIGHT_M;

  const footprint = useMemo<Footprint>(() => {
    const f = { minX: Infinity, maxX: -Infinity, minZ: Infinity, maxZ: -Infinity };
    for (const r of [room, ...otherRooms] as Room[]) {
      const b = polygonBounds(r.outline);
      f.minX = Math.min(f.minX, b.min[0] - r.wallThickness);
      f.maxX = Math.max(f.maxX, b.max[0] + r.wallThickness);
      f.minZ = Math.min(f.minZ, b.min[1] - r.wallThickness);
      f.maxZ = Math.max(f.maxZ, b.max[1] + r.wallThickness);
    }
    // Round so small edits (moving a wall a few cm) don't reshuffle the neighbourhood
    const q = (v: number) => Math.round(v);
    return { minX: q(f.minX), maxX: q(f.maxX), minZ: q(f.minZ), maxZ: q(f.maxZ) };
  }, [room, otherRooms]);

  const layout = useMemo(() => layoutFor(exposure, footprint), [exposure, footprint]);
  const pal = PALETTE[exposure];

  const { buildings, roofs, crowns, trunks, hills } = useMemo(
    () => ({
      buildings: layout.boxes.map((b) => m4(b.x, groundY, b.z, b.w, b.h, b.d)),
      roofs: layout.boxes.filter((b) => b.roof).map((b) => m4(b.x, groundY + b.h, b.z, b.w, 2.2, b.d)),
      crowns: layout.trees.map((t) => m4(t.x, groundY + 3.2 * t.s, t.z, 1.9 * t.s, 2.1 * t.s, 1.9 * t.s)),
      trunks: layout.trees.map((t) => m4(t.x, groundY, t.z, t.s, 2.2 * t.s, t.s)),
      hills: layout.hills.map((h) => m4(h.x, groundY - 0.05, h.z, h.r, h.h, h.r)),
    }),
    [layout, groundY]
  );

  if (view === '2d') return null;
  const cx = (footprint.minX + footprint.maxX) / 2;
  const cz = (footprint.minZ + footprint.maxZ) / 2;
  const fw = footprint.maxX - footprint.minX;
  const fd = footprint.maxZ - footprint.minZ;

  return (
    <group name="scenery">
      {/* Dusk sky and distance fog: far scenery fades to a silhouette (the home is well inside the fog start) */}
      <color attach="background" args={[simActive ? SKY_SIM : SKY]} />
      <fog attach="fog" args={[simActive ? SKY_SIM : SKY, 40, 140]} />
      {/* Ground at street level */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[cx, groundY - 0.03, cz]} raycast={() => null}>
        <circleGeometry args={[140, 48]} />
        <meshLambertMaterial color={dim(pal.ground, simActive)} />
      </mesh>
      {/* Streets around the home's block */}
      {exposure !== 'open' && (
        <group position={[cx, groundY - 0.02, cz]}>
          {[-1, 1].map((s) => (
            <mesh key={`x${s}`} rotation={[-Math.PI / 2, 0, 0]} position={[0, 0, s * (fd / 2 + 4)]} raycast={() => null}>
              <planeGeometry args={[260, 5]} />
              <meshLambertMaterial color={dim('#262a31', simActive)} />
            </mesh>
          ))}
          {[-1, 1].map((s) => (
            <mesh key={`z${s}`} rotation={[-Math.PI / 2, 0, 0]} position={[s * (fw / 2 + 4), 0, 0]} raycast={() => null}>
              <planeGeometry args={[5, 260]} />
              <meshLambertMaterial color={dim('#262a31', simActive)} />
            </mesh>
          ))}
        </group>
      )}
      {/* The home's own building below its floor */}
      {floorLevel > 0 && (
        <mesh position={[cx, groundY + (-groundY - 0.05) / 2, cz]} raycast={() => null}>
          <boxGeometry args={[fw + 0.6, -groundY - 0.05, fd + 0.6]} />
          <meshLambertMaterial color={dim('#666f80', simActive)} />
        </mesh>
      )}
      <Instanced geometry={unitBox} color={dim(pal.building, simActive)} matrices={buildings} />
      <Instanced geometry={unitRoof} color={dim(pal.roof, simActive)} matrices={roofs} />
      <Instanced geometry={unitTrunk} color={dim(pal.trunk, simActive)} matrices={trunks} />
      <Instanced geometry={unitCrown} color={dim(pal.tree, simActive)} matrices={crowns} />
      <Instanced geometry={unitHill} color={dim(pal.hill, simActive)} matrices={hills} />
    </group>
  );
};
