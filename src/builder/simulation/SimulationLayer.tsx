import React, { useEffect, useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { Html } from '@react-three/drei';
import * as THREE from 'three';
import { BASE_PARTICLES, MAX_PARTICLES, useSimulationStore } from '../../store/simulationStore';
import { useSimulationModel } from '../../store/useSimulationModel';
import { useGraphicsStore } from '../../store/graphicsStore';
import { useUiStore } from '../../store/uiStore';
import { motionTimeScale, STATUS_COLORS, type ColorScale } from '../../simulation/viz/colormap';
import { isPm25SourceObject } from '../../simulation/sources';
import { sliceToRGBA, verticalSlice, type FieldSlice } from '../../simulation/viz/slice';
import type { GridInfo, Hotspot } from '../../simulation/voxel/analysis';
import { useSceneStore } from '../../store/sceneStore';
import { FloorHeatmap, RoomTint, StaleZoneOutlines } from './FloorHeatmap';
import { OpeningArrows, type OpeningFlow } from './OpeningArrows';
import { CameraBridge } from './cameraBridge';
import { SmokeParticles } from './SmokeParticles';
import { Streamlines } from './Streamlines';
import { useDisplayedField } from './useDisplayedField';
import { useRoomInsights } from './useRoomInsights';
import { useStaleZones } from './useStaleZones';
import { CompareLayer } from './CompareLayer';
import { useScenarioStore } from '../../store/scenarioStore';
import { fitRoomsToRect, FOCUS_ROOM_EVENT, freeViewport, HOUSE_FILL, ROOM_FILL } from './simulationCamera';

/** Height the simulation view cuts the walls to (m). */
export const SIM_WALL_CUT_M = 1.0;

/** Bilinear RGBA texture of a slice; rebuilt only when the slice or colour scale changes. */
function useSliceTexture(slice: FieldSlice | null, scale: ColorScale, flipRows: boolean): THREE.DataTexture | null {
  const [d0, d1] = scale.domain;
  const texture = useMemo(() => {
    if (!slice) return null;
    const tex = new THREE.DataTexture(sliceToRGBA(slice, { ...scale, domain: [d0, d1] }, 200, flipRows), slice.width, slice.height, THREE.RGBAFormat);
    tex.magFilter = THREE.LinearFilter;
    tex.minFilter = THREE.LinearFilter;
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.needsUpdate = true;
    return tex;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slice, scale.field, d0, d1, scale.log, scale.relative, flipRows]);
  useEffect(() => () => texture?.dispose(), [texture]);
  return texture;
}

/** Drawn over furniture: no depth test, high render order. */
const OverlayMaterial: React.FC<{ map: THREE.Texture; opacity?: number }> = ({ map, opacity = 1 }) => (
  <meshBasicMaterial map={map} transparent opacity={opacity} side={THREE.DoubleSide} depthWrite={false} depthTest={false} toneMapped={false} />
);

/** Optional mid-air vertical slice (Advanced). */
const VerticalSlice: React.FC<{ grid: GridInfo; values: Float32Array; scale: ColorScale; axis: 'x' | 'z'; position: number }> = ({ grid, values, scale, axis, position }) => {
  const slice = useMemo(() => verticalSlice(grid, values, axis, position), [grid, values, axis, position]);
  const tex = useSliceTexture(slice, scale, false);
  if (!tex) return null;
  const h = grid.ny * grid.dx;
  const at = (axis === 'z' ? grid.origin[2] : grid.origin[0]) + (slice.layer + 0.5) * grid.dx;
  const w = (axis === 'z' ? grid.nx : grid.nz) * grid.dx;
  return axis === 'z' ? (
    <mesh position={[grid.origin[0] + w / 2, grid.origin[1] + h / 2, at]} renderOrder={950} raycast={() => null}>
      <planeGeometry args={[w, h]} />
      <OverlayMaterial map={tex} />
    </mesh>
  ) : (
    <mesh position={[at, grid.origin[1] + h / 2, grid.origin[2] + w / 2]} rotation={[0, -Math.PI / 2, 0]} renderOrder={950} raycast={() => null}>
      <planeGeometry args={[w, h]} />
      <OverlayMaterial map={tex} />
    </mesh>
  );
};

/** Arrows of the horizontal velocity on the slice, every ~0.5 m, length ∝ speed. */
const VectorArrows: React.FC<{ grid: GridInfo; velocity: Float32Array; sliceY: number; drawY: number }> = ({ grid, velocity, sliceY, drawY }) => {
  const geometry = useMemo(() => {
    const step = Math.max(1, Math.round(0.5 / grid.dx));
    const j = Math.min(grid.ny - 1, Math.max(0, Math.floor((sliceY - grid.origin[1]) / grid.dx)));
    const pts: number[] = [];
    for (let k = 0; k < grid.nz; k += step)
      for (let i = 0; i < grid.nx; i += step) {
        const c = i + grid.nx * (j + grid.ny * k);
        const u = velocity[3 * c]!;
        const w = velocity[3 * c + 2]!;
        const sp = Math.hypot(u, w);
        if (sp < 0.005) continue;
        const len = Math.min(0.45, sp * 1.5);
        const x0 = grid.origin[0] + (i + 0.5) * grid.dx;
        const z0 = grid.origin[2] + (k + 0.5) * grid.dx;
        const ux = u / sp;
        const uz = w / sp;
        const x1 = x0 + ux * len;
        const z1 = z0 + uz * len;
        pts.push(x0, drawY, z0, x1, drawY, z1);
        pts.push(x1, drawY, z1, x1 - ux * 0.08 - uz * 0.05, drawY, z1 - uz * 0.08 + ux * 0.05);
        pts.push(x1, drawY, z1, x1 - ux * 0.08 + uz * 0.05, drawY, z1 - uz * 0.08 - ux * 0.05);
      }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(pts), 3));
    return g;
  }, [grid, velocity, sliceY, drawY]);
  useEffect(() => () => geometry.dispose(), [geometry]);
  return (
    <lineSegments geometry={geometry} renderOrder={995} raycast={() => null}>
      <lineBasicMaterial color="#f5f5f5" transparent opacity={0.85} depthTest={false} depthWrite={false} />
    </lineSegments>
  );
};

