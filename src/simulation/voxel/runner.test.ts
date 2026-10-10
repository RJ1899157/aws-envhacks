import { describe, expect, it } from 'vitest';
import type { VoxelWorkerRequest, VoxelWorkerResponse } from './protocol';
import { VoxelRunner, type WorkerLike } from './runner';
import type { VoxelSimResult } from './solver';

class FakeWorker implements WorkerLike {
  onmessage: ((e: MessageEvent<VoxelWorkerResponse>) => void) | null = null;
  onerror: ((e: ErrorEvent) => void) | null = null;
  sent: VoxelWorkerRequest[] = [];
  postMessage(m: VoxelWorkerRequest) {
    this.sent.push(m);
  }
  reply(m: VoxelWorkerResponse) {
    this.onmessage?.({ data: m } as MessageEvent<VoxelWorkerResponse>);
  }
}

const input = { room: {} as never };

describe('VoxelRunner', () => {
  it('uses one worker and cancels the previous run when a new one starts', async () => {
    let created = 0;
    const worker = new FakeWorker();
    const runner = new VoxelRunner(() => {
      created++;
      return worker;
    });
    const first = runner.run(input);
    const firstOutcome = first.catch((e: Error) => e.name);
    const progress: number[] = [];
    const second = runner.run(input, (p) => progress.push(p.fraction));
    expect(created).toBe(1);
    expect(worker.sent.map((m) => m.type)).toEqual(['start', 'cancel', 'start']);
    expect(await firstOutcome).toBe('VoxelCancelledError');

    // Late messages from the cancelled run are ignored
    worker.reply({ type: 'result', id: worker.sent[0]!.id, result: { tag: 'old' } as unknown as VoxelSimResult });
    worker.reply({ type: 'progress', id: worker.sent[2]!.id, phase: 'velocity', fraction: 0.5, message: '' });
    worker.reply({ type: 'result', id: worker.sent[2]!.id, result: { tag: 'new' } as unknown as VoxelSimResult });
    expect(await second).toEqual({ tag: 'new' });
    expect(progress).toEqual([0.5]);
    expect(runner.running).toBe(false);
  });

  it('cancel() rejects the run and tells the worker', async () => {
    const worker = new FakeWorker();
    const runner = new VoxelRunner(() => worker);
    const run = runner.run(input).catch((e: Error) => e.name);
    runner.cancel();
    expect(await run).toBe('VoxelCancelledError');
    expect(worker.sent[1]).toMatchObject({ type: 'cancel' });
  });

  it('surfaces worker errors', async () => {
    const worker = new FakeWorker();
    const runner = new VoxelRunner(() => worker);
    const run = runner.run(input).catch((e: Error) => e.message);
    worker.reply({ type: 'error', id: worker.sent[0]!.id, message: 'boom' });
    expect(await run).toBe('boom');
  });
});
