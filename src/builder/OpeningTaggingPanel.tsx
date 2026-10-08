import React, { useCallback, useMemo } from 'react';
import { Html } from '@react-three/drei';
import { wallSegment } from '../core/parser';
import type { OpeningRole } from '../core/schema';
import { useSceneStore } from '../store/sceneStore';

export const OpeningTaggingPanel: React.FC = () => {
  const room = useSceneStore((state) => state.room);
  const selectedOpeningId = useSceneStore((state) => state.selectedOpeningId);
  const selectedOpeningIds = useSceneStore((state) => state.selectedOpeningIds);
  const updateOpening = useSceneStore((state) => state.updateOpening);
  const setOpeningsRole = useSceneStore((state) => state.setOpeningsRole);
  const setOpeningsOpenFraction = useSceneStore((state) => state.setOpeningsOpenFraction);
  const removeOpening = useSceneStore((state) => state.removeOpening);
  const deleteSelected = useSceneStore((state) => state.deleteSelected);
  const clearSelection = useSceneStore((state) => state.clearSelection);

  // Active selected openings list
  const selectedOpenings = useMemo(() => {
    const ids = new Set(
      selectedOpeningIds.length > 0
        ? selectedOpeningIds
        : selectedOpeningId
          ? [selectedOpeningId]
          : []
    );
    return room.openings.filter((op) => ids.has(op.id));
  }, [room.openings, selectedOpeningIds, selectedOpeningId]);

  // Primary single opening or null if none/multiple
  const singleOpening = selectedOpenings.length === 1 ? selectedOpenings[0]! : null;
  const isBulk = selectedOpenings.length > 1;

  // Compute 3D anchor position for the floating panel
  const panelPosition = useMemo<[number, number, number] | null>(() => {
    if (selectedOpenings.length === 0 || room.outline.length < 2) return null;

    if (singleOpening) {
      const seg = wallSegment(room, singleOpening.wallIndex);
      const uMid = singleOpening.offset + singleOpening.width / 2;
      const vMid = singleOpening.sill + singleOpening.height / 2;
      const tMid = room.wallThickness / 2;

      const posX = seg.a[0] + uMid * seg.dir[0] + tMid * seg.normal[0];
      const posY = vMid + singleOpening.height / 2 + 0.35;
      const posZ = seg.a[1] + uMid * seg.dir[1] + tMid * seg.normal[1];

      return [posX, posY, posZ];
    }

    // Centroid for bulk selection
    let sumX = 0;
    let sumY = 0;
    let sumZ = 0;
    for (const op of selectedOpenings) {
      const seg = wallSegment(room, op.wallIndex);
      const uMid = op.offset + op.width / 2;
      const vMid = op.sill + op.height / 2;
      const tMid = room.wallThickness / 2;

      sumX += seg.a[0] + uMid * seg.dir[0] + tMid * seg.normal[0];
      sumY += vMid + op.height / 2 + 0.35;
      sumZ += seg.a[1] + uMid * seg.dir[1] + tMid * seg.normal[1];
    }
    const n = selectedOpenings.length;
    return [sumX / n, sumY / n, sumZ / n];
  }, [selectedOpenings, singleOpening, room]);

  // Role change handlers
  const handleSingleRoleChange = useCallback(
    (role: OpeningRole) => {
      if (!singleOpening) return;
      if (role === 'closed') {
        updateOpening(singleOpening.id, { role: 'closed', openFraction: 0 });
      } else {
        const nextFraction = singleOpening.openFraction === 0 ? 0.5 : singleOpening.openFraction;
        updateOpening(singleOpening.id, { role, openFraction: nextFraction });
      }
    },
    [singleOpening, updateOpening]
  );

  const handleBulkRoleChange = useCallback(
    (role: OpeningRole) => {
      const ids = selectedOpenings.map((op) => op.id);
      setOpeningsRole(ids, role);
    },
    [selectedOpenings, setOpeningsRole]
  );

  // Open fraction slider handlers
  const handleSingleSliderChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      if (!singleOpening) return;
      const percent = Number(e.target.value);
      const fraction = Number((percent / 100).toFixed(2));

      if (fraction === 0) {
        updateOpening(singleOpening.id, { openFraction: 0 });
      } else if (singleOpening.role === 'closed') {
        // Auto-open previously closed opening
        const autoRole: OpeningRole = singleOpening.type === 'door' ? 'outlet' : 'inlet';
        updateOpening(singleOpening.id, { role: autoRole, openFraction: fraction });
      } else {
        updateOpening(singleOpening.id, { openFraction: fraction });
      }
    },
    [singleOpening, updateOpening]
  );

  const handleBulkSliderChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const percent = Number(e.target.value);
      const fraction = Number((percent / 100).toFixed(2));
      const ids = selectedOpenings.map((op) => op.id);
      setOpeningsOpenFraction(ids, fraction);
    },
    [selectedOpenings, setOpeningsOpenFraction]
  );

  // Numeric field handlers (Width, Height, Sill)
  const handleWidthChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      if (!singleOpening) return;
      const val = parseFloat(e.target.value);
      if (isNaN(val) || val <= 0) return;
      const seg = wallSegment(room, singleOpening.wallIndex);
      const maxW = Math.max(0.3, seg.len - singleOpening.offset);
      const clamped = Math.max(0.3, Math.min(maxW, val));
      updateOpening(singleOpening.id, { width: Number(clamped.toFixed(3)) });
    },
    [singleOpening, room, updateOpening]
  );

  const handleHeightChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      if (!singleOpening) return;
      const val = parseFloat(e.target.value);
      if (isNaN(val) || val <= 0) return;
      const maxH = Math.max(0.3, room.wallHeight - singleOpening.sill);
      const clamped = Math.max(0.3, Math.min(maxH, val));
      updateOpening(singleOpening.id, { height: Number(clamped.toFixed(3)) });
    },
    [singleOpening, room.wallHeight, updateOpening]
  );

  const handleSillChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      if (!singleOpening) return;
      const val = parseFloat(e.target.value);
      if (isNaN(val) || val < 0) return;
      const maxSill = Math.max(0, room.wallHeight - singleOpening.height);
      const clamped = Math.max(0, Math.min(maxSill, val));
      updateOpening(singleOpening.id, { sill: Number(clamped.toFixed(3)) });
    },
    [singleOpening, room.wallHeight, updateOpening]
  );

  if (!panelPosition || selectedOpenings.length === 0) {
    return null;
  }

  // --- SINGLE OPENING TAGGING PANEL ---
  if (singleOpening) {
    const openPercent = Math.round(singleOpening.openFraction * 100);

    return (
      <group position={panelPosition}>
        <Html center distanceFactor={7} zIndexRange={[120, 0]}>
          <div
            data-testid="opening-tagging-panel"
            className="w-72 bg-neutral-900/95 backdrop-blur-md border border-neutral-700/80 shadow-2xl rounded-xl p-3.5 text-neutral-200 select-none text-xs flex flex-col gap-3 font-sans"
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => e.stopPropagation()}
          >
            {/* Header: Type, Wall, and Close */}
            <div className="flex items-center justify-between border-b border-neutral-800 pb-2">
              <div className="flex items-center gap-2">
                <span
                  className={`w-2.5 h-2.5 rounded-full ${
                    singleOpening.role === 'inlet'
                      ? 'bg-sky-400'
                      : singleOpening.role === 'outlet'
                        ? 'bg-orange-400'
                        : 'bg-neutral-400'
                  }`}
                />
                <span className="font-semibold text-white capitalize text-sm">
                  {singleOpening.type}
                </span>
                <span className="text-[11px] text-neutral-400 font-mono">
                  (Wall #{singleOpening.wallIndex + 1})
                </span>
              </div>
              <button
                type="button"
                onClick={clearSelection}
                className="text-neutral-400 hover:text-white px-1.5 py-0.5 rounded hover:bg-neutral-800 text-xs transition-colors"
                title="Deselect"
              >
                ✕
              </button>
            </div>

            {/* Role Buttons: Inlet / Outlet / Closed */}
            <div className="flex flex-col gap-1.5">
              <label className="text-[11px] font-medium text-neutral-400 uppercase tracking-wider">
                Airflow Role
              </label>
              <div className="grid grid-cols-3 gap-1.5">
                {/* Inlet (Blue) */}
                <button
                  type="button"
                  data-testid="role-inlet-btn"
                  onClick={() => handleSingleRoleChange('inlet')}
                  className={`flex flex-col items-center justify-center py-2 px-1 rounded-lg border text-xs font-semibold transition-all ${
                    singleOpening.role === 'inlet'
                      ? 'bg-sky-600 border-sky-400 text-white shadow-md shadow-sky-900/40 ring-1 ring-sky-400'
                      : 'bg-neutral-800/80 border-neutral-700/60 text-neutral-300 hover:bg-neutral-700 hover:text-white'
                  }`}
                >
                  <span className="text-base leading-none mb-1">↓</span>
                  <span>Inlet</span>
                </button>

                {/* Outlet (Orange) */}
                <button
                  type="button"
                  data-testid="role-outlet-btn"
                  onClick={() => handleSingleRoleChange('outlet')}
                  className={`flex flex-col items-center justify-center py-2 px-1 rounded-lg border text-xs font-semibold transition-all ${
                    singleOpening.role === 'outlet'
                      ? 'bg-orange-600 border-orange-400 text-white shadow-md shadow-orange-900/40 ring-1 ring-orange-400'
                      : 'bg-neutral-800/80 border-neutral-700/60 text-neutral-300 hover:bg-neutral-700 hover:text-white'
                  }`}
                >
                  <span className="text-base leading-none mb-1">↑</span>
                  <span>Outlet</span>
                </button>

                {/* Closed (Grey) */}
                <button
                  type="button"
                  data-testid="role-closed-btn"
                  onClick={() => handleSingleRoleChange('closed')}
                  className={`flex flex-col items-center justify-center py-2 px-1 rounded-lg border text-xs font-semibold transition-all ${
                    singleOpening.role === 'closed'
                      ? 'bg-neutral-700 border-neutral-500 text-white shadow-md shadow-neutral-950/40 ring-1 ring-neutral-400'
                      : 'bg-neutral-800/80 border-neutral-700/60 text-neutral-400 hover:bg-neutral-700 hover:text-white'
                  }`}
                >
                  <span className="text-base leading-none mb-1">✕</span>
                  <span>Closed</span>
                </button>
              </div>
            </div>

            {/* Open-Fraction Slider: 0 - 100% */}
            <div className="flex flex-col gap-1.5 bg-neutral-950/40 p-2 rounded-lg border border-neutral-800">
              <div className="flex items-center justify-between text-xs">
                <span className="text-neutral-400 font-medium">Open Fraction</span>
                <span
                  data-testid="open-fraction-value"
                  className="font-mono font-bold text-sky-400 text-xs bg-sky-950/60 px-1.5 py-0.5 rounded border border-sky-800/50"
                >
                  {openPercent}%
                </span>
              </div>
              <input
                type="range"
                data-testid="open-fraction-slider"
                min="0"
                max="100"
                step="5"
                value={openPercent}
                onChange={handleSingleSliderChange}
                className="w-full h-1.5 bg-neutral-700 rounded-lg appearance-none cursor-pointer accent-sky-500 hover:accent-sky-400"
              />
              <div className="flex items-center justify-between text-[10px] text-neutral-500 pt-0.5">
                <button
                  type="button"
                  onClick={() =>
                    updateOpening(singleOpening.id, { role: 'closed', openFraction: 0 })
                  }
                  className="hover:text-neutral-300"
                >
                  0% (Closed)
                </button>
                <button
                  type="button"
                  onClick={() =>
                    updateOpening(singleOpening.id, {
                      openFraction: 0.5,
                      ...(singleOpening.role === 'closed' ? { role: 'inlet' } : {}),
                    })
                  }
                  className="hover:text-neutral-300"
                >
                  50%
                </button>
                <button
                  type="button"
                  onClick={() =>
                    updateOpening(singleOpening.id, {
                      openFraction: 1,
                      ...(singleOpening.role === 'closed' ? { role: 'inlet' } : {}),
                    })
                  }
                  className="hover:text-neutral-300"
                >
                  100% (Full)
                </button>
              </div>
            </div>

            {/* Dimensions: Width, Height, Sill Numeric Fields */}
            <div className="flex flex-col gap-1.5">
              <label className="text-[11px] font-medium text-neutral-400 uppercase tracking-wider">
                Dimensions (meters)
              </label>
              <div className="grid grid-cols-3 gap-2">
                <div className="flex flex-col gap-0.5">
                  <span className="text-[10px] text-neutral-400">Width</span>
                  <input
                    type="number"
                    data-testid="opening-width-input"
                    step="0.05"
                    min="0.3"
                    value={singleOpening.width}
                    onChange={handleWidthChange}
                    className="w-full bg-neutral-800 border border-neutral-700 rounded px-1.5 py-1 text-xs text-white font-mono focus:outline-none focus:border-sky-500"
                  />
                </div>
                <div className="flex flex-col gap-0.5">
                  <span className="text-[10px] text-neutral-400">Height</span>
                  <input
                    type="number"
                    data-testid="opening-height-input"
                    step="0.05"
                    min="0.3"
                    value={singleOpening.height}
                    onChange={handleHeightChange}
                    className="w-full bg-neutral-800 border border-neutral-700 rounded px-1.5 py-1 text-xs text-white font-mono focus:outline-none focus:border-sky-500"
                  />
                </div>
                <div className="flex flex-col gap-0.5">
                  <span className="text-[10px] text-neutral-400">Sill</span>
                  <input
                    type="number"
                    data-testid="opening-sill-input"
                    step="0.05"
                    min="0"
                    value={singleOpening.sill}
                    onChange={handleSillChange}
                    className="w-full bg-neutral-800 border border-neutral-700 rounded px-1.5 py-1 text-xs text-white font-mono focus:outline-none focus:border-sky-500"
                  />
                </div>
              </div>
            </div>

            {/* Footer / Delete Opening */}
            <div className="flex items-center justify-end border-t border-neutral-800 pt-2">
              <button
                type="button"
                data-testid="delete-opening-btn"
                onClick={() => removeOpening(singleOpening.id)}
                className="text-xs text-red-400 hover:text-red-300 hover:bg-red-950/40 px-2 py-1 rounded transition-colors"
              >
                Delete Opening
              </button>
            </div>
          </div>
        </Html>
      </group>
    );
  }

  // --- BULK OPENINGS TAGGING PANEL ---
  if (isBulk) {
    return (
      <group position={panelPosition}>
        <Html center distanceFactor={7} zIndexRange={[120, 0]}>
          <div
            data-testid="bulk-opening-tagging-panel"
            className="w-72 bg-neutral-900/95 backdrop-blur-md border border-neutral-700/80 shadow-2xl rounded-xl p-3.5 text-neutral-200 select-none text-xs flex flex-col gap-3 font-sans"
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => e.stopPropagation()}
          >
            {/* Header: Count and Close */}
            <div className="flex items-center justify-between border-b border-neutral-800 pb-2">
              <div className="flex items-center gap-2">
                <span className="w-2.5 h-2.5 rounded-full bg-amber-400" />
                <span className="font-semibold text-white text-sm">
                  Bulk Edit: {selectedOpenings.length} Openings
                </span>
              </div>
              <button
                type="button"
                onClick={clearSelection}
                className="text-neutral-400 hover:text-white px-1.5 py-0.5 rounded hover:bg-neutral-800 text-xs transition-colors"
              >
                ✕
              </button>
            </div>

            {/* Bulk Role Selector */}
            <div className="flex flex-col gap-1.5">
              <label className="text-[11px] font-medium text-neutral-400 uppercase tracking-wider">
                Set Role for All Selected
              </label>
              <div className="grid grid-cols-3 gap-1.5">
                <button
                  type="button"
                  data-testid="bulk-role-inlet-btn"
                  onClick={() => handleBulkRoleChange('inlet')}
                  className="py-2 px-1 rounded-lg bg-sky-600/30 hover:bg-sky-600 border border-sky-500/50 hover:border-sky-400 text-sky-200 hover:text-white font-semibold transition-all flex flex-col items-center gap-0.5"
                >
                  <span className="text-sm">↓</span>
                  <span>All Inlet</span>
                </button>

                <button
                  type="button"
                  data-testid="bulk-role-outlet-btn"
                  onClick={() => handleBulkRoleChange('outlet')}
                  className="py-2 px-1 rounded-lg bg-orange-600/30 hover:bg-orange-600 border border-orange-500/50 hover:border-orange-400 text-orange-200 hover:text-white font-semibold transition-all flex flex-col items-center gap-0.5"
                >
                  <span className="text-sm">↑</span>
                  <span>All Outlet</span>
                </button>

                <button
                  type="button"
                  data-testid="bulk-role-closed-btn"
                  onClick={() => handleBulkRoleChange('closed')}
                  className="py-2 px-1 rounded-lg bg-neutral-700/50 hover:bg-neutral-700 border border-neutral-600/50 hover:border-neutral-500 text-neutral-300 hover:text-white font-semibold transition-all flex flex-col items-center gap-0.5"
                >
                  <span className="text-sm">✕</span>
                  <span>All Closed</span>
                </button>
              </div>
            </div>

            {/* Bulk Open-Fraction Slider */}
            <div className="flex flex-col gap-1.5 bg-neutral-950/40 p-2 rounded-lg border border-neutral-800">
              <span className="text-neutral-400 font-medium text-xs">
                Set Open Fraction for All
              </span>
              <input
                type="range"
                data-testid="bulk-open-fraction-slider"
                min="0"
                max="100"
                step="5"
                defaultValue="50"
                onChange={handleBulkSliderChange}
                className="w-full h-1.5 bg-neutral-700 rounded-lg appearance-none cursor-pointer accent-amber-500 hover:accent-amber-400"
              />
              <div className="flex items-center justify-between text-[10px] text-neutral-500 pt-0.5">
                <button
                  type="button"
                  onClick={() => {
                    const ids = selectedOpenings.map((op) => op.id);
                    setOpeningsOpenFraction(ids, 0);
                  }}
                  className="hover:text-neutral-300"
                >
                  0%
                </button>
                <button
                  type="button"
                  onClick={() => {
                    const ids = selectedOpenings.map((op) => op.id);
                    setOpeningsOpenFraction(ids, 0.5);
                  }}
                  className="hover:text-neutral-300"
                >
                  50%
                </button>
                <button
                  type="button"
                  onClick={() => {
                    const ids = selectedOpenings.map((op) => op.id);
                    setOpeningsOpenFraction(ids, 1.0);
                  }}
                  className="hover:text-neutral-300"
                >
                  100%
                </button>
              </div>
            </div>

            {/* Delete All Selected */}
            <div className="flex items-center justify-end border-t border-neutral-800 pt-2">
              <button
                type="button"
                data-testid="bulk-delete-openings-btn"
                onClick={deleteSelected}
                className="text-xs text-red-400 hover:text-red-300 hover:bg-red-950/40 px-2 py-1 rounded transition-colors"
              >
                Delete Selected ({selectedOpenings.length})
              </button>
            </div>
          </div>
        </Html>
      </group>
    );
  }

  return null;
};

export default OpeningTaggingPanel;