/**
 * Makes furniture semi-transparent (25 %) while active (meshes under groups named `asset-*`, except
 * PM2.5 source markers, which stay solid), restoring the materials when switched off. Re-applied
 * periodically so late-loading models are ghosted too.
 */
const FurnitureGhost: React.FC<{ active: boolean; keep: ReadonlySet<string> }> = ({ active, keep }) => {
  const scene = useThree((s) => s.scene);
  const touched = useRef(new Map<THREE.Material, { opacity: number; transparent: boolean; depthWrite: boolean }>());
  const frame = useRef(0);
  const apply = useMemo(
    () => () => {
      scene.traverse((o) => {
        if (!o.name.startsWith('asset-') || keep.has(o.name.slice(6))) return;
        o.traverse((m) => {
          const mesh = m as THREE.Mesh;
          if (!mesh.isMesh) return;
          const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
          for (const mat of mats) {
            if (!mat || touched.current.has(mat)) continue;
            touched.current.set(mat, { opacity: mat.opacity, transparent: mat.transparent, depthWrite: mat.depthWrite });
            mat.transparent = true;
            mat.opacity = Math.min(mat.opacity, 0.25);
            mat.depthWrite = false;
            mat.needsUpdate = true;
          }
        });
      });
    },
    [scene, keep]
  );
  useEffect(() => {
    const map = touched.current;
    if (active) apply();
    return () => {
      for (const [mat, orig] of map) {
        mat.opacity = orig.opacity;
        mat.transparent = orig.transparent;
        mat.depthWrite = orig.depthWrite;
        mat.needsUpdate = true;
      }
      map.clear();
    };
  }, [active, apply]);
  useFrame(() => {
    if (active && ++frame.current % 30 === 0) apply();
  });
  return null;
};

