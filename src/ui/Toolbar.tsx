import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useStore } from 'zustand';
import { useSceneStore, useUiStore } from '../store';
import { createStudioSample, createBedroomSample, createLivingRoomSample } from '../core/samples';
import { createSampleRoom } from '../core/sampleRoom';
import { parseRoom, type ParseIssue } from '../core/parser';
import { captureCanvasScreenshot } from '../builder/screenshot';
import { ImportIssuesModal } from './ImportIssuesModal';

export interface ToolbarProps {
  className?: string;
}

export const Toolbar: React.FC<ToolbarProps> = ({ className = '' }) => {
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Modal state for import issues
  const [importModal, setImportModal] = useState<{
    isOpen: boolean;
    issues: ParseIssue[];
    hasErrors: boolean;
  }>({
    isOpen: false,
    issues: [],
    hasErrors: false,
  });

  // Store state
  const room = useSceneStore((state) => state.room);
  const resetRoom = useSceneStore((state) => state.resetRoom);
  const loadRoom = useSceneStore((state) => state.loadRoom);
  const exportRoom = useSceneStore((state) => state.exportRoom);

  // UI state
  const toolMode = useUiStore((state) => state.toolMode);
  const setToolMode = useUiStore((state) => state.setToolMode);
  const transformMode = useUiStore((state) => state.transformMode);
  const setTransformMode = useUiStore((state) => state.setTransformMode);
  const view = useUiStore((state) => state.view);
  const setView = useUiStore((state) => state.setView);
  const snapEnabled = useUiStore((state) => state.snapEnabled);
  const toggleSnap = useUiStore((state) => state.toggleSnap);
  const gridStep = useUiStore((state) => state.gridStep);
  const setGridStep = useUiStore((state) => state.setGridStep);
  const showDimensions = useUiStore((state) => state.showDimensions);
  const toggleDimensions = useUiStore((state) => state.toggleDimensions);
  const showCeiling = useUiStore((state) => state.showCeiling);
  const toggleCeiling = useUiStore((state) => state.toggleCeiling);
  const showVoxelDebug = useUiStore((state) => state.showVoxelDebug);
  const toggleVoxelDebug = useUiStore((state) => state.toggleVoxelDebug);

  // Zundo temporal undo/redo reactive bindings via useStore
  const pastStates = useStore(useSceneStore.temporal, (state) => state.pastStates);
  const futureStates = useStore(useSceneStore.temporal, (state) => state.futureStates);
  const canUndo = pastStates.length > 0;
  const canRedo = futureStates.length > 0;

  const handleUndo = useCallback(() => {
    useSceneStore.temporal.getState().undo();
  }, []);

  const handleRedo = useCallback(() => {
    useSceneStore.temporal.getState().redo();
  }, []);

  // Ventilation Summary calculations
  const ventilationStats = useMemo(() => {
    let inletCount = 0;
    let outletCount = 0;
    let totalOpenArea = 0;

    for (const op of room.openings) {
      if (op.role === 'inlet') {
        inletCount++;
        totalOpenArea += op.width * op.height * op.openFraction;
      } else if (op.role === 'outlet') {
        outletCount++;
        totalOpenArea += op.width * op.height * op.openFraction;
      }
    }

    const hasCrossVentilation = inletCount > 0 && outletCount > 0;

    return {
      inletCount,
      outletCount,
      totalOpenArea: Number(totalOpenArea.toFixed(2)),
      hasCrossVentilation,
    };
  }, [room.openings]);

  // Export JSON handler with validation
  const handleExportJson = useCallback(() => {
    try {
      const validation = parseRoom(room);
      if (validation.issues.some((i) => i.level === 'error')) {
        const confirmed = confirm(
          'Warning: The current room contains geometry/schema errors. Do you still wish to export room.json?'
        );
        if (!confirmed) return;
      }

      const json = exportRoom();
      const blob = new Blob([json], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'room.json';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error('Failed to export room JSON:', err);
    }
  }, [exportRoom, room]);

  // Unified JSON import processing logic (used by file picker and canvas drop)
  const processImportContent = useCallback(
    (content: string) => {
      try {
        const parsed = JSON.parse(content);
        const result = parseRoom(parsed);
        const hasErrors = result.issues.some((i) => i.level === 'error');

        if (hasErrors) {
          // Block loading, show errors in modal
          setImportModal({
            isOpen: true,
            issues: result.issues,
            hasErrors: true,
          });
          return;
        }

        // Only load when no errors exist
        if (result.room) {
          loadRoom(result.room);
          if (result.issues.length > 0) {
            // Show warnings notice
            setImportModal({
              isOpen: true,
              issues: result.issues,
              hasErrors: false,
            });
          }
        }
      } catch (err) {
        setImportModal({
          isOpen: true,
          issues: [
            {
              level: 'error',
              message: `Invalid JSON syntax: ${err instanceof Error ? err.message : String(err)}`,
            },
          ],
          hasErrors: true,
        });
      }
    },
    [loadRoom]
  );

  // Listen to drag-and-drop JSON event from Canvas
  useEffect(() => {
    const handleDropJson = (e: Event) => {
      const custom = e as CustomEvent<string>;
      if (custom.detail) {
        processImportContent(custom.detail);
      }
    };
    window.addEventListener('airforce:import-json', handleDropJson);
    return () => {
      window.removeEventListener('airforce:import-json', handleDropJson);
    };
  }, [processImportContent]);

  // Import JSON handler
  const handleImportClick = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  const handleFileChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;

      const reader = new FileReader();
      reader.onload = (event) => {
        const content = event.target?.result as string;
        if (content) {
          processImportContent(content);
        }
      };
      reader.readAsText(file);
      e.target.value = '';
    },
    [processImportContent]
  );

  // PNG Screenshot handler
  const handleScreenshot = useCallback(() => {
    captureCanvasScreenshot(room.name);
  }, [room.name]);

  // New room & sample room handlers
  const handleNewRoom = useCallback(() => {
    if (confirm('Create a new room? Any unsaved edits will be reset.')) {
      resetRoom();
    }
  }, [resetRoom]);

  const handleLoadSampleRoom = useCallback(() => {
    const sample = createSampleRoom();
    loadRoom(sample);
  }, [loadRoom]);

  return (
    <header
      data-testid="toolbar-header"
      className={`fixed top-0 left-0 right-0 z-30 h-13 bg-neutral-900/90 backdrop-blur-md border-b border-neutral-800 px-3.5 flex items-center justify-between gap-3 text-neutral-300 text-xs shadow-lg select-none ${className}`}
    >
      {/* Hidden File Input for JSON import */}
      <input
        ref={fileInputRef}
        type="file"
        accept=".json,application/json"
        className="hidden"
        onChange={handleFileChange}
      />

      {/* Left: Brand & Primary Tool Switcher */}
      <div className="flex items-center gap-2.5 shrink-0">
        <div className="flex items-center gap-1.5 font-bold text-white tracking-wide text-sm pr-1">
          <span className="text-sky-400">💨</span>
          <span>AirForce</span>
        </div>

        {/* Tool Mode Buttons (Select, Draw Floor, Place) */}
        <div className="flex items-center bg-neutral-800/80 p-0.5 rounded-lg border border-neutral-700/60 shadow-inner">
          <button
            type="button"
            data-testid="tool-select-btn"
            onClick={() => setToolMode('select')}
            className={`px-2.5 py-1 rounded-md text-xs font-medium transition-all ${
              toolMode === 'select'
                ? 'bg-sky-600 text-white shadow-sm font-semibold'
                : 'text-neutral-400 hover:text-neutral-200 hover:bg-neutral-700/50'
            }`}
            title="Select tool (Shortcut: Esc)"
          >
            Select
          </button>
          <button
            type="button"
            data-testid="tool-draw-floor-btn"
            onClick={() => setToolMode('draw-floor')}
            className={`px-2.5 py-1 rounded-md text-xs font-medium transition-all ${
              toolMode === 'draw-floor'
                ? 'bg-sky-600 text-white shadow-sm font-semibold'
                : 'text-neutral-400 hover:text-neutral-200 hover:bg-neutral-700/50'
            }`}
            title="Draw floor perimeter"
          >
            Draw Floor
          </button>
          <button
            type="button"
            data-testid="tool-place-btn"
            onClick={() => setToolMode('place')}
            className={`px-2.5 py-1 rounded-md text-xs font-medium transition-all ${
              toolMode === 'place'
                ? 'bg-sky-600 text-white shadow-sm font-semibold'
                : 'text-neutral-400 hover:text-neutral-200 hover:bg-neutral-700/50'
            }`}
            title="Place catalog asset"
          >
            Place
          </button>
        </div>

        {/* Translate / Rotate Mode Toggle */}
        <button
          type="button"
          data-testid="toggle-transform-mode-btn"
          onClick={() => setTransformMode(transformMode === 'translate' ? 'rotate' : 'translate')}
          className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-neutral-800/80 hover:bg-neutral-700 text-neutral-300 font-medium border border-neutral-700/60 transition-colors shadow-sm"
          title="Toggle Move (G) / Rotate (R) gizmo"
        >
          <span>{transformMode === 'translate' ? '↔ Move' : '↻ Rotate'}</span>
        </button>

        {/* 2D / 3D Toggle */}
        <button
          type="button"
          data-testid="view-toggle-btn"
          onClick={() => setView(view === '3d' ? '2d' : '3d')}
          className={`px-2.5 py-1 rounded-lg font-medium border transition-colors shadow-sm ${
            view === '2d'
              ? 'bg-indigo-600 border-indigo-400 text-white'
              : 'bg-neutral-800/80 hover:bg-neutral-700 border-neutral-700/60 text-neutral-300'
          }`}
          title="Toggle Perspective 3D / Orthographic 2D (Shortcut: Tab or Numpad 5)"
        >
          {view === '3d' ? '3D View' : '2D Top-Down'}
        </button>
      </div>

      {/* Center: Global Ventilation Summary Chip */}
      <div
        data-testid="ventilation-summary-chip"
        className="hidden lg:flex items-center gap-2.5 bg-neutral-950/60 px-3 py-1.5 rounded-lg border border-neutral-800 shadow-inner text-xs shrink-0"
      >
        <span className="text-neutral-400 font-medium">Ventilation:</span>

        {/* Inlets count */}
        <span className="flex items-center gap-1 font-semibold text-sky-400">
          <span className="w-2 h-2 rounded-full bg-sky-400" />
          {ventilationStats.inletCount} Inlet{ventilationStats.inletCount !== 1 ? 's' : ''}
        </span>

        <span className="text-neutral-600">/</span>

        {/* Outlets count */}
        <span className="flex items-center gap-1 font-semibold text-orange-400">
          <span className="w-2 h-2 rounded-full bg-orange-400" />
          {ventilationStats.outletCount} Outlet{ventilationStats.outletCount !== 1 ? 's' : ''}
        </span>

        <span className="text-neutral-700">|</span>

        {/* Total open area in m2 */}
        <span className="text-neutral-300 font-mono">
          Open Area:{' '}
          <strong className="text-emerald-400 font-semibold">
            {ventilationStats.totalOpenArea} m²
          </strong>
        </span>

        {/* Cross-ventilation condition badge */}
        {!ventilationStats.hasCrossVentilation ? (
          <div
            data-testid="cross-ventilation-warning"
            className="flex items-center gap-1.5 px-2 py-0.5 rounded bg-amber-950/80 border border-amber-500/60 text-amber-300 font-medium text-[11px] animate-pulse"
          >
            <span>⚠️</span>
            <span>No cross-ventilation</span>
          </div>
        ) : (
          <div
            data-testid="cross-ventilation-active"
            className="flex items-center gap-1.5 px-2 py-0.5 rounded bg-emerald-950/80 border border-emerald-500/60 text-emerald-300 font-medium text-[11px]"
          >
            <span>✓</span>
            <span>Active</span>
          </div>
        )}
      </div>

      {/* Right: Snapping, Display Toggles, Undo/Redo, File Operations */}
      <div className="flex items-center gap-2 shrink-0">
        {/* Snap Toggle + Grid Step Dropdown */}
        <div className="flex items-center bg-neutral-800/80 rounded-lg border border-neutral-700/60 overflow-hidden shadow-sm">
          <button
            type="button"
            data-testid="snap-toggle-btn"
            onClick={toggleSnap}
            className={`px-2 py-1 font-medium transition-colors ${
              snapEnabled
                ? 'bg-emerald-600/80 text-white font-semibold'
                : 'text-neutral-400 hover:text-neutral-200'
            }`}
            title="Toggle Grid Snapping"
          >
            Snap: {snapEnabled ? 'On' : 'Off'}
          </button>
          <select
            data-testid="grid-step-select"
            value={gridStep}
            onChange={(e) => setGridStep(parseFloat(e.target.value))}
            className="bg-neutral-800 text-neutral-300 text-xs py-1 px-1.5 border-l border-neutral-700/60 focus:outline-none cursor-pointer"
            title="Select Snap Grid Step"
          >
            <option value="0.01">0.01 m (1 cm)</option>
            <option value="0.05">0.05 m (5 cm)</option>
            <option value="0.1">0.10 m (10 cm)</option>
            <option value="0.25">0.25 m (25 cm)</option>
          </select>
        </div>

        {/* Dimension Labels Toggle */}
        <button
          type="button"
          data-testid="toggle-dimensions-btn"
          onClick={toggleDimensions}
          className={`px-2 py-1 rounded-lg font-medium border transition-colors shadow-sm ${
            showDimensions
              ? 'bg-neutral-700 border-neutral-500 text-white'
              : 'bg-neutral-800/80 hover:bg-neutral-700 border-neutral-700/60 text-neutral-400'
          }`}
          title="Toggle Wall Dimension Labels"
        >
          Dims: {showDimensions ? 'On' : 'Off'}
        </button>

        {/* Ceiling Toggle */}
        <button
          type="button"
          data-testid="toggle-ceiling-btn"
          onClick={toggleCeiling}
          className={`px-2 py-1 rounded-lg font-medium border transition-colors shadow-sm ${
            showCeiling
              ? 'bg-neutral-700 border-neutral-500 text-white'
              : 'bg-neutral-800/80 hover:bg-neutral-700 border-neutral-700/60 text-neutral-400'
          }`}
          title="Toggle Room Ceiling"
        >
          Ceiling: {showCeiling ? 'On' : 'Off'}
        </button>

        {/* Voxel Domain Debug Toggle */}
        <button
          type="button"
          data-testid="toggle-voxels-btn"
          onClick={toggleVoxelDebug}
          className={`px-2.5 py-1 rounded-lg font-medium border transition-colors shadow-sm flex items-center gap-1.5 ${
            showVoxelDebug
              ? 'bg-purple-600 border-purple-400 text-white font-semibold shadow-purple-900/30'
              : 'bg-neutral-800/80 hover:bg-neutral-700 border-neutral-700/60 text-neutral-300'
          }`}
          title="Toggle Voxel Domain Debug View"
        >
          <span>🧊</span>
          <span>Voxels: {showVoxelDebug ? 'On' : 'Off'}</span>
        </button>

        {/* Undo / Redo */}
        <div className="flex items-center bg-neutral-800/80 p-0.5 rounded-lg border border-neutral-700/60">
          <button
            type="button"
            data-testid="undo-btn"
            disabled={!canUndo}
            onClick={handleUndo}
            className={`p-1 rounded text-xs transition-colors ${
              canUndo
                ? 'text-neutral-200 hover:text-white hover:bg-neutral-700 cursor-pointer'
                : 'text-neutral-600 cursor-not-allowed'
            }`}
            title="Undo (Ctrl+Z)"
          >
            ↺
          </button>
          <button
            type="button"
            data-testid="redo-btn"
            disabled={!canRedo}
            onClick={handleRedo}
            className={`p-1 rounded text-xs transition-colors ${
              canRedo
                ? 'text-neutral-200 hover:text-white hover:bg-neutral-700 cursor-pointer'
                : 'text-neutral-600 cursor-not-allowed'
            }`}
            title="Redo (Ctrl+Shift+Z)"
          >
            ↻
          </button>
        </div>

        {/* File Actions: Screenshot, Import, Export, New Room, Load Samples */}
        <div className="flex items-center gap-1 pl-1 border-l border-neutral-800">
          <button
            type="button"
            data-testid="screenshot-btn"
            onClick={handleScreenshot}
            className="px-2 py-1 rounded-lg bg-neutral-800/80 hover:bg-neutral-700 text-neutral-300 border border-neutral-700/60 transition-colors"
            title="Export PNG Screenshot of current view"
          >
            📷 Screenshot
          </button>
          <button
            type="button"
            data-testid="import-json-btn"
            onClick={handleImportClick}
            className="px-2 py-1 rounded-lg bg-neutral-800/80 hover:bg-neutral-700 text-neutral-300 border border-neutral-700/60 transition-colors"
            title="Import Room JSON"
          >
            Import
          </button>
          <button
            type="button"
            data-testid="export-json-btn"
            onClick={handleExportJson}
            className="px-2 py-1 rounded-lg bg-neutral-800/80 hover:bg-neutral-700 text-neutral-300 border border-neutral-700/60 transition-colors"
            title="Export Room JSON (validates before download)"
          >
            Export
          </button>
          <button
            type="button"
            data-testid="new-room-btn"
            onClick={handleNewRoom}
            className="px-2 py-1 rounded-lg bg-neutral-800/80 hover:bg-neutral-700 text-neutral-300 border border-neutral-700/60 transition-colors"
            title="Reset to a blank/default room"
          >
            New
          </button>

          {/* Sample Rooms Selector Dropdown */}
          <select
            data-testid="sample-room-select"
            defaultValue=""
            onChange={(e) => {
              const val = e.target.value;
              if (val === 'studio') loadRoom(createStudioSample());
              else if (val === 'bedroom') loadRoom(createBedroomSample());
              else if (val === 'living') loadRoom(createLivingRoomSample());
              else if (val === 'default') handleLoadSampleRoom();
              e.target.value = '';
            }}
            className="px-2 py-1 rounded-lg bg-sky-700/80 hover:bg-sky-600 text-white font-medium border border-sky-500/60 transition-colors shadow-sm text-xs cursor-pointer focus:outline-none"
            title="Load Pre-configured Sample Rooms"
          >
            <option value="" disabled>
              Samples ▾
            </option>
            <option value="studio">Studio (3.5x4m)</option>
            <option value="bedroom">Bedroom (4x3.5m)</option>
            <option value="living">L-Shaped Living Room</option>
            <option value="default">Master Suite</option>
          </select>

          {/* Legacy button for test backwards compatibility */}
          <button
            type="button"
            data-testid="load-sample-room-btn"
            onClick={handleLoadSampleRoom}
            className="hidden"
            aria-hidden="true"
          >
            Sample Room
          </button>
        </div>
      </div>

      {/* Import Issues Modal */}
      <ImportIssuesModal
        isOpen={importModal.isOpen}
        issues={importModal.issues}
        hasErrors={importModal.hasErrors}
        onClose={() => setImportModal((prev) => ({ ...prev, isOpen: false }))}
      />
    </header>
  );
};

export default Toolbar;
