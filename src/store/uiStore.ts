import { create } from 'zustand';
import { DEFAULT_TRANSLATION_SNAP_METERS } from '../core/constants';
import type { Vec3 } from '../core/types';

export type ToolMode = 'select' | 'draw-floor' | 'place' | 'opening';
export type TransformMode = 'translate' | 'rotate';
export type ViewMode = '3d' | '2d';

export interface UiState {
  toolMode: ToolMode;
  transformMode: TransformMode;
  view: ViewMode;
  snapEnabled: boolean;
  gridStep: number;
  showDimensions: boolean;
  showCeiling: boolean;
  selectedVertexIndex: number | null;
  activeAssetId: string | null;
  ghostPosition: Vec3 | null;
  rotationSnapDeg: number;
  transformY: boolean;
  numericInputBuffer: string | null;
  isCollisionWarning: boolean;
  cursorCoords: [number, number] | null;
  isPlacingPollutantSource: boolean;
  showVoxelDebug: boolean;
  voxelSliceY: number | null;
  voxelOpacity: number;
  showSolidVoxels: boolean;
  voxelStats: import('../core/voxelizer').VoxelStats | null;

  // Actions
  setToolMode: (mode: ToolMode) => void;
  setTransformMode: (mode: TransformMode) => void;
  setView: (view: ViewMode) => void;
  setSnapEnabled: (enabled: boolean) => void;
  toggleSnap: () => void;
  setGridStep: (step: number) => void;
  setRotationSnapDeg: (deg: number) => void;
  setTransformY: (enabled: boolean) => void;
  toggleTransformY: () => void;
  setNumericInputBuffer: (buffer: string | null) => void;
  setIsCollisionWarning: (warning: boolean) => void;
  setShowDimensions: (show: boolean) => void;
  toggleDimensions: () => void;
  setShowCeiling: (show: boolean) => void;
  toggleCeiling: () => void;
  setSelectedVertexIndex: (index: number | null) => void;
  setActiveAssetId: (id: string | null) => void;
  setGhostPosition: (pos: Vec3 | null) => void;
  setCursorCoords: (coords: [number, number] | null) => void;
  setIsPlacingPollutantSource: (placing: boolean) => void;
  setShowVoxelDebug: (show: boolean) => void;
  toggleVoxelDebug: () => void;
  setVoxelSliceY: (slice: number | null) => void;
  setVoxelOpacity: (opacity: number) => void;
  setShowSolidVoxels: (show: boolean) => void;
  setVoxelStats: (stats: import('../core/voxelizer').VoxelStats | null) => void;
  resetUi: () => void;
}

export const initialUiState = {
  toolMode: 'select' as ToolMode,
  transformMode: 'translate' as TransformMode,
  view: '3d' as ViewMode,
  snapEnabled: true,
  gridStep: DEFAULT_TRANSLATION_SNAP_METERS, // 0.05m
  rotationSnapDeg: 15, // 15 degrees
  transformY: false,
  numericInputBuffer: null as string | null,
  isCollisionWarning: false,
  showDimensions: true,
  showCeiling: false,
  selectedVertexIndex: null as number | null,
  activeAssetId: null as string | null,
  ghostPosition: null as Vec3 | null,
  cursorCoords: null as [number, number] | null,
  isPlacingPollutantSource: false,
  showVoxelDebug: false,
  voxelSliceY: null as number | null,
  voxelOpacity: 0.65,
  showSolidVoxels: true,
  voxelStats: null as import('../core/voxelizer').VoxelStats | null,
};

export const useUiStore = create<UiState>()((set) => ({
  ...initialUiState,

  setToolMode: (toolMode) => set({ toolMode }),
  setTransformMode: (transformMode) => set({ transformMode }),
  setView: (view) => set({ view }),
  setSnapEnabled: (snapEnabled) => set({ snapEnabled }),
  toggleSnap: () => set((state) => ({ snapEnabled: !state.snapEnabled })),
  setGridStep: (gridStep) => set({ gridStep }),
  setRotationSnapDeg: (rotationSnapDeg) => set({ rotationSnapDeg }),
  setTransformY: (transformY) => set({ transformY }),
  toggleTransformY: () => set((state) => ({ transformY: !state.transformY })),
  setNumericInputBuffer: (numericInputBuffer) => set({ numericInputBuffer }),
  setIsCollisionWarning: (isCollisionWarning) => set({ isCollisionWarning }),
  setShowDimensions: (showDimensions) => set({ showDimensions }),
  toggleDimensions: () => set((state) => ({ showDimensions: !state.showDimensions })),
  setShowCeiling: (showCeiling) => set({ showCeiling }),
  toggleCeiling: () => set((state) => ({ showCeiling: !state.showCeiling })),
  setSelectedVertexIndex: (selectedVertexIndex) => set({ selectedVertexIndex }),
  setActiveAssetId: (activeAssetId) => set({ activeAssetId }),
  setGhostPosition: (ghostPosition) => set({ ghostPosition }),
  setCursorCoords: (cursorCoords) => set({ cursorCoords }),
  setIsPlacingPollutantSource: (isPlacingPollutantSource) => set({ isPlacingPollutantSource }),
  setShowVoxelDebug: (showVoxelDebug) => set({ showVoxelDebug }),
  toggleVoxelDebug: () => set((state) => ({ showVoxelDebug: !state.showVoxelDebug })),
  setVoxelSliceY: (voxelSliceY) => set({ voxelSliceY }),
  setVoxelOpacity: (voxelOpacity) => set({ voxelOpacity }),
  setShowSolidVoxels: (showSolidVoxels) => set({ showSolidVoxels }),
  setVoxelStats: (voxelStats) => set({ voxelStats }),
  resetUi: () => set(initialUiState),
}));
