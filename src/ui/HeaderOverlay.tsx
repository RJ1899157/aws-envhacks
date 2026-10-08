import React, { useMemo } from 'react';
import { signedArea } from '../core/parser';
import { useSceneStore, useUiStore } from '../store';

export interface HeaderOverlayProps {
  className?: string;
}

export const HeaderOverlay: React.FC<HeaderOverlayProps> = ({ className = '' }) => {
  const room = useSceneStore((state) => state.room);
  const snapEnabled = useUiStore((state) => state.snapEnabled);
  const toggleSnap = useUiStore((state) => state.toggleSnap);
  const gridStep = useUiStore((state) => state.gridStep);
  const toolMode = useUiStore((state) => state.toolMode);
  const setToolMode = useUiStore((state) => state.setToolMode);
  const view = useUiStore((state) => state.view);
  const setView = useUiStore((state) => state.setView);
  const showCeiling = useUiStore((state) => state.showCeiling);
  const toggleCeiling = useUiStore((state) => state.toggleCeiling);

  const roomArea = useMemo(() => {
    return Math.abs(signedArea(room.outline));
  }, [room.outline]);

  return (
    <header
      className={`pointer-events-none absolute top-0 left-0 right-0 p-4 flex flex-wrap items-center justify-between gap-3 text-neutral-300 ${className}`}
    >
      {/* Brand & Room Info */}
      <div className="pointer-events-auto flex items-center gap-3 bg-neutral-900/85 backdrop-blur-md px-3.5 py-1.5 rounded-lg border border-neutral-700/60 shadow-lg text-xs">
        <span className="font-bold text-white tracking-wide">AirForce</span>
        <span className="text-neutral-600">|</span>
        <span className="text-neutral-400 font-medium">Room: {room.name}</span>
        <span className="text-neutral-600">|</span>
        <span className="text-neutral-300 font-mono">
          Area: <strong className="text-emerald-400 font-semibold">{roomArea.toFixed(2)} m²</strong>
        </span>
      </div>

      {/* Tool & View Controls */}
      <div className="pointer-events-auto flex items-center gap-2 bg-neutral-900/85 backdrop-blur-md px-2 py-1.5 rounded-lg border border-neutral-700/60 shadow-lg text-xs">
        {/* Tool Mode Buttons */}
        <div className="flex items-center bg-neutral-800/80 p-0.5 rounded border border-neutral-700/50">
          <button
            type="button"
            onClick={() => setToolMode('select')}
            className={`px-2.5 py-1 rounded text-xs font-medium transition-colors ${
              toolMode === 'select'
                ? 'bg-sky-600 text-white shadow-sm'
                : 'text-neutral-400 hover:text-neutral-200'
            }`}
          >
            Select
          </button>
          <button
            type="button"
            onClick={() => setToolMode('draw-floor')}
            className={`px-2.5 py-1 rounded text-xs font-medium transition-colors ${
              toolMode === 'draw-floor'
                ? 'bg-sky-600 text-white shadow-sm'
                : 'text-neutral-400 hover:text-neutral-200'
            }`}
          >
            Draw Floor
          </button>
        </div>

        <span className="text-neutral-700">|</span>

        {/* 2D / 3D Toggle */}
        <button
          type="button"
          onClick={() => setView(view === '3d' ? '2d' : '3d')}
          className="px-2 py-1 rounded bg-neutral-800 hover:bg-neutral-700 text-neutral-300 font-medium border border-neutral-700/60 transition-colors"
        >
          {view === '3d' ? '3D View' : '2D Top-Down'}
        </button>

        {/* Ceiling Toggle */}
        <button
          type="button"
          onClick={toggleCeiling}
          className={`px-2 py-1 rounded font-medium border transition-colors ${
            showCeiling
              ? 'bg-neutral-700 border-neutral-500 text-white'
              : 'bg-neutral-800 border-neutral-700/60 text-neutral-400 hover:text-neutral-200'
          }`}
        >
          Ceiling: {showCeiling ? 'On' : 'Off'}
        </button>

        <span className="text-neutral-700">|</span>

        {/* Snap Toggle */}
        <button
          type="button"
          onClick={toggleSnap}
          className="px-2 py-1 rounded bg-neutral-800 hover:bg-neutral-700 text-neutral-300 font-medium border border-neutral-700/60 transition-colors"
        >
          Snap:{' '}
          <span className="font-mono text-emerald-400">{snapEnabled ? `${gridStep}m` : 'Off'}</span>
        </button>
      </div>
    </header>
  );
};

export default HeaderOverlay;
