import { create } from 'zustand';
import { DEFAULT_TRANSLATION_SNAP_METERS } from '../core/constants';
import type { Vec3 } from '../core/types';

export type ToolMode = 'select' | 'draw-floor' | 'place' | 'opening';
export type TransformMode = 'translate' | 'rotate';
export type ViewMode = '3d' | '2d';

export interface DraggedOpeningPreview {
  wallIndex: number;
  offset: number;
  width: number;
  height: number;
  sill: number;
  type: 'window' | 'door';
  subType?: string;
  snapLabel?: string;
}

export interface UiState {
  toolMode: ToolMode;
  transformMode: TransformMode;
  view: ViewMode;
  snapEnabled: boolean;
  gridStep: number;
  showDimensions: boolean;
  showAllWallDimensions: boolean;
  showCeiling: boolean;
  selectedVertexIndex: number | null;
  selectedWallIndex: number | null;
  hoveredWallIndex: number | null;
  toastMessage: string | null;
  activeAssetId: string | null;
  ghostPosition: Vec3 | null;
  draggedOpeningPreview: DraggedOpeningPreview | null;
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
  showScaleReference: boolean;
  showPrecisionGizmo: boolean;
  autoOrientToWall: boolean;

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
  setShowPrecisionGizmo: (show: boolean) => void;
  togglePrecisionGizmo: () => void;
  setAutoOrientToWall: (autoOrient: boolean) => void;
  toggleAutoOrientToWall: () => void;
  setNumericInputBuffer: (buffer: string | null) => void;
  setIsCollisionWarning: (warning: boolean) => void;
  setShowDimensions: (show: boolean) => void;
  toggleDimensions: () => void;
  setShowAllWallDimensions: (show: boolean) => void;
  setShowCeiling: (show: boolean) => void;
  toggleCeiling: () => void;
  setShowScaleReference: (show: boolean) => void;
  toggleScaleReference: () => void;
  setSelectedVertexIndex: (index: number | null) => void;
  setSelectedWallIndex: (index: number | null) => void;
  setHoveredWallIndex: (index: number | null) => void;
  setToastMessage: (msg: string | null) => void;
  setActiveAssetId: (id: string | null) => void;
  setGhostPosition: (pos: Vec3 | null) => void;
  setDraggedOpeningPreview: (preview: DraggedOpeningPreview | null) => void;
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
  showAllWallDimensions: false,
  showCeiling: false,
  selectedVertexIndex: null as number | null,
  selectedWallIndex: null as number | null,
  hoveredWallIndex: null as number | null,
  toastMessage: null as string | null,
  activeAssetId: null as string | null,
  ghostPosition: null as Vec3 | null,
  draggedOpeningPreview: null as DraggedOpeningPreview | null,
  cursorCoords: null as [number, number] | null,
  isPlacingPollutantSource: false,
  showVoxelDebug: false,
  voxelSliceY: null as number | null,
  voxelOpacity: 0.65,
  showSolidVoxels: true,
  voxelStats: null as import('../core/voxelizer').VoxelStats | null,
  showScaleReference: false,
  showPrecisionGizmo: false, // Default OFF as requested
  autoOrientToWall: false, // Opt-in toggle as requested
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
  setShowPrecisionGizmo: (showPrecisionGizmo) => set({ showPrecisionGizmo }),
  togglePrecisionGizmo: () => set((state) => ({ showPrecisionGizmo: !state.showPrecisionGizmo })),
  setAutoOrientToWall: (autoOrientToWall) => set({ autoOrientToWall }),
  toggleAutoOrientToWall: () => set((state) => ({ autoOrientToWall: !state.autoOrientToWall })),
  setNumericInputBuffer: (numericInputBuffer) => set({ numericInputBuffer }),
  setIsCollisionWarning: (isCollisionWarning) => set({ isCollisionWarning }),
  setShowDimensions: (showDimensions) => set({ showDimensions }),
  toggleDimensions: () => set((state) => ({ showDimensions: !state.showDimensions })),
  setShowAllWallDimensions: (showAllWallDimensions) => set({ showAllWallDimensions }),
  setShowCeiling: (showCeiling) => set({ showCeiling }),
  toggleCeiling: () => set((state) => ({ showCeiling: !state.showCeiling })),
  setShowScaleReference: (showScaleReference) => set({ showScaleReference }),
  toggleScaleReference: () => set((state) => ({ showScaleReference: !state.showScaleReference })),
  setSelectedVertexIndex: (selectedVertexIndex) => set({ selectedVertexIndex }),
  setSelectedWallIndex: (selectedWallIndex) => set({ selectedWallIndex }),
  setHoveredWallIndex: (hoveredWallIndex) => set({ hoveredWallIndex }),
  setToastMessage: (toastMessage) => set({ toastMessage }),
  setActiveAssetId: (activeAssetId) => set({ activeAssetId }),
  setGhostPosition: (ghostPosition) => set({ ghostPosition }),
  setDraggedOpeningPreview: (draggedOpeningPreview) => set({ draggedOpeningPreview }),
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
