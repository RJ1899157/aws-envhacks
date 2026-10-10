import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Sliders,
  Wind,
  Home,
  Activity,
  X,
  Copy,
  Trash2,
  Split,
  Maximize2,
  Combine,
  Eye,
  EyeOff,
  Lock,
  Unlock,
} from 'lucide-react';
import { useSceneStore, useUiStore } from '../store';
import { signedArea, wallSegment } from '../core/parser';
import { radToDeg, degToRad } from '../core/units';
import { bearingToScreen, compassPoint } from '../core/wind';
import { computeVentilation, ventilationEnvFromRoom } from '../simulation/ventilation';
import { SimulationPanel } from './simulation/SimulationPanel';
import { OccupancyWeightField } from './simulation/OccupancyWeightField';
import { DeviceProperties } from './simulation/DeviceProperties';
import { SourceProperties } from './simulation/SourceProperties';
import type { LengthAnchor } from '../core/wallOperations';
import type { QuickShapeType, QuickShapeDimensions } from '../core/quickShapes';
import {
  ScrubbableInput,
  Select,
  Slider,
  Checkbox,
  CollapsibleSection,
  Tooltip,
} from './components';
import { useSnapshotStore } from '../store/snapshotStore';

export interface InspectorProps {
  className?: string;
}

type InspectorTab = 'properties' | 'airflow' | 'room' | 'simulation';

/**
 * Interactive SVG compass for the wind direction (convention: src/core/wind.ts). North is up, as in
 * the plan and top views. Clicking a bearing sets where the wind comes FROM; the arrow is drawn from
 * that side across the dial in the direction the air moves.
 */
interface CompassWidgetProps {
  degrees: number;
  onChange: (deg: number) => void;
  onCommit: (deg: number) => void;
}

const CompassWidget: React.FC<CompassWidgetProps> = ({ degrees, onChange, onCommit }) => {
  const svgRef = useRef<SVGSVGElement>(null);
  const [isInteracting, setIsInteracting] = useState(false);

  const calculateAngle = useCallback((clientX: number, clientY: number): number => {
    if (!svgRef.current) return 0;
    const rect = svgRef.current.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    const dx = clientX - cx;
    const dy = clientY - cy;

    const angleRad = Math.atan2(dx, -dy);
    let deg = (angleRad * 180) / Math.PI;
    if (deg < 0) deg += 360;
    return Math.round(deg) % 360;
  }, []);

  const handlePointerDown = (e: React.PointerEvent<SVGSVGElement>) => {
    e.preventDefault();
    setIsInteracting(true);
    e.currentTarget.setPointerCapture(e.pointerId);
    const deg = calculateAngle(e.clientX, e.clientY);
    onChange(deg);
  };

  const handlePointerMove = (e: React.PointerEvent<SVGSVGElement>) => {
    if (!isInteracting) return;
    const deg = calculateAngle(e.clientX, e.clientY);
    onChange(deg);
  };

  const handlePointerUp = (e: React.PointerEvent<SVGSVGElement>) => {
    if (!isInteracting) return;
    setIsInteracting(false);
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {
      // ignore
    }
    const deg = calculateAngle(e.clientX, e.clientY);
    onCommit(deg);
  };

  return (
    <div className="flex flex-col items-center gap-1.5 select-none">
      <svg
        ref={svgRef}
        data-testid="wind-compass-widget"
        width={72}
        height={72}
        viewBox="-40 -40 80 80"
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        className="cursor-crosshair bg-black/40 rounded-full border border-white/10 shadow-inner hover:border-indigo-500/80 transition-colors"
      >
        <circle r={36} fill="none" stroke="rgba(255,255,255,0.15)" strokeWidth={1.5} />
        <circle r={28} fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth={1} strokeDasharray="2,2" />

        <text x={0} y={-23} textAnchor="middle" fill="#6366f1" fontSize={9} fontWeight="bold">
          N
        </text>
        <text x={26} y={3} textAnchor="middle" fill="#94a3b8" fontSize={8} fontWeight="bold">
          E
        </text>
        <text x={0} y={30} textAnchor="middle" fill="#94a3b8" fontSize={8} fontWeight="bold">
          S
        </text>
        <text x={-26} y={3} textAnchor="middle" fill="#94a3b8" fontSize={8} fontWeight="bold">
          W
        </text>

        {/* Wind arrow: tail on the upwind (from) side, head downwind. rotate(θ) turns "up" to bearing θ. */}
        <g transform={`rotate(${degrees})`}>
          <line x1={0} y1={-16} x2={0} y2={9} stroke="#38bdf8" strokeWidth={3} strokeLinecap="round" />
          <polygon points="0,18 -5,7 5,7" fill="#38bdf8" />
        </g>
        <circle cx={bearingToScreen(degrees, 33)[0]} cy={bearingToScreen(degrees, 33)[1]} r={3} fill="#ef4444" />
      </svg>
      <span className="text-[11px] font-mono font-medium text-indigo-400">
        from {compassPoint(degrees)} · {degrees}°
      </span>
    </div>
  );
};

