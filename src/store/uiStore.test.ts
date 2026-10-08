import { beforeEach, describe, expect, it } from 'vitest';
import { initialUiState, useUiStore } from './uiStore';

describe('useUiStore', () => {
  beforeEach(() => {
    useUiStore.getState().resetUi();
  });

  it('initializes with default settings', () => {
    const state = useUiStore.getState();
    expect(state.toolMode).toBe('select');
    expect(state.transformMode).toBe('translate');
    expect(state.view).toBe('3d');
    expect(state.snapEnabled).toBe(true);
    expect(state.gridStep).toBe(0.05);
    expect(state.showDimensions).toBe(true);
    expect(state.activeAssetId).toBeNull();
    expect(state.ghostPosition).toBeNull();
  });

  it('updates toolMode and transformMode', () => {
    useUiStore.getState().setToolMode('draw-floor');
    expect(useUiStore.getState().toolMode).toBe('draw-floor');

    useUiStore.getState().setTransformMode('rotate');
    expect(useUiStore.getState().transformMode).toBe('rotate');

    useUiStore.getState().setView('2d');
    expect(useUiStore.getState().view).toBe('2d');
  });

  it('toggles and sets snapping and gridStep', () => {
    useUiStore.getState().toggleSnap();
    expect(useUiStore.getState().snapEnabled).toBe(false);

    useUiStore.getState().setSnapEnabled(true);
    expect(useUiStore.getState().snapEnabled).toBe(true);

    useUiStore.getState().setGridStep(0.1);
    expect(useUiStore.getState().gridStep).toBe(0.1);
  });

  it('manages activeAssetId and ghostPosition', () => {
    useUiStore.getState().setActiveAssetId('office-chair');
    expect(useUiStore.getState().activeAssetId).toBe('office-chair');

    useUiStore.getState().setGhostPosition([1.5, 0, -2.0]);
    expect(useUiStore.getState().ghostPosition).toEqual([1.5, 0, -2.0]);

    useUiStore.getState().resetUi();
    expect(useUiStore.getState()).toEqual(expect.objectContaining(initialUiState));
  });
});
