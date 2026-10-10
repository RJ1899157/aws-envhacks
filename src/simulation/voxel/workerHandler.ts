import type { VoxelWorkerRequest, VoxelWorkerResponse } from './protocol';
import { resultTransferables, runVoxelSimulation, VoxelCancelledError } from './solver';

export type PostFn = (message: VoxelWorkerResponse, transfer?: Transferable[]) => void;

/**
 * Message handler for the voxel worker, separated from the worker global so it can be tested in
 * Node. Runs are keyed by id; `cancel` flips a flag the solver checks between chunks of work.
 */
export function createVoxelWorkerHandler(post: PostFn): (msg: VoxelWorkerRequest) => Promise<void> {
  const cancelled = new Set<string>();
  return async (msg) => {
    if (msg.type === 'cancel') {
      cancelled.add(msg.id);
      return;
    }
    const { id, input } = msg;
    cancelled.delete(id);
    try {
      const result = await runVoxelSimulation(input, {
        onProgress: (p) => post({ type: 'progress', id, ...p }),
        isCancelled: () => cancelled.has(id),
      });
      post({ type: 'result', id, result }, resultTransferables(result));
    } catch (err) {
      if (err instanceof VoxelCancelledError) post({ type: 'cancelled', id });
      else post({ type: 'error', id, message: err instanceof Error ? err.message : String(err) });
    } finally {
      cancelled.delete(id);
    }
  };
}
