import React, { useState, useRef, useEffect } from 'react';
import * as THREE from 'three';
import {
  Compass,
  Maximize2,
  ZoomIn,
  ZoomOut,
  RotateCw,
  Eye,
  Camera,
  Layers,
  Box,
  Trash2,
  Plus,
  Play,
  Edit2,
  Check,
  Footprints,
} from 'lucide-react';
import { useSceneStore } from '../store/sceneStore';
import { useUiStore } from '../store/uiStore';
import { useCameraStore, type SavedView } from '../store/cameraStore';
import { cameraController } from '../builder/cameraController';
import { sharedOrbitControlsRef } from '../builder/Canvas';
import { Tooltip } from './components/Tooltip';

export const ViewControlsOverlay: React.FC = () => {
  const room = useSceneStore((state) => state.room);
  const selectedObjectId = useSceneStore((state) => state.selectedObjectId);
  const view = useUiStore((state) => state.view);
  const setView = useUiStore((state) => state.setView);

  const projection = useCameraStore((state) => state.projection);
  const isTurntableActive = useCameraStore((state) => state.isTurntableActive);
  const toggleTurntable = useCameraStore((state) => state.toggleTurntable);
  const isWalkthroughActive = useCameraStore((state) => state.isWalkthroughActive);
  const toggleWalkthrough = useCameraStore((state) => state.toggleWalkthrough);
  const savedViews = useCameraStore((state) => state.savedViews);
  const saveView = useCameraStore((state) => state.saveView);
  const deleteSavedView = useCameraStore((state) => state.deleteSavedView);
  const renameSavedView = useCameraStore((state) => state.renameSavedView);

  // Popover menus
  const [isPresetsOpen, setIsPresetsOpen] = useState(false);
  const [isSavedViewsOpen, setIsSavedViewsOpen] = useState(false);
  const [newViewName, setNewViewName] = useState('');
  const [editingViewId, setEditingViewId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState('');

  const presetsRef = useRef<HTMLDivElement>(null);
  const viewsRef = useRef<HTMLDivElement>(null);

  // Close popovers on click outside
  useEffect(() => {
    const handleOutside = (e: MouseEvent) => {
      if (presetsRef.current && !presetsRef.current.contains(e.target as Node)) {
        setIsPresetsOpen(false);
      }
      if (viewsRef.current && !viewsRef.current.contains(e.target as Node)) {
        setIsSavedViewsOpen(false);
      }
    };
    window.addEventListener('pointerdown', handleOutside);
    return () => window.removeEventListener('pointerdown', handleOutside);
  }, []);

  const getControlsAndCamera = () => {
    const controls = sharedOrbitControlsRef.current;
    const camera = controls?.object;
    return { controls, camera };
  };

  // Presets Handlers
  const handlePreset = (
    preset: 'perspective' | 'isometric' | 'top' | 'front' | 'back' | 'right' | 'left'
  ) => {
    const { controls, camera } = getControlsAndCamera();
    if (controls && camera) {
      cameraController.goToPreset(preset, room, camera, controls);
    }
    setIsPresetsOpen(false);
  };

  const handleFitRoom = () => {
    const { controls, camera } = getControlsAndCamera();
    if (controls && camera) {
      cameraController.fitRoom(room, camera, controls);
    }
  };

  const handleFitSelection = () => {
    const { controls, camera } = getControlsAndCamera();
    if (controls && camera) {
      cameraController.fitSelection(selectedObjectId, room, camera, controls);
    }
  };

  const handleToggleProjection = () => {
    const { controls, camera } = getControlsAndCamera();
    if (controls && camera) {
      cameraController.toggleProjectionPreservingFraming(camera, controls);
    }
  };

  const handleZoomIn = () => {
    const { controls, camera } = getControlsAndCamera();
    if (controls && camera) {
      camera.position.lerp(controls.target, 0.25);
      controls.update();
    }
  };

  const handleZoomOut = () => {
    const { controls, camera } = getControlsAndCamera();
    if (controls && camera) {
      const dir = camera.position.clone().sub(controls.target).multiplyScalar(1.25);
      camera.position.copy(controls.target).add(dir);
      controls.update();
    }
  };

  // Saved Views Handlers
  const handleSaveCurrentView = () => {
    const { controls, camera } = getControlsAndCamera();
    if (!controls || !camera) return;

    const name = newViewName.trim() || `View ${savedViews.length + 1}`;
    saveView({
      name,
      position: [camera.position.x, camera.position.y, camera.position.z],
      target: [controls.target.x, controls.target.y, controls.target.z],
      fov: (camera as any).fov || 45,
      projection,
    });
    setNewViewName('');
  };

  const handleRestoreView = (v: SavedView) => {
    const { controls, camera } = getControlsAndCamera();
    if (!controls || !camera) return;

    const targetPos = new THREE.Vector3(...v.position);
    const targetLookAt = new THREE.Vector3(...v.target);

    cameraController.animateTo(camera, controls, targetPos, targetLookAt, {
      duration: 500,
    });
    setIsSavedViewsOpen(false);
  };

  return (
    <>
      {/* Walkthrough Mode HUD Bar when active */}
      {isWalkthroughActive && (
        <div className="fixed top-14 left-1/2 -translate-x-1/2 z-[40] pointer-events-auto">
          <div className="bg-neutral-900/95 dark:bg-[#121826]/95 border border-indigo-500/60 text-white px-4 py-2 rounded-full shadow-2xl backdrop-blur-md flex items-center gap-3 text-xs font-medium animate-in fade-in slide-in-from-top-3 duration-200">
            <Footprints size={15} className="text-indigo-400" />
            <span>Walkthrough Mode (1.6m eye height)</span>
            <span className="text-neutral-400 text-[11px] border-l border-white/10 pl-2">
              <kbd className="bg-white/10 px-1.5 py-0.5 rounded text-[10px] font-mono">WASD</kbd> Move •{' '}
              <kbd className="bg-white/10 px-1.5 py-0.5 rounded text-[10px] font-mono">Drag</kbd> Look
            </span>
            <button
              type="button"
              onClick={() => toggleWalkthrough()}
              className="ml-2 px-2.5 py-0.5 rounded-full bg-indigo-600 hover:bg-indigo-500 text-white text-[11px] font-semibold transition-colors"
            >
              Exit (Esc)
            </button>
          </div>
        </div>
      )}

      {/* Turntable Indicator when active */}
      {isTurntableActive && (
        <div className="fixed top-14 left-1/2 -translate-x-1/2 z-[40] pointer-events-auto">
          <div className="bg-neutral-900/95 dark:bg-[#121826]/95 border border-amber-500/60 text-white px-4 py-2 rounded-full shadow-2xl backdrop-blur-md flex items-center gap-2.5 text-xs font-medium animate-in fade-in slide-in-from-top-3 duration-200">
            <RotateCw size={14} className="text-amber-400 animate-spin" />
            <span>Turntable Presentation Active</span>
            <span className="text-[11px] text-neutral-400">• Drag or click anywhere to stop</span>
          </div>
        </div>
      )}

      {/* Floating View Controls Cluster at Bottom-Right */}
      <div className="fixed bottom-3 right-3 z-[20] pointer-events-auto flex items-center gap-1 bg-neutral-900/85 dark:bg-[#121826]/85 backdrop-blur-md p-1 rounded-[10px] border border-neutral-300/20 dark:border-white/10 shadow-xl text-neutral-300 select-none">
        {/* 1. Camera Presets Dropdown */}
        <div ref={presetsRef} className="relative">
          <Tooltip label="Camera Presets" side="top">
            <button
              type="button"
              onClick={() => setIsPresetsOpen(!isPresetsOpen)}
              className={`h-7 px-2 rounded-[6px] flex items-center gap-1 transition-colors text-xs font-medium ${
                isPresetsOpen
                  ? 'bg-indigo-600 text-white'
                  : 'hover:bg-white/10 hover:text-white text-neutral-300'
              }`}
            >
              <Compass size={14} strokeWidth={1.75} />
              <span>Presets</span>
            </button>
          </Tooltip>

          {isPresetsOpen && (
            <div className="absolute bottom-full right-0 mb-2 w-44 bg-neutral-900/95 dark:bg-[#121826]/95 border border-white/10 rounded-[10px] shadow-2xl backdrop-blur-md py-1.5 flex flex-col z-[60] animate-in fade-in zoom-in-95 duration-100">
              <span className="px-3 py-1 text-[10px] uppercase font-semibold text-neutral-400 tracking-wider">
                Viewing Angles
              </span>
              <button
                type="button"
                onClick={() => handlePreset('perspective')}
                className="px-3 py-1.5 text-left text-xs text-neutral-200 hover:bg-white/10 hover:text-white transition-colors"
              >
                Perspective (3D)
              </button>
              <button
                type="button"
                onClick={() => handlePreset('isometric')}
                className="px-3 py-1.5 text-left text-xs text-neutral-200 hover:bg-white/10 hover:text-white transition-colors"
              >
                Isometric (Corner)
              </button>
              <button
                type="button"
                onClick={() => handlePreset('top')}
                className="px-3 py-1.5 text-left text-xs text-neutral-200 hover:bg-white/10 hover:text-white transition-colors flex items-center justify-between"
              >
                <span>Top (2D Plan)</span>
                <kbd className="text-[10px] text-neutral-500">Num 7</kbd>
              </button>
              <button
                type="button"
                onClick={() => handlePreset('front')}
                className="px-3 py-1.5 text-left text-xs text-neutral-200 hover:bg-white/10 hover:text-white transition-colors flex items-center justify-between"
              >
                <span>Front View</span>
                <kbd className="text-[10px] text-neutral-500">Num 1</kbd>
              </button>
              <button
                type="button"
                onClick={() => handlePreset('right')}
                className="px-3 py-1.5 text-left text-xs text-neutral-200 hover:bg-white/10 hover:text-white transition-colors flex items-center justify-between"
              >
                <span>Right Side</span>
                <kbd className="text-[10px] text-neutral-500">Num 3</kbd>
              </button>
              <button
                type="button"
                onClick={() => handlePreset('back')}
                className="px-3 py-1.5 text-left text-xs text-neutral-200 hover:bg-white/10 hover:text-white transition-colors flex items-center justify-between"
              >
                <span>Back View</span>
                <kbd className="text-[10px] text-neutral-500">Ctrl+1</kbd>
              </button>
              <button
                type="button"
                onClick={() => handlePreset('left')}
                className="px-3 py-1.5 text-left text-xs text-neutral-200 hover:bg-white/10 hover:text-white transition-colors flex items-center justify-between"
              >
                <span>Left Side</span>
                <kbd className="text-[10px] text-neutral-500">Ctrl+3</kbd>
              </button>
            </div>
          )}
        </div>

        <div className="w-px h-3.5 bg-white/10" />

        {/* 2. Fit Room Button */}
        <Tooltip label="Fit Room" shortcut="Home" side="top">
          <button
            type="button"
            onClick={handleFitRoom}
            className="w-7 h-7 rounded-[6px] hover:bg-white/10 hover:text-white flex items-center justify-center transition-colors"
          >
            <Maximize2 size={14} strokeWidth={1.75} />
          </button>
        </Tooltip>

        {/* 3. Fit Selection Button */}
        <Tooltip label="Fit Selection" shortcut="F" side="top">
          <button
            type="button"
            onClick={handleFitSelection}
            disabled={!selectedObjectId}
            className={`w-7 h-7 rounded-[6px] flex items-center justify-center transition-colors ${
              selectedObjectId
                ? 'hover:bg-white/10 hover:text-white text-neutral-300'
                : 'text-neutral-600 cursor-not-allowed'
            }`}
          >
            <Eye size={14} strokeWidth={1.75} />
          </button>
        </Tooltip>

        <div className="w-px h-3.5 bg-white/10" />

        {/* 4. Perspective / Orthographic Toggle */}
        <Tooltip label={`Projection: ${projection}`} shortcut="Num 5" side="top">
          <button
            type="button"
            onClick={handleToggleProjection}
            className={`h-7 px-2 rounded-[6px] flex items-center gap-1 text-xs font-semibold transition-colors ${
              projection === 'orthographic'
                ? 'bg-indigo-600 text-white'
                : 'hover:bg-white/10 text-neutral-300'
            }`}
          >
            <Box size={13} strokeWidth={1.75} />
            <span className="capitalize">{projection === 'perspective' ? 'Persp' : 'Ortho'}</span>
          </button>
        </Tooltip>

        {/* 5. Walkthrough Mode Button */}
        <Tooltip label="Walkthrough First-Person Mode" side="top">
          <button
            type="button"
            onClick={toggleWalkthrough}
            className={`w-7 h-7 rounded-[6px] flex items-center justify-center transition-colors ${
              isWalkthroughActive
                ? 'bg-indigo-600 text-white'
                : 'hover:bg-white/10 hover:text-white text-neutral-300'
            }`}
          >
            <Footprints size={14} strokeWidth={1.75} />
          </button>
        </Tooltip>

        {/* 6. Turntable Presentation Button */}
        <Tooltip label="Turntable Spin Presentation" side="top">
          <button
            type="button"
            onClick={toggleTurntable}
            className={`w-7 h-7 rounded-[6px] flex items-center justify-center transition-colors ${
              isTurntableActive
                ? 'bg-amber-600 text-white'
                : 'hover:bg-white/10 hover:text-white text-neutral-300'
            }`}
          >
            <RotateCw size={14} strokeWidth={1.75} />
          </button>
        </Tooltip>

        <div className="w-px h-3.5 bg-white/10" />

        {/* 7. Saved Views Popover */}
        <div ref={viewsRef} className="relative">
          <Tooltip label="Saved Camera Views" side="top">
            <button
              type="button"
              onClick={() => setIsSavedViewsOpen(!isSavedViewsOpen)}
              className={`h-7 px-2 rounded-[6px] flex items-center gap-1 transition-colors text-xs font-medium ${
                isSavedViewsOpen
                  ? 'bg-indigo-600 text-white'
                  : 'hover:bg-white/10 hover:text-white text-neutral-300'
              }`}
            >
              <Camera size={14} strokeWidth={1.75} />
              <span>Views</span>
            </button>
          </Tooltip>

          {isSavedViewsOpen && (
            <div className="absolute bottom-full right-0 mb-2 w-64 bg-neutral-900/95 dark:bg-[#121826]/95 border border-white/10 rounded-[10px] shadow-2xl backdrop-blur-md p-3 flex flex-col gap-2.5 z-[60] animate-in fade-in zoom-in-95 duration-100">
              <div className="flex items-center justify-between pb-1 border-b border-white/10">
                <span className="text-[10px] uppercase font-semibold text-neutral-400 tracking-wider">
                  Saved Camera Views
                </span>
                <span className="text-[10px] text-neutral-500 font-mono">
                  {savedViews.length} saved
                </span>
              </div>

              {/* Save current view input */}
              <div className="flex gap-1.5">
                <input
                  type="text"
                  placeholder="View name..."
                  value={newViewName}
                  onChange={(e) => setNewViewName(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleSaveCurrentView()}
                  className="flex-1 bg-black/30 dark:bg-white/5 border border-white/10 rounded-[6px] px-2 py-1 text-xs text-white outline-none focus:border-indigo-500"
                />
                <button
                  type="button"
                  onClick={handleSaveCurrentView}
                  className="px-2.5 py-1 bg-indigo-600 hover:bg-indigo-500 text-white rounded-[6px] text-xs font-medium transition-colors flex items-center gap-1"
                >
                  <Plus size={13} />
                  <span>Save</span>
                </button>
              </div>

              {/* Saved Views List */}
              <div className="flex flex-col gap-1 max-h-44 overflow-y-auto">
                {savedViews.length === 0 ? (
                  <div className="py-4 text-center text-[11px] text-neutral-500">
                    No views saved yet. Position your camera and click Save.
                  </div>
                ) : (
                  savedViews.map((v) => (
                    <div
                      key={v.id}
                      onClick={() => editingViewId !== v.id && handleRestoreView(v)}
                      className="group flex items-center justify-between p-1.5 rounded-[6px] bg-black/20 dark:bg-white/5 hover:bg-white/10 border border-white/5 cursor-pointer transition-colors text-xs"
                    >
                      <div className="flex items-center gap-2 truncate flex-1 mr-2">
                        <span className="text-neutral-400 group-hover:text-indigo-400 shrink-0">
                          <Play size={12} fill="currentColor" />
                        </span>
                        {editingViewId === v.id ? (
                          <input
                            type="text"
                            value={editingName}
                            onChange={(e) => setEditingName(e.target.value)}
                            onClick={(e) => e.stopPropagation()}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') {
                                e.stopPropagation();
                                if (editingName.trim()) renameSavedView(v.id, editingName.trim());
                                setEditingViewId(null);
                              } else if (e.key === 'Escape') {
                                setEditingViewId(null);
                              }
                            }}
                            className="bg-black/50 border border-indigo-500 rounded px-1.5 py-0.5 text-xs text-white outline-none w-full"
                            autoFocus
                          />
                        ) : (
                          <span className="font-medium text-white truncate">{v.name}</span>
                        )}
                      </div>
                      <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
                        {editingViewId === v.id ? (
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              if (editingName.trim()) renameSavedView(v.id, editingName.trim());
                              setEditingViewId(null);
                            }}
                            className="p-1 text-emerald-400 hover:text-emerald-300 rounded"
                            title="Save name"
                          >
                            <Check size={12} />
                          </button>
                        ) : (
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              setEditingViewId(v.id);
                              setEditingName(v.name);
                            }}
                            className="p-1 text-neutral-400 hover:text-indigo-400 rounded"
                            title="Rename view"
                          >
                            <Edit2 size={12} />
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            deleteSavedView(v.id);
                          }}
                          className="p-1 text-neutral-400 hover:text-red-400 rounded"
                          title="Delete view"
                        >
                          <Trash2 size={12} />
                        </button>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          )}
        </div>

        <div className="w-px h-3.5 bg-white/10" />

        {/* 8. Zoom In / Out Buttons */}
        <Tooltip label="Zoom In" side="top">
          <button
            type="button"
            onClick={handleZoomIn}
            className="w-7 h-7 rounded-[6px] hover:bg-white/10 hover:text-white flex items-center justify-center transition-colors"
          >
            <ZoomIn size={14} strokeWidth={1.75} />
          </button>
        </Tooltip>

        <Tooltip label="Zoom Out" side="top">
          <button
            type="button"
            onClick={handleZoomOut}
            className="w-7 h-7 rounded-[6px] hover:bg-white/10 hover:text-white flex items-center justify-center transition-colors"
          >
            <ZoomOut size={14} strokeWidth={1.75} />
          </button>
        </Tooltip>

        <div className="w-px h-3.5 bg-white/10" />

        {/* 9. 2D / 3D Toggle */}
        <Tooltip label="Toggle 2D / 3D View" shortcut="Tab" side="top">
          <button
            type="button"
            onClick={() => setView(view === '3d' ? '2d' : '3d')}
            className={`h-7 px-2 rounded-[6px] text-xs font-semibold flex items-center gap-1 transition-colors ${
              view === '2d' ? 'bg-indigo-600 text-white' : 'hover:bg-white/10 text-neutral-300'
            }`}
          >
            <Layers size={13} strokeWidth={1.75} />
            <span>{view === '3d' ? '3D' : '2D'}</span>
          </button>
        </Tooltip>
      </div>
    </>
  );
};

export default ViewControlsOverlay;
