import React, { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { Line } from '@react-three/drei';
import type { Line2, LineMaterial, LineSegments2 } from 'three-stdlib';
import * as THREE from 'three';
import type { Room } from '../../core/schema';
import { AQI_BOUNDARIES, STATUS_COLORS, mapValue, type ColorScale } from '../../simulation/viz/colormap';
import { fillSolids, horizontalSlice, marchingSquares, type FieldSlice } from '../../simulation/viz/slice';
import type { StaleZone } from '../../simulation/viz/stagnation';
import type { GridInfo } from '../../simulation/voxel/analysis';

/** Heights (m) of the floor layers. They draw first among transparent objects (negative renderOrder), so ghosted furniture blends over them. */
const HEAT_Y = 0.02;
const CONTOUR_Y = 0.032;
const STALE_Y = 0.04;
/** Entries of the colour lookup table (band steps land within domain / LUT_SIZE of their value) */
const LUT_SIZE = 2048;
const HEAT_ALPHA = 235 / 255;

/**
 * Floor polygon of a room in world XZ at height y, with UVs mapping world position onto the grid
 * texture (u along +x, v along +z). Clipping the heatmap to the room outline exactly keeps it off
 * the walls and out of the outdoor margin.
 */
function roomFloorGeometry(outline: Room['outline'], grid: GridInfo, y: number): THREE.BufferGeometry {
  const contour = outline.map(([x, z]) => new THREE.Vector2(x, z));
  const tris = THREE.ShapeUtils.triangulateShape(contour, []);
  const W = grid.nx * grid.dx;
  const D = grid.nz * grid.dx;
  const pos = new Float32Array(outline.length * 3);
  const uv = new Float32Array(outline.length * 2);
  outline.forEach(([x, z], i) => {
    pos.set([x, y, z], i * 3);
    uv.set([(x - grid.origin[0]) / W, (z - grid.origin[2]) / D], i * 2);
  });
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  g.setIndex(tris.flat());
  return g;
}

function useRoomGeometries(rooms: readonly Room[], grid: GridInfo, y: number): THREE.BufferGeometry[] {
  const geometries = useMemo(() => rooms.filter((r) => r.outline.length >= 3).map((r) => roomFloorGeometry(r.outline, grid, y)), [rooms, grid, y]);
  useEffect(() => () => geometries.forEach((g) => g.dispose()), [geometries]);
  return geometries;
}

/** The slice as a float texture, one texel per cell (interpolated in the shader). NaN → 0. */
function fieldTexture(slice: FieldSlice): THREE.DataTexture {
  const data = Float32Array.from(slice.values, (v) => (Number.isFinite(v) ? v : 0));
  const tex = new THREE.DataTexture(data, slice.width, slice.height, THREE.RedFormat, THREE.FloatType);
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestFilter;
  tex.needsUpdate = true;
  return tex;
}

/** The scale's colours sampled evenly along its 0–1 position (linear or log), so the shader matches mapValue exactly. */
function colorLut(scale: ColorScale): THREE.DataTexture {
  const [lo, hi] = scale.domain;
  const log = Boolean(scale.log && lo > 0);
  const data = new Uint8Array(LUT_SIZE * 4);
  const rgba: [number, number, number, number] = [0, 0, 0, 0];
  for (let i = 0; i < LUT_SIZE; i++) {
    const t = (i + 0.5) / LUT_SIZE;
    const v = log ? lo * Math.pow(hi / lo, t) : lo + t * (hi - lo);
    mapValue(scale, v, 255, rgba);
    data.set(rgba, i * 4);
  }
  const tex = new THREE.DataTexture(data, LUT_SIZE, 1, THREE.RGBAFormat);
  // Nearest keeps the AQI band steps sharp; the field itself is interpolated per pixel
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestFilter;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.needsUpdate = true;
  return tex;
}

const HEAT_VERTEX = /* glsl */ `
#include <clipping_planes_pars_vertex>
varying vec2 vUv;
void main() {
  vUv = uv;
  #include <begin_vertex>
  #include <project_vertex>
  #include <clipping_planes_vertex>
}`;

/**
 * Per pixel: bilinear interpolation of the cell-centred field, then the colour of that value. The
 * field is smooth at any zoom and band boundaries are crisp curves, not cell-sized steps.
 */
const HEAT_FRAGMENT = /* glsl */ `
#include <clipping_planes_pars_fragment>
uniform sampler2D field;
uniform ivec2 size;
uniform sampler2D lut;
uniform float lo;
uniform float hi;
uniform bool logScale;
uniform float opacity;
varying vec2 vUv;
float cell(ivec2 c) { return texelFetch(field, clamp(c, ivec2(0), size - 1), 0).r; }
void main() {
  #include <clipping_planes_fragment>
  vec2 p = vUv * vec2(size) - 0.5;
  vec2 i0 = floor(p);
  vec2 f = p - i0;
  ivec2 c = ivec2(i0);
  float v = mix(mix(cell(c), cell(c + ivec2(1, 0)), f.x), mix(cell(c + ivec2(0, 1)), cell(c + ivec2(1, 1)), f.x), f.y);
  float t = logScale ? log(max(v, lo) / lo) / log(hi / lo) : (v - lo) / max(1e-6, hi - lo);
  gl_FragColor = vec4(texture2D(lut, vec2(clamp(t, 0.0, 1.0), 0.5)).rgb, opacity);
  #include <colorspace_fragment>
}`;

function useHeatMaterial(slice: FieldSlice, scale: ColorScale, clippingPlanes?: THREE.Plane[]): THREE.ShaderMaterial {
  const field = useMemo(() => fieldTexture(slice), [slice]);
  const [lo, hi] = scale.domain;
  const lut = useMemo(() => colorLut({ field: scale.field, domain: [lo, hi], log: scale.log, relative: scale.relative }), [scale.field, lo, hi, scale.log, scale.relative]);
  const material = useMemo(
    () =>
      new THREE.ShaderMaterial({
        vertexShader: HEAT_VERTEX,
        fragmentShader: HEAT_FRAGMENT,
        uniforms: {
          field: { value: null },
          size: { value: new THREE.Vector2(1, 1) },
          lut: { value: null },
          lo: { value: 0 },
          hi: { value: 1 },
          logScale: { value: false },
          opacity: { value: HEAT_ALPHA },
        },
        transparent: true,
        side: THREE.DoubleSide,
        depthWrite: false,
        clipping: true,
        polygonOffset: true,
        polygonOffsetFactor: -2,
        polygonOffsetUnits: -2,
      }),
    []
  );
  const u = material.uniforms;
  u.field!.value = field;
  (u.size!.value as THREE.Vector2).set(slice.width, slice.height);
  u.lut!.value = lut;
  u.lo!.value = lo;
  u.hi!.value = hi;
  u.logScale!.value = Boolean(scale.log && lo > 0);
  material.clippingPlanes = clippingPlanes ?? null;
  useEffect(() => () => field.dispose(), [field]);
  useEffect(() => () => lut.dispose(), [lut]);
  useEffect(() => () => material.dispose(), [material]);
  return material;
}

/** Contour segments of a slice at the given levels, as world-space line geometry at height y. */
function contourGeometry(slice: FieldSlice, grid: GridInfo, levels: readonly number[], y: number, skipNaN: boolean): THREE.BufferGeometry {
  const pts: number[] = [];
  for (const level of levels)
    for (const [x0, z0, x1, z1] of marchingSquares(slice, level, skipNaN)) {
      pts.push(grid.origin[0] + x0 * grid.dx, y, grid.origin[2] + z0 * grid.dx, grid.origin[0] + x1 * grid.dx, y, grid.origin[2] + z1 * grid.dx);
    }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(pts), 3));
  return g;
}