export const Inspector: React.FC<InspectorProps> = ({ className = '' }) => {
  const room = useSceneStore((state) => state.room);
  const selectedObjectId = useSceneStore((state) => state.selectedObjectId);
  const updateObject = useSceneStore((state) => state.updateObject);
  const removeObject = useSceneStore((state) => state.removeObject);
  const duplicateObject = useSceneStore((state) => state.duplicateObject);
  const clearSelection = useSceneStore((state) => state.clearSelection);
  const selectObject = useSceneStore((state) => state.selectObject);
  const setRoomName = useSceneStore((state) => state.setRoomName);
  const setWallHeight = useSceneStore((state) => state.setWallHeight);
  const setWallThickness = useSceneStore((state) => state.setWallThickness);
  const setParams = useSceneStore((state) => state.setParams);
  const setWallLength = useSceneStore((state) => state.setWallLength);
  const splitWall = useSceneStore((state) => state.splitWall);
  const extrudeWall = useSceneStore((state) => state.extrudeWall);
  const mergeCorner = useSceneStore((state) => state.mergeCorner);
  const setQuickShape = useSceneStore((state) => state.setQuickShape);
  const selectOpening = useSceneStore((state) => state.selectOpening);
  const updateOpening = useSceneStore((state) => state.updateOpening);
  const removeOpening = useSceneStore((state) => state.removeOpening);
  const duplicateOpening = useSceneStore((state) => state.duplicateOpening);

  const selectedWallIndex = useUiStore((state) => state.selectedWallIndex);
  const setSelectedWallIndex = useUiStore((state) => state.setSelectedWallIndex);
  const selectedVertexIndex = useUiStore((state) => state.selectedVertexIndex);
  const setSelectedVertexIndex = useUiStore((state) => state.setSelectedVertexIndex);
  const setToastMessage = useUiStore((state) => state.setToastMessage);

  const isPlacingPollutantSource = useUiStore((state) => state.isPlacingPollutantSource);
  const setIsPlacingPollutantSource = useUiStore((state) => state.setIsPlacingPollutantSource);

  // Selected Object instance
  const selectedObject = useMemo(() => {
    return room.objects.find((o) => o.id === selectedObjectId) || null;
  }, [room.objects, selectedObjectId]);

  // Selected Opening instance
  const selectedOpening = useMemo(() => {
    const openingId = useSceneStore.getState().selectedOpeningId;
    return room.openings.find((op) => op.id === openingId) || null;
  }, [room.openings, useSceneStore.getState().selectedOpeningId]);

  // Check if anything is currently selected
  const hasSelection = Boolean(
    selectedObject ||
      selectedOpening ||
      selectedWallIndex !== null ||
      selectedVertexIndex !== null
  );

  // Manual open/close state when nothing is selected
  const [isManuallyOpened, setIsManuallyOpened] = useState(false);
  const [activeTab, setActiveTab] = useState<InspectorTab>('properties');
  const setShowWindIndicator = useUiStore((state) => state.setShowWindIndicator);

  // Auto-switch to properties tab and open on new selection
  useEffect(() => {
    if (hasSelection) {
      setActiveTab('properties');
    }
  }, [hasSelection, selectedObjectId, selectedWallIndex, selectedVertexIndex, selectedOpening]);

  const isVisible = hasSelection || isManuallyOpened;

  // The scene wind arrow follows the Airflow tab
  useEffect(() => {
    setShowWindIndicator(isVisible && activeTab === 'airflow');
    return () => setShowWindIndicator(false);
  }, [isVisible, activeTab, setShowWindIndicator]);

  // Selected Wall segment
  const selectedWallSegment = useMemo(() => {
    if (selectedWallIndex === null || selectedWallIndex < 0 || selectedWallIndex >= room.outline.length) {
      return null;
    }
    try {
      return wallSegment(room, selectedWallIndex);
    } catch {
      return null;
    }
  }, [room, selectedWallIndex]);

  // Selected Vertex
  const selectedVertex = useMemo(() => {
    if (selectedVertexIndex === null || selectedVertexIndex < 0 || selectedVertexIndex >= room.outline.length) {
      return null;
    }
    return room.outline[selectedVertexIndex] || null;
  }, [room.outline, selectedVertexIndex]);

  // Floor Area
  const roomAreaM2 = useMemo(() => {
    return Math.abs(signedArea(room.outline));
  }, [room.outline]);

  // Wall Anchor state for wall length resizing
  const [wallAnchor, setWallAnchor] = useState<LengthAnchor>('start');

  // Ventilation stats: inlet/outlet counts from the computed airflow direction, not the role tags
  const otherRooms = useSceneStore((state) => state.otherRooms);
  const ventilationStats = useMemo(() => {
    const v = computeVentilation(room, ventilationEnvFromRoom(room), { neighbours: otherRooms });
    const inletCount = v.openings.filter((o) => o.computedRole === 'inlet').length;
    const outletCount = v.openings.filter((o) => o.computedRole === 'outlet').length;
    const totalOpenArea = v.openings.filter((o) => !o.excluded).reduce((sum, o) => sum + o.effectiveArea, 0);
    return {
      inletCount,
      outletCount,
      totalOpenArea: Number(totalOpenArea.toFixed(2)),
      hasCrossVentilation: v.type === 'cross',
    };
  }, [room, otherRooms]);

  // Quick Shapes State
  const [quickShapeType, setQuickShapeType] = useState<QuickShapeType>('rectangle');
  const [quickDims, setQuickDims] = useState<QuickShapeDimensions>({
    width: 4.0,
    depth: 3.0,
    cutWidth: 2.0,
    cutDepth: 1.5,
    stemWidth: 2.5,
    stemDepth: 2.5,
  });

  // Snapshots
  const [snapName, setSnapName] = useState('');
  const { snapshots, loadSnapshots, saveSnapshot, restoreSnapshot, deleteSnapshot } = useSnapshotStore();
  useEffect(() => {
    loadSnapshots();
  }, [loadSnapshots]);

  return (
    <>
      {/* Floating Toggle Button when Inspector is collapsed and nothing is selected */}
      {!isVisible && (
        <button
          type="button"
        data-testid="open-room-inspector-btn"
        aria-label="Open Room Inspector"
          onClick={() => {
            setIsManuallyOpened(true);
            setActiveTab('room');
          }}
          className="fixed top-14 right-3 z-[15] h-8 px-2.5 rounded-[8px] bg-neutral-900/85 dark:bg-[#121826]/85 backdrop-blur-md border border-white/10 shadow-lg text-neutral-300 hover:text-white text-xs font-medium flex items-center gap-1.5 transition-colors"
          title="Open Room Inspector"
        >
          <Home size={14} strokeWidth={1.75} />
          <span>Room</span>
        </button>
      )}

      {/* Main Inspector Panel */}
      <aside
        data-testid="inspector-panel"
        className={`pointer-events-auto fixed top-14 right-3 z-[15] w-[300px] max-h-[calc(100vh-4.5rem)] bg-neutral-900/85 dark:bg-[#121826]/85 backdrop-blur-md border border-neutral-300/20 dark:border-white/10 rounded-[10px] shadow-2xl flex flex-col text-neutral-200 select-none text-xs transition-all duration-150 overflow-hidden ${
          isVisible
            ? 'translate-x-0 opacity-100'
            : 'translate-x-[calc(100%+24px)] opacity-0 pointer-events-none'
        } ${className}`}
      >
        {/* Header Tabs: Properties | Airflow | Room | Simulate */}
        <div className="flex items-center justify-between gap-1 px-2 pt-2 pb-1.5 border-b border-neutral-200/10 dark:border-white/10 bg-black/20 dark:bg-white/5">
          <div className="flex items-center gap-0.5 min-w-0">
            <button
              type="button"
              onClick={() => setActiveTab('properties')}
              className={`px-1.5 py-1 rounded-[6px] font-medium transition-colors flex items-center gap-1 text-[11px] whitespace-nowrap ${
                activeTab === 'properties'
                  ? 'bg-indigo-600 text-white font-semibold shadow-sm'
                  : 'text-neutral-400 hover:text-white hover:bg-white/5'
              }`}
            >
              <Sliders size={13} strokeWidth={1.75} />
              <span>Properties</span>
            </button>

            <button
              type="button"
              onClick={() => setActiveTab('airflow')}
              className={`px-1.5 py-1 rounded-[6px] font-medium transition-colors flex items-center gap-1 text-[11px] whitespace-nowrap ${
                activeTab === 'airflow'
                  ? 'bg-indigo-600 text-white font-semibold shadow-sm'
                  : 'text-neutral-400 hover:text-white hover:bg-white/5'
              }`}
            >
              <Wind size={13} strokeWidth={1.75} />
              <span>Airflow</span>
            </button>

            <button
              type="button"
              onClick={() => setActiveTab('room')}
              className={`px-1.5 py-1 rounded-[6px] font-medium transition-colors flex items-center gap-1 text-[11px] whitespace-nowrap ${
                activeTab === 'room'
                  ? 'bg-indigo-600 text-white font-semibold shadow-sm'
                  : 'text-neutral-400 hover:text-white hover:bg-white/5'
              }`}
            >
              <Home size={13} strokeWidth={1.75} />
              <span>Room</span>
            </button>

            <button
              type="button"
              data-testid="inspector-tab-simulation"
              onClick={() => setActiveTab('simulation')}
              className={`px-1.5 py-1 rounded-[6px] font-medium transition-colors flex items-center gap-1 text-[11px] whitespace-nowrap ${
                activeTab === 'simulation'
                  ? 'bg-indigo-600 text-white font-semibold shadow-sm'
                  : 'text-neutral-400 hover:text-white hover:bg-white/5'
              }`}
            >
              <Activity size={13} strokeWidth={1.75} />
              <span>Simulate</span>
            </button>
          </div>

          <Tooltip label="Close Inspector">
            <button
              type="button"
              aria-label="Close Inspector"
              onClick={() => {
                clearSelection();
                setSelectedWallIndex(null);
                setSelectedVertexIndex(null);
                setIsManuallyOpened(false);
              }}
              className="p-1 rounded-[4px] text-neutral-400 hover:text-white hover:bg-white/10 transition-colors"
            >
              <X size={15} strokeWidth={1.75} />
            </button>
          </Tooltip>
        </div>

        {/* Tab Contents */}
        <div className="flex-1 overflow-y-auto overflow-x-hidden p-3 flex flex-col gap-3">
          {/* ========================================================= */}
          {/* TAB 1: PROPERTIES                                         */}
          {/* ========================================================= */}
          {activeTab === 'properties' && (
            <>
              {/* CASE A: OBJECT SELECTED */}
              {selectedObject ? (
                <div className="flex flex-col gap-3 animate-in fade-in duration-100">
                  {/* Identity Header */}
                  <div className="flex items-center justify-between pb-1">
                    <div className="flex items-center gap-2">
                      <span className="w-2 h-2 rounded-full bg-emerald-400" />
                      <input
                        type="text"
                        data-testid="object-name-input"
                        value={selectedObject.name}
                        onChange={(e) => updateObject(selectedObject.id, { name: e.target.value })}
                        className="bg-transparent font-semibold text-white text-xs border-b border-transparent hover:border-white/20 focus:border-indigo-500 outline-none w-36 truncate"
                      />
                    </div>
                    <div className="flex items-center gap-1">
                      <Tooltip label={selectedObject.isLocked ? 'Unlock' : 'Lock'}>
                        <button
                          type="button"
                          onClick={() => updateObject(selectedObject.id, { isLocked: !selectedObject.isLocked })}
                          className={`p-1 rounded hover:bg-white/10 ${selectedObject.isLocked ? 'text-amber-400' : 'text-neutral-400'}`}
                        >
                          {selectedObject.isLocked ? <Lock size={13} /> : <Unlock size={13} />}
                        </button>
                      </Tooltip>
                      <Tooltip label={selectedObject.isHidden ? 'Unhide' : 'Hide'}>
                        <button
                          type="button"
                          onClick={() => updateObject(selectedObject.id, { isHidden: !selectedObject.isHidden })}
                          className={`p-1 rounded hover:bg-white/10 ${selectedObject.isHidden ? 'text-neutral-500' : 'text-neutral-400'}`}
                        >
                          {selectedObject.isHidden ? <EyeOff size={13} /> : <Eye size={13} />}
                        </button>
                      </Tooltip>
                      <Tooltip label="Deselect">
                        <button
                          type="button"
                          data-testid="deselect-object-btn"
                          onClick={clearSelection}
                          className="p-1 text-neutral-400 hover:text-white"
                        >
                          <X size={13} />
                        </button>
                      </Tooltip>
                    </div>
                  </div>

                  {/* Transform Section with Scrubbable Inputs */}
                  <CollapsibleSection title="Transform" defaultOpen={false} summary={`Position ${selectedObject.position.map((v) => v.toFixed(2)).join(', ')}`}>
                    <div className="flex flex-col gap-2">
                      <div className="text-[10px] text-neutral-400 font-semibold uppercase tracking-wider">
                        Position
                      </div>
                      <div className="grid grid-cols-3 gap-1.5">
                        <ScrubbableInput
                          label="X"
                          labelColor="text-red-400"
                          value={selectedObject.position[0]}
                          onChange={(val) =>
                            updateObject(selectedObject.id, {
                              position: [val, selectedObject.position[1], selectedObject.position[2]],
                            })
                          }
                          unit="m"
                        />
                        <ScrubbableInput
                          label="Y"
                          labelColor="text-emerald-400"
                          value={selectedObject.position[1] ?? 0}
                          onChange={(val) =>
                            updateObject(selectedObject.id, {
                              position: [selectedObject.position[0], val, selectedObject.position[2]],
                            })
                          }
                          unit="m"
                        />
                        <ScrubbableInput
                          label="Z"
                          labelColor="text-blue-400"
                          value={selectedObject.position[2]}
                          onChange={(val) =>
                            updateObject(selectedObject.id, {
                              position: [selectedObject.position[0], selectedObject.position[1], val],
                            })
                          }
                          unit="m"
                        />
                      </div>

                      <div className="text-[10px] text-neutral-400 font-semibold uppercase tracking-wider mt-1">
                        Dimensions
                      </div>
                      <div className="grid grid-cols-3 gap-1.5">
                        <ScrubbableInput
                          label="W"
                          min={0.05}
                          value={selectedObject.size[0]}
                          onChange={(val) =>
                            updateObject(selectedObject.id, {
                              size: [val, selectedObject.size[1], selectedObject.size[2]],
                            })
                          }
                          unit="m"
                        />
                        <ScrubbableInput
                          label="H"
                          min={0.05}
                          value={selectedObject.size[1]}
                          onChange={(val) =>
                            updateObject(selectedObject.id, {
                              size: [selectedObject.size[0], val, selectedObject.size[2]],
                            })
                          }
                          unit="m"
                        />
                        <ScrubbableInput
                          label="D"
                          min={0.05}
                          value={selectedObject.size[2]}
                          onChange={(val) =>
                            updateObject(selectedObject.id, {
                              size: [selectedObject.size[0], selectedObject.size[1], val],
                            })
                          }
                          unit="m"
                        />
                      </div>

                      <div className="grid grid-cols-2 gap-1.5 mt-1">
                        <ScrubbableInput
                          label="Rot"
                          step={15}
                          value={Math.round(radToDeg(selectedObject.rotation[1])) % 360}
                          onChange={(deg) =>
                            updateObject(selectedObject.id, {
                              rotation: [selectedObject.rotation[0], degToRad(deg), selectedObject.rotation[2]],
                            })
                          }
                          unit="°"
                        />
                        <ScrubbableInput
                          label="Elev"
                          step={0.05}
                          value={selectedObject.elevation ?? 0}
                          onChange={(val) => updateObject(selectedObject.id, { elevation: val })}
                          unit="m"
                        />
                      </div>
                    </div>
                  </CollapsibleSection>

                  {/* Simulation Role */}
                  <DeviceProperties object={selectedObject} />
                  <SourceProperties object={selectedObject} />

                  <CollapsibleSection title="Airflow Role" defaultOpen={false} summary={selectedObject.role}>
                    <Select
                      value={selectedObject.role}
                      onChange={(role) => updateObject(selectedObject.id, { role: role as any })}
                      options={[
                        { value: 'solid', label: 'Solid (Obstacle to Airflow)' },
                        { value: 'porous', label: 'Porous (Partial Resistance)' },
                        { value: 'source', label: 'Source (Fan / Purifier)' },
                        { value: 'none', label: 'None (Decor / No Effect)' },
                      ]}
                    />
                  </CollapsibleSection>

                  {/* Actions: Duplicate, Delete */}
                  <div className="flex gap-2 pt-1">
                    <button
                      type="button"
                      data-testid="duplicate-object-btn"
                      onClick={() => duplicateObject(selectedObject.id)}
                      className="flex-1 h-8 rounded-[6px] bg-black/20 dark:bg-white/5 hover:bg-white/10 border border-white/10 text-neutral-200 font-medium flex items-center justify-center gap-1.5 transition-colors"
                    >
                      <Copy size={13} />
                      <span>Duplicate</span>
                    </button>
                    <button
                      type="button"
                      data-testid="delete-object-btn"
                      onClick={() => removeObject(selectedObject.id)}
                      className="h-8 px-3 rounded-[6px] bg-red-950/40 hover:bg-red-900/60 border border-red-500/40 text-red-200 font-medium flex items-center justify-center gap-1.5 transition-colors"
                    >
                      <Trash2 size={13} />
                      <span>Delete</span>
                    </button>
                  </div>
                </div>
              ) : selectedWallIndex !== null && selectedWallSegment ? (
                /* CASE B: WALL SELECTED */
                <div className="flex flex-col gap-3 animate-in fade-in duration-100">
                  <div className="flex items-center justify-between pb-1">
                    <span className="font-semibold text-white">Wall #{selectedWallIndex}</span>
                    <button
                      type="button"
                      data-testid="deselect-wall-btn"
                      onClick={() => setSelectedWallIndex(null)}
                      className="p-1 text-neutral-400 hover:text-white"
                    >
                      <X size={14} />
                    </button>
                  </div>

                  <CollapsibleSection
                    title="Dimensions"
                    defaultOpen={false}
                    summary={`${selectedWallSegment.len.toFixed(2)} m`}
                  >
                    <ScrubbableInput
                      label="Length"
                      step={0.1}
                      min={0.5}
                      value={selectedWallSegment.len}
                      onChange={(len) => setWallLength(selectedWallIndex, len, wallAnchor)}
                      unit="m"
                    />

                    <div className="flex flex-col gap-1 mt-1">
                      <span className="text-[10px] text-neutral-400 uppercase font-semibold">
                        Resize Anchor
                      </span>
                      <div className="grid grid-cols-3 gap-1 bg-black/20 dark:bg-white/5 p-1 rounded-[6px] border border-white/10 text-[11px]">
                        {(['start', 'center', 'end'] as LengthAnchor[]).map((anchor) => (
                          <button
                            key={anchor}
                            type="button"
                            onClick={() => setWallAnchor(anchor)}
                            className={`py-0.5 rounded capitalize transition-colors ${
                              wallAnchor === anchor
                                ? 'bg-indigo-600 text-white font-medium'
                                : 'text-neutral-400 hover:text-white'
                            }`}
                          >
                            {anchor}
                          </button>
                        ))}
                      </div>
                    </div>
                  </CollapsibleSection>

                  <CollapsibleSection title="Operations" defaultOpen={false}>
                    <div className="flex flex-col gap-2">
                      <button
                        type="button"
                        data-testid="split-wall-btn"
                        onClick={() => splitWall(selectedWallIndex)}
                        className="h-8 rounded-[6px] bg-black/20 dark:bg-white/5 hover:bg-white/10 border border-white/10 text-neutral-200 font-medium flex items-center justify-center gap-1.5 transition-colors"
                      >
                        <Split size={14} />
                        <span>Split Wall in Half</span>
                      </button>

                      <button
                        type="button"
                        data-testid="extrude-wall-btn"
                        onClick={() => extrudeWall(selectedWallIndex, 1.5)}
                        className="h-8 rounded-[6px] bg-black/20 dark:bg-white/5 hover:bg-white/10 border border-white/10 text-neutral-200 font-medium flex items-center justify-center gap-1.5 transition-colors"
                      >
                        <Maximize2 size={14} />
                        <span>Extrude Wall (Push/Pull)</span>
                      </button>
                    </div>
                  </CollapsibleSection>
                </div>
              ) : selectedVertexIndex !== null && selectedVertex ? (
                /* CASE C: CORNER VERTEX SELECTED */
                <div className="flex flex-col gap-3 animate-in fade-in duration-100">
                  <div className="flex items-center justify-between pb-1">
                    <span className="font-semibold text-white">Corner #{selectedVertexIndex}</span>
                    <button
                      type="button"
                      data-testid="deselect-vertex-btn"
                      onClick={() => setSelectedVertexIndex(null)}
                      className="p-1 text-neutral-400 hover:text-white"
                    >
                      <X size={14} />
                    </button>
                  </div>

                  <CollapsibleSection title="Coordinates" defaultOpen={false} summary={selectedWallSegment ? `${selectedWallSegment.len.toFixed(2)} m wall` : undefined}>
                    <div className="grid grid-cols-2 gap-2">
                      <ScrubbableInput
                        label="X"
                        value={selectedVertex[0]}
                        onChange={(x) => {
                          const outline = [...room.outline];
                          outline[selectedVertexIndex] = [x, outline[selectedVertexIndex]![1]];
                          useSceneStore.getState().setOutline(outline);
                        }}
                        unit="m"
                      />
                      <ScrubbableInput
                        label="Z"
                        value={selectedVertex[1]}
                        onChange={(z) => {
                          const outline = [...room.outline];
                          outline[selectedVertexIndex] = [outline[selectedVertexIndex]![0], z];
                          useSceneStore.getState().setOutline(outline);
                        }}
                        unit="m"
                      />
                    </div>
                  </CollapsibleSection>

                  <CollapsibleSection title="Operations" defaultOpen={false}>
                    <button
                      type="button"
                      data-testid="merge-corner-btn"
                      onClick={() => mergeCorner(selectedVertexIndex)}
                      className="w-full h-8 rounded-[6px] bg-red-950/40 hover:bg-red-900/60 border border-red-500/40 text-red-200 font-medium flex items-center justify-center gap-1.5 transition-colors"
                    >
                      <Combine size={14} />
                      <span>Merge / Delete Corner</span>
                    </button>
                  </CollapsibleSection>
                </div>
              ) : selectedOpening ? (
                /* CASE D: OPENING SELECTED */
                <div className="flex flex-col gap-3 animate-in fade-in duration-100">
                  <div className="flex items-center justify-between pb-1">
                    <span className="font-semibold text-white capitalize">
                      {selectedOpening.type} ({selectedOpening.role})
                    </span>
                    <button
                      type="button"
                      onClick={() => selectOpening(null)}
                      className="p-1 text-neutral-400 hover:text-white"
                    >
                      <X size={14} />
                    </button>
                  </div>

                  <CollapsibleSection title="Geometry" defaultOpen={false} summary={`${room.outline.length} corners · ${roomAreaM2.toFixed(1)} m²`}>
                    <div className="flex flex-col gap-2">
                      <ScrubbableInput
                        label="Offset"
                        step={0.05}
                        min={0}
                        value={selectedOpening.offset}
                        onChange={(val) => updateOpening(selectedOpening.id, { offset: val })}
                        unit="m"
                      />
                      <div className="grid grid-cols-2 gap-2">
                        <ScrubbableInput
                          label="Width"
                          step={0.05}
                          min={0.3}
                          value={selectedOpening.width}
                          onChange={(val) => updateOpening(selectedOpening.id, { width: val })}
                          unit="m"
                        />
                        <ScrubbableInput
                          label="Height"
                          step={0.05}
                          min={0.3}
                          value={selectedOpening.height}
                          onChange={(val) => updateOpening(selectedOpening.id, { height: val })}
                          unit="m"
                        />
                      </div>
                      <ScrubbableInput
                        label="Sill H"
                        step={0.05}
                        min={0}
                        value={selectedOpening.sill}
                        onChange={(val) => updateOpening(selectedOpening.id, { sill: val })}
                        unit="m"
                      />
                    </div>
                  </CollapsibleSection>

                  <CollapsibleSection title="Ventilation" defaultOpen={false} summary={`${ventilationStats.inletCount} in · ${ventilationStats.outletCount} out`}>
                    <Select
                      value={selectedOpening.role}
                      onChange={(role) => updateOpening(selectedOpening.id, { role: role as any })}
                      options={[
                        { value: 'inlet', label: 'Inlet (Fresh Air Inflow)' },
                        { value: 'outlet', label: 'Outlet (Exhaust Outflow)' },
                        { value: 'closed', label: 'Closed (No Airflow)' },
                      ]}
                    />

                    <Slider
                      label="Open Fraction"
                      min={0}
                      max={1}
                      step={0.05}
                      value={selectedOpening.openFraction}
                      onChange={(val) => updateOpening(selectedOpening.id, { openFraction: val })}
                      unit="%"
                    />
                  </CollapsibleSection>

                  <div className="flex gap-2 pt-1">
                    <button
                      type="button"
                      onClick={() => duplicateOpening(selectedOpening.id)}
                      className="flex-1 h-8 rounded-[6px] bg-black/20 dark:bg-white/5 hover:bg-white/10 border border-white/10 text-neutral-200 font-medium flex items-center justify-center gap-1.5 transition-colors"
                    >
                      <Copy size={13} />
                      <span>Duplicate</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => removeOpening(selectedOpening.id)}
                      className="h-8 px-3 rounded-[6px] bg-red-950/40 hover:bg-red-900/60 border border-red-500/40 text-red-200 font-medium flex items-center justify-center gap-1.5 transition-colors"
                    >
                      <Trash2 size={13} />
                      <span>Delete</span>
                    </button>
                  </div>
                </div>
              ) : (
                /* No Selection Message */
                <div className="py-8 text-center text-neutral-400 flex flex-col items-center gap-2">
                  <Sliders size={24} className="text-neutral-500" />
                  <span className="text-xs">No item selected</span>
                  <span className="text-[11px] text-neutral-500 max-w-[200px]">
                    Click any object, wall, corner, or opening in the room to edit its properties.
                  </span>
                </div>
              )}
            </>
          )}

          {/* ========================================================= */}
          {/* TAB 2: AIRFLOW                                            */}
          {/* ========================================================= */}
          {activeTab === 'simulation' && <SimulationPanel visible={isVisible} />}

          {activeTab === 'airflow' && (
            <div className="flex flex-col gap-3 animate-in fade-in duration-100">
              {/* Ventilation Status Badge */}
              <div className="p-2.5 rounded-[8px] bg-black/20 dark:bg-white/5 border border-white/10 flex flex-col gap-2">
                <div className="flex items-center justify-between">
                  <span className="font-semibold text-white text-xs">Ventilation Balance</span>
                  <span
                    className={`px-2 py-0.5 rounded text-[10px] font-semibold ${
                      ventilationStats.hasCrossVentilation
                        ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/40'
                        : 'bg-amber-500/20 text-amber-400 border border-amber-500/40'
                    }`}
                  >
                    {ventilationStats.hasCrossVentilation ? 'Cross-Vent Active' : 'Single Sided'}
                  </span>
                </div>
                <div className="grid grid-cols-3 gap-1 text-center font-mono">
                  <div className="p-1.5 bg-black/20 rounded">
                    <span className="text-sky-400 font-bold block">{ventilationStats.inletCount}</span>
                    <span className="text-[9px] text-neutral-400">Inlets</span>
                  </div>
                  <div className="p-1.5 bg-black/20 rounded">
                    <span className="text-orange-400 font-bold block">{ventilationStats.outletCount}</span>
                    <span className="text-[9px] text-neutral-400">Outlets</span>
                  </div>
                  <div className="p-1.5 bg-black/20 rounded">
                    <span className="text-emerald-400 font-bold block">{ventilationStats.totalOpenArea}</span>
                    <span className="text-[9px] text-neutral-400">Area (m²)</span>
                  </div>
                </div>
              </div>

              {/* Wind Direction & Speed */}
              <CollapsibleSection title="External Wind" defaultOpen={false} summary={`${room.params.windSpeed.toFixed(1)} m/s · ${room.params.windDirDeg}°`}>
                <div className="flex items-center justify-around py-1">
                  <CompassWidget
                    degrees={room.params.windDirDeg}
                    onChange={(deg) => setParams({ windDirDeg: deg })}
                    onCommit={(deg) => setParams({ windDirDeg: deg })}
                  />
                  <div className="flex flex-col gap-2 w-32">
                    <ScrubbableInput
                      label="Speed"
                      step={0.5}
                      min={0}
                      max={25}
                      value={room.params.windSpeed}
                      onChange={(spd) => setParams({ windSpeed: spd })}
                      unit="m/s"
                    />
                    <ScrubbableInput
                      label="Dir"
                      step={15}
                      min={0}
                      max={360}
                      value={room.params.windDirDeg}
                      onChange={(deg) => setParams({ windDirDeg: deg })}
                      unit="°"
                    />
                  </div>
                </div>
              </CollapsibleSection>

              {/* Ambient Atmosphere */}
              <CollapsibleSection title="Ambient Atmosphere" defaultOpen={false} summary={`${room.params.indoorTempC.toFixed(1)}°C · ${room.params.humidity}% RH`}>
                <div className="flex flex-col gap-2">
                  <div className="grid grid-cols-2 gap-2">
                    <ScrubbableInput
                      label="Indoor T"
                      step={0.5}
                      value={room.params.indoorTempC}
                      onChange={(t) => setParams({ indoorTempC: t })}
                      unit="°C"
                    />
                    <ScrubbableInput
                      label="Outdoor T"
                      step={0.5}
                      value={room.params.outdoorTempC}
                      onChange={(t) => setParams({ outdoorTempC: t })}
                      unit="°C"
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <ScrubbableInput
                      label="Humidity"
                      step={1}
                      min={0}
                      max={100}
                      value={room.params.humidity}
                      onChange={(h) => setParams({ humidity: h })}
                      unit="%"
                    />
                    <ScrubbableInput
                      label="Pressure"
                      step={50}
                      min={80000}
                      max={120000}
                      value={room.params.pressurePa}
                      onChange={(p) => setParams({ pressurePa: p })}
                      unit="Pa"
                    />
                  </div>
                </div>
              </CollapsibleSection>

              {/* Pollutant Source */}
              <CollapsibleSection title="Pollutant Source" defaultOpen={false} summary={room.params.pollutantSource?.type ?? 'None'}>
                <Checkbox
                  checked={Boolean(room.params.pollutantSource)}
                  onChange={(checked) => {
                    if (checked) {
                      setParams({
                        pollutantSource: {
                          type: 'VOC',
                          emissionRateMgH: 15,
                          position: [0, 0, 0],
                        },
                      });
                    } else {
                      setParams({ pollutantSource: undefined });
                    }
                  }}
                  label="Enable Pollutant Source"
                />

                {room.params.pollutantSource && (
                  <div className="flex flex-col gap-2 pt-1">
                    <Select
                      label="Pollutant Type"
                      value={room.params.pollutantSource.type}
                      onChange={(type) =>
                        setParams({
                          pollutantSource: { ...room.params.pollutantSource!, type: type as any },
                        })
                      }
                      options={[
                        { value: 'VOC', label: 'Volatile Organics (VOC)' },
                        { value: 'CO2', label: 'Carbon Dioxide (CO2)' },
                        { value: 'PM2.5', label: 'Particulate (PM2.5)' },
                      ]}
                    />

                    <ScrubbableInput
                      label="Emission"
                      step={1}
                      min={1}
                      value={room.params.pollutantSource.emissionRateMgH}
                      onChange={(rate) =>
                        setParams({
                          pollutantSource: { ...room.params.pollutantSource!, emissionRateMgH: rate },
                        })
                      }
                      unit="mg/h"
                    />

                    <button
                      type="button"
                      data-testid="place-pollutant-source-btn"
                      onClick={() => {
                        setIsPlacingPollutantSource(!isPlacingPollutantSource);
                        setToastMessage(
                          !isPlacingPollutantSource
                            ? 'Click anywhere on the room floor to position pollutant source.'
                            : null
                        );
                      }}
                      className={`h-8 rounded-[6px] font-medium border transition-colors ${
                        isPlacingPollutantSource
                          ? 'bg-amber-600 border-amber-500 text-white'
                          : 'bg-black/20 dark:bg-white/5 border-white/10 text-neutral-300 hover:text-white'
                      }`}
                    >
                      {isPlacingPollutantSource ? 'Click Floor to Set' : 'Reposition on Floor'}
                    </button>
                  </div>
                )}
              </CollapsibleSection>
            </div>
          )}

          {/* ========================================================= */}
          {/* TAB 3: ROOM                                               */}
          {/* ========================================================= */}
          {activeTab === 'room' && (
            <div className="flex flex-col gap-3 animate-in fade-in duration-100">
              <OccupancyWeightField room={room} />
              {/* Room Dimensions & Height */}
              <CollapsibleSection title="Room Dimensions" defaultOpen={false} summary={`${room.name} · ${roomAreaM2.toFixed(1)} m²`}>
                <div className="flex flex-col gap-2">
                  <div className="flex flex-col gap-1">
                    <span className="text-[10px] text-neutral-400 font-semibold uppercase">Room Name</span>
                    <input
                      type="text"
                      data-testid="room-name-input"
                      value={room.name}
                      onChange={(e) => setRoomName(e.target.value)}
                      className="bg-black/20 dark:bg-white/5 border border-white/10 rounded-[6px] px-2 py-1 text-xs text-white outline-none focus:border-indigo-500 font-medium"
                    />
                  </div>

                  <div className="grid grid-cols-2 gap-2">
                    <ScrubbableInput
                      label="Wall H"
                      step={0.1}
                      min={1.8}
                      max={6.0}
                      value={room.wallHeight}
                      onChange={(h) => setWallHeight(h)}
                      unit="m"
                    />
                    <ScrubbableInput
                      label="Thick"
                      step={0.05}
                      min={0.1}
                      max={0.5}
                      value={room.wallThickness}
                      onChange={(t) => setWallThickness(t)}
                      unit="m"
                    />
                  </div>

                  <div className="flex items-center justify-between p-2 rounded-[6px] bg-black/20 dark:bg-white/5 border border-white/10 text-xs">
                    <span className="text-neutral-400">Floor Area:</span>
                    <span className="font-mono text-emerald-400 font-semibold">
                      {roomAreaM2.toFixed(1)} m² ({Math.round(roomAreaM2 * 10.764)} ft²)
                    </span>
                  </div>
                </div>
              </CollapsibleSection>

              {/* Quick Preset Shapes */}
              <CollapsibleSection title="Quick Preset Shapes" defaultOpen={false}>
                <div className="flex flex-col gap-2">
                  <div className="grid grid-cols-3 gap-1 bg-black/20 dark:bg-white/5 p-1 rounded-[6px] border border-white/10 text-[11px]">
                    {(['rectangle', 'l-shape', 't-shape'] as QuickShapeType[]).map((shape) => (
                      <button
                        key={shape}
                        type="button"
                        onClick={() => setQuickShapeType(shape)}
                        className={`py-1 rounded capitalize transition-colors ${
                          quickShapeType === shape
                            ? 'bg-indigo-600 text-white font-medium'
                            : 'text-neutral-400 hover:text-white'
                        }`}
                      >
                        {shape.replace('-', ' ')}
                      </button>
                    ))}
                  </div>

                  <div className="grid grid-cols-2 gap-2">
                    <ScrubbableInput
                      label="Width"
                      step={0.5}
                      min={2}
                      value={quickDims.width}
                      onChange={(w) => setQuickDims((d) => ({ ...d, width: w }))}
                      unit="m"
                    />
                    <ScrubbableInput
                      label="Depth"
                      step={0.5}
                      min={2}
                      value={quickDims.depth}
                      onChange={(d) => setQuickDims((dims) => ({ ...dims, depth: d }))}
                      unit="m"
                    />
                  </div>

                  <button
                    type="button"
                    onClick={() => {
                      if (confirm('Apply preset shape? Current room outline will be rebuilt.')) {
                        setQuickShape(quickShapeType, quickDims);
                      }
                    }}
                    className="h-8 rounded-[6px] bg-indigo-600 hover:bg-indigo-500 text-white font-medium transition-colors"
                  >
                    Apply Shape
                  </button>
                </div>
              </CollapsibleSection>

              {/* Scene Hierarchy / Outliner */}
              <CollapsibleSection title="Scene Hierarchy" defaultOpen={false} summary={`${room.objects.length} objects · ${room.openings.length} openings`}>
                <div className="flex flex-col gap-1 max-h-48 overflow-y-auto">
                  {/* Objects */}
                  <span className="text-[10px] text-neutral-400 uppercase font-semibold mt-1">
                    Objects ({room.objects.length})
                  </span>
                  {room.objects.map((obj) => (
                    <div
                      key={obj.id}
                      onClick={() => selectObject(obj.id)}
                      className={`flex items-center justify-between px-2 py-1 rounded-[4px] cursor-pointer transition-colors ${
                        selectedObjectId === obj.id
                          ? 'bg-indigo-600 text-white'
                          : 'bg-black/20 dark:bg-white/5 hover:bg-white/10 text-neutral-300'
                      }`}
                    >
                      <span className="truncate text-xs">{obj.name}</span>
                      <div className="flex items-center gap-1">
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            updateObject(obj.id, { isLocked: !obj.isLocked });
                          }}
                          className="p-0.5 text-neutral-400 hover:text-white"
                        >
                          {obj.isLocked ? <Lock size={12} className="text-amber-400" /> : <Unlock size={12} />}
                        </button>
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            updateObject(obj.id, { isHidden: !obj.isHidden });
                          }}
                          className="p-0.5 text-neutral-400 hover:text-white"
                        >
                          {obj.isHidden ? <EyeOff size={12} className="text-neutral-500" /> : <Eye size={12} />}
                        </button>
                      </div>
                    </div>
                  ))}

                  {/* Openings */}
                  <span className="text-[10px] text-neutral-400 uppercase font-semibold mt-2">
                    Openings ({room.openings.length})
                  </span>
                  {room.openings.map((op) => (
                    <div
                      key={op.id}
                      onClick={() => selectOpening(op.id)}
                      className="flex items-center justify-between px-2 py-1 rounded-[4px] cursor-pointer bg-black/20 dark:bg-white/5 hover:bg-white/10 text-neutral-300 transition-colors"
                    >
                      <span className="truncate text-xs capitalize">
                        {op.type} ({op.role})
                      </span>
                      <span className="text-[10px] text-neutral-500 font-mono">
                        {op.width}m × {op.height}m
                      </span>
                    </div>
                  ))}
                </div>
              </CollapsibleSection>

              {/* Versioned Snapshots */}
              <CollapsibleSection title="Snapshots & History" defaultOpen={false}>
                <div className="flex flex-col gap-2">
                  <div className="flex gap-1.5">
                    <input
                      type="text"
                      placeholder="Snapshot name..."
                      value={snapName}
                      onChange={(e) => setSnapName(e.target.value)}
                      className="flex-1 bg-black/20 dark:bg-white/5 border border-white/10 rounded-[6px] px-2 py-1 text-xs text-white outline-none focus:border-indigo-500"
                    />
                    <button
                      type="button"
                      onClick={() => {
                        if (snapName.trim()) {
                          saveSnapshot(snapName.trim());
                          setSnapName('');
                        }
                      }}
                      className="px-2.5 py-1 bg-indigo-600 hover:bg-indigo-500 text-white rounded-[6px] font-medium text-xs transition-colors"
                    >
                      Save
                    </button>
                  </div>
                  <div className="flex flex-col gap-1 max-h-36 overflow-y-auto">
                    {snapshots.length === 0 ? (
                      <span className="text-[11px] text-neutral-500 py-1">No saved snapshots yet</span>
                    ) : (
                      snapshots.map((snap) => (
                        <div
                          key={snap.id}
                          className="flex items-center justify-between p-1.5 rounded-[4px] bg-black/20 dark:bg-white/5 border border-white/5 text-xs"
                        >
                          <div className="flex flex-col truncate">
                            <span className="font-medium text-white truncate">{snap.name}</span>
                            <span className="text-[9px] text-neutral-500">
                              {new Date(snap.timestamp).toLocaleTimeString([], {
                                hour: '2-digit',
                                minute: '2-digit',
                              })}
                            </span>
                          </div>
                          <div className="flex items-center gap-1">
                            <button
                              type="button"
                              onClick={() => {
                                if (confirm(`Restore snapshot "${snap.name}"?`)) restoreSnapshot(snap.id);
                              }}
                              className="px-1.5 py-0.5 rounded bg-white/10 hover:bg-white/20 text-neutral-200 text-[10px]"
                            >
                              Restore
                            </button>
                            <button
                              type="button"
                              onClick={() => deleteSnapshot(snap.id)}
                              className="p-1 text-neutral-500 hover:text-red-400"
                            >
                              <X size={12} />
                            </button>
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              </CollapsibleSection>
            </div>
          )}
        </div>
      </aside>
    </>
  );
};

export default Inspector;
