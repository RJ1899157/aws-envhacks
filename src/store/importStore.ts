import { create } from 'zustand';
import type * as THREE from 'three';
import { type Vec2 } from '../core/schema';
import { type ResolvedFile } from '../io/import/FileLoader';

export interface ImportState {
  // Global Drop
  isDropping: boolean;
  setIsDropping: (val: boolean) => void;

  // Modals
  progressModal: { isOpen: boolean, progress: number, message: string };
  setProgressModal: (opts: { isOpen: boolean, progress?: number, message?: string }) => void;

  // 3D Import Dialog
  modelDialog: {
    isOpen: boolean;
    resolvedFile: ResolvedFile | null;
    threeGroup: THREE.Group | null;
    detectedSize: [number, number, number];
  };
  openModelDialog: (resolvedFile: ResolvedFile, threeGroup: THREE.Group, detectedSize: [number, number, number]) => void;
  closeModelDialog: () => void;

  // 2D Floorplan Dialog
  floorplanDialog: {
    isOpen: boolean;
    outline: Vec2[];
    firstLineLengthRaw: number;
  };
  openFloorplanDialog: (outline: Vec2[], rawLength: number) => void;
  closeFloorplanDialog: () => void;
}

export const useImportStore = create<ImportState>((set) => ({
  isDropping: false,
  setIsDropping: (val) => set({ isDropping: val }),

  progressModal: { isOpen: false, progress: 0, message: '' },
  setProgressModal: (opts) => set((state) => ({ 
    progressModal: { ...state.progressModal, ...opts } 
  })),

  modelDialog: { isOpen: false, resolvedFile: null, threeGroup: null, detectedSize: [1, 1, 1] },
  openModelDialog: (resolvedFile, threeGroup, detectedSize) => set({
    modelDialog: { isOpen: true, resolvedFile, threeGroup, detectedSize }
  }),
  closeModelDialog: () => set((state) => ({
    modelDialog: { ...state.modelDialog, isOpen: false }
  })),

  floorplanDialog: { isOpen: false, outline: [], firstLineLengthRaw: 1 },
  openFloorplanDialog: (outline, firstLineLengthRaw) => set({
    floorplanDialog: { isOpen: true, outline, firstLineLengthRaw }
  }),
  closeFloorplanDialog: () => set((state) => ({
    floorplanDialog: { ...state.floorplanDialog, isOpen: false }
  })),
}));
