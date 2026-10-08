import React, { useMemo, useState } from 'react';
import { parseRoom } from '../core/parser';
import { useSceneStore, useUiStore } from '../store';

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
  const gridStep = useUiStore((state) => state.gridStep);
  const cursorCoords = useUiStore((state) => state.cursorCoords);

  const [isIssuesOpen, setIsIssuesOpen] = useState(false);

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
    </div>
  );
};

export default HudOverlay;