const Contours: React.FC<{ slice: FieldSlice; grid: GridInfo; levels: readonly number[]; color: string; opacity: number; y?: number }> = ({ slice, grid, levels, color, opacity, y = CONTOUR_Y }) => {
  const geometry = useMemo(() => contourGeometry(slice, grid, levels, y, true), [slice, grid, levels, y]);
  useEffect(() => () => geometry.dispose(), [geometry]);
  return (
    <lineSegments geometry={geometry} renderOrder={-1} raycast={() => null}>
      <lineBasicMaterial color={color} transparent opacity={opacity} depthWrite={false} />
    </lineSegments>
  );
};

export interface FloorHeatmapProps {
  rooms: readonly Room[];
  grid: GridInfo;
  values: Float32Array;
  scale: ColorScale;
  /** Height the field is sampled at (m) */
  sampleY: number;
  /** Compare swipe: draw only one side of these planes */
  clippingPlanes?: THREE.Plane[];
}

/**
 * Airflow view: no field heatmap; each room's floor is tinted by its outdoor-air changes per hour
 * (the same colour as its chip), which also gives the streamlines a dark, even backdrop.
 */
export const RoomTint: React.FC<{ rooms: readonly Room[]; grid: GridInfo; colors: ReadonlyMap<string, string> }> = ({ rooms, grid, colors }) => {
  const valid = useMemo(() => rooms.filter((r) => r.outline.length >= 3), [rooms]);
  const geoms = useRoomGeometries(valid, grid, HEAT_Y);
  return (
    <group name="sim-floor-tint">
      {geoms.map((g, i) => (
        <mesh key={i} geometry={g} renderOrder={-3} raycast={() => null}>
          <meshBasicMaterial color={colors.get(valid[i]!.id ?? '') ?? '#0b1220'} transparent opacity={0.92} side={THREE.DoubleSide} depthWrite={false} toneMapped={false} polygonOffset polygonOffsetFactor={-2} polygonOffsetUnits={-2} />
        </mesh>
      ))}
    </group>
  );
};

