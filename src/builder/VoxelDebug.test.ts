import { beforeEach, describe, expect, it } from 'vitest';
import { useUiStore } from '../store/uiStore';
import { useSceneStore } from '../store/sceneStore';
import { VoxelDebugMesh, VoxelDebugControls } from './VoxelDebug';
import { voxelize, computeVoxelStats, CellType } from '../core/voxelizer';
import { createBedroomSample } from '../core/samples';

describe('VoxelDebug Component and UI State Integration', () => {
  beforeEach(() => {
    useSceneStore.getState().resetRoom();
    useSceneStore.temporal.getState().clear();
    useUiStore.getState().resetUi();
  });

  it('exports VoxelDebugMesh and VoxelDebugControls', () => {
    expect(VoxelDebugMesh).toBeDefined();
    expect(VoxelDebugControls).toBeDefined();
  });

  it('toggles voxel debug mode and updates slice and opacity controls in uiStore', () => {
    expect(useUiStore.getState().showVoxelDebug).toBe(false);

    // Toggle on
    useUiStore.getState().toggleVoxelDebug();
    expect(useUiStore.getState().showVoxelDebug).toBe(true);

    // Set Y-slice
    useUiStore.getState().setVoxelSliceY(12);
    expect(useUiStore.getState().voxelSliceY).toBe(12);

    // Reset slice to all (null)
    useUiStore.getState().setVoxelSliceY(null);
    expect(useUiStore.getState().voxelSliceY).toBeNull();

    // Set opacity
    useUiStore.getState().setVoxelOpacity(0.8);
    expect(useUiStore.getState().voxelOpacity).toBe(0.8);

    // Toggle solid walls
    useUiStore.getState().setShowSolidVoxels(false);
    expect(useUiStore.getState().showSolidVoxels).toBe(false);

    // Toggle off
    useUiStore.getState().toggleVoxelDebug();
    expect(useUiStore.getState().showVoxelDebug).toBe(false);
  });

  it('stores and tracks voxel domain memory and computation time', () => {
    const room = createBedroomSample();
    const grid = voxelize(room, 0.1);
    const stats = computeVoxelStats(grid, 18.5);

    useUiStore.getState().setVoxelStats(stats);
    const currentStats = useUiStore.getState().voxelStats;

    expect(currentStats).not.toBeNull();
    expect(currentStats?.cellCount).toBe(grid.cells.length);
    expect(currentStats?.memoryBytes).toBe(grid.cells.byteLength);
    expect(currentStats?.computeTimeMs).toBe(18.5);
    expect(currentStats?.inletCount).toBeGreaterThan(0);
  });

  it('computes room voxelization with openings showing as non-solid (inlet/outlet) cells', () => {
    const room = createBedroomSample();
    const grid = voxelize(room, 0.1);

    // Bedroom has 2 windows tagged inlet
    let inletFound = false;
    for (let i = 0; i < grid.cells.length; i++) {
      if (grid.cells[i] === CellType.INLET) {
        inletFound = true;
        break;
      }
    }
    expect(inletFound).toBe(true);
  });
});
