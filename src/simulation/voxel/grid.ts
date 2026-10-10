import { pointInPolygon, polygonBounds, wallSegment } from '../../core/parser';
import type { Room, SceneObject, Vec2 } from '../../core/schema';
import { CellType } from '../../core/voxelizer';
import {
  AC_FILTRATION_EFFICIENCY,
  DISCHARGE_COEFFICIENT,
  FAN_JET_DIAMETER_FRACTION,
  GRAVITY,
  HOUSE_MARGIN_M,
  INFILTRATION_PENETRATION,
  JET_DEPTH_M,
  OPEN_WINDOW_PENETRATION,
  PURIFIER_SINGLE_PASS_EFFICIENCY,
  SECONDS_PER_HOUR,
} from '../constants';
import type { Device } from '../devices';
import type { House, HousePath } from '../house/house';
import { roomPm25Sources } from '../sources';

/**
 * Whole-house simulation domain on one MAC (staggered) grid:
 * - cell (i, j, k) centre at origin + (i + ½, j + ½, k + ½)·dx, index i + nx·(j + ny·k)
 * - u (x-normal) faces at x = origin + i·dx, i ∈ [0, nx], index i + (nx+1)·(j + ny·k)
 * - v (y-normal) faces, j ∈ [0, ny], index i + nx·(j + (ny+1)·k)
 * - w (z-normal) faces, k ∈ [0, nz], index i + nx·(j + ny·k)
 *
 * Every room is a zone. A floor column belongs to the room whose outline, grown by half a wall
 * thickness, contains it, so neighbouring rooms meet at the middle of their shared wall and a thin
 * wall can never vanish between cells; the rest is the outdoor margin. Walls are faces: a face is
 * open only between cells of the same room, or where an opening of the house model crosses it:
 * - interior openings and door undercuts: open faces with an orifice loss
 * - exterior openings: pressure faces at the wind (+ stack) pressure, with the same orifice loss
 * The loss coefficient per face, K = (A_voxel / (Cd·A_open))², makes the voxel flow through an
 * opening follow Q = Cd·A·sqrt(2Δp/ρ) whatever the voxelized hole size.
 */

export const FaceType = {
  /** No-penetration wall (velocity fixed at 0) */
  SOLID: 0,
  /** Between two fluid cells; solved */
  INTERIOR: 1,
  /** Fixed velocity (unused by the pressure-driven house domain; kept for completeness) */
  PRESCRIBED: 2,
  /** Open to outdoors at a given pressure; velocity solved, scalars upwinded (outdoor value on inflow) */
  PRESSURE: 3,
} as const;

export type Axis = 0 | 1 | 2;

export interface FaceRef {
  axis: Axis;
  index: number;
  /** Fluid cell on the `from` side of the path */
  cell: number;
  /** +1 if the `to` side lies in the +axis direction of `cell`, −1 otherwise */
  outward: 1 | -1;
}

export interface DomainOpening {
  /** House path id (opening id, `<id>:undercut`) */
  id: string;
  kind: HousePath['kind'];
  from: number;
  to: number;
  faces: FaceRef[];
  /** Voxelized open area (m²) */
  voxelArea: number;
  /** Open area of the opening in the house model (m²) */
  areaM2: number;
  /** Orifice loss coefficient applied on its faces */
  loss: number;
}

export interface Jet {
  deviceId: string;
  axis: Axis;
  index: number;
  target: number;
}

export interface Recirculator {
  deviceId: string;
  /** Air moved through the unit (m³/s) */
  flowM3s: number;
  /** Fraction of PM2.5 removed per pass; the outlet returns (1 − efficiency)·C̄_intake */
  efficiency: number;
  intake: Int32Array;
  outlet: Int32Array;
}

export interface FaceList {
  u: Int32Array;
  v: Int32Array;
  w: Int32Array;
}

export interface DomainZone {
  index: number;
  roomId: string;
  name: string;
  cells: number;
  volumeM3: number;
}

