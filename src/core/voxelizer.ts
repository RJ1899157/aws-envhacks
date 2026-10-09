import { sharedWallOpenings } from './rooms';
import { polygonBounds, pointInPolygon, wallSegment } from './parser';
import type { Room } from './schema';

/**
 * Cell types for voxelized CFD and IAQ simulation domain
 */
export const CellType = {
  FLUID: 0,
  SOLID: 1,
  INLET: 2,
  OUTLET: 3,
  SOURCE: 4,
  POROUS: 5,
} as const;

export type CellTypeValue = (typeof CellType)[keyof typeof CellType];

export const CELL_TYPE_NAMES: Record<CellTypeValue, string> = {
  [CellType.FLUID]: 'FLUID',
  [CellType.SOLID]: 'SOLID',
  [CellType.INLET]: 'INLET',
  [CellType.OUTLET]: 'OUTLET',
  [CellType.SOURCE]: 'SOURCE',
  [CellType.POROUS]: 'POROUS',
};

export const CELL_TYPE_COLORS: Record<CellTypeValue, string> = {
  [CellType.FLUID]: '#ffffff',
  [CellType.SOLID]: '#71717a', // grey
  [CellType.INLET]: '#38bdf8', // blue
  [CellType.OUTLET]: '#f97316', // orange
  [CellType.SOURCE]: '#22c55e', // green
  [CellType.POROUS]: '#eab308', // yellow
};

export interface VoxelGrid {
  nx: number;
  ny: number;
  nz: number;
  dx: number;
  origin: [number, number, number];
  cells: Uint8Array;
  idx: (i: number, j: number, k: number) => number;
}

export interface VoxelStats {
  cellCount: number;
  memoryBytes: number;
  computeTimeMs: number;
  fluidCount: number;
  solidCount: number;
  inletCount: number;
  outletCount: number;
  sourceCount: number;
  porousCount: number;
}

/**
 * Voxelizes a Room specification into a 3D regular grid.
 *
 * Rules:
 * - Interior polygon between y = 0 and y = wallHeight is FLUID.
 * - Cells outside the polygon or above/below the room are SOLID.
 * - Openings punch INLET / OUTLET cells through the wall thickness. Closed (or 0% open) openings
 *   stay SOLID. Openings that `neighbours` put on a wall shared with this room are punched too,
 *   with the role reversed (air entering the neighbour leaves this room, and vice versa).
 * - Objects (rotated by rotationY, scaled, elevated) fill SOLID / POROUS / SOURCE.
 * - Loops are restricted to each object's axis-aligned bounding box.
 */