const HotspotBox: React.FC<{ h: Hotspot; color: string; label: string }> = ({ h, color, label }) => {
  const sx = h.boundsMax[0] - h.boundsMin[0];
  const sy = h.boundsMax[1] - h.boundsMin[1];
  const sz = h.boundsMax[2] - h.boundsMin[2];
  const edges = useMemo(() => new THREE.EdgesGeometry(new THREE.BoxGeometry(sx, sy, sz)), [sx, sy, sz]);
  useEffect(() => () => edges.dispose(), [edges]);
  return (
    <group position={[(h.boundsMax[0] + h.boundsMin[0]) / 2, (h.boundsMax[1] + h.boundsMin[1]) / 2, (h.boundsMax[2] + h.boundsMin[2]) / 2]}>
      <lineSegments geometry={edges} raycast={() => null} renderOrder={990}>
        <lineBasicMaterial color={color} transparent opacity={0.8} depthTest={false} />
      </lineSegments>
      <Html center position={[0, sy / 2 + 0.15, 0]} style={{ pointerEvents: 'none' }}>
        <div className="px-1.5 py-0.5 rounded bg-black/75 border text-[10px] font-medium text-neutral-100 whitespace-nowrap" style={{ borderColor: color }}>
          {label}
        </div>
      </Html>
    </group>
  );
};

/** While on: walls cut to SIM_WALL_CUT_M and opaque (Phase 1 "Cutaway" mode), restored afterwards. */
const SimulationWalls: React.FC = () => {
  useEffect(() => {
    const g = useGraphicsStore.getState();
    const previous = g.wallOpacityMode;
    g.setWallOpacityMode('Cutaway');
    g.setWallCutHeight(SIM_WALL_CUT_M);
    return () => {
      const st = useGraphicsStore.getState();
      st.setWallCutHeight(null);
      st.setWallOpacityMode(previous);
    };
  }, []);
  return null;
};

/**
 * Fits the house into the free part of the canvas when the layer turns on, when a run finishes
 * and when the view switches; frames one room on FOCUS_ROOM_EVENT (after making it active, the
 * Phase 1 room switch).
 */
const SimulationFraming: React.FC<{ result: unknown }> = ({ result }) => {
  const camera = useThree((s) => s.camera);
  const controls = useThree((s) => s.controls) as unknown as Parameters<typeof fitRoomsToRect>[2];
  const size = useThree((s) => s.size);
  const gl = useThree((s) => s.gl);
  const view = useUiStore((s) => s.view);
  const sizeRef = useRef(size);
  sizeRef.current = size;

  useEffect(() => {
    const fit = (roomIds: string[] | null) => {
      const { room, otherRooms } = useSceneStore.getState();
      const all = [room, ...otherRooms];
      const rooms = roomIds ? all.filter((r) => r.id && roomIds.includes(r.id)) : all;
      const container = gl.domElement.parentElement ?? gl.domElement;
      fitRoomsToRect(rooms, camera, controls, sizeRef.current, freeViewport(container), {
        fill: roomIds ? ROOM_FILL : HOUSE_FILL,
        topDown: useUiStore.getState().view === '2d',
        height: SIM_WALL_CUT_M,
      });
    };
    // Let the legend and panels lay out first, and run after Phase 1's own view-change framing
    const id = window.setTimeout(() => fit(null), 120);
    const onFocus = (e: Event) => {
      const roomId = (e as CustomEvent<string>).detail;
      if (!roomId) return;
      useSceneStore.getState().setActiveRoom(roomId);
      fit([roomId]);
    };
    const onHouse = () => fit(null);
    window.addEventListener(FOCUS_ROOM_EVENT, onFocus);
    window.addEventListener('airforce:simulation-view', onHouse);
    return () => {
      window.clearTimeout(id);
      window.removeEventListener(FOCUS_ROOM_EVENT, onFocus);
      window.removeEventListener('airforce:simulation-view', onHouse);
    };
  }, [camera, controls, gl, result, view]);
  return null;
};

/**
 * The simulation layer, one story per view mode:
 * - Pollution: PM2.5 on the floor of each room + smoke from active sources
 * - Ventilation: age of air + outlines of the (at most three) stalest zones + faint streamlines
 * - Airflow: streamlines + opening flow arrows over a per-room air-change tint
 * Room chips and the legend are DOM overlays (RoomChips, SimulationLegend).
 */
