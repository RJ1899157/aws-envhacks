import { voxelize } from './voxelizer';
import type { Room } from './schema';

self.onmessage = (e: MessageEvent<{ room: Room; dx: number; id: number }>) => {
  const { room, dx, id } = e.data;
  const start = performance.now();
  const grid = voxelize(room, dx);
  const duration = performance.now() - start;

  // Zero-copy transfer of the cells Uint8Array buffer
  (self as unknown as Worker).postMessage(
    {
      id,
      duration,
      nx: grid.nx,
      ny: grid.ny,
      nz: grid.nz,
      dx: grid.dx,
      origin: grid.origin,
      cells: grid.cells,
    },
    [grid.cells.buffer]
  );
};
