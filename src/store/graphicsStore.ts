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

const getInitialTheme = (): ThemeMode => {
  if (typeof window !== 'undefined') {
    const saved = localStorage.getItem('airforce-theme') as ThemeMode | null;
    if (saved === 'light' || saved === 'dark') return saved;
    if (window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches) {
      return 'light';
    }
  }
  return 'dark';
};

const applyThemeToDOM = (theme: ThemeMode) => {
  if (typeof document !== 'undefined') {
    document.documentElement.setAttribute('data-theme', theme);
    if (theme === 'dark') {
      document.documentElement.classList.add('dark');
      document.documentElement.classList.remove('light');
    } else {
      document.documentElement.classList.remove('dark');
      document.documentElement.classList.add('light');
    }
  }
};

const initialTheme = getInitialTheme();
applyThemeToDOM(initialTheme);

export const useGraphicsStore = create<GraphicsState>()((set) => ({
  quality: 'Medium',
  wallOpacityMode: 'Auto-fade',
  theme: initialTheme,
  fps: 60,

  setQuality: (quality) => set({ quality }),
  setWallOpacityMode: (wallOpacityMode) => set({ wallOpacityMode }),
  setTheme: (theme) => {
    set({ theme });
    try {
      localStorage.setItem('airforce-theme', theme);
    } catch {
      // ignore
    }
    applyThemeToDOM(theme);
  },
  setFps: (fps) => set({ fps }),
}));