export const SimulationLayer: React.FC = () => {
  const displayed = useDisplayedField();
  const viz = useSimulationStore((s) => s.viz);
  const { rooms, network, stale } = useSimulationModel();
  const view = useUiStore((s) => s.view);
  const overlay = view === '2d';
  const result = displayed?.result ?? null;
  // Fans move air fast: slow the playback so it still looks like air, not a stream of sparks
  const timeScale = motionTimeScale(result?.velocity.maxSpeed ?? 0, viz.timeScale);
  const insights = useRoomInsights();
  const comparing = useScenarioStore((s) => s.compare !== null);
  const staleZones = useStaleZones();
  const tint = useMemo(() => new Map((insights?.mode === 'airflow' ? insights.rows : []).map((r) => [r.roomId, r.color])), [insights]);

  const resultRooms = useMemo(() => (result ? rooms.filter((r) => result.zones.some((z) => z.roomId === r.id)) : []), [rooms, result]);
  const sourceIds = useMemo(() => new Set(rooms.flatMap((r) => r.objects.filter(isPm25SourceObject).map((o) => o.id))), [rooms]);
  const flows = useMemo(() => {
    const m = new Map<string, OpeningFlow>();
    if (result && !stale) for (const p of result.paths) m.set(p.id, { netM3s: p.voxelFlowM3s, exchangeM3s: p.voxelExchangeM3s });
    else for (const p of network.paths) m.set(p.id, { netM3s: p.flowM3s, exchangeM3s: Math.max(p.forwardM3s, p.backwardM3s) });
    return m;
  }, [result, stale, network]);

  const active = viz.show && result !== null;
  if (!active || !displayed || !result) return active ? <CameraBridge /> : null;
  const { grid } = result;
  const { mode } = viz;
  const verticalPos = viz.vertical.position ?? (viz.vertical.axis === 'x' ? grid.origin[0] + (grid.nx * grid.dx) / 2 : grid.origin[2] + (grid.nz * grid.dx) / 2);
  const moving = result.velocity.maxSpeed > 1e-4;
  const smokeCount = Math.min(MAX_PARTICLES, Math.round(BASE_PARTICLES * viz.density));

  return (
    <group name="simulation-layer">
      <CameraBridge />
      <SimulationFraming result={result} />
      {viz.cutaway && <SimulationWalls />}
      <FurnitureGhost active={viz.ghostFurniture} keep={sourceIds} />
      {comparing && <CompareLayer rooms={resultRooms} sampleY={viz.sliceHeight} />}
      {!comparing && displayed.values && displayed.scale && (
        <FloorHeatmap
          rooms={resultRooms}
          grid={grid}
          values={displayed.values}
          scale={displayed.scale}
          sampleY={viz.sliceHeight}
        />
      )}
      {mode === 'airflow' && <RoomTint rooms={resultRooms} grid={grid} colors={tint} />}
      {mode === 'ventilation' && !comparing && <StaleZoneOutlines zones={staleZones} />}
      {viz.vertical.enabled && !overlay && displayed.values && displayed.scale && (
        <VerticalSlice grid={grid} values={displayed.values} scale={displayed.scale} axis={viz.vertical.axis} position={verticalPos} />
      )}
      {moving && viz.streamlines && mode === 'airflow' && !comparing && <Streamlines result={result} speedRef={displayed.speedRef} timeScale={timeScale} density={viz.density} />}
      {moving && viz.streamlines && mode === 'ventilation' && !comparing && <Streamlines result={result} speedRef={displayed.speedRef} timeScale={timeScale} density={viz.density * 0.6} width={1.4} opacity={0.45} />}
      {mode === 'airflow' && viz.openingArrows && <OpeningArrows house={network.house} flows={flows} />}
      {mode === 'pollution' && viz.smoke && displayed.scale && !comparing && (
        <SmokeParticles key={smokeCount} result={result} rooms={rooms} timeS={displayed.timeS} pm25={displayed.pm25} scale={displayed.scale} count={smokeCount} timeScale={timeScale} />
      )}
      {viz.arrows && <VectorArrows grid={grid} velocity={result.velocity.cell} sliceY={viz.sliceHeight} drawY={SIM_WALL_CUT_M + 0.05} />}
      {viz.hotspots &&
        !overlay &&
        result.hotspots.pm25.slice(0, 3).map((h, i) => <HotspotBox key={`pm-${i}`} h={h} color={STATUS_COLORS.serious} label={`PM2.5 hotspot · ${h.mean.toFixed(0)} µg/m³`} />)}
    </group>
  );
};
