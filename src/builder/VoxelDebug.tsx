import React, { useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import {
  CellType,
  CELL_TYPE_COLORS,
  computeVoxelStats,
  voxelizeAsync,
  type VoxelGrid,
} from '../core/voxelizer';
import { useSceneStore } from '../store/sceneStore';
import { useUiStore } from '../store/uiStore';

/**
 * Renders non-fluid voxel cells as crisp InstancedMesh cubes.
 * Updates live (debounced) when the room geometry or objects change.
 */
export const VoxelDebugMesh: React.FC = () => {
  const room = useSceneStore((state) => state.room);
  const showVoxelDebug = useUiStore((state) => state.showVoxelDebug);
  const voxelSliceY = useUiStore((state) => state.voxelSliceY);
  const voxelOpacity = useUiStore((state) => state.voxelOpacity);
  const showSolidVoxels = useUiStore((state) => state.showSolidVoxels);
  const setVoxelStats = useUiStore((state) => state.setVoxelStats);

  const [grid, setGrid] = useState<VoxelGrid | null>(null);
  const meshRef = useRef<THREE.InstancedMesh>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Debounced voxelization on room changes
  useEffect(() => {
    if (!showVoxelDebug) return;

    if (timerRef.current) {
      clearTimeout(timerRef.current);
    }

    timerRef.current = setTimeout(async () => {
      try {
        const { grid: newGrid, timeMs } = await voxelizeAsync(room, 0.1);
        setGrid(newGrid);
        setVoxelStats(computeVoxelStats(newGrid, timeMs));
      } catch (err) {
        console.error('Voxelization error:', err);
      }
    }, 120);

    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
      }
    };
  }, [room, showVoxelDebug, setVoxelStats]);

  // Update instanced mesh transforms and colors
  useEffect(() => {
    if (!showVoxelDebug || !grid || !meshRef.current) return;

    const mesh = meshRef.current;
    const { nx, ny, nz, dx, origin, cells, idx } = grid;

    const tempMatrix = new THREE.Matrix4();
    const tempColor = new THREE.Color();
    let instanceIndex = 0;

    const startJ = voxelSliceY !== null ? Math.max(0, Math.min(ny - 1, voxelSliceY)) : 0;
    const endJ = voxelSliceY !== null ? startJ : ny - 1;

    for (let k = 0; k < nz; k++) {
      const cz = origin[2] + (k + 0.5) * dx;
      for (let j = startJ; j <= endJ; j++) {
        const cy = origin[1] + (j + 0.5) * dx;
        for (let i = 0; i < nx; i++) {
          const cell = cells[idx(i, j, k)];
          if (cell === CellType.FLUID) continue;
          if (cell === CellType.SOLID && !showSolidVoxels) continue;

          if (instanceIndex >= mesh.count) {
            break;
          }

          const cx = origin[0] + (i + 0.5) * dx;
          tempMatrix.setPosition(cx, cy, cz);
          mesh.setMatrixAt(instanceIndex, tempMatrix);

          const hex = CELL_TYPE_COLORS[cell as keyof typeof CELL_TYPE_COLORS] || '#71717a';
          tempColor.set(hex);
          mesh.setColorAt(instanceIndex, tempColor);

          instanceIndex++;
        }
      }
    }

    // Zero out remaining unused instances
    const emptyMatrix = new THREE.Matrix4().makeScale(0, 0, 0);
    for (let i = instanceIndex; i < mesh.count; i++) {
      mesh.setMatrixAt(i, emptyMatrix);
    }

    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) {
      mesh.instanceColor.needsUpdate = true;
    }
  }, [grid, voxelSliceY, showVoxelDebug, showSolidVoxels]);

  // Material with configurable opacity
  const material = useMemo(() => {
    return new THREE.MeshStandardMaterial({
      roughness: 0.5,
      metalness: 0.1,
      transparent: true,
      opacity: voxelOpacity,
    });
  }, [voxelOpacity]);

  useEffect(() => {
    return () => {
      material.dispose();
    };
  }, [material]);

  if (!showVoxelDebug || !grid) return null;

  // Max non-fluid instances buffer (up to 45,000)
  const maxInstances = Math.min(grid.cells.length, 45000);
  const cubeSize = grid.dx * 0.96;

  return (
    <instancedMesh
      ref={meshRef}
      args={[undefined, undefined, maxInstances]}
      material={material}
      castShadow={false}
      receiveShadow={false}
    >
      <boxGeometry args={[cubeSize, cubeSize, cubeSize]} />
    </instancedMesh>
  );
};

