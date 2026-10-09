import { isPassage } from '../core/openingPresets';
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
  const flipOpening = useSceneStore((state) => state.flipOpening);
  const duplicateOpening = useSceneStore((state) => state.duplicateOpening);
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

  // Compute 3D anchor position directly above the selected opening
  const panelPosition = useMemo<[number, number, number] | null>(() => {
    if (selectedOpenings.length === 0 || room.outline.length < 2) return null;

    if (singleOpening) {
      const seg = wallSegment(room, singleOpening.wallIndex);
      const uMid = singleOpening.offset + singleOpening.width / 2;
      const vTop = singleOpening.sill + singleOpening.height;
      const tMid = room.wallThickness / 2;

      const posX = seg.a[0] + uMid * seg.dir[0] + tMid * seg.normal[0];
      const posY = vTop + 0.28;
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
      const vTop = op.sill + op.height;
      const tMid = room.wallThickness / 2;

      sumX += seg.a[0] + uMid * seg.dir[0] + tMid * seg.normal[0];
      sumY += vTop + 0.28;
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

  if (!panelPosition || selectedOpenings.length === 0) {
    return null;
  }

  // --- SINGLE OPENING COMPACT FLOATING TOOLBAR ---
  if (singleOpening) {
    const openPercent = Math.round(singleOpening.openFraction * 100);

    return (
      <group position={panelPosition}>
        <Html center zIndexRange={[140, 0]}>
          <div
            data-testid="opening-tagging-panel"
            className="bg-neutral-900/95 backdrop-blur-md border border-neutral-700/80 shadow-2xl rounded-full px-3 py-1.5 text-neutral-200 select-none text-xs flex items-center gap-2.5 font-sans whitespace-nowrap"
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => e.stopPropagation()}
          >
            {/* Opening Title Tag */}
            <div className="flex items-center gap-1.5 pr-1 border-r border-neutral-800">
              <span
                className={`w-2 h-2 rounded-full ${
                  singleOpening.role === 'inlet'
                    ? 'bg-sky-400'
                    : singleOpening.role === 'outlet'
                      ? 'bg-orange-400'
                      : 'bg-neutral-400'
                }`}
              />
              <span className="font-semibold text-white capitalize text-[11px]">
                {singleOpening.subType ?? singleOpening.type}
              </span>
            </div>

            {/* Role Pill Selector: Inlet / Outlet / Closed */}
            <div className="flex items-center bg-neutral-950/80 p-0.5 rounded-full border border-neutral-800">
              <button
                type="button"
                data-testid="role-inlet-btn"
                onClick={() => handleSingleRoleChange('inlet')}
                className={`px-2 py-0.5 rounded-full text-[10px] font-semibold transition-all cursor-pointer ${
                  singleOpening.role === 'inlet'
                    ? 'bg-sky-500 text-white shadow-sm ring-1 ring-sky-400'
                    : 'text-neutral-400 hover:text-white'
                }`}
              >
                Inlet
              </button>
              <button
                type="button"
                data-testid="role-outlet-btn"
                onClick={() => handleSingleRoleChange('outlet')}
                className={`px-2 py-0.5 rounded-full text-[10px] font-semibold transition-all cursor-pointer ${
                  singleOpening.role === 'outlet'
                    ? 'bg-orange-500 text-white shadow-sm ring-1 ring-orange-400'
                    : 'text-neutral-400 hover:text-white'
                }`}
              >
                Outlet
              </button>
              <button
                type="button"
                data-testid="role-closed-btn"
                onClick={() => handleSingleRoleChange('closed')}
                className={`px-2 py-0.5 rounded-full text-[10px] font-semibold transition-all cursor-pointer ${
                  singleOpening.role === 'closed'
                    ? 'bg-neutral-700 text-white shadow-sm ring-1 ring-neutral-400'
                    : 'text-neutral-400 hover:text-white'
                }`}
              >
                Closed
              </button>
            </div>

            {/* Open Fraction Slider */}
            <div className="flex items-center gap-1.5 px-1 border-x border-neutral-800">
              <span className="text-[10px] text-neutral-400 font-medium">Open</span>
              <input
                type="range"
                data-testid="open-fraction-slider"
                min="0"
                max="100"
                step="5"
                value={openPercent}
                onChange={handleSingleSliderChange}
                className="w-16 h-1 bg-neutral-700 rounded-lg appearance-none cursor-pointer accent-sky-400 hover:accent-sky-300"
              />
              <span
                data-testid="open-fraction-value"
                className="font-mono text-[10px] text-sky-300 font-semibold w-7 text-right"
              >
                {openPercent}%
              </span>
            </div>

            {/* Compact Action Buttons: Flip, Duplicate, Delete */}
            <div className="flex items-center gap-1">
              {!isPassage(singleOpening.subType) && (
                <button
                  type="button"
                  data-testid="flip-opening-btn"
                  onClick={() => flipOpening(singleOpening.id)}
                  className="px-2 py-1 rounded-md text-[11px] font-medium text-neutral-300 hover:text-white hover:bg-neutral-800 transition-colors cursor-pointer"
                  title="Flip hinge side / swing direction"
                >
                  Flip
                </button>
              )}

              <button
                type="button"
                data-testid="duplicate-opening-btn"
                onClick={() => duplicateOpening(singleOpening.id)}
                className="px-2 py-1 rounded-md text-[11px] font-medium text-neutral-300 hover:text-white hover:bg-neutral-800 transition-colors cursor-pointer"
                title="Duplicate opening on wall"
              >
                Duplicate
              </button>

              <button
                type="button"
                data-testid="delete-opening-btn"
                onClick={() => removeOpening(singleOpening.id)}
                className="px-2 py-1 rounded-md text-[11px] font-medium text-red-400 hover:text-red-300 hover:bg-red-950/40 transition-colors cursor-pointer"
                title="Delete opening"
              >
                Delete
              </button>

              <button
                type="button"
                onClick={clearSelection}
                className="text-neutral-500 hover:text-neutral-300 px-1 py-0.5 rounded text-xs ml-0.5 cursor-pointer"
                title="Close"
              >
                ✕
              </button>
            </div>
          </div>
        </Html>
      </group>
    );
  }

  // --- BULK OPENINGS COMPACT FLOATING TOOLBAR ---
  if (isBulk) {
    return (
      <group position={panelPosition}>
        <Html center zIndexRange={[140, 0]}>
          <div
            data-testid="bulk-opening-tagging-panel"
            className="bg-neutral-900/95 backdrop-blur-md border border-neutral-700/80 shadow-2xl rounded-full px-3 py-1.5 text-neutral-200 select-none text-xs flex items-center gap-2.5 font-sans whitespace-nowrap"
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => e.stopPropagation()}
          >
            <div className="flex items-center gap-1.5 pr-1 border-r border-neutral-800">
              <span className="w-2 h-2 rounded-full bg-amber-400" />
              <span className="font-semibold text-white text-[11px]">
                {selectedOpenings.length} Selected
              </span>
            </div>

            <div className="flex items-center bg-neutral-950/80 p-0.5 rounded-full border border-neutral-800">
              <button
                type="button"
                data-testid="bulk-role-inlet-btn"
                onClick={() => handleBulkRoleChange('inlet')}
                className="px-2 py-0.5 rounded-full text-[10px] font-semibold text-sky-300 hover:bg-sky-600 hover:text-white transition-all cursor-pointer"
              >
                All Inlet
              </button>
              <button
                type="button"
                data-testid="bulk-role-outlet-btn"
                onClick={() => handleBulkRoleChange('outlet')}
                className="px-2 py-0.5 rounded-full text-[10px] font-semibold text-orange-300 hover:bg-orange-600 hover:text-white transition-all cursor-pointer"
              >
                All Outlet
              </button>
              <button
                type="button"
                data-testid="bulk-role-closed-btn"
                onClick={() => handleBulkRoleChange('closed')}
                className="px-2 py-0.5 rounded-full text-[10px] font-semibold text-neutral-400 hover:bg-neutral-700 hover:text-white transition-all cursor-pointer"
              >
                All Closed
              </button>
            </div>

            <div className="flex items-center gap-1.5 px-1 border-x border-neutral-800">
              <span className="text-[10px] text-neutral-400 font-medium">Open</span>
              <input
                type="range"
                data-testid="bulk-open-fraction-slider"
                min="0"
                max="100"
                step="5"
                defaultValue="50"
                onChange={handleBulkSliderChange}
                className="w-16 h-1 bg-neutral-700 rounded-lg appearance-none cursor-pointer accent-amber-500 hover:accent-amber-400"
              />
            </div>

            <button
              type="button"
              data-testid="bulk-delete-openings-btn"
              onClick={deleteSelected}
              className="px-2 py-1 rounded-md text-[11px] font-medium text-red-400 hover:text-red-300 hover:bg-red-950/40 transition-colors cursor-pointer"
            >
              Delete Selected
            </button>

            <button
              type="button"
              onClick={clearSelection}
              className="text-neutral-500 hover:text-neutral-300 px-1 py-0.5 rounded text-xs cursor-pointer"
              title="Close"
            >
              ✕
            </button>
          </div>
        </Html>
      </group>
    );
  }

  return null;
};

export default OpeningTaggingPanel;
