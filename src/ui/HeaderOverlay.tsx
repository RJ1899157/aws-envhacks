import React from 'react';
import { useSceneStore, useUiStore } from '../store';

export interface HeaderOverlayProps {
  className?: string;
}

export const HeaderOverlay: React.FC<HeaderOverlayProps> = ({ className = '' }) => {
  const room = useSceneStore((state) => state.room);
  const snapEnabled = useUiStore((state) => state.snapEnabled);
  const gridStep = useUiStore((state) => state.gridStep);
  const toolMode = useUiStore((state) => state.toolMode);

  return (
    <header
      className={`pointer-events-none absolute top-0 left-0 right-0 p-4 flex items-center justify-between text-neutral-300 ${className}`}
    >
      <div className="pointer-events-auto flex items-center gap-3 bg-neutral-900/80 backdrop-blur-md px-3.5 py-1.5 rounded-lg border border-neutral-700/50 shadow-lg text-xs">
        <span className="font-bold text-white tracking-wide">AirForce</span>
        <span className="text-neutral-500">|</span>
        <span className="text-neutral-400">3D Room Builder</span>
        <span className="text-neutral-500">|</span>
        <span className="text-neutral-400">Room: {room.name}</span>
        <span className="text-neutral-500">|</span>
        <span className="text-neutral-400 capitalize">Tool: {toolMode}</span>
      </div>

      <div className="pointer-events-auto flex items-center gap-3 bg-neutral-900/80 backdrop-blur-md px-3.5 py-1.5 rounded-lg border border-neutral-700/50 shadow-lg text-xs">
        <span className="text-neutral-400">
          Snap:{' '}
          <span className="text-neutral-200 font-mono">{snapEnabled ? `${gridStep}m` : 'Off'}</span>
        </span>
        <span className="text-neutral-500">|</span>
        <span className="text-emerald-400 font-medium">Ready</span>
      </div>
    </header>
  );
};
