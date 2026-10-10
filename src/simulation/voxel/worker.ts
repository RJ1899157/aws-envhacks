import type { VoxelWorkerRequest } from './protocol';
import { createVoxelWorkerHandler } from './workerHandler';

/** Web Worker entry for the voxel solver; see protocol.ts for the messages. */
const scope = self as unknown as Worker;
const handle = createVoxelWorkerHandler((message, transfer) => scope.postMessage(message, transfer ?? []));
scope.onmessage = (e: MessageEvent<VoxelWorkerRequest>) => {
  void handle(e.data);
};