/**
 * One heatmap layer: the field at the sampled height, projected onto the floor of each room and
 * clipped to it, with faint contour lines at the AQI band boundaries for PM2.5.
 */
export const FloorHeatmap: React.FC<FloorHeatmapProps> = ({ rooms, grid, values, scale, sampleY, clippingPlanes }) => {
  const slice = useMemo(() => horizontalSlice(grid, values, sampleY), [grid, values, sampleY]);
  // Furniture and wall cells take the air around them, so the floor under a wardrobe isn't a hole
  const filled = useMemo(() => fillSolids(slice), [slice]);
  const material = useHeatMaterial(filled, scale, clippingPlanes);
  const heatGeoms = useRoomGeometries(rooms, grid, HEAT_Y);

  return (
    <group name="sim-floor-heatmap">
      {heatGeoms.map((g, i) => (
        <mesh key={i} geometry={g} material={material} renderOrder={-3} raycast={() => null} />
      ))}
      {scale.field === 'pm25' && !scale.relative && !clippingPlanes && <Contours slice={slice} grid={grid} levels={AQI_BOUNDARIES} color="#f8fafc" opacity={0.3} />}
    </group>
  );
};

/** Stale-zone highlight colour: red reads against both ends of viridis (yellow stale air, purple fresh). */
export const STALE_COLOR = STATUS_COLORS.critical;

/**
 * Outlines of the (at most three) stalest zones: a clean red line with a slow, subtle pulse.
 * Their labels are DOM chips (RoomChips), so they take part in label collision avoidance.
 */
export const StaleZoneOutlines: React.FC<{ zones: readonly StaleZone[] }> = ({ zones }) => {
  const points = useMemo(() => zones.flatMap((z) => z.segments.flatMap(([x0, z0, x1, z1]) => [new THREE.Vector3(x0, STALE_Y, z0), new THREE.Vector3(x1, STALE_Y, z1)])), [zones]);
  const ref = useRef<Line2 | LineSegments2>(null);
  useFrame(({ clock }) => {
    const mat = ref.current?.material as LineMaterial | undefined;
    if (mat) mat.opacity = 0.8 + 0.2 * Math.sin(clock.elapsedTime * 1.6);
  });
  if (points.length === 0) return null;
  return <Line ref={ref} name="sim-stale-zones" points={points} segments color={STALE_COLOR} lineWidth={3} transparent opacity={0.9} depthTest={false} depthWrite={false} renderOrder={996} raycast={() => null} />;
};