/**
 * Floating interactive UI overlay for Voxel debugging controls:
 * Y-slice selection slider, opacity slider, solid walls toggle, and color legend.
 */
export const VoxelDebugControls: React.FC = () => {
  const showVoxelDebug = useUiStore((state) => state.showVoxelDebug);
  const toggleVoxelDebug = useUiStore((state) => state.toggleVoxelDebug);
  const voxelSliceY = useUiStore((state) => state.voxelSliceY);
  const setVoxelSliceY = useUiStore((state) => state.setVoxelSliceY);
  const voxelOpacity = useUiStore((state) => state.voxelOpacity);
  const setVoxelOpacity = useUiStore((state) => state.setVoxelOpacity);
  const showSolidVoxels = useUiStore((state) => state.showSolidVoxels);
  const setShowSolidVoxels = useUiStore((state) => state.setShowSolidVoxels);
  const voxelStats = useUiStore((state) => state.voxelStats);
  const room = useSceneStore((state) => state.room);

  if (!showVoxelDebug) return null;

  const maxLayers = Math.max(1, Math.ceil(room.wallHeight / 0.1));
  const currentHeightMeters = voxelSliceY !== null ? ((voxelSliceY + 0.5) * 0.1).toFixed(2) : null;

  return (
    <div
      data-testid="voxel-debug-panel"
      className="fixed top-16 right-84 z-30 w-72 bg-neutral-900/90 backdrop-blur-md border border-neutral-700/80 rounded-xl shadow-2xl p-3.5 text-xs text-neutral-200 flex flex-col gap-3 font-sans select-none"
    >
      {/* Panel Header */}
      <div className="flex items-center justify-between border-b border-neutral-800 pb-2">
        <div className="flex items-center gap-1.5 font-semibold text-white">
          <span className="text-sm">🧊</span>
          <span>Voxel Domain (dx = 0.1m)</span>
        </div>
        <button
          type="button"
          onClick={toggleVoxelDebug}
          className="text-neutral-400 hover:text-white px-1.5 py-0.5 rounded hover:bg-neutral-800 text-xs transition-colors"
          title="Close Voxel Debug"
        >
          ✕
        </button>
      </div>

      {/* Y-Slice Control */}
      <div className="flex flex-col gap-1.5">
        <div className="flex items-center justify-between">
          <span className="text-neutral-300 font-medium">Y-Slice Layer:</span>
          <div className="flex items-center gap-2">
            {voxelSliceY !== null && (
              <span className="font-mono text-sky-400 text-[11px]">
                y = {currentHeightMeters}m (L{voxelSliceY})
              </span>
            )}
            <button
              type="button"
              data-testid="voxel-slice-toggle-btn"
              onClick={() =>
                setVoxelSliceY(voxelSliceY === null ? Math.floor(maxLayers / 2) : null)
              }
              className={`px-2 py-0.5 rounded text-[11px] font-semibold border transition-all ${
                voxelSliceY === null
                  ? 'bg-neutral-800 border-neutral-600 text-neutral-300 hover:bg-neutral-700'
                  : 'bg-sky-950/80 border-sky-600 text-sky-300'
              }`}
            >
              {voxelSliceY === null ? 'All Slices' : 'Slice Mode'}
            </button>
          </div>
        </div>

        {voxelSliceY !== null && (
          <div className="flex items-center gap-2 pt-1">
            <span className="font-mono text-[10px] text-neutral-500">0</span>
            <input
              type="range"
              data-testid="voxel-slice-slider"
              min={0}
              max={maxLayers - 1}
              step={1}
              value={voxelSliceY}
              onChange={(e) => setVoxelSliceY(parseInt(e.target.value, 10))}
              className="w-full accent-sky-500 cursor-pointer h-1.5 bg-neutral-800 rounded-lg"
            />
            <span className="font-mono text-[10px] text-neutral-500">{maxLayers - 1}</span>
          </div>
        )}
      </div>

      {/* Opacity Slider */}
      <div className="flex flex-col gap-1">
        <div className="flex items-center justify-between">
          <span className="text-neutral-300 font-medium">Opacity:</span>
          <span className="font-mono text-neutral-400">{Math.round(voxelOpacity * 100)}%</span>
        </div>
        <input
          type="range"
          data-testid="voxel-opacity-slider"
          min={0.1}
          max={1.0}
          step={0.05}
          value={voxelOpacity}
          onChange={(e) => setVoxelOpacity(parseFloat(e.target.value))}
          className="w-full accent-purple-500 cursor-pointer h-1.5 bg-neutral-800 rounded-lg"
        />
      </div>

      {/* Show Solid Wall Voxels Toggle */}
      <label className="flex items-center justify-between cursor-pointer py-0.5">
        <span className="text-neutral-300">Show Solid Walls:</span>
        <input
          type="checkbox"
          data-testid="voxel-solid-toggle"
          checked={showSolidVoxels}
          onChange={(e) => setShowSolidVoxels(e.target.checked)}
          className="rounded border-neutral-700 text-sky-600 focus:ring-sky-500 bg-neutral-800 h-4 w-4 cursor-pointer"
        />
      </label>

      {/* Legend */}
      <div className="pt-2 border-t border-neutral-800/80 flex flex-col gap-1.5">
        <span className="text-[11px] font-semibold text-neutral-400">Cell Color Legend:</span>
        <div className="grid grid-cols-2 gap-1.5 text-[11px]">
          <div className="flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-sm bg-[#71717a] border border-neutral-500 inline-block" />
            <span className="text-neutral-300">Solid Wall/Object</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-sm bg-[#38bdf8] border border-sky-400 inline-block" />
            <span className="text-neutral-300">Inlet (Window)</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-sm bg-[#f97316] border border-orange-400 inline-block" />
            <span className="text-neutral-300">Outlet (Door)</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-sm bg-[#22c55e] border border-emerald-400 inline-block" />
            <span className="text-neutral-300">Source (Fan/IAQ)</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-sm bg-[#eab308] border border-yellow-400 inline-block" />
            <span className="text-neutral-300">Porous Screen</span>
          </div>
        </div>
      </div>

      {/* Stats Summary */}
      {voxelStats && (
        <div className="pt-2 border-t border-neutral-800/80 flex flex-col gap-0.5 font-mono text-[10px] text-neutral-400">
          <div className="flex justify-between">
            <span>Total Domain:</span>
            <span className="text-neutral-200">{voxelStats.cellCount.toLocaleString()} cells</span>
          </div>
          <div className="flex justify-between">
            <span>Fluid Volume:</span>
            <span className="text-neutral-200">{voxelStats.fluidCount.toLocaleString()} cells</span>
          </div>
          <div className="flex justify-between">
            <span>Grid Memory:</span>
            <span className="text-neutral-200">
              {(voxelStats.memoryBytes / 1024).toFixed(1)} KB
            </span>
          </div>
          <div className="flex justify-between">
            <span>Voxelize Time:</span>
            <span className="text-neutral-200">{voxelStats.computeTimeMs} ms</span>
          </div>
        </div>
      )}
    </div>
  );
};

export default VoxelDebugMesh;
