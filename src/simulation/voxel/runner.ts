import type { VoxelWorkerRequest, VoxelWorkerResponse } from './protocol';
import type { VoxelProgress, VoxelSimInput, VoxelSimResult } from './solver';

export interface WorkerLike {
  postMessage(message: VoxelWorkerRequest): void;
  onmessage: ((e: MessageEvent<VoxelWorkerResponse>) => void) | null;
  onerror: ((e: ErrorEvent) => void) | null;
}

export class VoxelRunCancelled extends Error {
  constructor() {
    super('Voxel simulation cancelled');
    this.name = 'VoxelCancelledError';
  }
}

interface Pending {
  id: string;
  resolve: (r: VoxelSimResult) => void;
  reject: (e: Error) => void;
  onProgress?: (p: VoxelProgress) => void;
}

/**
 * Owns the single solver worker. Starting a run cancels the one in flight (its promise rejects with
 * VoxelRunCancelled); the worker is created lazily and kept for later runs.
 */
export class VoxelRunner {
  private worker: WorkerLike | null = null;
  private pending: Pending | null = null;
  private counter = 0;

  constructor(private readonly createWorker: () => WorkerLike) {}

  get running(): boolean {
    return this.pending !== null;
  }

  run(input: VoxelSimInput, onProgress?: (p: VoxelProgress) => void): Promise<VoxelSimResult> {
    this.cancel();
    const worker = this.ensureWorker();
    const id = `run-${++this.counter}`;
    return new Promise<VoxelSimResult>((resolve, reject) => {
      this.pending = { id, resolve, reject, onProgress };
      worker.postMessage({ type: 'start', id, input });
    });
  }

  cancel(): void {
    const p = this.pending;
    if (!p) return;
    this.pending = null;
    this.worker?.postMessage({ type: 'cancel', id: p.id });
    p.reject(new VoxelRunCancelled());
  }

  private ensureWorker(): WorkerLike {
    if (this.worker) return this.worker;
    const w = this.createWorker();
    w.onmessage = (e) => this.handle(e.data);
    w.onerror = (e) => {
      const p = this.pending;
      this.pending = null;
      this.worker = null; // recreate on the next run
      p?.reject(new Error(e.message || 'Voxel worker failed'));
    };
    this.worker = w;
    return w;
  }

  private handle(msg: VoxelWorkerResponse): void {
    const p = this.pending;
    if (!p || msg.id !== p.id) return; // stale messages from a cancelled run
    if (msg.type === 'progress') {
      p.onProgress?.({ phase: msg.phase, fraction: msg.fraction, message: msg.message });
      return;
    }
    this.pending = null;
    if (msg.type === 'result') p.resolve(msg.result);
    else if (msg.type === 'cancelled') p.reject(new VoxelRunCancelled());
    else p.reject(new Error(msg.message));
  }
}

let shared: VoxelRunner | null = null;

/** The app-wide runner backed by the module worker in worker.ts. */
export function getVoxelRunner(): VoxelRunner {
  shared ??= new VoxelRunner(() => new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' }) as unknown as WorkerLike);
  return shared;
}
