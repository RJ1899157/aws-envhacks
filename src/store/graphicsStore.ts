import { create } from 'zustand';

export type QualitySetting = 'Low' | 'Medium' | 'High';
export type WallOpacityMode = 'Auto-fade' | 'Cutaway' | 'Solid';
export type ThemeMode = 'light' | 'dark';

export interface GraphicsState {
  quality: QualitySetting;
  wallOpacityMode: WallOpacityMode;
  theme: ThemeMode;
  fps: number;
  
  setQuality: (quality: QualitySetting) => void;
  setWallOpacityMode: (mode: WallOpacityMode) => void;
  setTheme: (theme: ThemeMode) => void;
  setFps: (fps: number) => void;
}

export const useGraphicsStore = create<GraphicsState>()((set) => ({
  quality: 'Medium',
  wallOpacityMode: 'Auto-fade',
  theme: 'dark',
  fps: 60,

  setQuality: (quality) => set({ quality }),
  setWallOpacityMode: (wallOpacityMode) => set({ wallOpacityMode }),
  setTheme: (theme) => {
    set({ theme });
    if (typeof document !== 'undefined') {
      if (theme === 'dark') {
        document.documentElement.classList.add('dark');
      } else {
        document.documentElement.classList.remove('dark');
      }
    }
  },
  setFps: (fps) => set({ fps }),
}));
