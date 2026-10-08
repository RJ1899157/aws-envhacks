import { create } from 'zustand';

export interface SavedView {
  id: string;
  name: string;
  position: [number, number, number];
  target: [number, number, number];
  fov: number;
  projection: 'perspective' | 'orthographic';
  zoom?: number;
  thumbnailDataUrl?: string;
  createdAt: number;
}

export type PivotMode = 'room-center' | 'selection' | 'cursor';

export interface CameraState {
  projection: 'perspective' | 'orthographic';
  fov: number; // 30 - 90 deg
  dampedInertia: boolean;
  pivotMode: PivotMode;
  isTurntableActive: boolean;
  isWalkthroughActive: boolean;
  savedViews: SavedView[];

  // Actions
  setProjection: (projection: 'perspective' | 'orthographic') => void;
  setFov: (fov: number) => void;
  setDampedInertia: (enabled: boolean) => void;
  setPivotMode: (mode: PivotMode) => void;
  toggleTurntable: () => void;
  setTurntableActive: (active: boolean) => void;
  toggleWalkthrough: () => void;
  setWalkthroughActive: (active: boolean) => void;
  saveView: (view: Omit<SavedView, 'id' | 'createdAt'>) => SavedView;
  deleteSavedView: (id: string) => void;
  renameSavedView: (id: string, name: string) => void;
}

const STORAGE_KEY = 'airforce-saved-views';

const getInitialSavedViews = (): SavedView[] => {
  if (typeof localStorage === 'undefined') return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw);
  } catch {
    // ignore
  }
  return [];
};

export const useCameraStore = create<CameraState>()((set, get) => ({
  projection: 'perspective',
  fov: 45,
  dampedInertia: true,
  pivotMode: 'room-center',
  isTurntableActive: false,
  isWalkthroughActive: false,
  savedViews: getInitialSavedViews(),

  setProjection: (projection) => set({ projection }),
  setFov: (fov) => set({ fov: Math.max(30, Math.min(90, fov)) }),
  setDampedInertia: (dampedInertia) => set({ dampedInertia }),
  setPivotMode: (pivotMode) => set({ pivotMode }),
  toggleTurntable: () => set((state) => ({ isTurntableActive: !state.isTurntableActive })),
  setTurntableActive: (isTurntableActive) => set({ isTurntableActive }),
  toggleWalkthrough: () => set((state) => ({ isWalkthroughActive: !state.isWalkthroughActive })),
  setWalkthroughActive: (isWalkthroughActive) => set({ isWalkthroughActive }),

  saveView: (viewData) => {
    const newView: SavedView = {
      ...viewData,
      id: `view-${Date.now()}-${Math.random().toString(36).substr(2, 4)}`,
      createdAt: Date.now(),
    };
    const updated = [newView, ...get().savedViews];
    set({ savedViews: updated });
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
    } catch {
      // ignore
    }
    return newView;
  },

  deleteSavedView: (id) => {
    const updated = get().savedViews.filter((v) => v.id !== id);
    set({ savedViews: updated });
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
    } catch {
      // ignore
    }
  },

  renameSavedView: (id, name) => {
    const updated = get().savedViews.map((v) => (v.id === id ? { ...v, name } : v));
    set({ savedViews: updated });
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
    } catch {
      // ignore
    }
  },
}));
