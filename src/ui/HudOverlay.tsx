import React, { useEffect, useMemo, useState } from 'react';
import * as THREE from 'three';
import { parseRoom } from '../core/parser';
import { useSceneStore, useUiStore } from '../store';
import { usePlacementIssuesStore } from '../store/placementIssuesStore';
import type { PlacementIssue } from '../core/placementValidator';
import { sharedOrbitControlsRef } from '../builder/Canvas';

export interface HudOverlayProps {
  className?: string;
}

/**
 * Dedicated sub-component for cursor coordinates so high-frequency mouse moves
 * do not re-render the validation list or other HUD widgets.
 */
const HudCursorDisplay: React.FC = () => {
  const cursorCoords = useUiStore((state) => state.cursorCoords);

  return (
    <div data-testid="hud-cursor-coords" className="flex items-center gap-1.5 font-mono">
      <span className="text-neutral-500">📍</span>
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
  );
};

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
  const gridStep = useUiStore((state) => state.gridStep);
  const showVoxelDebug = useUiStore((state) => state.showVoxelDebug);
  const voxelStats = useUiStore((state) => state.voxelStats);
  const toastMessage = useUiStore((state) => state.toastMessage);
  const setToastMessage = useUiStore((state) => state.setToastMessage);

  useEffect(() => {
    if (!toastMessage) return;
    const timer = setTimeout(() => {
      setToastMessage(null);
    }, 4000);
    return () => clearTimeout(timer);
  }, [toastMessage, setToastMessage]);

  const [isIssuesOpen, setIsIssuesOpen] = useState(false);
  const [isPlacementDrawerOpen, setIsPlacementDrawerOpen] = useState(false);

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

  const handlePlacementIssueClick = (objectId: string) => {
    selectObject(objectId);

    // Frame the object in the camera view
    const targetObj = room.objects.find((o) => o.id === objectId);
    if (targetObj && sharedOrbitControlsRef.current) {
      const elev = targetObj.elevation ?? 0;
      const targetPos = new THREE.Vector3(
        targetObj.position[0],
        (targetObj.position[1] ?? 0) + elev + targetObj.size[1] / 2,
        targetObj.position[2]
      );

      const maxDim = Math.max(...targetObj.size, 1.0);
      const dist = maxDim * 2.5;
      const cam = sharedOrbitControlsRef.current.object;
      if (cam) {
        cam.position.set(
          targetPos.x + dist * 0.7,
          targetPos.y + dist * 0.6,
          targetPos.z + dist * 0.7
        );
      }
      sharedOrbitControlsRef.current.target.copy(targetPos);
      sharedOrbitControlsRef.current.update();
    }
  };

  // Validate room using parseRoom
  const parseResult = useMemo(() => {
    return parseRoom(room);
  }, [room]);

  const issues = parseResult.issues;
  const errorCount = useMemo(() => issues.filter((i) => i.level === 'error').length, [issues]);
  const warningCount = useMemo(() => issues.filter((i) => i.level === 'warning').length, [issues]);

  // Selection count label
  const selectionLabel = useMemo(() => {
    const objCount =
      selectedObjectIds.length > 0 ? selectedObjectIds.length : selectedObjectId ? 1 : 0;
    const opCount =
      selectedOpeningIds.length > 0 ? selectedOpeningIds.length : selectedOpeningId ? 1 : 0;

    if (objCount > 0 && opCount > 0) {
      return `${objCount} obj, ${opCount} op`;
    }
    if (objCount > 0) {
      return `${objCount} object${objCount > 1 ? 's' : ''}`;
    }
    if (opCount > 0) {
      return `${opCount} opening${opCount > 1 ? 's' : ''}`;
    }
    return 'None';
  }, [selectedObjectIds, selectedObjectId, selectedOpeningIds, selectedOpeningId]);

  // Click on issue handler: selects offending object or opening
  const handleIssueClick = (ref?: string) => {
    if (!ref) return;

    // Check if ref is an object
    const isObj = room.objects.some((o) => o.id === ref);
    if (isObj) {
      selectObject(ref);
      return;
    }

    // Check if ref is an opening
    const isOp = room.openings.some((o) => o.id === ref);
    if (isOp) {
      selectOpening(ref);
      return;
    }
  };

  return (
    <div
      data-testid="hud-overlay"
      className={`fixed bottom-4 left-4 z-30 flex flex-col gap-2 font-mono text-xs select-none pointer-events-none ${className}`}
    >
      {/* Expanded Placement Issues Drawer */}
      {isPlacementDrawerOpen && activePlacementIssues.length > 0 && (
        <div
          data-testid="placement-issues-list"
          className="pointer-events-auto w-88 max-h-72 bg-neutral-900/95 backdrop-blur-md border border-red-500/70 rounded-xl shadow-2xl p-3 flex flex-col gap-2 overflow-y-auto"
        >
          <div className="flex items-center justify-between border-b border-neutral-800 pb-1.5 font-sans">
            <span className="font-semibold text-white text-xs flex items-center gap-1.5">
              <span className="text-red-400">⚠️</span>
              <span>Placement Issues</span>
              <span className="text-[10px] text-red-300 font-mono">
                ({activePlacementIssues.length})
              </span>
            </span>
            <button
              type="button"
              data-testid="close-placement-issues-btn"
              onClick={() => setIsPlacementDrawerOpen(false)}
              className="text-neutral-400 hover:text-white px-1.5 py-0.5 rounded hover:bg-neutral-800 text-xs transition-colors"
            >
              ✕
            </button>
          </div>

          <div className="flex flex-col gap-1.5 font-sans">
            {activePlacementIssues.map(({ issue, objectName }) => (
              <button
                key={issue.id}
                type="button"
                data-testid={`placement-issue-item-${issue.objectId}`}
                onClick={() => handlePlacementIssueClick(issue.objectId)}
                className="text-left p-2 rounded-lg border bg-red-950/40 border-red-800/60 hover:bg-red-900/40 hover:border-red-500 text-red-200 transition-all flex flex-col gap-1 cursor-pointer"
              >
                <div className="flex items-center justify-between text-[10px]">
                  <span className="font-bold uppercase tracking-wider px-1 py-0.5 rounded text-[9px] bg-red-900 text-red-100">
                    {objectName}
                  </span>
                  <span className="text-[10px] text-sky-400 hover:underline">Select & Frame →</span>
                </div>
                <span className="text-xs leading-snug">{issue.message}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Expanded Validation Issues Drawer */}
      {isIssuesOpen && (
        <div
          data-testid="validation-issues-list"
          className="pointer-events-auto w-84 max-h-72 bg-neutral-900/95 backdrop-blur-md border border-neutral-700/80 rounded-xl shadow-2xl p-3 flex flex-col gap-2 overflow-y-auto"
        >
          <div className="flex items-center justify-between border-b border-neutral-800 pb-1.5 font-sans">
            <span className="font-semibold text-white text-xs flex items-center gap-1.5">
              <span>Validation Issues</span>
              <span className="text-[10px] text-neutral-400 font-mono">({issues.length})</span>
            </span>
            <button
              type="button"
              data-testid="close-issues-btn"
              onClick={() => setIsIssuesOpen(false)}
              className="text-neutral-400 hover:text-white px-1.5 py-0.5 rounded hover:bg-neutral-800 text-xs transition-colors"
            >
              ✕
            </button>
          </div>

          {issues.length === 0 ? (
            <div className="py-4 text-center text-emerald-400 text-xs font-sans">
              ✓ Room is fully valid! No warnings or errors.
            </div>
          ) : (
            <div className="flex flex-col gap-1.5 font-sans">
              {issues.map((iss, index) => {
                const isClickable = Boolean(iss.ref);
                return (
                  <button
                    key={`${iss.level}-${index}-${iss.ref || 'gen'}`}
                    type="button"
                    data-testid={iss.ref ? `issue-item-${iss.ref}` : `issue-item-${index}`}
                    onClick={() => handleIssueClick(iss.ref)}
                    disabled={!isClickable}
                    className={`text-left p-2 rounded-lg border transition-all flex flex-col gap-1 ${
                      iss.level === 'error'
                        ? 'bg-red-950/40 border-red-800/60 hover:bg-red-900/40 text-red-200'
                        : 'bg-amber-950/40 border-amber-800/60 hover:bg-amber-900/40 text-amber-200'
                    } ${isClickable ? 'cursor-pointer hover:border-sky-500' : 'cursor-default'}`}
                  >
                    <div className="flex items-center justify-between text-[10px]">
                      <span
                        className={`font-bold uppercase tracking-wider px-1 py-0.5 rounded text-[9px] ${
                          iss.level === 'error'
                            ? 'bg-red-900 text-red-100'
                            : 'bg-amber-900 text-amber-100'
                        }`}
                      >
                        {iss.level}
                      </span>
                      {iss.ref && (
                        <span className="text-[10px] text-sky-400 hover:underline">
                          Select {iss.ref} →
                        </span>
                      )}
                    </div>
                    <span className="text-xs leading-snug">{iss.message}</span>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* Bottom Status Card */}
      <div
        data-testid="hud-status-card"
        className="pointer-events-auto bg-neutral-900/85 backdrop-blur-md px-3 py-2 rounded-xl border border-neutral-700/60 shadow-xl flex items-center gap-3 text-neutral-300"
      >
        {/* Cursor Coordinates */}
        <HudCursorDisplay />

        <span className="text-neutral-700">|</span>

        {/* Current Tool */}
        <div data-testid="hud-current-tool" className="flex items-center gap-1 font-sans">
          <span className="text-neutral-400">Tool:</span>
          <span className="font-semibold text-sky-400 capitalize">
            {toolMode === 'draw-floor' ? 'Draw Floor' : toolMode}
          </span>
        </div>

        <span className="text-neutral-700">|</span>

        {/* Snap Status */}
        <div data-testid="hud-snap-status" className="flex items-center gap-1">
          <span className="text-neutral-400 font-sans">Snap:</span>
          <span className="font-mono text-emerald-400">{snapEnabled ? `${gridStep}m` : 'Off'}</span>
        </div>

        <span className="text-neutral-700">|</span>

        {/* Selection Count */}
        <div data-testid="hud-selection-count" className="flex items-center gap-1 font-sans">
          <span className="text-neutral-400">Selected:</span>
          <span className="font-semibold text-neutral-200">{selectionLabel}</span>
        </div>

        {/* Voxel Grid Memory / Time Stats */}
        {showVoxelDebug && voxelStats && (
          <>
            <span className="text-neutral-700">|</span>
            <div
              data-testid="hud-voxel-stats"
              className="flex items-center gap-1.5 font-mono text-purple-300"
            >
              <span className="text-xs">🧊</span>
              <span>
                <strong>{(voxelStats.cellCount / 1000).toFixed(0)}k</strong> cells (
                <strong className="text-neutral-200">
                  {(voxelStats.memoryBytes / 1024).toFixed(1)} KB
                </strong>
                , <strong className="text-emerald-400">{voxelStats.computeTimeMs}ms</strong>)
              </span>
            </div>
          </>
        )}

        {/* Phase B: Placement Issues Warning Badge */}
        {activePlacementIssues.length > 0 && (
          <>
            <span className="text-neutral-700">|</span>
            <button
              type="button"
              data-testid="hud-placement-badge"
              onClick={() => setIsPlacementDrawerOpen(!isPlacementDrawerOpen)}
              className="flex items-center gap-1.5 px-2.5 py-0.5 rounded-lg border font-sans text-xs font-semibold bg-red-950/80 border-red-500 text-red-200 hover:bg-red-900/90 transition-all cursor-pointer shadow-lg animate-pulse"
              title="Click to view placement issues"
            >
              <span className="text-sm">⚠️</span>
              <span>
                {activePlacementIssues.length} Placement Issue
                {activePlacementIssues.length > 1 ? 's' : ''}
              </span>
            </button>
          </>
        )}

        <span className="text-neutral-700">|</span>

        {/* Validation Issues Pill */}
        <button
          type="button"
          data-testid="hud-validation-pill"
          onClick={() => setIsIssuesOpen(!isIssuesOpen)}
          className={`flex items-center gap-1.5 px-2 py-0.5 rounded-lg border font-sans text-xs font-semibold transition-all cursor-pointer ${
            errorCount > 0
              ? 'bg-red-950/80 border-red-600 text-red-300 hover:bg-red-900/90'
              : warningCount > 0
                ? 'bg-amber-950/80 border-amber-600 text-amber-300 hover:bg-amber-900/90'
                : 'bg-emerald-950/80 border-emerald-600 text-emerald-300 hover:bg-emerald-900/90'
          }`}
          title="Click to view validation issues"
        >
          <span>{errorCount > 0 ? '❌' : warningCount > 0 ? '⚠️' : '✓'}</span>
          <span>
            {errorCount > 0
              ? `${errorCount} Error${errorCount > 1 ? 's' : ''}`
              : warningCount > 0
                ? `${warningCount} Warning${warningCount > 1 ? 's' : ''}`
                : 'Valid'}
          </span>
        </button>
      </div>

      {/* Floating Toast Notification (bottom-centre with Undo action) */}
      {toastMessage && (
        <div className="fixed bottom-8 left-1/2 -translate-x-1/2 z-50 pointer-events-auto">
          <div
            data-testid="hud-toast-message"
            className="bg-neutral-900/95 border border-amber-500/70 text-amber-200 px-4 py-2.5 rounded-xl shadow-2xl backdrop-blur-md flex items-center gap-3 text-xs font-medium animate-in fade-in slide-in-from-bottom-3 duration-200"
          >
            <span>ℹ️</span>
            <span>{toastMessage}</span>
            <button
              type="button"
              onClick={() => {
                useSceneStore.temporal.getState().undo();
                setToastMessage(null);
              }}
              className="px-2 py-0.5 rounded bg-amber-500/20 hover:bg-amber-500/30 text-amber-300 font-semibold text-[11px] border border-amber-500/50 transition-colors cursor-pointer flex items-center gap-1"
              aria-label="Undo last action"
            >
              <span>↩</span>
              <span>Undo</span>
            </button>
            <button
              type="button"
              onClick={() => setToastMessage(null)}
              className="ml-1 text-neutral-400 hover:text-white"
              aria-label="Dismiss notification"
            >
              ✕
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export default HudOverlay;
