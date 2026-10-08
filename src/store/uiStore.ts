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

  // Actions
  setToolMode: (mode: ToolMode) => void;
  setTransformMode: (mode: TransformMode) => void;
  setView: (view: ViewMode) => void;
  setSnapEnabled: (enabled: boolean) => void;
  toggleSnap: () => void;
  setGridStep: (step: number) => void;
  setShowDimensions: (show: boolean) => void;
  toggleDimensions: () => void;
  setShowCeiling: (show: boolean) => void;
  toggleCeiling: () => void;
  setSelectedVertexIndex: (index: number | null) => void;
  setActiveAssetId: (id: string | null) => void;
  setGhostPosition: (pos: Vec3 | null) => void;
  resetUi: () => void;
}

export const initialUiState = {
  toolMode: 'select' as ToolMode,
  transformMode: 'translate' as TransformMode,
  view: '3d' as ViewMode,
  snapEnabled: true,
  gridStep: DEFAULT_TRANSLATION_SNAP_METERS, // 0.05m
  showDimensions: true,
  showCeiling: false,
  selectedVertexIndex: null as number | null,
  activeAssetId: null as string | null,
  ghostPosition: null as Vec3 | null,
};

export const useUiStore = create<UiState>()((set) => ({
  ...initialUiState,

  setToolMode: (toolMode) => set({ toolMode }),
  setTransformMode: (transformMode) => set({ transformMode }),
  setView: (view) => set({ view }),
  setSnapEnabled: (snapEnabled) => set({ snapEnabled }),
  toggleSnap: () => set((state) => ({ snapEnabled: !state.snapEnabled })),
  setGridStep: (gridStep) => set({ gridStep }),
  setShowDimensions: (showDimensions) => set({ showDimensions }),
  toggleDimensions: () => set((state) => ({ showDimensions: !state.showDimensions })),
  setShowCeiling: (showCeiling) => set({ showCeiling }),
  toggleCeiling: () => set((state) => ({ showCeiling: !state.showCeiling })),
  setSelectedVertexIndex: (selectedVertexIndex) => set({ selectedVertexIndex }),
  setActiveAssetId: (activeAssetId) => set({ activeAssetId }),
  setGhostPosition: (ghostPosition) => set({ ghostPosition }),
  resetUi: () => set(initialUiState),
}));