export function voxelize(room: Room, dx = 0.1, neighbours: readonly Room[] = []): VoxelGrid {
  if (dx <= 0) {
    throw new Error('dx grid resolution must be positive');
  }

  const bounds = polygonBounds(room.outline);
  const wallThickness = room.wallThickness ?? 0.15;
  const wallHeight = room.wallHeight ?? 2.7;

  // Add margin around outline to encompass the outer walls
  const pad = Math.max(wallThickness, dx);
  const padCells = Math.ceil(pad / dx);

  const originX = Math.floor(bounds.min[0] / dx - padCells) * dx;
  const originZ = Math.floor(bounds.min[1] / dx - padCells) * dx;
  const originY = 0;

  const maxXBounded = Math.ceil(bounds.max[0] / dx + padCells) * dx;
  const maxZBounded = Math.ceil(bounds.max[1] / dx + padCells) * dx;

  const nx = Math.max(1, Math.round((maxXBounded - originX) / dx));
  const nz = Math.max(1, Math.round((maxZBounded - originZ) / dx));
  const ny = Math.max(1, Math.ceil(wallHeight / dx));

  const idx = (i: number, j: number, k: number) => i + j * nx + k * nx * ny;
  const cells = new Uint8Array(nx * ny * nz);

  // 1. Precompute 2D floor polygon membership for column (i, k)
  const inPolygon2D = new Uint8Array(nx * nz);
  for (let k = 0; k < nz; k++) {
    const cz = originZ + (k + 0.5) * dx;
    for (let i = 0; i < nx; i++) {
      const cx = originX + (i + 0.5) * dx;
      if (pointInPolygon([cx, cz], room.outline)) {
        inPolygon2D[i + k * nx] = 1;
      }
    }
  }

  // 2. Initialize cells: FLUID inside polygon, SOLID outside
  for (let k = 0; k < nz; k++) {
    for (let j = 0; j < ny; j++) {
      for (let i = 0; i < nx; i++) {
        const isInside = inPolygon2D[i + k * nx] === 1;
        cells[idx(i, j, k)] = isInside ? CellType.FLUID : CellType.SOLID;
      }
    }
  }

  // 3. Openings: Punch INLET/OUTLET cells through the wall thickness
  const reversed = { inlet: 'outlet', outlet: 'inlet', closed: 'closed' } as const;
  const allOpenings = [
    ...room.openings,
    ...room.outline.flatMap((_, wallIndex) =>
      sharedWallOpenings(room, wallIndex, neighbours).map((o) => ({ ...o, wallIndex, role: reversed[o.role] }))
    ),
  ];
  for (const op of allOpenings) {
    if (op.wallIndex < 0 || op.wallIndex >= room.outline.length) continue;
    if (op.role === 'closed' || op.openFraction <= 0) continue;

    const seg = wallSegment(room, op.wallIndex);
    const roleType: CellTypeValue =
      op.role === 'inlet'
        ? CellType.INLET
        : op.role === 'outlet'
          ? CellType.OUTLET
          : CellType.SOLID;

    if (roleType === CellType.SOLID) continue;

    const p1x = seg.a[0] + op.offset * seg.dir[0];
    const p1z = seg.a[1] + op.offset * seg.dir[1];
    const p2x = seg.a[0] + (op.offset + op.width) * seg.dir[0];
    const p2z = seg.a[1] + (op.offset + op.width) * seg.dir[1];
    const normX = seg.normal[0] * wallThickness;
    const normZ = seg.normal[1] * wallThickness;

    const cornersX = [p1x, p2x, p1x + normX, p2x + normX];
    const cornersZ = [p1z, p2z, p1z + normZ, p2z + normZ];

    const minX = Math.min(...cornersX) - dx * 0.5;
    const maxX = Math.max(...cornersX) + dx * 0.5;
    const minZ = Math.min(...cornersZ) - dx * 0.5;
    const maxZ = Math.max(...cornersZ) + dx * 0.5;
    const minY = Math.max(0, op.sill);
    const maxY = Math.min(wallHeight, op.sill + op.height);

    const iMin = Math.max(0, Math.floor((minX - originX) / dx));
    const iMax = Math.min(nx - 1, Math.ceil((maxX - originX) / dx));
    const jMin = Math.max(0, Math.floor((minY - originY) / dx));
    const jMax = Math.min(ny - 1, Math.ceil((maxY - originY) / dx));
    const kMin = Math.max(0, Math.floor((minZ - originZ) / dx));
    const kMax = Math.min(nz - 1, Math.ceil((maxZ - originZ) / dx));

    for (let k = kMin; k <= kMax; k++) {
      const cz = originZ + (k + 0.5) * dx;
      for (let i = iMin; i <= iMax; i++) {
        const cx = originX + (i + 0.5) * dx;
        const wx = cx - seg.a[0];
        const wz = cz - seg.a[1];
        const u = wx * seg.dir[0] + wz * seg.dir[1];
        const t = wx * seg.normal[0] + wz * seg.normal[1];

        // Punches through wall thickness [0, wallThickness]
        if (
          u >= op.offset - 1e-4 &&
          u <= op.offset + op.width + 1e-4 &&
          t >= -1e-4 &&
          t <= wallThickness + 1e-4
        ) {
          for (let j = jMin; j <= jMax; j++) {
            const cy = originY + (j + 0.5) * dx;
            if (cy >= op.sill - 1e-4 && cy <= op.sill + op.height + 1e-4) {
              cells[idx(i, j, k)] = roleType;
            }
          }
        }
      }
    }
  }

  // 4. Objects: Fill SOLID, POROUS, or SOURCE within AABB loops
  for (const obj of room.objects) {
    if (obj.role === 'none') continue;

    let fillType: CellTypeValue = CellType.SOLID;
    if (obj.role === 'source') {
      fillType = CellType.SOURCE;
    } else if (obj.role === 'porous') {
      fillType = CellType.POROUS;
    }

    const sx = obj.scale?.[0] ?? 1;
    const sy = obj.scale?.[1] ?? 1;
    const sz = obj.scale?.[2] ?? 1;
    const w = obj.size[0] * sx;
    const h = obj.size[1] * sy;
    const d = obj.size[2] * sz;
    const halfW = w / 2;
    const halfD = d / 2;

    const elevation = obj.elevation ?? 0;
    const baseY = (obj.position[1] ?? 0) + elevation;
    const topY = baseY + h;

    const posX = obj.position[0];
    const posZ = obj.position[2];
    const rotY = obj.rotation?.[1] ?? 0;
    const cos = Math.cos(rotY);
    const sin = Math.sin(rotY);

    const localCorners: [number, number][] = [
      [-halfW, -halfD],
      [halfW, -halfD],
      [halfW, halfD],
      [-halfW, halfD],
    ];

    let minObjX = Infinity;
    let maxObjX = -Infinity;
    let minObjZ = Infinity;
    let maxObjZ = -Infinity;

    for (const [lx, lz] of localCorners) {
      const rx = lx * cos - lz * sin;
      const rz = lx * sin + lz * cos;
      const wx = posX + rx;
      const wz = posZ + rz;
      if (wx < minObjX) minObjX = wx;
      if (wx > maxObjX) maxObjX = wx;
      if (wz < minObjZ) minObjZ = wz;
      if (wz > maxObjZ) maxObjZ = wz;
    }

    const iMin = Math.max(0, Math.floor((minObjX - originX) / dx));
    const iMax = Math.min(nx - 1, Math.ceil((maxObjX - originX) / dx));
    const jMin = Math.max(0, Math.floor((baseY - originY) / dx));
    const jMax = Math.min(ny - 1, Math.ceil((topY - originY) / dx));
    const kMin = Math.max(0, Math.floor((minObjZ - originZ) / dx));
    const kMax = Math.min(nz - 1, Math.ceil((maxObjZ - originZ) / dx));

    for (let j = jMin; j <= jMax; j++) {
      const cy = originY + (j + 0.5) * dx;
      if (cy < baseY - 1e-4 || cy > topY + 1e-4) continue;

      for (let k = kMin; k <= kMax; k++) {
        const cz = originZ + (k + 0.5) * dx;
        const dz = cz - posZ;

        for (let i = iMin; i <= iMax; i++) {
          const cx = originX + (i + 0.5) * dx;
          const dxCoord = cx - posX;

          // Inverse rotation by rotY around local origin
          const localX = dxCoord * cos + dz * sin;
          const localZ = -dxCoord * sin + dz * cos;

          if (Math.abs(localX) <= halfW + 1e-4 && Math.abs(localZ) <= halfD + 1e-4) {
            cells[idx(i, j, k)] = fillType;
          }
        }
      }
    }
  }

  return {
    nx,
    ny,
    nz,
    dx,
    origin: [originX, originY, originZ],
    cells,
    idx,
  };
}

