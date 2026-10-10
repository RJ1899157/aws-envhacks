import { VOXEL_CACHE_SIZE } from '../constants';
import type { VoxelRunner } from '../voxel/runner';
import type { VoxelProgress, VoxelSimInput, VoxelSimResult } from '../voxel/solver';

type Runner = Pick<VoxelRunner, 'run' | 'cancel'>;

export interface VoxelJob {
  key: string;
  label: string;
  priority: 'high' | 'low';
}

export interface VoxelQueueState {
  running: (VoxelJob & { progress: VoxelProgress | null }) | null;
  queued: VoxelJob[];
}

interface Entry extends VoxelJob {
  input: VoxelSimInput;
  promise: Promise<VoxelSimResult>;
  resolve: (r: VoxelSimResult) => void;
  reject: (e: Error) => void;
}

export class VoxelJobCancelled extends Error {
  constructor() {
    super('Voxel job cancelled');
    this.name = 'VoxelCancelledError';
  }
}

/**
 * Voxel runs one at a time on the shared solver worker, cached by a key of the design + inputs
 * (simulationInputKey), so revisiting a design is instant. High-priority jobs (the user's Run) go
 * first and pre-empt a running background job, which is re-queued; asking again for a key that is
 * queued or running joins that job.
 */
export class VoxelQueue {
  private cache = new Map<string, VoxelSimResult>();
  private queue: Entry[] = [];
  private current: (Entry & { progress: VoxelProgress | null }) | null = null;
  private listeners = new Set<() => void>();
  private held = false;
  private snapshot: VoxelQueueState = { running: null, queued: [] };

  constructor(
    private readonly runner: () => Runner,
    private readonly cacheSize = VOXEL_CACHE_SIZE
  ) {}

  get(key: string): VoxelSimResult | undefined {
    const r = this.cache.get(key);
    if (r) {
      // Refresh recency
      this.cache.delete(key);
      this.cache.set(key, r);
    }
    return r;
  }

  has(key: string): boolean {
    return this.cache.has(key);
  }

  /** Puts a result in the cache (e.g. one computed elsewhere). */
  put(key: string, result: VoxelSimResult): void {
    this.cache.delete(key);
    this.cache.set(key, result);
    while (this.cache.size > this.cacheSize) this.cache.delete(this.cache.keys().next().value!);
    this.emit();
  }

  state(): VoxelQueueState {
    return this.snapshot;
  }

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  isPending(key: string): boolean {
    return this.current?.key === key || this.queue.some((e) => e.key === key);
  }

  enqueue(job: VoxelJob & { input: VoxelSimInput }): Promise<VoxelSimResult> {
    const hit = this.get(job.key);
    if (hit) return Promise.resolve(hit);
    const existing = this.current?.key === job.key ? this.current : this.queue.find((e) => e.key === job.key);
    if (existing) {
      if (job.priority === 'high' && existing.priority === 'low') {
        existing.priority = 'high';
        this.sort();
        if (this.current !== existing) this.preempt();
        this.pump();
      }
      return existing.promise;
    }
    let resolve!: (r: VoxelSimResult) => void;
    let reject!: (e: Error) => void;
    const promise = new Promise<VoxelSimResult>((res, rej) => {
      resolve = res;
      reject = rej;
    });
    // Callers that drop the promise must not see unhandled rejections
    promise.catch(() => {});
    this.queue.push({ ...job, promise, resolve, reject });
    this.sort();
    if (job.priority === 'high') this.preempt();
    this.pump();
    return promise;
  }

  /** Cancels one job (queued or running), or every job. */
  cancel(key?: string): void {
    const drop = (e: Entry) => e.reject(new VoxelJobCancelled());
    if (key === undefined) {
      this.queue.splice(0).forEach(drop);
      if (this.current) {
        const c = this.current;
        this.current = null;
        this.runner().cancel();
        drop(c);
      }
    } else {
      const i = this.queue.findIndex((e) => e.key === key);
      if (i >= 0) drop(this.queue.splice(i, 1)[0]!);
      if (this.current?.key === key) {
        const c = this.current;
        this.current = null;
        this.runner().cancel();
        drop(c);
      }
    }
    this.emit();
    this.pump();
  }

  /**
   * Holds the queue while something else uses the solver worker (the user's main Run): a job in
   * flight is stopped and re-queued, nothing starts until resume().
   */
  suspend(): void {
    this.held = true;
    const c = this.current;
    if (c) {
      this.current = null;
      this.runner().cancel();
      const { progress: _p, ...entry } = c;
      void _p;
      this.queue.unshift(entry);
      this.sort();
    }
    this.emit();
  }

  resume(): void {
    this.held = false;
    this.pump();
  }

  /** Cancels background (low-priority) jobs only. */
  cancelBackground(): void {
    for (const e of [...this.queue]) if (e.priority === 'low') this.cancel(e.key);
    if (this.current?.priority === 'low') this.cancel(this.current.key);
  }

  private sort(): void {
    this.queue.sort((a, b) => (a.priority === b.priority ? 0 : a.priority === 'high' ? -1 : 1));
  }

  /** A high job waiting while a low one runs: stop the low one and put it back in the queue. */
  private preempt(): void {
    const c = this.current;
    if (!c || c.priority === 'high' || !this.queue.some((e) => e.priority === 'high')) return;
    this.current = null;
    this.runner().cancel();
    const { progress: _p, ...entry } = c;
    void _p;
    this.queue.push(entry);
    this.sort();
  }

  private pump(): void {
    if (this.held || this.current || this.queue.length === 0) {
      this.emit();
      return;
    }
    const next = this.queue.shift()!;
    const cur = { ...next, progress: null as VoxelProgress | null };
    this.current = cur;
    this.emit();
    this.runner()
      .run(next.input, (p) => {
        if (this.current === cur) {
          cur.progress = p;
          this.emit();
        }
      })
      .then(
        (result) => {
          if (this.current !== cur) return; // pre-empted or cancelled; the re-queued job will run again
          this.current = null;
          this.put(next.key, result);
          next.resolve(result);
          this.pump();
        },
        (err: Error) => {
          if (this.current !== cur) return;
          this.current = null;
          next.reject(err);
          this.pump();
        }
      );
  }

  private emit(): void {
    const c = this.current;
    this.snapshot = {
      running: c ? { key: c.key, label: c.label, priority: c.priority, progress: c.progress } : null,
      queued: this.queue.map(({ key, label, priority }) => ({ key, label, priority })),
    };
    for (const fn of this.listeners) fn();
  }
}
