import React, { useEffect, useMemo, useState, useRef } from 'react';
import * as THREE from 'three';
import {
  MapPin,
  Magnet,
  AlertTriangle,
  CheckCircle2,
  ZoomIn,
  ZoomOut,
  Maximize2,
  Layers,
  Compass,
  X,
  Undo2,
} from 'lucide-react';
import { parseRoom, polygonBounds } from '../core/parser';
import { useSceneStore, useUiStore } from '../store';
import { usePlacementIssuesStore } from '../store/placementIssuesStore';
import type { PlacementIssue } from '../core/placementValidator';
import { sharedOrbitControlsRef } from '../builder/Canvas';
import { Tooltip } from './components/Tooltip';

export interface HudOverlayProps {
  className?: string;
}

export const HudOverlay: React.FC<HudOverlayProps> = ({ className = '' }) => {
  const room = useSceneStore((state) => state.room);
  const selectedObjectId = useSceneStore((state) => state.selectedObjectId);
  const selectedObjectIds = useSceneStore((state) => state.selectedObjectIds);
  const selectedOpeningId = useSceneStore((state) => state.selectedOpeningId);
  const selectedOpeningIds = useSceneStore((state) => state.selectedOpeningIds);
  const selectObject = useSceneStore((state) => state.selectObject);
  const selectOpening = useSceneStore((state) => state.selectOpening);

  const toolMode = useUiStore((state) => state.toolMode);
  const snapEnabled = useUiStore((state) => state.snapEnabled);
  const toggleSnap = useUiStore((state) => state.toggleSnap);
  const gridStep = useUiStore((state) => state.gridStep);
  const cursorCoords = useUiStore((state) => state.cursorCoords);
  const view = useUiStore((state) => state.view);
  const setView = useUiStore((state) => state.setView);
  const toastMessage = useUiStore((state) => state.toastMessage);
  const setToastMessage = useUiStore((state) => state.setToastMessage);

  // Issues drawers
  const [isIssuesOpen, setIsIssuesOpen] = useState(false);
  const [isPlacementDrawerOpen, setIsPlacementDrawerOpen] = useState(false);

  // 5-second Tool Hint Inactivity timer
  const [isHintVisible, setIsHintVisible] = useState(true);
  const inactivityTimerRef = useRef<NodeJS.Timeout | null>(null);

  const resetInactivityTimer = () => {
    setIsHintVisible(true);
    if (inactivityTimerRef.current) {
      clearTimeout(inactivityTimerRef.current);
    }
    inactivityTimerRef.current = setTimeout(() => {
      setIsHintVisible(false);
    }, 5000);
  };

  useEffect(() => {
    resetInactivityTimer();
    const handleActivity = () => resetInactivityTimer();

    window.addEventListener('pointermove', handleActivity);
    window.addEventListener('keydown', handleActivity);
    window.addEventListener('wheel', handleActivity);

    return () => {
      if (inactivityTimerRef.current) clearTimeout(inactivityTimerRef.current);
      window.removeEventListener('pointermove', handleActivity);
      window.removeEventListener('keydown', handleActivity);
      window.removeEventListener('wheel', handleActivity);
    };
  }, [toolMode]);

  // Toast auto-dismiss after 4s
  useEffect(() => {
    if (!toastMessage) return;
    const timer = setTimeout(() => {
      setToastMessage(null);
    }, 4000);
    return () => clearTimeout(timer);
  }, [toastMessage, setToastMessage]);

  // Placement Issues
  const placementIssuesMap = usePlacementIssuesStore((state) => state.issues);
  const dismissedObjectIds = usePlacementIssuesStore((state) => state.dismissedObjectIds);

  const activePlacementIssues = useMemo(() => {
    const list: Array<{ issue: PlacementIssue; objectName: string }> = [];
    for (const [objId, issuesList] of Object.entries(placementIssuesMap)) {
      if (dismissedObjectIds.includes(objId)) continue;
      const obj = room.objects.find((o) => o.id === objId);
      const objectName = obj?.name || 'Object';
      for (const issue of issuesList) {
        list.push({ issue, objectName });
      }
    }
    return list;
  }, [placementIssuesMap, dismissedObjectIds, room.objects]);

  // Validation Issues
  const parseResult = useMemo(() => parseRoom(room), [room]);
  const issues = parseResult.issues;
  const errorCount = useMemo(() => issues.filter((i) => i.level === 'error').length, [issues]);
  const totalIssuesCount = activePlacementIssues.length + issues.length;

  // Camera Controls
  const handleZoomIn = () => {
    if (sharedOrbitControlsRef.current) {
      const cam = sharedOrbitControlsRef.current.object;
      const target = sharedOrbitControlsRef.current.target;
      cam.position.lerp(target, 0.25);
      sharedOrbitControlsRef.current.update();
    }
  };

  const handleZoomOut = () => {
    if (sharedOrbitControlsRef.current) {
      const cam = sharedOrbitControlsRef.current.object;
      const target = sharedOrbitControlsRef.current.target;
      const dir = cam.position.clone().sub(target).multiplyScalar(1.25);
      cam.position.copy(target).add(dir);
      sharedOrbitControlsRef.current.update();
    }
  };

  const handleFrameRoom = () => {
    if (sharedOrbitControlsRef.current) {
      const cam = sharedOrbitControlsRef.current.object;
      const bounds = polygonBounds(room.outline);
      const center = new THREE.Vector3(
        (bounds.min[0] + bounds.max[0]) / 2,
        0,
        (bounds.min[1] + bounds.max[1]) / 2
      );
      const maxDim = Math.max(bounds.width, bounds.depth, 4.0);
      cam.position.set(center.x, maxDim * 1.8, center.z + maxDim * 1.4);
      sharedOrbitControlsRef.current.target.copy(center);
      sharedOrbitControlsRef.current.update();
    }
  };

  // Selection count label for tests
  const selectionLabel = useMemo(() => {
    const objCount = selectedObjectIds.length > 0 ? selectedObjectIds.length : selectedObjectId ? 1 : 0;
    const opCount = selectedOpeningIds.length > 0 ? selectedOpeningIds.length : selectedOpeningId ? 1 : 0;
    if (objCount > 0 && opCount > 0) return `${objCount} obj, ${opCount} op`;
    if (objCount > 0) return `${objCount} object${objCount > 1 ? 's' : ''}`;
    if (opCount > 0) return `${opCount} opening${opCount > 1 ? 's' : ''}`;
    return 'None';
  }, [selectedObjectIds, selectedObjectId, selectedOpeningIds, selectedOpeningId]);

  // Contextual Tool Hint text
  const toolHintText = useMemo(() => {
    switch (toolMode) {
      case 'draw-floor':
        return (
          <>
            <span className="text-white font-medium">Click</span> to place corner •{' '}
            <span className="text-white font-medium">Close</span> loop to finish •{' '}
            <kbd className="bg-white/10 px-1 py-0.2 rounded text-[10px]">Shift</kbd> 90° snap
          </>
        );
      case 'place':
        return (
          <>
            <span className="text-white font-medium">Click / Drag</span> to place •{' '}
            <kbd className="bg-white/10 px-1 py-0.2 rounded text-[10px]">R</kbd> rotate •{' '}
            <kbd className="bg-white/10 px-1 py-0.2 rounded text-[10px]">Esc</kbd> cancel
          </>
        );
      case 'opening':
        return (
          <>
            <span className="text-white font-medium">Slide</span> along wall •{' '}
            <span className="text-white font-medium">Handles</span> resize •{' '}
            <kbd className="bg-white/10 px-1 py-0.2 rounded text-[10px]">Esc</kbd> done
          </>
        );
      case 'select':
      default:
        return (
          <>
            <span className="text-white font-medium">Drag</span> move •{' '}
            <kbd className="bg-white/10 px-1 py-0.2 rounded text-[10px]">R</kbd> rotate •{' '}
            <kbd className="bg-white/10 px-1 py-0.2 rounded text-[10px]">Alt</kbd> lift •{' '}
            <kbd className="bg-white/10 px-1 py-0.2 rounded text-[10px]">F</kbd> focus
          </>
        );
    }
  }, [toolMode]);

  return (
    <div data-testid="hud-overlay" className={`select-none pointer-events-none ${className}`}>
      {/* 1. BOTTOM-LEFT: Tiny Status Cluster */}
      <div className="fixed bottom-3 left-3 z-[20] pointer-events-auto flex items-center gap-2">
        <div
          data-testid="hud-status-card"
          className="bg-neutral-900/85 dark:bg-[#121826]/85 backdrop-blur-md px-2.5 py-1.5 rounded-[8px] border border-neutral-300/20 dark:border-white/10 shadow-lg flex items-center gap-2.5 text-xs text-neutral-300"
        >
          {/* Cursor Coords */}
          <div data-testid="hud-cursor-coords" className="flex items-center gap-1 font-mono text-[11px]">
            <MapPin size={13} className="text-indigo-400" />
            <span>
              {cursorCoords ? (
                <>
                  <strong className="text-white">{cursorCoords[0].toFixed(2)}</strong>m,{' '}
                  <strong className="text-white">{cursorCoords[1].toFixed(2)}</strong>m
                </>
              ) : (
                <span className="text-neutral-500">-- , --</span>
              )}
            </span>
          </div>

          <div className="w-px h-3.5 bg-white/10" />

          {/* Snap on/off Toggle */}
          <Tooltip label="Toggle grid snap">
            <button
              type="button"
              onClick={toggleSnap}
              className="flex items-center gap-1 text-[11px] font-mono hover:text-white transition-colors cursor-pointer"
            >
              <Magnet
                size={13}
                className={snapEnabled ? 'text-emerald-400' : 'text-neutral-500'}
              />
              <span className={snapEnabled ? 'text-emerald-400' : 'text-neutral-500'}>
                {snapEnabled ? `${gridStep}m` : 'Off'}
              </span>
            </button>
          </Tooltip>

          {/* Issue Count Badge */}
          {totalIssuesCount > 0 ? (
            <>
              <div className="w-px h-3.5 bg-white/10" />
              <button
                type="button"
                data-testid="hud-validation-pill"
                onClick={() => {
                  if (activePlacementIssues.length > 0) {
                    setIsPlacementDrawerOpen(!isPlacementDrawerOpen);
                  } else {
                    setIsIssuesOpen(!isIssuesOpen);
                  }
                }}
                className={`flex items-center gap-1 px-1.5 py-0.5 rounded-[4px] text-[10px] font-semibold transition-colors ${
                  errorCount > 0 || activePlacementIssues.length > 0
                    ? 'bg-red-500/20 text-red-300 hover:bg-red-500/30'
                    : 'bg-amber-500/20 text-amber-300 hover:bg-amber-500/30'
                }`}
                title="Click to view issues"
              >
                <AlertTriangle size={12} className="shrink-0" />
                <span>{totalIssuesCount} Issue{totalIssuesCount !== 1 ? 's' : ''}</span>
              </button>
            </>
          ) : (
            <>
              <div className="w-px h-3.5 bg-white/10" />
              <div className="flex items-center gap-1 text-[11px] text-emerald-400 font-medium">
                <CheckCircle2 size={13} />
                <span>Valid</span>
              </div>
            </>
          )}
        </div>

        {/* Hidden Elements for Automated Test Assertions */}
        <div className="hidden" aria-hidden="true">
          <div data-testid="hud-current-tool">{toolMode}</div>
          <div data-testid="hud-snap-status">{snapEnabled ? `${gridStep}m` : 'Off'}</div>
          <div data-testid="hud-selection-count">{selectionLabel}</div>
        </div>
      </div>

      {/* 2. BOTTOM-CENTRE: Small Floating Tool-Hint Pill (Auto-hides after 5s) */}
      <div
        className={`fixed bottom-3 left-1/2 -translate-x-1/2 z-[20] pointer-events-auto transition-opacity duration-300 ${
          isHintVisible ? 'opacity-100' : 'opacity-0 pointer-events-none'
        }`}
      >
        <div className="bg-neutral-900/80 dark:bg-[#0c101c]/80 backdrop-blur-md border border-white/10 rounded-full px-4 py-1.5 text-[11px] text-neutral-300 font-sans tracking-wide shadow-lg flex items-center gap-2 select-none">
          {toolHintText}
        </div>
      </div>

      {/* 3. BOTTOM-RIGHT: View Controls & Zoom Cluster */}
      <div className="fixed bottom-3 right-3 z-[20] pointer-events-auto flex items-center gap-1 bg-neutral-900/85 dark:bg-[#121826]/85 backdrop-blur-md p-1 rounded-[8px] border border-neutral-300/20 dark:border-white/10 shadow-lg text-neutral-300">
        <Tooltip label="Zoom in" side="top">
          <button
            type="button"
            onClick={handleZoomIn}
            className="w-7 h-7 rounded-[4px] hover:bg-white/10 hover:text-white flex items-center justify-center transition-colors"
          >
            <ZoomIn size={15} strokeWidth={1.75} />
          </button>
        </Tooltip>

        <Tooltip label="Zoom out" side="top">
          <button
            type="button"
            onClick={handleZoomOut}
            className="w-7 h-7 rounded-[4px] hover:bg-white/10 hover:text-white flex items-center justify-center transition-colors"
          >
            <ZoomOut size={15} strokeWidth={1.75} />
          </button>
        </Tooltip>

        <div className="w-px h-3.5 bg-white/10" />

        <Tooltip label="Frame entire room" shortcut="Home" side="top">
          <button
            type="button"
            onClick={handleFrameRoom}
            className="w-7 h-7 rounded-[4px] hover:bg-white/10 hover:text-white flex items-center justify-center transition-colors"
          >
            <Maximize2 size={14} strokeWidth={1.75} />
          </button>
        </Tooltip>

        <Tooltip label="North orientation" side="top">
          <div className="w-7 h-7 flex items-center justify-center text-indigo-400 font-bold text-xs" title="North is Up (Z-)">
            <Compass size={15} strokeWidth={1.75} />
          </div>
        </Tooltip>

        <div className="w-px h-3.5 bg-white/10" />

        <Tooltip label="Toggle 2D / 3D view" shortcut="Tab" side="top">
          <button
            type="button"
            onClick={() => setView(view === '3d' ? '2d' : '3d')}
            className={`h-7 px-2 rounded-[4px] text-xs font-semibold flex items-center gap-1 transition-colors ${
              view === '2d' ? 'bg-indigo-600 text-white' : 'hover:bg-white/10 text-neutral-300'
            }`}
          >
            <Layers size={13} strokeWidth={1.75} />
            <span>{view === '3d' ? '3D' : '2D'}</span>
          </button>
        </Tooltip>
      </div>

      {/* Floating Toast Notification (bottom-centre with Undo) */}
      {toastMessage && (
        <div className="fixed bottom-14 left-1/2 -translate-x-1/2 z-[50] pointer-events-auto">
          <div
            data-testid="hud-toast-message"
            className="bg-neutral-900/95 dark:bg-[#121826]/95 border border-indigo-500/40 text-neutral-200 px-3.5 py-2 rounded-[8px] shadow-2xl backdrop-blur-md flex items-center gap-2.5 text-xs font-medium animate-in fade-in slide-in-from-bottom-2 duration-150"
          >
            <span>{toastMessage}</span>
            <button
              type="button"
              onClick={() => {
                useSceneStore.temporal.getState().undo();
                setToastMessage(null);
              }}
              className="px-2 py-0.5 rounded bg-indigo-600/30 hover:bg-indigo-600/50 text-indigo-300 font-semibold text-[11px] border border-indigo-500/30 transition-colors flex items-center gap-1"
            >
              <Undo2 size={12} />
              <span>Undo</span>
            </button>
            <button
              type="button"
              onClick={() => setToastMessage(null)}
              className="text-neutral-400 hover:text-white p-0.5"
            >
              <X size={13} />
            </button>
          </div>
        </div>
      )}

      {/* Validation Issues Drawer */}
      {isIssuesOpen && (
        <div
          data-testid="validation-issues-list"
          className="pointer-events-auto fixed bottom-14 left-3 z-[30] w-80 max-h-64 bg-neutral-900/95 dark:bg-[#121826]/95 backdrop-blur-md border border-white/10 rounded-[10px] shadow-2xl p-3 flex flex-col gap-2 overflow-y-auto animate-in fade-in zoom-in-95 duration-100"
        >
          <div className="flex items-center justify-between pb-1.5 border-b border-white/10">
            <span className="font-semibold text-white text-xs">Validation Issues ({issues.length})</span>
            <button
              type="button"
              data-testid="close-issues-btn"
              onClick={() => setIsIssuesOpen(false)}
              className="text-neutral-400 hover:text-white"
            >
              <X size={14} />
            </button>
          </div>
          {issues.length === 0 ? (
            <div className="py-3 text-center text-emerald-400 text-xs font-sans">
              ✓ Room is fully valid!
            </div>
          ) : (
            <div className="flex flex-col gap-1.5">
              {issues.map((iss, index) => (
                <button
                  key={`${iss.level}-${index}`}
                  type="button"
                  data-testid={iss.ref ? `issue-item-${iss.ref}` : `issue-item-${index}`}
                  onClick={() => {
                    if (iss.ref) {
                      if (room.objects.some((o) => o.id === iss.ref)) selectObject(iss.ref);
                      else if (room.openings.some((op) => op.id === iss.ref)) selectOpening(iss.ref);
                    }
                  }}
                  className={`text-left p-2 rounded-[6px] border text-xs flex flex-col gap-0.5 ${
                    iss.level === 'error'
                      ? 'bg-red-950/40 border-red-800/60 text-red-200'
                      : 'bg-amber-950/40 border-amber-800/60 text-amber-200'
                  } ${iss.ref ? 'cursor-pointer hover:border-indigo-500' : 'cursor-default'}`}
                >
                  <div className="flex items-center justify-between text-[10px]">
                    <span className="font-bold uppercase tracking-wider">{iss.level}</span>
                    {iss.ref && <span className="text-indigo-400">Select →</span>}
                  </div>
                  <span className="text-[11px] leading-tight">{iss.message}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Placement Issues Drawer */}
      {isPlacementDrawerOpen && activePlacementIssues.length > 0 && (
        <div
          data-testid="placement-issues-list"
          className="pointer-events-auto fixed bottom-14 left-3 z-[30] w-80 max-h-64 bg-neutral-900/95 dark:bg-[#121826]/95 backdrop-blur-md border border-red-500/60 rounded-[10px] shadow-2xl p-3 flex flex-col gap-2 overflow-y-auto animate-in fade-in zoom-in-95 duration-100"
        >
          <div className="flex items-center justify-between pb-1.5 border-b border-white/10">
            <span className="font-semibold text-white text-xs flex items-center gap-1.5">
              <AlertTriangle size={13} className="text-red-400" />
              <span>Placement Conflicts ({activePlacementIssues.length})</span>
            </span>
            <button
              type="button"
              data-testid="close-placement-issues-btn"
              onClick={() => setIsPlacementDrawerOpen(false)}
              className="text-neutral-400 hover:text-white"
            >
              <X size={14} />
            </button>
          </div>
          <div className="flex flex-col gap-1.5">
            {activePlacementIssues.map(({ issue, objectName }) => (
              <button
                key={issue.id}
                type="button"
                data-testid={`placement-issue-item-${issue.objectId}`}
                onClick={() => {
                  selectObject(issue.objectId);
                  const targetObj = room.objects.find((o) => o.id === issue.objectId);
                  if (targetObj && sharedOrbitControlsRef.current) {
                    const elev = targetObj.elevation ?? 0;
                    const targetPos = new THREE.Vector3(
                      targetObj.position[0],
                      (targetObj.position[1] ?? 0) + elev + targetObj.size[1] / 2,
                      targetObj.position[2]
                    );
                    sharedOrbitControlsRef.current.target.copy(targetPos);
                    sharedOrbitControlsRef.current.update();
                  }
                }}
                className="text-left p-2 rounded-[6px] border bg-red-950/40 border-red-800/60 hover:border-red-500 text-red-200 transition-colors flex flex-col gap-0.5 cursor-pointer"
              >
                <div className="flex items-center justify-between text-[10px]">
                  <span className="font-bold uppercase tracking-wider">{objectName}</span>
                  <span className="text-indigo-400">Frame →</span>
                </div>
                <span className="text-[11px] leading-tight">{issue.message}</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

export default HudOverlay;