export interface VoxelDomain {
  nx: number;
  ny: number;
  nz: number;
  dx: number;
  origin: [number, number, number];
  /** Cell types (core/voxelizer CellType): FLUID / SOLID / POROUS / SOURCE */
  cells: Uint8Array;
  /** 1 for cells the air moves through (FLUID, POROUS, SOURCE) */
  fluid: Uint8Array;
  fluidCount: number;
  /** Zone (room index) of every cell; −1 outdoors */
  zoneOf: Int16Array;
  zones: DomainZone[];
  uType: Uint8Array;
  vType: Uint8Array;
  wType: Uint8Array;
  /** Prescribed face velocities (m/s); zero in the pressure-driven house domain */
  uFixed: Float64Array;
  vFixed: Float64Array;
  wFixed: Float64Array;
  /** Orifice loss coefficient K per face (0 = none) */
  uLoss: Float32Array;
  vLoss: Float32Array;
  wLoss: Float32Array;
  /** Outdoor pressure (Pa, relative to the indoor hydrostatic reference) on PRESSURE faces */
  uPressure: Float64Array;
  vPressure: Float64Array;
  wPressure: Float64Array;
  /** Air density used to turn pressures into velocities */
  rho: number;
  /** Faces next to a porous cell (damped) */
  porousFaces: FaceList;
  openings: DomainOpening[];
  jets: Jet[];
  /** Per-cell volumetric sink (≤ 0, 1/s): exhaust devices, recirculator intakes, uniform leakage */
  sSink: Float64Array;
  /** Per-cell volumetric source (≥ 0, 1/s): uniform make-up air through the envelope */
  sSource: Float64Array;
  recirculators: Recirculator[];
  /** Per-cell volumetric source (≥ 0, 1/s) of recirculator outlets */
  sReturn: Float64Array;
  /** Per-cell PM2.5 emission (µg/s per cell) for each source, with its schedule */
  sources: { id: string; zone: number; perCell: Float64Array; schedule?: { startMin: number; durationMin: number }[] }[];
  hasPressureBoundary: boolean;
  /** Concentration of air entering through openings (P·C_out) and through the envelope (P_crack·C_out) */
  inflowUgM3: number;
  envelopeInflowUgM3: number;
  /** Uniform envelope infiltration exchange rate (1/s) */
  infiltrationPerS: number;
  devices: Device[];
  warnings: string[];
}

interface Box {
  cx: number;
  cz: number;
  hw: number;
  hd: number;
  base: number;
  top: number;
  rot: number;
  clamped: boolean;
}

/** Unit vector of an object's local +Z (its front) in world XZ, matching three.js rotation.y. */
export function objectForward(obj: SceneObject): [number, number] {
  const r = obj.rotation?.[1] ?? 0;
  return [Math.sin(r), Math.cos(r)];
}

/** World box of an object (base at position.y + elevation, rotation.y); moved under the ceiling if needed. */
function objectBox(obj: SceneObject, ceiling: number): Box {
  const sx = obj.scale?.[0] ?? 1;
  const sy = obj.scale?.[1] ?? 1;
  const sz = obj.scale?.[2] ?? 1;
  const h = obj.size[1] * sy;
  let base = (obj.position[1] ?? 0) + (obj.elevation ?? 0);
  const clamped = base + h > ceiling + 1e-6;
  if (clamped) base = Math.max(0, ceiling - h);
  return { cx: obj.position[0], cz: obj.position[2], hw: (obj.size[0] * sx) / 2, hd: (obj.size[2] * sz) / 2, base, top: base + h, rot: obj.rotation?.[1] ?? 0, clamped };
}

function distanceToOutline(p: Vec2, outline: readonly Vec2[]): number {
  let best = Infinity;
  for (let i = 0; i < outline.length; i++) {
    const a = outline[i]!;
    const b = outline[(i + 1) % outline.length]!;
    const ex = b[0] - a[0];
    const ez = b[1] - a[1];
    const len2 = ex * ex + ez * ez;
    const t = len2 > 0 ? Math.max(0, Math.min(1, ((p[0] - a[0]) * ex + (p[1] - a[1]) * ez) / len2)) : 0;
    best = Math.min(best, Math.hypot(p[0] - a[0] - t * ex, p[1] - a[1] - t * ez));
  }
  return best;
}

function normalize(v: [number, number, number]): [number, number, number] {
  const l = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / l, v[1] / l, v[2] / l];
}

export interface DomainInput {
  house: House;
  dx: number;
  marginM?: number;
}