/**
 * Retrieves the cell type at integer grid index (i, j, k).
 * Out-of-bounds coordinates return CellType.SOLID.
 */
export function getCellByIndex(grid: VoxelGrid, i: number, j: number, k: number): CellTypeValue {
  if (i < 0 || i >= grid.nx || j < 0 || j >= grid.ny || k < 0 || k >= grid.nz) {
    return CellType.SOLID;
  }
  return grid.cells[grid.idx(i, j, k)] as CellTypeValue;
}

/**
 * Retrieves the cell type at continuous world coordinates [x, y, z].
 * Points outside the room domain or above/below the room return CellType.SOLID.
 */
export function getCell(grid: VoxelGrid, x: number, y: number, z: number): CellTypeValue {
  const i = Math.floor((x - grid.origin[0]) / grid.dx);
  const j = Math.floor((y - grid.origin[1]) / grid.dx);
  const k = Math.floor((z - grid.origin[2]) / grid.dx);
  return getCellByIndex(grid, i, j, k);
}

/**
 * Computes descriptive statistics for a voxel grid
 */
export function computeVoxelStats(grid: VoxelGrid, computeTimeMs: number): VoxelStats {
  let fluidCount = 0;
  let solidCount = 0;
  let inletCount = 0;
  let outletCount = 0;
  let sourceCount = 0;
  let porousCount = 0;

  const total = grid.cells.length;
  for (let i = 0; i < total; i++) {
    const val = grid.cells[i];
    switch (val) {
      case CellType.FLUID:
        fluidCount++;
        break;
      case CellType.SOLID:
        solidCount++;
        break;
      case CellType.INLET:
        inletCount++;
        break;
      case CellType.OUTLET:
        outletCount++;
        break;
      case CellType.SOURCE:
        sourceCount++;
        break;
      case CellType.POROUS:
        porousCount++;
        break;
    }
  }

  return {
    cellCount: total,
    memoryBytes: grid.cells.byteLength,
    computeTimeMs: Number(computeTimeMs.toFixed(2)),
    fluidCount,
    solidCount,
    inletCount,
    outletCount,
    sourceCount,
    porousCount,
  };
}

