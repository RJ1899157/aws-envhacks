import React from 'react';
import { useProgress } from '@react-three/drei';

/**
 * Global progress bar for asynchronous GLTF / texture downloads and parses.
 * Appears seamlessly at top of screen with glowing gradient and live percentage.
 */
export const GLTFLoadProgressBar: React.FC = () => {
  const { active, progress, item } = useProgress();

  if (!active || progress >= 100) return null;

  const itemName = item ? item.split('/').pop()?.replace(/\.[^/.]+$/, '') : 'model';

  return (
    <div
      data-testid="gltf-load-progress-bar"
      className="fixed top-0 left-0 right-0 z-50 pointer-events-none transition-opacity duration-300"
    >
      {/* Sleek Gradient Bar */}
      <div className="h-0.5 bg-neutral-900/60 overflow-hidden w-full backdrop-blur-xs">
        <div
          className="h-full bg-gradient-to-r from-sky-400 via-cyan-300 to-amber-400 transition-all duration-150 ease-out shadow-[0_0_10px_rgba(56,189,248,0.9)]"
          style={{ width: `${Math.max(5, Math.min(100, progress))}%` }}
        />
      </div>

      {/* Floating Status Pill */}
      <div className="absolute top-2 right-4 flex items-center gap-2 px-2.5 py-1 rounded-full bg-neutral-950/85 border border-sky-500/40 text-[10px] text-sky-200 font-mono shadow-2xl backdrop-blur-md animate-in fade-in slide-in-from-top-1 duration-200">
        <span className="w-1.5 h-1.5 rounded-full bg-sky-400 animate-ping" />
        <span>Loading {itemName}</span>
        <span className="font-bold text-amber-300">{Math.round(progress)}%</span>
      </div>
    </div>
  );
};

export default GLTFLoadProgressBar;
