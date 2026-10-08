import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSceneStore, useUiStore } from '../store';
import { RoomParamsSchema } from '../core/schema';
import { signedArea } from '../core/parser';
import { radToDeg, degToRad } from '../core/units';
import { z } from 'zod';
import type { RoomParams } from '../core/types';

export interface InspectorProps {
  className?: string;
}

/**
 * Interactive SVG Compass Dial for wind direction (0-360 deg)
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

    // Invert dy because SVG Y points down; 0° is North (top)
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
    e.currentTarget.releasePointerCapture(e.pointerId);
    const deg = calculateAngle(e.clientX, e.clientY);
    onCommit(deg);
  };

  return (
    <div className="flex flex-col items-center gap-1.5">
      <svg
        ref={svgRef}
        data-testid="wind-compass-widget"
        width={76}
        height={76}
        viewBox="-40 -40 80 80"
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        className="cursor-crosshair select-none bg-neutral-950/80 rounded-full border border-neutral-700/80 shadow-inner hover:border-sky-500/80 transition-colors"
      >
        {/* Outer Dial Circle */}
        <circle r={36} fill="none" stroke="#3f3f46" strokeWidth={1.5} />
        <circle r={28} fill="none" stroke="#27272a" strokeWidth={1} strokeDasharray="2,2" />

        {/* Cardinal Markers */}
        <text x={0} y={-23} textAnchor="middle" fill="#38bdf8" fontSize={9} fontWeight="bold">
          N
        </text>
        <text x={26} y={3} textAnchor="middle" fill="#a1a1aa" fontSize={8} fontWeight="bold">
          E
        </text>
        <text x={0} y={30} textAnchor="middle" fill="#a1a1aa" fontSize={8} fontWeight="bold">
          S
        </text>
        <text x={-26} y={3} textAnchor="middle" fill="#a1a1aa" fontSize={8} fontWeight="bold">
          W
        </text>

        {/* Rotating Wind Direction Indicator Needle */}
        <g transform={`rotate(${degrees})`}>
          {/* North/Inward arrow pointing towards room */}
          <polygon points="0,-33 -4,-12 4,-12" fill="#ef4444" />
          <polygon points="0,33 -3,12 3,12" fill="#71717a" />
          <circle r={3.5} fill="#ffffff" />
        </g>
      </svg>
      <span className="text-[11px] font-mono font-semibold text-sky-400">{degrees}°</span>
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
  const setRoomName = useSceneStore((state) => state.setRoomName);
  const setWallHeight = useSceneStore((state) => state.setWallHeight);
  const setWallThickness = useSceneStore((state) => state.setWallThickness);
  const setParams = useSceneStore((state) => state.setParams);

  const isPlacingPollutantSource = useUiStore((state) => state.isPlacingPollutantSource);
  const setIsPlacingPollutantSource = useUiStore((state) => state.setIsPlacingPollutantSource);

  // Selected object instance
  const selectedObject = useMemo(() => {
    return room.objects.find((o) => o.id === selectedObjectId) || null;
  }, [room.objects, selectedObjectId]);

  // Read-only Floor Area in m² and ft²
  const roomAreaM2 = useMemo(() => {
    return Math.abs(signedArea(room.outline));
  }, [room.outline]);
  const roomAreaFt2 = useMemo(() => {
    return roomAreaM2 * 10.7639;
  }, [roomAreaM2]);

  // -------------------------------------------------------------
  // ROOM & SIMULATION PARAMS DRAFT STATE (for Nothing Selected)
  // -------------------------------------------------------------
  const [draftRoomName, setDraftRoomName] = useState(room.name);
  const [draftWallHeight, setDraftWallHeight] = useState(room.wallHeight);
  const [draftWallThickness, setDraftWallThickness] = useState(room.wallThickness);
  const [draftParams, setDraftParams] = useState<RoomParams>({ ...room.params });
  const [paramErrors, setParamErrors] = useState<Record<string, string>>({});

  // Synchronize drafts when store changes externally (unless user actively editing)
  useEffect(() => {
    setDraftRoomName(room.name);
    setDraftWallHeight(room.wallHeight);
    setDraftWallThickness(room.wallThickness);
    setDraftParams({ ...room.params });
  }, [room.name, room.wallHeight, room.wallThickness, room.params]);

  // Validation function using Zod
  const validateField = useCallback((key: keyof RoomParams, value: unknown): boolean => {
    try {
      const fieldSchema = RoomParamsSchema.shape[key];
      fieldSchema.parse(value);
      setParamErrors((prev) => {
        const next = { ...prev };
        delete next[key];
        return next;
      });
      return true;
    } catch (err) {
      if (err instanceof z.ZodError) {
        const msg = err.errors[0]?.message || 'Invalid value';
        setParamErrors((prev) => ({ ...prev, [key]: msg }));
      }
      return false;
    }
  }, []);

  // Room Name commit
  const handleRoomNameBlur = () => {
    const trimmed = draftRoomName.trim();
    if (trimmed.length > 0) {
      setRoomName(trimmed);
      setParamErrors((prev) => {
        const next = { ...prev };
        delete next.roomName;
        return next;
      });
    } else {
      setParamErrors((prev) => ({ ...prev, roomName: 'Room name cannot be empty' }));
    }
  };

  // Wall Height commit
  const handleWallHeightCommit = (val: number) => {
    if (val >= 2.0 && val <= 6.0) {
      setWallHeight(val);
      setParamErrors((prev) => {
        const next = { ...prev };
        delete next.wallHeight;
        return next;
      });
    } else {
      setParamErrors((prev) => ({
        ...prev,
        wallHeight: 'Height must be between 2.0m and 6.0m',
      }));
    }
  };

  // Wall Thickness commit
  const handleWallThicknessCommit = (val: number) => {
    if (val >= 0.05 && val <= 0.5) {
      setWallThickness(val);
      setParamErrors((prev) => {
        const next = { ...prev };
        delete next.wallThickness;
        return next;
      });
    } else {
      setParamErrors((prev) => ({
        ...prev,
        wallThickness: 'Thickness must be between 0.05m and 0.50m',
      }));
    }
  };

  // Param commit helper
  const handleParamCommit = <K extends keyof RoomParams>(key: K, value: RoomParams[K]) => {
    if (validateField(key, value)) {
      setParams({ [key]: value });
    }
  };

  // Reset to default params
  const handleResetDefaults = () => {
    const defaults = RoomParamsSchema.parse({});
    setDraftParams(defaults);
    setParamErrors({});
    setParams(defaults);
  };

  // -------------------------------------------------------------
  // SELECTED OBJECT DRAFT STATE
  // -------------------------------------------------------------
  const [draftObjName, setDraftObjName] = useState('');
  const [draftPosX, setDraftPosX] = useState('0');
  const [draftPosY, setDraftPosY] = useState('0');
  const [draftPosZ, setDraftPosZ] = useState('0');
  const [draftRotY, setDraftRotY] = useState('0');
  const [draftScaleX, setDraftScaleX] = useState('1');
  const [draftScaleY, setDraftScaleY] = useState('1');
  const [draftScaleZ, setDraftScaleZ] = useState('1');
  const [draftElevation, setDraftElevation] = useState('0');
  const [draftAirflow, setDraftAirflow] = useState('0');
  const [lockAspect, setLockAspect] = useState(true);

  // Sync draft object state on object selection change
  useEffect(() => {
    if (selectedObject) {
      setDraftObjName(selectedObject.name);
      setDraftPosX(selectedObject.position[0].toFixed(2));
      setDraftPosY(selectedObject.position[1].toFixed(2));
      setDraftPosZ(selectedObject.position[2].toFixed(2));
      setDraftRotY(Math.round(radToDeg(selectedObject.rotation[1] || 0)).toString());
      setDraftScaleX((selectedObject.scale?.[0] ?? 1).toFixed(2));
      setDraftScaleY((selectedObject.scale?.[1] ?? 1).toFixed(2));
      setDraftScaleZ((selectedObject.scale?.[2] ?? 1).toFixed(2));
      setDraftElevation(selectedObject.elevation.toFixed(2));
      setDraftAirflow((selectedObject.defaultAirflow ?? 0).toString());
    }
  }, [selectedObject]);

  // Object position commit
  const commitObjectPosition = () => {
    if (!selectedObject) return;
    const x = parseFloat(draftPosX);
    const y = parseFloat(draftPosY);
    const z = parseFloat(draftPosZ);
    if (!isNaN(x) && !isNaN(y) && !isNaN(z)) {
      updateObject(selectedObject.id, { position: [x, y, z] });
    }
  };

  // Object rotation commit
  const commitObjectRotation = () => {
    if (!selectedObject) return;
    const deg = parseFloat(draftRotY);
    if (!isNaN(deg)) {
      const rad = degToRad(deg);
      updateObject(selectedObject.id, {
        rotation: [selectedObject.rotation[0], rad, selectedObject.rotation[2]],
      });
    }
  };

  // Object scale commit with aspect-ratio locking
  const commitObjectScale = (axis: 'x' | 'y' | 'z', newVal: number) => {
    if (!selectedObject || isNaN(newVal) || newVal <= 0) return;
    const currentScale = selectedObject.scale || [1, 1, 1];

    if (lockAspect) {
      const oldVal =
        axis === 'x' ? currentScale[0] : axis === 'y' ? currentScale[1] : currentScale[2];
      const ratio = newVal / (oldVal || 1);
      const nextScale: [number, number, number] = [
        Number((currentScale[0] * ratio).toFixed(2)),
        Number((currentScale[1] * ratio).toFixed(2)),
        Number((currentScale[2] * ratio).toFixed(2)),
      ];
      setDraftScaleX(nextScale[0].toFixed(2));
      setDraftScaleY(nextScale[1].toFixed(2));
      setDraftScaleZ(nextScale[2].toFixed(2));
      updateObject(selectedObject.id, { scale: nextScale });
    } else {
      const nextScale: [number, number, number] = [
        axis === 'x' ? newVal : currentScale[0],
        axis === 'y' ? newVal : currentScale[1],
        axis === 'z' ? newVal : currentScale[2],
      ];
      updateObject(selectedObject.id, { scale: nextScale });
    }
  };

  return (
    <aside
      data-testid="inspector-panel"
      className={`fixed top-14 right-3 bottom-3 w-80 bg-neutral-900/95 backdrop-blur-md border border-neutral-800 rounded-xl shadow-2xl z-20 flex flex-col overflow-hidden text-neutral-200 select-none text-xs ${className}`}
    >
      {/* ------------------------------------------------------------- */}
      {/* CASE A: OBJECT SELECTED                                       */}
      {/* ------------------------------------------------------------- */}
      {selectedObject ? (
        <div className="flex flex-col h-full overflow-y-auto p-4 gap-4">
          {/* Header */}
          <div className="flex items-center justify-between border-b border-neutral-800 pb-2.5">
            <div className="flex items-center gap-2">
              <span className="w-2.5 h-2.5 rounded-full bg-emerald-400" />
              <span className="font-semibold text-white text-sm">Object Inspector</span>
            </div>
            <button
              type="button"
              data-testid="deselect-object-btn"
              onClick={clearSelection}
              className="text-neutral-400 hover:text-white px-2 py-0.5 rounded hover:bg-neutral-800 transition-colors"
              title="Deselect object"
            >
              ✕
            </button>
          </div>

          {/* Name & Role */}
          <div className="flex flex-col gap-1.5">
            <label className="text-[11px] font-semibold text-neutral-400 uppercase tracking-wider">
              Asset Name
            </label>
            <input
              type="text"
              data-testid="object-name-input"
              value={draftObjName}
              onChange={(e) => setDraftObjName(e.target.value)}
              onBlur={() => {
                if (draftObjName.trim()) {
                  updateObject(selectedObject.id, { name: draftObjName.trim() });
                }
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.currentTarget.blur();
                }
              }}
              className="bg-neutral-800 border border-neutral-700 rounded-lg px-2.5 py-1.5 text-white font-medium focus:outline-none focus:border-sky-500"
            />
            <div className="flex items-center justify-between pt-1">
              <span className="text-[11px] text-neutral-400">Simulation Role:</span>
              <span className="px-2 py-0.5 bg-neutral-800 border border-neutral-700 rounded text-[11px] font-mono capitalize text-sky-400">
                {selectedObject.role}
              </span>
            </div>
          </div>

          {/* Position XYZ */}
          <div className="flex flex-col gap-1.5 bg-neutral-950/40 p-3 rounded-lg border border-neutral-800">
            <label className="text-[11px] font-semibold text-neutral-400 uppercase tracking-wider">
              Position (X, Y, Z meters)
            </label>
            <div className="grid grid-cols-3 gap-2">
              <div>
                <span className="text-[10px] text-red-400 font-bold block mb-0.5">X</span>
                <input
                  type="number"
                  data-testid="object-pos-x"
                  step="0.05"
                  value={draftPosX}
                  onChange={(e) => setDraftPosX(e.target.value)}
                  onBlur={commitObjectPosition}
                  onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
                  className="w-full bg-neutral-800 border border-neutral-700 rounded px-1.5 py-1 font-mono text-white text-xs"
                />
              </div>
              <div>
                <span className="text-[10px] text-emerald-400 font-bold block mb-0.5">Y (Up)</span>
                <input
                  type="number"
                  data-testid="object-pos-y"
                  step="0.05"
                  value={draftPosY}
                  onChange={(e) => setDraftPosY(e.target.value)}
                  onBlur={commitObjectPosition}
                  onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
                  className="w-full bg-neutral-800 border border-neutral-700 rounded px-1.5 py-1 font-mono text-white text-xs"
                />
              </div>
              <div>
                <span className="text-[10px] text-blue-400 font-bold block mb-0.5">Z</span>
                <input
                  type="number"
                  data-testid="object-pos-z"
                  step="0.05"
                  value={draftPosZ}
                  onChange={(e) => setDraftPosZ(e.target.value)}
                  onBlur={commitObjectPosition}
                  onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
                  className="w-full bg-neutral-800 border border-neutral-700 rounded px-1.5 py-1 font-mono text-white text-xs"
                />
              </div>
            </div>
          </div>

          {/* Rotation Y */}
          <div className="flex flex-col gap-1.5 bg-neutral-950/40 p-3 rounded-lg border border-neutral-800">
            <div className="flex items-center justify-between">
              <label className="text-[11px] font-semibold text-neutral-400 uppercase tracking-wider">
                Rotation Y
              </label>
              <span className="font-mono text-sky-400">{draftRotY}°</span>
            </div>
            <input
              type="range"
              min="0"
              max="360"
              step="5"
              value={draftRotY}
              onChange={(e) => setDraftRotY(e.target.value)}
              onMouseUp={commitObjectRotation}
              onTouchEnd={commitObjectRotation}
              className="w-full h-1.5 bg-neutral-700 rounded-lg appearance-none cursor-pointer accent-sky-500"
            />
            <input
              type="number"
              data-testid="object-rot-y"
              value={draftRotY}
              onChange={(e) => setDraftRotY(e.target.value)}
              onBlur={commitObjectRotation}
              onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
              className="bg-neutral-800 border border-neutral-700 rounded px-2 py-1 font-mono text-white text-xs mt-1"
            />
          </div>

          {/* Scale XYZ with Lock Aspect Ratio */}
          <div className="flex flex-col gap-1.5 bg-neutral-950/40 p-3 rounded-lg border border-neutral-800">
            <div className="flex items-center justify-between">
              <label className="text-[11px] font-semibold text-neutral-400 uppercase tracking-wider">
                Scale Multiplier
              </label>
              <button
                type="button"
                data-testid="scale-aspect-lock-btn"
                onClick={() => setLockAspect(!lockAspect)}
                className={`px-1.5 py-0.5 rounded text-[10px] font-medium border transition-colors ${
                  lockAspect
                    ? 'bg-sky-950 border-sky-600 text-sky-300'
                    : 'bg-neutral-800 border-neutral-700 text-neutral-400'
                }`}
                title={lockAspect ? 'Aspect ratio locked' : 'Aspect ratio unlocked'}
              >
                {lockAspect ? '🔒 Locked' : '🔓 Free'}
              </button>
            </div>
            <div className="grid grid-cols-3 gap-2">
              <div>
                <span className="text-[10px] text-neutral-400 block mb-0.5">Scale X</span>
                <input
                  type="number"
                  data-testid="object-scale-x"
                  step="0.05"
                  min="0.1"
                  value={draftScaleX}
                  onChange={(e) => setDraftScaleX(e.target.value)}
                  onBlur={() => commitObjectScale('x', parseFloat(draftScaleX))}
                  onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
                  className="w-full bg-neutral-800 border border-neutral-700 rounded px-1.5 py-1 font-mono text-white text-xs"
                />
              </div>
              <div>
                <span className="text-[10px] text-neutral-400 block mb-0.5">Scale Y</span>
                <input
                  type="number"
                  data-testid="object-scale-y"
                  step="0.05"
                  min="0.1"
                  value={draftScaleY}
                  onChange={(e) => setDraftScaleY(e.target.value)}
                  onBlur={() => commitObjectScale('y', parseFloat(draftScaleY))}
                  onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
                  className="w-full bg-neutral-800 border border-neutral-700 rounded px-1.5 py-1 font-mono text-white text-xs"
                />
              </div>
              <div>
                <span className="text-[10px] text-neutral-400 block mb-0.5">Scale Z</span>
                <input
                  type="number"
                  data-testid="object-scale-z"
                  step="0.05"
                  min="0.1"
                  value={draftScaleZ}
                  onChange={(e) => setDraftScaleZ(e.target.value)}
                  onBlur={() => commitObjectScale('z', parseFloat(draftScaleZ))}
                  onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
                  className="w-full bg-neutral-800 border border-neutral-700 rounded px-1.5 py-1 font-mono text-white text-xs"
                />
              </div>
            </div>
          </div>

          {/* Elevation */}
          <div className="flex items-center justify-between bg-neutral-950/40 p-3 rounded-lg border border-neutral-800">
            <label className="text-[11px] font-semibold text-neutral-400 uppercase tracking-wider">
              Elevation (m)
            </label>
            <input
              type="number"
              data-testid="object-elevation-input"
              step="0.05"
              min="0"
              value={draftElevation}
              onChange={(e) => setDraftElevation(e.target.value)}
              onBlur={() => {
                const elev = parseFloat(draftElevation);
                if (!isNaN(elev) && elev >= 0) {
                  updateObject(selectedObject.id, { elevation: elev });
                }
              }}
              onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
              className="w-24 bg-neutral-800 border border-neutral-700 rounded px-2 py-1 font-mono text-white text-xs text-right"
            />
          </div>

          {/* Airflow Speed (for source or appliance items) */}
          {(selectedObject.role === 'source' || selectedObject.defaultAirflow !== undefined) && (
            <div className="flex items-center justify-between bg-neutral-950/40 p-3 rounded-lg border border-neutral-800">
              <label className="text-[11px] font-semibold text-neutral-400 uppercase tracking-wider">
                Airflow (m³/h)
              </label>
              <input
                type="number"
                data-testid="object-airflow-input"
                step="25"
                min="0"
                value={draftAirflow}
                onChange={(e) => setDraftAirflow(e.target.value)}
                onBlur={() => {
                  const flow = parseFloat(draftAirflow);
                  if (!isNaN(flow) && flow >= 0) {
                    updateObject(selectedObject.id, { defaultAirflow: flow });
                  }
                }}
                onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
                className="w-24 bg-neutral-800 border border-neutral-700 rounded px-2 py-1 font-mono text-sky-400 text-xs text-right font-bold"
              />
            </div>
          )}

          {/* Action Buttons: Duplicate & Delete */}
          <div className="grid grid-cols-2 gap-2 pt-2 border-t border-neutral-800 mt-auto">
            <button
              type="button"
              data-testid="duplicate-object-btn"
              onClick={() => duplicateObject(selectedObject.id)}
              className="py-2 px-3 rounded-lg bg-neutral-800 hover:bg-neutral-700 text-neutral-200 font-medium border border-neutral-700 transition-colors"
            >
              Duplicate (Shift+D)
            </button>
            <button
              type="button"
              data-testid="delete-object-btn"
              onClick={() => removeObject(selectedObject.id)}
              className="py-2 px-3 rounded-lg bg-red-950/60 hover:bg-red-900 border border-red-800/80 text-red-200 font-medium transition-colors"
            >
              Delete (Del)
            </button>
          </div>
        </div>
      ) : (
        /* ------------------------------------------------------------- */
        /* CASE B: NOTHING SELECTED (ROOM & SIMULATION PARAMS)           */
        /* ------------------------------------------------------------- */
        <div className="flex flex-col h-full overflow-y-auto p-4 gap-4">
          {/* Header */}
          <div className="flex items-center justify-between border-b border-neutral-800 pb-2.5">
            <div className="flex items-center gap-2">
              <span className="w-2.5 h-2.5 rounded-full bg-sky-400" />
              <span className="font-semibold text-white text-sm">Room & Simulation</span>
            </div>
            <button
              type="button"
              data-testid="reset-params-btn"
              onClick={handleResetDefaults}
              className="text-[11px] text-sky-400 hover:text-sky-300 font-medium hover:underline"
            >
              Reset to Defaults
            </button>
          </div>

          {/* Room Name */}
          <div className="flex flex-col gap-1">
            <label className="text-[11px] font-semibold text-neutral-400 uppercase tracking-wider">
              Room Name
            </label>
            <input
              type="text"
              data-testid="room-name-input"
              value={draftRoomName}
              onChange={(e) => setDraftRoomName(e.target.value)}
              onBlur={handleRoomNameBlur}
              onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
              className="bg-neutral-800 border border-neutral-700 rounded-lg px-2.5 py-1.5 text-white font-medium focus:outline-none focus:border-sky-500"
            />
            {paramErrors.roomName && (
              <span data-testid="room-name-error" className="text-[11px] text-red-400 font-medium">
                {paramErrors.roomName}
              </span>
            )}
          </div>

          {/* Wall Height Slider & Input */}
          <div className="flex flex-col gap-1.5 bg-neutral-950/40 p-3 rounded-lg border border-neutral-800">
            <div className="flex items-center justify-between">
              <label className="text-[11px] font-semibold text-neutral-400 uppercase tracking-wider">
                Wall Height
              </label>
              <div className="flex items-center gap-1 font-mono text-sky-400">
                <input
                  type="number"
                  data-testid="wall-height-input"
                  step="0.05"
                  min="2.0"
                  max="6.0"
                  value={draftWallHeight}
                  onChange={(e) => {
                    const val = parseFloat(e.target.value);
                    setDraftWallHeight(val);
                  }}
                  onBlur={() => handleWallHeightCommit(draftWallHeight)}
                  onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
                  className="w-16 bg-neutral-800 border border-neutral-700 rounded px-1.5 py-0.5 text-right text-xs"
                />
                <span>m</span>
              </div>
            </div>
            <input
              type="range"
              min="2.0"
              max="6.0"
              step="0.05"
              value={draftWallHeight}
              onChange={(e) => {
                const val = parseFloat(e.target.value);
                setDraftWallHeight(val);
                handleWallHeightCommit(val);
              }}
              className="w-full h-1.5 bg-neutral-700 rounded-lg appearance-none cursor-pointer accent-sky-500"
            />
            {paramErrors.wallHeight && (
              <span data-testid="wall-height-error" className="text-[11px] text-red-400">
                {paramErrors.wallHeight}
              </span>
            )}
          </div>

          {/* Wall Thickness Slider & Input */}
          <div className="flex flex-col gap-1.5 bg-neutral-950/40 p-3 rounded-lg border border-neutral-800">
            <div className="flex items-center justify-between">
              <label className="text-[11px] font-semibold text-neutral-400 uppercase tracking-wider">
                Wall Thickness
              </label>
              <div className="flex items-center gap-1 font-mono text-sky-400">
                <input
                  type="number"
                  data-testid="wall-thickness-input"
                  step="0.01"
                  min="0.05"
                  max="0.5"
                  value={draftWallThickness}
                  onChange={(e) => setDraftWallThickness(parseFloat(e.target.value))}
                  onBlur={() => handleWallThicknessCommit(draftWallThickness)}
                  onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
                  className="w-16 bg-neutral-800 border border-neutral-700 rounded px-1.5 py-0.5 text-right text-xs"
                />
                <span>m</span>
              </div>
            </div>
            <input
              type="range"
              min="0.05"
              max="0.5"
              step="0.01"
              value={draftWallThickness}
              onChange={(e) => {
                const val = parseFloat(e.target.value);
                setDraftWallThickness(val);
                handleWallThicknessCommit(val);
              }}
              className="w-full h-1.5 bg-neutral-700 rounded-lg appearance-none cursor-pointer accent-sky-500"
            />
            {paramErrors.wallThickness && (
              <span data-testid="wall-thickness-error" className="text-[11px] text-red-400">
                {paramErrors.wallThickness}
              </span>
            )}
          </div>

          {/* Floor Area (Read-only) */}
          <div className="flex items-center justify-between bg-neutral-950/40 p-3 rounded-lg border border-neutral-800">
            <span className="text-[11px] font-semibold text-neutral-400 uppercase tracking-wider">
              Floor Area
            </span>
            <div className="text-right">
              <div className="font-mono font-bold text-emerald-400">{roomAreaM2.toFixed(2)} m²</div>
              <div className="text-[10px] text-neutral-400 font-mono">
                {roomAreaFt2.toFixed(1)} ft²
              </div>
            </div>
          </div>

          {/* SECTION: SIMULATION PARAMS */}
          <div className="pt-2 border-t border-neutral-800 flex flex-col gap-3">
            <span className="text-[11px] font-bold text-sky-400 uppercase tracking-wider">
              Environmental Parameters
            </span>

            {/* Wind Direction & Compass Widget */}
            <div className="flex flex-col gap-2 bg-neutral-950/40 p-3 rounded-lg border border-neutral-800">
              <div className="flex items-center justify-between">
                <label className="text-[11px] font-semibold text-neutral-400 uppercase tracking-wider">
                  Wind Direction
                </label>
                <div className="flex items-center gap-1 font-mono text-sky-400">
                  <input
                    type="number"
                    data-testid="param-wind-dir-input"
                    min="0"
                    max="360"
                    value={draftParams.windDirDeg}
                    onChange={(e) => {
                      const deg = parseInt(e.target.value, 10) || 0;
                      setDraftParams((prev) => ({ ...prev, windDirDeg: deg }));
                      handleParamCommit('windDirDeg', deg);
                    }}
                    className="w-14 bg-neutral-800 border border-neutral-700 rounded px-1.5 py-0.5 text-right text-xs"
                  />
                  <span>°</span>
                </div>
              </div>
              <CompassWidget
                degrees={draftParams.windDirDeg}
                onChange={(deg) => setDraftParams((prev) => ({ ...prev, windDirDeg: deg }))}
                onCommit={(deg) => handleParamCommit('windDirDeg', deg)}
              />
              {paramErrors.windDirDeg && (
                <span data-testid="param-wind-dir-error" className="text-[11px] text-red-400">
                  {paramErrors.windDirDeg}
                </span>
              )}
            </div>

            {/* Wind Speed (m/s) */}
            <div className="flex items-center justify-between bg-neutral-950/40 p-3 rounded-lg border border-neutral-800">
              <label className="text-[11px] font-semibold text-neutral-400 uppercase tracking-wider">
                Wind Speed (m/s)
              </label>
              <input
                type="number"
                data-testid="param-wind-speed-input"
                step="0.1"
                min="0"
                value={draftParams.windSpeed}
                onChange={(e) => {
                  const val = parseFloat(e.target.value);
                  setDraftParams((prev) => ({ ...prev, windSpeed: val }));
                  handleParamCommit('windSpeed', val);
                }}
                className="w-20 bg-neutral-800 border border-neutral-700 rounded px-2 py-1 font-mono text-white text-xs text-right"
              />
            </div>
            {paramErrors.windSpeed && (
              <span data-testid="param-wind-speed-error" className="text-[11px] text-red-400">
                {paramErrors.windSpeed}
              </span>
            )}

            {/* Pressure (Pa) */}
            <div className="flex items-center justify-between bg-neutral-950/40 p-3 rounded-lg border border-neutral-800">
              <label className="text-[11px] font-semibold text-neutral-400 uppercase tracking-wider">
                Pressure (Pa)
              </label>
              <input
                type="number"
                data-testid="param-pressure-input"
                step="100"
                value={draftParams.pressurePa}
                onChange={(e) => {
                  const val = parseFloat(e.target.value);
                  setDraftParams((prev) => ({ ...prev, pressurePa: val }));
                  handleParamCommit('pressurePa', val);
                }}
                className="w-24 bg-neutral-800 border border-neutral-700 rounded px-2 py-1 font-mono text-white text-xs text-right"
              />
            </div>
            {paramErrors.pressurePa && (
              <span data-testid="param-pressure-error" className="text-[11px] text-red-400">
                {paramErrors.pressurePa}
              </span>
            )}

            {/* Indoor & Outdoor Temp */}
            <div className="grid grid-cols-2 gap-2">
              <div className="bg-neutral-950/40 p-2.5 rounded-lg border border-neutral-800">
                <span className="text-[10px] text-neutral-400 block mb-1">Indoor Temp (°C)</span>
                <input
                  type="number"
                  data-testid="param-indoor-temp-input"
                  step="0.5"
                  value={draftParams.indoorTempC}
                  onChange={(e) => {
                    const val = parseFloat(e.target.value);
                    setDraftParams((prev) => ({ ...prev, indoorTempC: val }));
                    handleParamCommit('indoorTempC', val);
                  }}
                  className="w-full bg-neutral-800 border border-neutral-700 rounded px-1.5 py-1 font-mono text-white text-xs text-right"
                />
              </div>
              <div className="bg-neutral-950/40 p-2.5 rounded-lg border border-neutral-800">
                <span className="text-[10px] text-neutral-400 block mb-1">Outdoor Temp (°C)</span>
                <input
                  type="number"
                  data-testid="param-outdoor-temp-input"
                  step="0.5"
                  value={draftParams.outdoorTempC}
                  onChange={(e) => {
                    const val = parseFloat(e.target.value);
                    setDraftParams((prev) => ({ ...prev, outdoorTempC: val }));
                    handleParamCommit('outdoorTempC', val);
                  }}
                  className="w-full bg-neutral-800 border border-neutral-700 rounded px-1.5 py-1 font-mono text-white text-xs text-right"
                />
              </div>
            </div>

            {/* Humidity (%) */}
            <div className="flex items-center justify-between bg-neutral-950/40 p-3 rounded-lg border border-neutral-800">
              <label className="text-[11px] font-semibold text-neutral-400 uppercase tracking-wider">
                Relative Humidity (%)
              </label>
              <input
                type="number"
                data-testid="param-humidity-input"
                min="0"
                max="100"
                step="1"
                value={draftParams.humidity}
                onChange={(e) => {
                  const val = parseFloat(e.target.value);
                  setDraftParams((prev) => ({ ...prev, humidity: val }));
                  handleParamCommit('humidity', val);
                }}
                className="w-20 bg-neutral-800 border border-neutral-700 rounded px-2 py-1 font-mono text-white text-xs text-right"
              />
            </div>
            {paramErrors.humidity && (
              <span data-testid="param-humidity-error" className="text-[11px] text-red-400">
                {paramErrors.humidity}
              </span>
            )}

            {/* Date-Time Picker */}
            <div className="flex flex-col gap-1 bg-neutral-950/40 p-3 rounded-lg border border-neutral-800">
              <label className="text-[11px] font-semibold text-neutral-400 uppercase tracking-wider">
                Simulation Date & Time
              </label>
              <input
                type="datetime-local"
                data-testid="param-datetime-input"
                value={draftParams.datetime ? draftParams.datetime.slice(0, 16) : ''}
                onChange={(e) => {
                  const iso = new Date(e.target.value).toISOString();
                  setDraftParams((prev) => ({ ...prev, datetime: iso }));
                  handleParamCommit('datetime', iso);
                }}
                className="bg-neutral-800 border border-neutral-700 rounded px-2 py-1 font-mono text-white text-xs"
              />
            </div>

            {/* Pollutant Source Toggle & Click-to-Place */}
            <div className="flex flex-col gap-2 bg-neutral-950/40 p-3 rounded-lg border border-neutral-800">
              <div className="flex items-center justify-between">
                <label className="text-[11px] font-semibold text-neutral-400 uppercase tracking-wider">
                  Pollutant Source (VOC)
                </label>
                <input
                  type="checkbox"
                  data-testid="pollutant-source-toggle"
                  checked={Boolean(draftParams.pollutantSource)}
                  onChange={(e) => {
                    const checked = e.target.checked;
                    if (checked) {
                      const newSource = {
                        type: 'VOC',
                        emissionRateMgH: 10,
                        position: [0, 0, 0] as [number, number, number],
                      };
                      setDraftParams((prev) => ({ ...prev, pollutantSource: newSource }));
                      setParams({ pollutantSource: newSource });
                    } else {
                      setDraftParams((prev) => ({ ...prev, pollutantSource: undefined }));
                      setParams({ pollutantSource: undefined });
                      setIsPlacingPollutantSource(false);
                    }
                  }}
                  className="w-4 h-4 rounded accent-sky-500 cursor-pointer"
                />
              </div>

              {draftParams.pollutantSource && (
                <div className="flex flex-col gap-2 pt-1 border-t border-neutral-800/80">
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] text-neutral-400">Emission (mg/h):</span>
                    <input
                      type="number"
                      data-testid="pollutant-emission-rate-input"
                      step="1"
                      min="0"
                      value={draftParams.pollutantSource.emissionRateMgH}
                      onChange={(e) => {
                        const rate = parseFloat(e.target.value) || 0;
                        const updated = {
                          ...draftParams.pollutantSource!,
                          emissionRateMgH: rate,
                        };
                        setDraftParams((prev) => ({ ...prev, pollutantSource: updated }));
                        setParams({ pollutantSource: updated });
                      }}
                      className="w-20 bg-neutral-800 border border-neutral-700 rounded px-1.5 py-0.5 text-right font-mono text-xs"
                    />
                  </div>
                  {draftParams.pollutantSource.position && (
                    <div className="flex items-center justify-between text-[10px] text-neutral-400 font-mono">
                      <span>Coords:</span>
                      <span className="text-pink-400">
                        [{draftParams.pollutantSource.position[0]},{' '}
                        {draftParams.pollutantSource.position[2]}] m
                      </span>
                    </div>
                  )}
                  <button
                    type="button"
                    data-testid="place-pollutant-source-btn"
                    onClick={() => setIsPlacingPollutantSource(!isPlacingPollutantSource)}
                    className={`py-1 px-2 rounded text-xs font-semibold transition-all ${
                      isPlacingPollutantSource
                        ? 'bg-pink-600 text-white animate-pulse'
                        : 'bg-neutral-800 hover:bg-neutral-700 text-neutral-300 border border-neutral-700'
                    }`}
                  >
                    {isPlacingPollutantSource
                      ? '📍 Click floor to place...'
                      : 'Click to Place Source'}
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </aside>
  );
};

export default Inspector;
