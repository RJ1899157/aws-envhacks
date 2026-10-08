import { create } from 'zustand';

export interface ExportState {
  isOpen: boolean;
  setIsOpen: (isOpen: boolean) => void;

  isExporting: boolean;
  progress: number;
  message: string;
  setExportProgress: (isExporting: boolean, progress?: number, message?: string) => void;

  cancelSource: AbortController | null;
  setCancelSource: (controller: AbortController | null) => void;
  cancelExport: () => void;
}

export const useExportStore = create<ExportState>((set, get) => ({
  isOpen: false,
  setIsOpen: (isOpen) => set({ isOpen }),

  isExporting: false,
  progress: 0,
  message: '',
  setExportProgress: (isExporting, progress = 0, message = '') => 
    set({ isExporting, progress, message }),

  cancelSource: null,
  setCancelSource: (controller) => set({ cancelSource: controller }),
  
  cancelExport: () => {
    const { cancelSource } = get();
    if (cancelSource) {
      cancelSource.abort();
      set({ cancelSource: null, isExporting: false, progress: 0, message: 'Cancelled' });
    }
  }
}));
