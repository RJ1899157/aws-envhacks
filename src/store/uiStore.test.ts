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
    expect(state.gridStep).toBe(0.1);
    expect(state.showDimensions).toBe(true);
    expect(state.showCeiling).toBe(true);
    expect(state.selectedVertexIndex).toBeNull();
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

  it('toggles and sets ceiling and selected vertex index', () => {
    useUiStore.getState().toggleCeiling();
    expect(useUiStore.getState().showCeiling).toBe(false);

    useUiStore.getState().setShowCeiling(true);
    expect(useUiStore.getState().showCeiling).toBe(true);

    useUiStore.getState().setSelectedVertexIndex(2);
    expect(useUiStore.getState().selectedVertexIndex).toBe(2);

    useUiStore.getState().setSelectedVertexIndex(null);
    expect(useUiStore.getState().selectedVertexIndex).toBeNull();
  });

  it('toggles and sets snapping and gridStep', () => {
    useUiStore.getState().toggleSnap();
    expect(useUiStore.getState().snapEnabled).toBe(false);

    useUiStore.getState().setSnapEnabled(true);
    expect(useUiStore.getState().snapEnabled).toBe(true);

    useUiStore.getState().setGridStep(0.25);
    expect(useUiStore.getState().gridStep).toBe(0.25);
  });

  it('manages activeAssetId and ghostPosition', () => {
    useUiStore.getState().setActiveAssetId('office-chair');
    expect(useUiStore.getState().activeAssetId).toBe('office-chair');

    useUiStore.getState().setGhostPosition([1.5, 0, -2.0]);
    expect(useUiStore.getState().ghostPosition).toEqual([1.5, 0, -2.0]);

    useUiStore.getState().resetUi();
    expect(useUiStore.getState()).toEqual(expect.objectContaining(initialUiState));
  });

  it('manages rotationSnapDeg, transformY, numericInputBuffer, and isCollisionWarning', () => {
    useUiStore.getState().setRotationSnapDeg(30);
    expect(useUiStore.getState().rotationSnapDeg).toBe(30);

    useUiStore.getState().toggleTransformY();
    expect(useUiStore.getState().transformY).toBe(true);

    useUiStore.getState().setTransformY(false);
    expect(useUiStore.getState().transformY).toBe(false);

    useUiStore.getState().setNumericInputBuffer('1.25');
    expect(useUiStore.getState().numericInputBuffer).toBe('1.25');

    useUiStore.getState().setIsCollisionWarning(true);
    expect(useUiStore.getState().isCollisionWarning).toBe(true);
  });
});
