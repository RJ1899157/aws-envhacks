import React, { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { Line } from '@react-three/drei';
import type { Line2, LineMaterial, LineSegments2 } from 'three-stdlib';
import * as THREE from 'three';
import type { Room } from '../../core/schema';
import { AQI_BOUNDARIES, STATUS_COLORS, type ColorScale } from '../../simulation/viz/colormap';
import { horizontalSlice, marchingSquares, sliceToRGBA, type FieldSlice } from '../../simulation/viz/slice';
import type { StaleZone } from '../../simulation/viz/stagnation';
import type { GridInfo } from '../../simulation/voxel/analysis';

/** Heights (m) of the floor layers. They draw first among transparent objects (negative renderOrder), so ghosted furniture blends over them. */
const HEAT_Y = 0.02;
const CONTOUR_Y = 0.032;
const STALE_Y = 0.04;

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

function dataTexture(data: Uint8Array<ArrayBuffer>, w: number, h: number, nearest = false): THREE.DataTexture {
  const tex = new THREE.DataTexture(data, w, h, THREE.RGBAFormat);
  tex.magFilter = nearest ? THREE.NearestFilter : THREE.LinearFilter;
  tex.minFilter = THREE.LinearFilter;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.needsUpdate = true;
  return tex;
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
  const [d0, d1] = scale.domain;
  const texture = useMemo(
    () => dataTexture(sliceToRGBA(slice, { field: scale.field, domain: [d0, d1], log: scale.log, relative: scale.relative }, 235), slice.width, slice.height),
    [slice, scale.field, d0, d1, scale.log, scale.relative]
  );
  useEffect(() => () => texture.dispose(), [texture]);
  const heatGeoms = useRoomGeometries(rooms, grid, HEAT_Y);

  return (
    <group name="sim-floor-heatmap">
      {heatGeoms.map((g, i) => (
        <mesh key={i} geometry={g} renderOrder={-3} raycast={() => null}>
          <meshBasicMaterial map={texture} transparent side={THREE.DoubleSide} depthWrite={false} toneMapped={false} polygonOffset polygonOffsetFactor={-2} polygonOffsetUnits={-2} clippingPlanes={clippingPlanes ?? null} />
        </mesh>
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
