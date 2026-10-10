import { afterEach, describe, expect, it } from 'vitest';
import { createBedroomSample } from '../core/samples';
import { simulationInputKey } from '../simulation/viz/staleness';
import type { VoxelSimResult } from '../simulation/voxel/solver';
import { setVoxelRunnerFactory, useSimulationStore } from './simulationStore';

afterEach(() => useSimulationStore.getState().clearResult());

describe('simulation store', () => {
  it('stores the result with the key of the inputs it was run on', async () => {
    const room = createBedroomSample();
    setVoxelRunnerFactory(() => ({ run: async () => ({ tag: 'r' }) as unknown as VoxelSimResult, cancel: () => {} }));
    await useSimulationStore.getState().runVoxel(room, []);
    const st = useSimulationStore.getState();
    expect(st.status).toBe('done');
    expect(st.resultKey).toBe(simulationInputKey(room, [], st.settings));
  });

  it('a superseded run never overwrites the newer result', async () => {
    const room = createBedroomSample();
    const resolvers: ((r: VoxelSimResult) => void)[] = [];
    setVoxelRunnerFactory(() => ({ run: () => new Promise<VoxelSimResult>((res) => resolvers.push(res)), cancel: () => {} }));
    const first = useSimulationStore.getState().runVoxel(room, []);
    const second = useSimulationStore.getState().runVoxel(room, []);
    resolvers[1]!({ tag: 'new' } as unknown as VoxelSimResult);
    await second;
    resolvers[0]!({ tag: 'old' } as unknown as VoxelSimResult);
    await first;
    expect(useSimulationStore.getState().result).toEqual({ tag: 'new' });
  });

  it('drops the old result as soon as a run for a changed design starts, so it never plays meanwhile', async () => {
    const room = createBedroomSample();
    setVoxelRunnerFactory(() => ({ run: async () => ({ tag: 'old' }) as unknown as VoxelSimResult, cancel: () => {} }));
    await useSimulationStore.getState().runVoxel(room, []);
    expect(useSimulationStore.getState().result).toEqual({ tag: 'old' });
    let resolve: (r: VoxelSimResult) => void = () => {};
    setVoxelRunnerFactory(() => ({ run: () => new Promise<VoxelSimResult>((res) => (resolve = res)), cancel: () => {} }));
    const changed = { ...room, objects: room.objects.slice(1) };
    const run = useSimulationStore.getState().runVoxel(changed, []);
    expect(useSimulationStore.getState().status).toBe('running');
    expect(useSimulationStore.getState().result).toBeNull();
    resolve({ tag: 'new' } as unknown as VoxelSimResult);
    await run;
    expect(useSimulationStore.getState().result).toEqual({ tag: 'new' });
  });

  it('is not part of the design: the scene export has no simulation data', async () => {
    const { useSceneStore } = await import('./sceneStore');
    expect(useSceneStore.getState().exportRoom()).not.toMatch(/pm25"|snapshots|velocity/);
  });
});