let workerInstance: Worker | null = null;
let lastExecDurationMs = 0;
let workerTaskId = 0;

/**
 * Asynchronously voxelizes a room, automatically utilizing a Web Worker
 * if voxelization duration exceeds 50 ms.
 */
export async function voxelizeAsync(
  room: Room,
  dx = 0.1,
  neighbours: readonly Room[] = []
): Promise<{ grid: VoxelGrid; timeMs: number }> {
  // Use Web Worker if available and execution previously exceeded 50 ms
  if (typeof window !== 'undefined' && typeof Worker !== 'undefined' && lastExecDurationMs > 50) {
    try {
      if (!workerInstance) {
        workerInstance = new Worker(new URL('./voxelWorker.ts', import.meta.url), {
          type: 'module',
        });
      }

      const id = ++workerTaskId;
      const res = await new Promise<{
        id: number;
        duration: number;
        nx: number;
        ny: number;
        nz: number;
        dx: number;
        origin: [number, number, number];
        cells: Uint8Array;
      }>((resolve, reject) => {
        const timeout = setTimeout(() => {
          reject(new Error('Worker voxelization timed out'));
        }, 5000);

        const handler = (e: MessageEvent) => {
          if (e.data?.id === id) {
            clearTimeout(timeout);
            workerInstance?.removeEventListener('message', handler);
            resolve(e.data);
          }
        };

        workerInstance?.addEventListener('message', handler);
        workerInstance?.postMessage({ room, dx, neighbours, id });
      });

      lastExecDurationMs = res.duration;
      const nx = res.nx;
      const ny = res.ny;
      const grid: VoxelGrid = {
        nx: res.nx,
        ny: res.ny,
        nz: res.nz,
        dx: res.dx,
        origin: res.origin,
        cells: res.cells,
        idx: (i, j, k) => i + j * nx + k * nx * ny,
      };

      return { grid, timeMs: res.duration };
    } catch {
      // Fall back to synchronous path below if worker fails
    }
  }

  const start = performance.now();
  const grid = voxelize(room, dx, neighbours);
  const timeMs = performance.now() - start;
  lastExecDurationMs = timeMs;
  return { grid, timeMs };
}