export function buildDomain({ house, dx, marginM = HOUSE_MARGIN_M }: DomainInput): VoxelDomain {
  const warnings: string[] = [];
  const rooms: Room[] = house.zones.map((z) => z.room);

  // --- Grid extent: all rooms + walls + outdoor margin --------------------------------------------
  let minX = Infinity;
  let minZ = Infinity;
  let maxX = -Infinity;
  let maxZ = -Infinity;
  let maxH = 0;
  for (const r of rooms) {
    const b = polygonBounds(r.outline);
    const pad = r.wallThickness;
    minX = Math.min(minX, b.min[0] - pad);
    minZ = Math.min(minZ, b.min[1] - pad);
    maxX = Math.max(maxX, b.max[0] + pad);
    maxZ = Math.max(maxZ, b.max[1] + pad);
    maxH = Math.max(maxH, r.wallHeight);
  }
  const originX = Math.floor((minX - marginM) / dx) * dx;
  const originZ = Math.floor((minZ - marginM) / dx) * dx;
  const nx = Math.ceil((maxX + marginM - originX) / dx);
  const nz = Math.ceil((maxZ + marginM - originZ) / dx);
  const ny = Math.max(1, Math.round(maxH / dx));
  const origin: [number, number, number] = [originX, 0, originZ];
  const n = nx * ny * nz;
  const cell = (i: number, j: number, k: number) => i + nx * (j + ny * k);
  const uIdx = (i: number, j: number, k: number) => i + (nx + 1) * (j + ny * k);
  const vIdx = (i: number, j: number, k: number) => i + nx * (j + (ny + 1) * k);
  const wIdx = (i: number, j: number, k: number) => i + nx * (j + ny * k);
  const cx = (i: number) => originX + (i + 0.5) * dx;
  const cy = (j: number) => (j + 0.5) * dx;
  const cz = (k: number) => originZ + (k + 0.5) * dx;
  const cellVol = dx * dx * dx;

  // --- Zones: each floor column belongs to the room whose outline (grown by ½ wall) contains it --
  const columnZone = new Int16Array(nx * nz).fill(-1);
  for (let k = 0; k < nz; k++)
    for (let i = 0; i < nx; i++) {
      const p: Vec2 = [cx(i), cz(k)];
      let zone = rooms.findIndex((r) => pointInPolygon(p, r.outline));
      if (zone < 0) {
        let best = Infinity;
        rooms.forEach((r, idx) => {
          const d = distanceToOutline(p, r.outline);
          if (d <= r.wallThickness / 2 + 1e-9 && d < best) {
            best = d;
            zone = idx;
          }
        });
      }
      columnZone[i + nx * k] = zone;
    }
  const zoneOf = new Int16Array(n).fill(-1);
  const cells = new Uint8Array(n).fill(CellType.SOLID);
  for (let k = 0; k < nz; k++)
    for (let j = 0; j < ny; j++)
      for (let i = 0; i < nx; i++) {
        const z = columnZone[i + nx * k]!;
        if (z < 0 || cy(j) > rooms[z]!.wallHeight) continue;
        const c = cell(i, j, k);
        zoneOf[c] = z;
        cells[c] = CellType.FLUID;
      }

  // --- Furniture -------------------------------------------------------------------------------
  rooms.forEach((room, z) => {
    for (const obj of room.objects) {
      if (obj.role === 'none') continue;
      const fill = obj.role === 'source' ? CellType.SOURCE : obj.role === 'porous' ? CellType.POROUS : CellType.SOLID;
      const b = objectBox(obj, room.wallHeight);
      const cos = Math.cos(b.rot);
      const sin = Math.sin(b.rot);
      const r = Math.hypot(b.hw, b.hd);
      const i0 = Math.max(0, Math.floor((b.cx - r - originX) / dx));
      const i1 = Math.min(nx - 1, Math.ceil((b.cx + r - originX) / dx));
      const k0 = Math.max(0, Math.floor((b.cz - r - originZ) / dx));
      const k1 = Math.min(nz - 1, Math.ceil((b.cz + r - originZ) / dx));
      const j0 = Math.max(0, Math.floor(b.base / dx));
      const j1 = Math.min(ny - 1, Math.ceil(b.top / dx));
      for (let k = k0; k <= k1; k++)
        for (let i = i0; i <= i1; i++) {
          const ddx = cx(i) - b.cx;
          const ddz = cz(k) - b.cz;
          const lx = ddx * cos - ddz * sin;
          const lz = ddx * sin + ddz * cos;
          if (Math.abs(lx) > b.hw || Math.abs(lz) > b.hd) continue;
          for (let j = j0; j <= j1; j++) {
            const y = cy(j);
            if (y < b.base || y > b.top) continue;
            const c = cell(i, j, k);
            if (zoneOf[c] === z) cells[c] = fill;
          }
        }
    }
  });

  const fluid = new Uint8Array(n);
  let fluidCount = 0;
  for (let c = 0; c < n; c++) {
    if (cells[c] === CellType.FLUID || cells[c] === CellType.POROUS || cells[c] === CellType.SOURCE) {
      fluid[c] = 1;
      fluidCount++;
    }
  }
  const inGrid = (i: number, j: number, k: number) => i >= 0 && i < nx && j >= 0 && j < ny && k >= 0 && k < nz;
  const isFluid = (i: number, j: number, k: number) => inGrid(i, j, k) && fluid[cell(i, j, k)] === 1;
  const zoneAt = (i: number, j: number, k: number) => (inGrid(i, j, k) ? zoneOf[cell(i, j, k)]! : -1);

  // --- Faces: open only within one room ---------------------------------------------------------
  const uType = new Uint8Array((nx + 1) * ny * nz);
  const vType = new Uint8Array(nx * (ny + 1) * nz);
  const wType = new Uint8Array(nx * ny * (nz + 1));
  const sameRoom = (a: number, b: number) => fluid[a] === 1 && fluid[b] === 1 && zoneOf[a] === zoneOf[b];
  for (let k = 0; k < nz; k++)
    for (let j = 0; j < ny; j++)
      for (let i = 1; i < nx; i++) if (sameRoom(cell(i - 1, j, k), cell(i, j, k))) uType[uIdx(i, j, k)] = FaceType.INTERIOR;
  for (let k = 0; k < nz; k++)
    for (let j = 1; j < ny; j++)
      for (let i = 0; i < nx; i++) if (sameRoom(cell(i, j - 1, k), cell(i, j, k))) vType[vIdx(i, j, k)] = FaceType.INTERIOR;
  for (let k = 1; k < nz; k++)
    for (let j = 0; j < ny; j++)
      for (let i = 0; i < nx; i++) if (sameRoom(cell(i, j, k - 1), cell(i, j, k))) wType[wIdx(i, j, k)] = FaceType.INTERIOR;
  const types = [uType, vType, wType];
  const uLoss = new Float32Array(uType.length);
  const vLoss = new Float32Array(vType.length);
  const wLoss = new Float32Array(wType.length);
  const losses = [uLoss, vLoss, wLoss];
  const uPressure = new Float64Array(uType.length);
  const vPressure = new Float64Array(vType.length);
  const wPressure = new Float64Array(wType.length);
  const pressures = [uPressure, vPressure, wPressure];
  const dRho = house.rhoOut - house.rhoIn;

  // --- Openings of the house model ---------------------------------------------------------------
  const claimed = new Set<string>();
  const openings: DomainOpening[] = [];
  for (const path of house.paths) {
    const g = path.geometry;
    if (!g || path.areaM2 <= 0) continue;
    const owner = rooms[g.room]!;
    const seg = wallSegment(owner, g.wallIndex);
    const halfT = owner.wallThickness / 2;
    const ax = seg.a[0] + seg.dir[0] * g.offset;
    const az = seg.a[1] + seg.dir[1] * g.offset;
    const bx = ax + seg.dir[0] * g.width;
    const bz = az + seg.dir[1] * g.width;
    const reach = owner.wallThickness + 2 * dx;
    const i0 = Math.max(0, Math.floor((Math.min(ax, bx) - reach - originX) / dx));
    const i1 = Math.min(nx - 1, Math.ceil((Math.max(ax, bx) + reach - originX) / dx));
    const k0 = Math.max(0, Math.floor((Math.min(az, bz) - reach - originZ) / dx));
    const k1 = Math.min(nz - 1, Math.ceil((Math.max(az, bz) + reach - originZ) / dx));
    type Cand = FaceRef & { u: number; y: number; dy: number };
    const cands: Cand[] = [];
    const dirs: [number, number, Axis, 1 | -1][] = [
      [1, 0, 0, 1],
      [-1, 0, 0, -1],
      [0, 1, 2, 1],
      [0, -1, 2, -1],
    ];
    for (let k = k0; k <= k1; k++)
      for (let i = i0; i <= i1; i++)
        for (let j = 0; j < ny; j++) {
          if (!isFluid(i, j, k) || zoneAt(i, j, k) !== g.room) continue;
          for (const [ddx, ddz, axis, outward] of dirs) {
            if (ddx * seg.normal[0] + ddz * seg.normal[1] < 0.3) continue;
            const ni = i + ddx;
            const nk = k + ddz;
            const otherZone = zoneAt(ni, j, nk);
            if (path.to >= 0 ? !(isFluid(ni, j, nk) && otherZone === path.to) : otherZone !== -1) continue;
            const fx = cx(i) + (ddx * dx) / 2;
            const fz = cz(k) + (ddz * dx) / 2;
            const t = (fx - seg.a[0]) * seg.normal[0] + (fz - seg.a[1]) * seg.normal[1];
            if (Math.abs(t - halfT) > dx) continue;
            const u = (fx - seg.a[0]) * seg.dir[0] + (fz - seg.a[1]) * seg.dir[1];
            if (u < g.offset - 1e-9 || u >= g.offset + g.width - 1e-9) continue;
            const y = cy(j);
            const dy = y < g.sill ? g.sill - y : y >= g.sill + g.height ? y - g.sill - g.height + 1e-9 : 0;
            const index = axis === 0 ? uIdx(outward > 0 ? i + 1 : i, j, k) : wIdx(i, j, outward > 0 ? k + 1 : k);
            if (claimed.has(`${axis}:${index}`)) continue;
            cands.push({ axis, index, cell: cell(i, j, k), outward, u, y, dy });
          }
        }
    if (cands.length === 0) {
      warnings.push(`Opening "${path.id}" could not be placed on the ${dx} m grid; it is ignored by the voxel solver.`);
      continue;
    }
    // Rows inside the opening's height; if it is thinner than a cell (undercut), the nearest row
    const minDy = Math.min(...cands.map((c) => c.dy));
    let faces = cands.filter((c) => c.dy === minDy);
    // Open fraction: a contiguous share of the width (like a door ajar or a sliding sash)
    if (g.openFraction < 1) {
      const limit = g.offset + Math.max(g.openFraction * g.width, 1e-6);
      const open = faces.filter((f) => f.u < limit);
      faces = open.length > 0 ? open : [faces.sort((a, b) => a.u - b.u)[0]!];
    }
    const voxelArea = faces.length * dx * dx;
    const loss = (voxelArea / (DISCHARGE_COEFFICIENT * path.areaM2)) ** 2;
    for (const f of faces) {
      claimed.add(`${f.axis}:${f.index}`);
      losses[f.axis]![f.index] = loss;
      if (path.to >= 0) {
        types[f.axis]![f.index] = FaceType.INTERIOR;
      } else {
        types[f.axis]![f.index] = FaceType.PRESSURE;
        // Wind pressure plus stack (outdoor minus indoor hydrostatic) at the face height
        pressures[f.axis]![f.index] = path.windPressurePa - dRho * GRAVITY * f.y;
      }
    }
    openings.push({ id: path.id, kind: path.kind, from: path.from, to: path.to, faces: faces.map(({ axis, index, cell: c, outward }) => ({ axis, index, cell: c, outward })), voxelArea, areaM2: path.areaM2, loss });
  }
  const hasPressureBoundary = openings.some((o) => o.to < 0);

  // --- Porous faces ----------------------------------------------------------------------------
  const porousU: number[] = [];
  const porousV: number[] = [];
  const porousW: number[] = [];
  for (let k = 0; k < nz; k++)
    for (let j = 0; j < ny; j++)
      for (let i = 0; i < nx; i++) {
        if (cells[cell(i, j, k)] !== CellType.POROUS) continue;
        porousU.push(uIdx(i, j, k), uIdx(i + 1, j, k));
        porousV.push(vIdx(i, j, k), vIdx(i, j + 1, k));
        porousW.push(wIdx(i, j, k), wIdx(i, j, k + 1));
      }
  const uniq = (a: number[]) => Int32Array.from(new Set(a));

  // --- Devices ---------------------------------------------------------------------------------
  const jets: Jet[] = [];
  const sSink = new Float64Array(n);
  const sSource = new Float64Array(n);
  const sReturn = new Float64Array(n);
  const recirculators: Recirculator[] = [];
  const devices: Device[] = [];

  /** Fluid cells of `zone` within `radius` of p (at or above minY); else the nearest one. */
  const cellsNear = (p: [number, number, number], radius: number, zone: number, minY = -Infinity): number[] => {
    const out: number[] = [];
    let best = -1;
    let bestD = Infinity;
    for (let c = 0; c < n; c++) {
      if (!fluid[c] || zoneOf[c] !== zone) continue;
      const i = c % nx;
      const j = Math.floor(c / nx) % ny;
      const k = Math.floor(c / (nx * ny));
      if (cy(j) < minY) continue;
      const d = Math.hypot(cx(i) - p[0], cy(j) - p[1], cz(k) - p[2]);
      if (d <= radius) out.push(c);
      if (d < bestD) {
        bestD = d;
        best = c;
      }
    }
    return out.length > 0 ? out : best >= 0 ? [best] : [];
  };

  /** Fluid cells of `zone` whose centres lie in a rotated box (grown by ½ cell); else the nearest one. */
  const cellsInBox = (b: Box, zone: number): number[] => {
    const cos = Math.cos(b.rot);
    const sin = Math.sin(b.rot);
    const r = Math.hypot(b.hw, b.hd) + dx;
    const out: number[] = [];
    const i0 = Math.max(0, Math.floor((b.cx - r - originX) / dx));
    const i1 = Math.min(nx - 1, Math.ceil((b.cx + r - originX) / dx));
    const k0 = Math.max(0, Math.floor((b.cz - r - originZ) / dx));
    const k1 = Math.min(nz - 1, Math.ceil((b.cz + r - originZ) / dx));
    for (let k = k0; k <= k1; k++)
      for (let j = 0; j < ny; j++)
        for (let i = i0; i <= i1; i++) {
          if (!isFluid(i, j, k) || zoneAt(i, j, k) !== zone) continue;
          const y = cy(j);
          if (y < b.base - dx / 2 || y > b.top + dx / 2) continue;
          const ddx = cx(i) - b.cx;
          const ddz = cz(k) - b.cz;
          const lx = ddx * cos - ddz * sin;
          const lz = ddx * sin + ddz * cos;
          if (Math.abs(lx) <= b.hw + dx / 2 && Math.abs(lz) <= b.hd + dx / 2) out.push(cell(i, j, k));
        }
    return out.length > 0 ? out : cellsNear([b.cx, (b.base + b.top) / 2, b.cz], 0, zone);
  };

  const addJet = (deviceId: string, p0: [number, number, number], dir: [number, number, number], radius: number, length: number, speed: number) => {
    const span = radius + length + dx;
    const i0 = Math.max(0, Math.floor((p0[0] - span - originX) / dx));
    const i1 = Math.min(nx, Math.ceil((p0[0] + span - originX) / dx));
    const j0 = Math.max(0, Math.floor((p0[1] - span) / dx));
    const j1 = Math.min(ny, Math.ceil((p0[1] + span) / dx));
    const k0 = Math.max(0, Math.floor((p0[2] - span - originZ) / dx));
    const k1 = Math.min(nz, Math.ceil((p0[2] + span - originZ) / dx));
    let count = 0;
    const consider = (axis: Axis, index: number, x: number, y: number, z: number) => {
      const comp = dir[axis];
      if (Math.abs(comp) < 1e-3 || types[axis]![index] !== FaceType.INTERIOR) return;
      const rx = x - p0[0];
      const ry = y - p0[1];
      const rz = z - p0[2];
      const along = rx * dir[0] + ry * dir[1] + rz * dir[2];
      if (along < -dx / 2 || along > length) return;
      if (rx * rx + ry * ry + rz * rz - along * along > radius * radius) return;
      jets.push({ deviceId, axis, index, target: speed * comp });
      count++;
    };
    for (let k = k0; k < k1; k++) for (let j = j0; j < j1; j++) for (let i = i0; i <= i1; i++) consider(0, uIdx(i, j, k), originX + i * dx, cy(j), cz(k));
    for (let k = k0; k < k1; k++) for (let j = j0; j <= j1; j++) for (let i = i0; i < i1; i++) consider(1, vIdx(i, j, k), cx(i), j * dx, cz(k));
    for (let k = k0; k <= k1; k++) for (let j = j0; j < j1; j++) for (let i = i0; i < i1; i++) consider(2, wIdx(i, j, k), cx(i), cy(j), originZ + k * dx);
    if (count === 0) warnings.push(`Device "${deviceId}" jet does not fit the ${dx} m grid; its jet is ignored.`);
  };

  const addRecirculator = (deviceId: string, flowM3s: number, efficiency: number, intakeCells: number[], outletCells: number[]) => {
    const outletSet = new Set(outletCells);
    const intake = intakeCells.filter((c) => !outletSet.has(c));
    if (intake.length === 0 || outletCells.length === 0 || flowM3s <= 0) {
      warnings.push(`Device "${deviceId}" has no room for an intake and outlet on the ${dx} m grid; it is ignored.`);
      return;
    }
    for (const c of intake) sSink[c] = sSink[c]! - flowM3s / (intake.length * cellVol);
    for (const c of outletCells) sReturn[c] = sReturn[c]! + flowM3s / (outletCells.length * cellVol);
    recirculators.push({ deviceId, flowM3s, efficiency, intake: Int32Array.from(intake), outlet: Int32Array.from(outletCells) });
  };

  let anyExhaust = false;
  house.zones.forEach((zone) => {
    const room = zone.room;
    const objects = new Map(room.objects.map((o) => [o.id, o]));
    for (const d of zone.devices) {
      if (!d.enabled) continue;
      devices.push(d);
      const obj = objects.get(d.objectId);
      if (!obj) continue;
      const b = objectBox(obj, room.wallHeight);
      if (b.clamped) warnings.push(`Device "${obj.name}" extends above the ceiling; it is placed just below the ceiling for the voxel solver.`);
      const fwd = objectForward(obj);
      const speed = d.dischargeVelocityMs ?? 0;
      const width = Math.min(b.hw, b.hd) * 2;
      switch (d.kind) {
        case 'ceilingFan':
          addJet(d.objectId, [b.cx, b.base, b.cz], [0, -1, 0], (b.hw * 2 * FAN_JET_DIAMETER_FRACTION) / 2, JET_DEPTH_M, speed);
          break;
        case 'pedestalFan':
          addJet(d.objectId, [b.cx + fwd[0] * b.hd, b.base + 0.85 * (b.top - b.base), b.cz + fwd[1] * b.hd], [fwd[0], 0, fwd[1]], (width * FAN_JET_DIAMETER_FRACTION) / 2, JET_DEPTH_M, speed);
          break;
        case 'ac': {
          const at: [number, number, number] = [b.cx + fwd[0] * b.hd, b.base + 0.25 * (b.top - b.base), b.cz + fwd[1] * b.hd];
          addJet(d.objectId, at, normalize([fwd[0], -0.4, fwd[1]]), Math.max(dx, (b.top - b.base) / 2), JET_DEPTH_M, speed);
          const outletAt: [number, number, number] = [at[0] + (fwd[0] * dx) / 2, at[1], at[2] + (fwd[1] * dx) / 2];
          addRecirculator(d.objectId, d.flowM3s, AC_FILTRATION_EFFICIENCY, cellsInBox(b, zone.index), cellsNear(outletAt, Math.max(0.75 * dx, (b.top - b.base) / 2), zone.index));
          break;
        }
        case 'purifier': {
          const radius = (width * FAN_JET_DIAMETER_FRACTION) / 2;
          addJet(d.objectId, [b.cx, b.top, b.cz], [0, 1, 0], radius, JET_DEPTH_M, speed);
          const outlet = cellsNear([b.cx, b.top + dx / 2, b.cz], Math.max(radius, 0.75 * dx), zone.index, b.top);
          addRecirculator(d.objectId, d.flowM3s / PURIFIER_SINGLE_PASS_EFFICIENCY, PURIFIER_SINGLE_PASS_EFFICIENCY, cellsInBox(b, zone.index), outlet);
          break;
        }
        case 'exhaustFan':
        case 'rangeHood': {
          const region = cellsInBox(b, zone.index);
          for (const c of region) sSink[c] = sSink[c]! - d.flowM3s / (region.length * cellVol);
          anyExhaust = true;
          break;
        }
      }
    }
  });

  // --- Make-up air for connected regions with an exhaust but no pressure boundary -------------------
  if (anyExhaust) {
    const comp = new Int32Array(n).fill(-1);
    let nComp = 0;
    for (let s = 0; s < n; s++) {
      if (!fluid[s] || comp[s]! >= 0) continue;
      const stack = [s];
      comp[s] = nComp;
      while (stack.length) {
        const c = stack.pop()!;
        const i = c % nx;
        const j = Math.floor(c / nx) % ny;
        const k = Math.floor(c / (nx * ny));
        const nbs: [number, Axis, number][] = [
          [i > 0 ? c - 1 : -1, 0, uIdx(i, j, k)],
          [i < nx - 1 ? c + 1 : -1, 0, uIdx(i + 1, j, k)],
          [j > 0 ? c - nx : -1, 1, vIdx(i, j, k)],
          [j < ny - 1 ? c + nx : -1, 1, vIdx(i, j + 1, k)],
          [k > 0 ? c - nx * ny : -1, 2, wIdx(i, j, k)],
          [k < nz - 1 ? c + nx * ny : -1, 2, wIdx(i, j, k + 1)],
        ];
        for (const [nb, axis, f] of nbs) {
          if (nb >= 0 && comp[nb]! < 0 && fluid[nb] && types[axis]![f] === FaceType.INTERIOR) {
            comp[nb] = nComp;
            stack.push(nb);
          }
        }
      }
      nComp++;
    }
    const open = new Uint8Array(nComp);
    for (const o of openings) if (o.to < 0) for (const f of o.faces) open[comp[f.cell]!] = 1;
    const net = new Float64Array(nComp);
    const cnt = new Float64Array(nComp);
    for (let c = 0; c < n; c++) {
      if (comp[c]! < 0) continue;
      net[comp[c]!] = net[comp[c]!]! + (sSink[c]! + sReturn[c]!) * cellVol;
      cnt[comp[c]!] = cnt[comp[c]!]! + 1;
    }
    for (let p = 0; p < nComp; p++) {
      if (open[p] || net[p]! >= -1e-12) continue;
      const s = -net[p]! / (cnt[p]! * cellVol);
      for (let c = 0; c < n; c++) if (comp[c] === p) sSource[c] = sSource[c]! + s;
      warnings.push('Part of the house has an exhaust fan but no open window: its make-up air comes in uniformly through the envelope.');
    }
  }

  // --- PM2.5 sources ---------------------------------------------------------------------------
  const sources: VoxelDomain['sources'] = [];
  house.zones.forEach((zone) => {
    const room = zone.room;
    for (const src of roomPm25Sources(room)) {
      const perCell = new Float64Array(n);
      let region: number[];
      const obj = src.objectId ? room.objects.find((o) => o.id === src.objectId) : undefined;
      if (obj) {
        // Emit into the air around and just above the appliance (a stove top), not inside it
        const b = objectBox(obj, room.wallHeight);
        region = cellsInBox({ ...b, base: b.top, top: b.top + 0.4, hw: b.hw + dx / 2, hd: b.hd + dx / 2 }, zone.index);
      } else if (src.position) {
        // A small volume (≈ 0.3 m radius, at least the nearest cell) at the source and its height
        region = cellsNear(src.position as [number, number, number], Math.max(0.3, 0.75 * dx), zone.index);
      }
      else {
        region = [];
        for (let c = 0; c < n; c++) if (fluid[c] && zoneOf[c] === zone.index) region.push(c);
        warnings.push(`PM2.5 source "${src.id}" in ${room.name} has no object or position; it is spread through the room.`);
      }
      const rate = src.emissionRateUgMin / 60;
      for (const c of region) perCell[c] = rate / region.length;
      sources.push({ id: src.id, zone: zone.index, perCell, schedule: src.schedule });
    }
  });

  const zones: DomainZone[] = house.zones.map((z) => ({ index: z.index, roomId: z.roomId, name: z.name, cells: 0, volumeM3: 0 }));
  for (let c = 0; c < n; c++) {
    if (fluid[c] && zoneOf[c]! >= 0) {
      const z = zones[zoneOf[c]!]!;
      z.cells++;
      z.volumeM3 += cellVol;
    }
  }

  return {
    nx,
    ny,
    nz,
    dx,
    origin,
    cells,
    fluid,
    fluidCount,
    zoneOf,
    zones,
    uType,
    vType,
    wType,
    uFixed: new Float64Array(uType.length),
    vFixed: new Float64Array(vType.length),
    wFixed: new Float64Array(wType.length),
    uLoss,
    vLoss,
    wLoss,
    uPressure,
    vPressure,
    wPressure,
    rho: house.rhoIn,
    porousFaces: { u: uniq(porousU), v: uniq(porousV), w: uniq(porousW) },
    openings,
    jets,
    sSink,
    sSource,
    recirculators,
    sReturn,
    sources,
    hasPressureBoundary,
    inflowUgM3: OPEN_WINDOW_PENETRATION * house.env.outdoorUgM3,
    envelopeInflowUgM3: INFILTRATION_PENETRATION * house.env.outdoorUgM3,
    infiltrationPerS: house.env.infiltrationAch / SECONDS_PER_HOUR,
    devices,
    warnings,
  };
}
