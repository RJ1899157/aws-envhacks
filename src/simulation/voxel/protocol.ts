import type { VoxelProgress, VoxelSimInput, VoxelSimResult } from './solver';

/** Main thread → worker */
export type VoxelWorkerRequest =
  | { type: 'start'; id: string; input: VoxelSimInput }
  | { type: 'cancel'; id: string };

/** Worker → main thread. Result arrays are transferred, not copied. */
export type VoxelWorkerResponse =
  | ({ type: 'progress'; id: string } & VoxelProgress)
  | { type: 'result'; id: string; result: VoxelSimResult }
  | { type: 'cancelled'; id: string }
  | { type: 'error'; id: string; message: string };
