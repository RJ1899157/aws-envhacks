import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSceneStore, useUiStore } from '../store';
import { useGraphicsStore } from '../store/graphicsStore';
import { RoomParamsSchema } from '../core/schema';
import { signedArea, polygonBounds, wallSegment } from '../core/parser';
import { radToDeg, degToRad } from '../core/units';
import { getCatalogAsset } from '../core/catalog';
import type { LengthAnchor } from '../core/wallOperations';
import type { QuickShapeType, QuickShapeDimensions } from '../core/quickShapes';
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
  const setWallOverride = useSceneStore((state) => state.setWallOverride);
  const setWallLength = useSceneStore((state) => state.setWallLength);
  const splitWall = useSceneStore((state) => state.splitWall);
  const extrudeWall = useSceneStore((state) => state.extrudeWall);
  const mergeCorner = useSceneStore((state) => state.mergeCorner);
  const moveRoom = useSceneStore((state) => state.moveRoom);
  const scaleRoom = useSceneStore((state) => state.scaleRoom);
  const setQuickShape = useSceneStore((state) => state.setQuickShape);
  const selectOpening = useSceneStore((state) => state.selectOpening);

  const selectedWallIndex = useUiStore((state) => state.selectedWallIndex);
  const setSelectedWallIndex = useUiStore((state) => state.setSelectedWallIndex);
  const selectedVertexIndex = useUiStore((state) => state.selectedVertexIndex);
  const setSelectedVertexIndex = useUiStore((state) => state.setSelectedVertexIndex);
  const setToastMessage = useUiStore((state) => state.setToastMessage);

  const isPlacingPollutantSource = useUiStore((state) => state.isPlacingPollutantSource);
  const setIsPlacingPollutantSource = useUiStore((state) => state.setIsPlacingPollutantSource);
  const showScaleReference = useUiStore((state) => state.showScaleReference);
  const toggleScaleReference = useUiStore((state) => state.toggleScaleReference);

  const quality = useGraphicsStore((state) => state.quality);
  const setQuality = useGraphicsStore((state) => state.setQuality);
  const theme = useGraphicsStore((state) => state.theme);
  const setTheme = useGraphicsStore((state) => state.setTheme);
  const wallOpacityMode = useGraphicsStore((state) => state.wallOpacityMode);
  const setWallOpacityMode = useGraphicsStore((state) => state.setWallOpacityMode);
  const setFloorMaterial = useSceneStore((state) => state.setFloorMaterial);
  const setWallMaterial = useSceneStore((state) => state.setWallMaterial);

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
  const [draftRealWidth, setDraftRealWidth] = useState('1');
  const [draftRealHeight, setDraftRealHeight] = useState('1');
  const [draftRealDepth, setDraftRealDepth] = useState('1');
  const [draftElevation, setDraftElevation] = useState('0');
  const [draftAirflow, setDraftAirflow] = useState('0');
  const [lockAspect, setLockAspect] = useState(true);

  // Selected asset catalog definition
  const selectedCatalogAsset = useMemo(() => {
    return selectedObject ? getCatalogAsset(selectedObject.assetId) : undefined;
  }, [selectedObject]);

  // Sync draft object state on object selection change
  useEffect(() => {
    if (selectedObject) {
      setDraftObjName(selectedObject.name);
      setDraftPosX(selectedObject.position[0].toFixed(2));
      setDraftPosY(selectedObject.position[1].toFixed(2));
      setDraftPosZ(selectedObject.position[2].toFixed(2));
      setDraftRotY(Math.round(radToDeg(selectedObject.rotation[1] || 0)).toString());
      const sx = selectedObject.scale?.[0] ?? 1;
      const sy = selectedObject.scale?.[1] ?? 1;
      const sz = selectedObject.scale?.[2] ?? 1;
      setDraftScaleX(sx.toFixed(2));
      setDraftScaleY(sy.toFixed(2));
      setDraftScaleZ(sz.toFixed(2));
      setDraftElevation(selectedObject.elevation.toFixed(2));
      setDraftAirflow((selectedObject.defaultAirflow ?? 0).toString());

      const base = selectedCatalogAsset?.size ?? selectedObject.size;
      setDraftRealWidth((base[0] * sx).toFixed(2));
      setDraftRealHeight((base[1] * sy).toFixed(2));
      setDraftRealDepth((base[2] * sz).toFixed(2));
    }
  }, [selectedObject, selectedCatalogAsset]);

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

  // Commit real-world size directly and back-compute the multiplier
  const commitTargetSize = (axis: 'width' | 'height' | 'depth', targetVal: number) => {
    if (!selectedObject || isNaN(targetVal) || targetVal <= 0) return;
    const base = selectedCatalogAsset?.size ?? selectedObject.size;
    const currentScale = selectedObject.scale || [1, 1, 1];
    const axisIdx = axis === 'width' ? 0 : axis === 'height' ? 1 : 2;
    const baseDim = base[axisIdx];
    if (!baseDim || baseDim <= 0) return;

    const newScaleForAxis = Number((targetVal / baseDim).toFixed(4));

    if (lockAspect) {
      const oldScale = currentScale[axisIdx] || 1;
      const ratio = newScaleForAxis / oldScale;
      const nextScale: [number, number, number] = [
        Number((currentScale[0] * ratio).toFixed(3)),
        Number((currentScale[1] * ratio).toFixed(3)),
        Number((currentScale[2] * ratio).toFixed(3)),
      ];
      setDraftScaleX(nextScale[0].toFixed(2));
      setDraftScaleY(nextScale[1].toFixed(2));
      setDraftScaleZ(nextScale[2].toFixed(2));
      setDraftRealWidth((base[0] * nextScale[0]).toFixed(2));
      setDraftRealHeight((base[1] * nextScale[1]).toFixed(2));
      setDraftRealDepth((base[2] * nextScale[2]).toFixed(2));
      updateObject(selectedObject.id, { scale: nextScale });
    } else {
      const nextScale: [number, number, number] = [
        axis === 'width' ? newScaleForAxis : currentScale[0],
        axis === 'height' ? newScaleForAxis : currentScale[1],
        axis === 'depth' ? newScaleForAxis : currentScale[2],
      ];
      setDraftScaleX(nextScale[0].toFixed(2));
      setDraftScaleY(nextScale[1].toFixed(2));
      setDraftScaleZ(nextScale[2].toFixed(2));
      setDraftRealWidth((base[0] * nextScale[0]).toFixed(2));
      setDraftRealHeight((base[1] * nextScale[1]).toFixed(2));
      setDraftRealDepth((base[2] * nextScale[2]).toFixed(2));
      updateObject(selectedObject.id, { scale: nextScale });
    }
  };

  // Object scale commit with aspect-ratio locking
  const commitObjectScale = (axis: 'x' | 'y' | 'z', newVal: number) => {
    if (!selectedObject || isNaN(newVal) || newVal <= 0) return;
    const currentScale = selectedObject.scale || [1, 1, 1];
    const base = selectedCatalogAsset?.size ?? selectedObject.size;

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
      setDraftRealWidth((base[0] * nextScale[0]).toFixed(2));
      setDraftRealHeight((base[1] * nextScale[1]).toFixed(2));
      setDraftRealDepth((base[2] * nextScale[2]).toFixed(2));
      updateObject(selectedObject.id, { scale: nextScale });
    } else {
      const nextScale: [number, number, number] = [
        axis === 'x' ? newVal : currentScale[0],
        axis === 'y' ? newVal : currentScale[1],
        axis === 'z' ? newVal : currentScale[2],
      ];
      setDraftScaleX(nextScale[0].toFixed(2));
      setDraftScaleY(nextScale[1].toFixed(2));
      setDraftScaleZ(nextScale[2].toFixed(2));
      setDraftRealWidth((base[0] * nextScale[0]).toFixed(2));
      setDraftRealHeight((base[1] * nextScale[1]).toFixed(2));
      setDraftRealDepth((base[2] * nextScale[2]).toFixed(2));
      updateObject(selectedObject.id, { scale: nextScale });
    }
  };

  // -------------------------------------------------------------
  // SELECTED WALL DRAFT STATE & HANDLERS
  // -------------------------------------------------------------
  const outline = room.outline;

  const selectedWallSegment = useMemo(() => {
    if (selectedWallIndex === null || selectedWallIndex >= outline.length) return null;
    try {
      return wallSegment({ outline }, selectedWallIndex);
    } catch {
      return null;
    }
  }, [outline, selectedWallIndex]);

  const selectedWallOverride = useMemo(() => {
    if (selectedWallIndex === null) return undefined;
    return room.wallOverrides?.[selectedWallIndex];
  }, [room.wallOverrides, selectedWallIndex]);

  const selectedWallOpenings = useMemo(() => {
    if (selectedWallIndex === null) return [];
    return room.openings.filter((op) => op.wallIndex === selectedWallIndex);
  }, [room.openings, selectedWallIndex]);

  const [draftWallLength, setDraftWallLength] = useState<string>('3.0');
  const [draftWallAnchor, setDraftWallAnchor] = useState<LengthAnchor>('center');
  const [draftWallThicknessOverride, setDraftWallThicknessOverride] = useState<number>(
    room.wallThickness
  );
  const [hasThicknessOverride, setHasThicknessOverride] = useState<boolean>(false);
  const [draftWallHeightOverride, setDraftWallHeightOverride] = useState<number>(room.wallHeight);
  const [hasHeightOverride, setHasHeightOverride] = useState<boolean>(false);
  const [draftWallColor, setDraftWallColor] = useState<string>('#3f3f46');

  useEffect(() => {
    if (selectedWallSegment) {
      setDraftWallLength(selectedWallSegment.len.toFixed(2));
    }
    if (selectedWallOverride) {
      if (selectedWallOverride.thickness !== undefined) {
        setHasThicknessOverride(true);
        setDraftWallThicknessOverride(selectedWallOverride.thickness);
      } else {
        setHasThicknessOverride(false);
        setDraftWallThicknessOverride(room.wallThickness);
      }
      if (selectedWallOverride.height !== undefined) {
        setHasHeightOverride(true);
        setDraftWallHeightOverride(selectedWallOverride.height);
      } else {
        setHasHeightOverride(false);
        setDraftWallHeightOverride(room.wallHeight);
      }
      if (selectedWallOverride.color !== undefined) {
        setDraftWallColor(selectedWallOverride.color);
      } else {
        setDraftWallColor('#3f3f46');
      }
    } else {
      setHasThicknessOverride(false);
      setDraftWallThicknessOverride(room.wallThickness);
      setHasHeightOverride(false);
      setDraftWallHeightOverride(room.wallHeight);
      setDraftWallColor('#3f3f46');
    }
  }, [selectedWallSegment, selectedWallOverride, room.wallThickness, room.wallHeight]);

  const handleWallLengthApply = useCallback(() => {
    if (selectedWallIndex === null) return;
    const targetLen = parseFloat(draftWallLength);
    if (!Number.isFinite(targetLen) || targetLen <= 0.1) return;
    const res = setWallLength(selectedWallIndex, targetLen, draftWallAnchor);
    if (res.removedOpenings.length > 0) {
      setToastMessage(
        `${res.removedOpenings.length} opening(s) removed (wall too short) — press Ctrl+Z to undo`
      );
    }
  }, [selectedWallIndex, draftWallLength, draftWallAnchor, setWallLength, setToastMessage]);

  const handleThicknessToggle = useCallback(
    (enable: boolean) => {
      if (selectedWallIndex === null) return;
      setHasThicknessOverride(enable);
      if (enable) {
        setWallOverride(selectedWallIndex, { thickness: draftWallThicknessOverride });
      } else {
        setWallOverride(selectedWallIndex, { thickness: undefined });
      }
    },
    [selectedWallIndex, draftWallThicknessOverride, setWallOverride]
  );

  const handleThicknessChange = useCallback(
    (val: number) => {
      if (selectedWallIndex === null) return;
      setDraftWallThicknessOverride(val);
      if (hasThicknessOverride) {
        setWallOverride(selectedWallIndex, { thickness: val });
      }
    },
    [selectedWallIndex, hasThicknessOverride, setWallOverride]
  );

  const handleHeightToggle = useCallback(
    (enable: boolean) => {
      if (selectedWallIndex === null) return;
      setHasHeightOverride(enable);
      if (enable) {
        setWallOverride(selectedWallIndex, { height: draftWallHeightOverride });
      } else {
        setWallOverride(selectedWallIndex, { height: undefined });
      }
    },
    [selectedWallIndex, draftWallHeightOverride, setWallOverride]
  );

  const handleHeightChange = useCallback(
    (val: number) => {
      if (selectedWallIndex === null) return;
      setDraftWallHeightOverride(val);
      if (hasHeightOverride) {
        setWallOverride(selectedWallIndex, { height: val });
      }
    },
    [selectedWallIndex, hasHeightOverride, setWallOverride]
  );

  const handleColorChange = useCallback(
    (hex: string) => {
      if (selectedWallIndex === null) return;
      setDraftWallColor(hex);
      setWallOverride(selectedWallIndex, { color: hex });
    },
    [selectedWallIndex, setWallOverride]
  );

  const handleResetWallOverrides = useCallback(() => {
    if (selectedWallIndex === null) return;
    setHasThicknessOverride(false);
    setHasHeightOverride(false);
    setDraftWallThicknessOverride(room.wallThickness);
    setDraftWallHeightOverride(room.wallHeight);
    setDraftWallColor('#3f3f46');
    setWallOverride(selectedWallIndex, {
      thickness: undefined,
      height: undefined,
      color: undefined,
    });
  }, [selectedWallIndex, room.wallThickness, room.wallHeight, setWallOverride]);

  const handleSplitWall = useCallback(() => {
    if (selectedWallIndex === null || !selectedWallSegment) return;
    const midX = (selectedWallSegment.a[0] + selectedWallSegment.b[0]) / 2;
    const midZ = (selectedWallSegment.a[1] + selectedWallSegment.b[1]) / 2;
    splitWall(selectedWallIndex, [midX, midZ]);
    setSelectedWallIndex(null);
  }, [selectedWallIndex, selectedWallSegment, splitWall, setSelectedWallIndex]);

  const handleExtrudeAlcove = useCallback(() => {
    if (selectedWallIndex === null) return;
    extrudeWall(selectedWallIndex, 0.5);
  }, [selectedWallIndex, extrudeWall]);

  // -------------------------------------------------------------
  // ROOM BOUNDS, SCALE & QUICK SHAPES DRAFT STATE
  // -------------------------------------------------------------
  const roomBounds = useMemo(() => {
    return polygonBounds(outline);
  }, [outline]);

  const roomWidth = useMemo(() => {
    return Number((roomBounds.max[0] - roomBounds.min[0]).toFixed(2));
  }, [roomBounds]);

  const roomDepth = useMemo(() => {
    return Number((roomBounds.max[1] - roomBounds.min[1]).toFixed(2));
  }, [roomBounds]);

  const [draftRoomScaleW, setDraftRoomScaleW] = useState<string>('4.0');
  const [draftRoomScaleD, setDraftRoomScaleD] = useState<string>('3.0');
  const [draftMoveDx, setDraftMoveDx] = useState<string>('0');
  const [draftMoveDz, setDraftMoveDz] = useState<string>('0');

  useEffect(() => {
    setDraftRoomScaleW(roomWidth.toFixed(2));
    setDraftRoomScaleD(roomDepth.toFixed(2));
  }, [roomWidth, roomDepth]);

  const [selectedQuickShape, setSelectedQuickShape] = useState<QuickShapeType | null>(null);
  const [quickShapeDims] = useState<QuickShapeDimensions>({
    width: 4.0,
    depth: 3.0,
    cutWidth: 2.0,
    cutDepth: 2.0,
    recessWidth: 2.0,
    recessDepth: 2.0,
    stemWidth: 3.0,
    stemDepth: 3.0,
  });

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

          {/* Real-World Dimensions & Direct Target Size Inputs */}
          <div className="flex flex-col gap-2 bg-neutral-950/40 p-3 rounded-lg border border-neutral-800">
            <div className="flex items-center justify-between">
              <label className="text-[11px] font-semibold text-neutral-400 uppercase tracking-wider">
                Real-World Dimensions (m)
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

            {/* Dimension Readout Chip */}
            <div
              data-testid="dimension-readout"
              className="bg-sky-950/40 border border-sky-800/60 rounded-md px-2.5 py-1.5 font-mono text-sky-200 text-xs flex items-center justify-between shadow-inner"
            >
              <span className="text-[10px] text-sky-400 font-sans uppercase font-semibold">
                W × H × D:
              </span>
              <span className="font-bold">
                {draftRealWidth} m × {draftRealHeight} m × {draftRealDepth} m
              </span>
            </div>

            {/* Direct Target Size Inputs */}
            <div className="grid grid-cols-3 gap-2 pt-0.5">
              <div>
                <span className="text-[10px] text-amber-400 font-bold block mb-0.5">Width (m)</span>
                <input
                  type="number"
                  data-testid="target-size-width"
                  step="0.05"
                  min="0.05"
                  value={draftRealWidth}
                  onChange={(e) => setDraftRealWidth(e.target.value)}
                  onBlur={() => commitTargetSize('width', parseFloat(draftRealWidth))}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      commitTargetSize('width', parseFloat(draftRealWidth));
                      e.currentTarget.blur();
                    }
                  }}
                  className="w-full bg-neutral-800 border border-neutral-700 rounded px-1.5 py-1 font-mono text-white text-xs focus:border-amber-500"
                  title="Direct Width in meters"
                />
              </div>
              <div>
                <span className="text-[10px] text-sky-400 font-bold block mb-0.5">Height (m)</span>
                <input
                  type="number"
                  data-testid="target-size-height"
                  step="0.05"
                  min="0.05"
                  value={draftRealHeight}
                  onChange={(e) => setDraftRealHeight(e.target.value)}
                  onBlur={() => commitTargetSize('height', parseFloat(draftRealHeight))}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      commitTargetSize('height', parseFloat(draftRealHeight));
                      e.currentTarget.blur();
                    }
                  }}
                  className="w-full bg-neutral-800 border border-neutral-700 rounded px-1.5 py-1 font-mono text-white text-xs focus:border-sky-500"
                  title="Direct Height in meters"
                />
              </div>
              <div>
                <span className="text-[10px] text-emerald-400 font-bold block mb-0.5">
                  Depth (m)
                </span>
                <input
                  type="number"
                  data-testid="target-size-depth"
                  step="0.05"
                  min="0.05"
                  value={draftRealDepth}
                  onChange={(e) => setDraftRealDepth(e.target.value)}
                  onBlur={() => commitTargetSize('depth', parseFloat(draftRealDepth))}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      commitTargetSize('depth', parseFloat(draftRealDepth));
                      e.currentTarget.blur();
                    }
                  }}
                  className="w-full bg-neutral-800 border border-neutral-700 rounded px-1.5 py-1 font-mono text-white text-xs focus:border-emerald-500"
                  title="Direct Depth in meters"
                />
              </div>
            </div>
          </div>

          {/* Scale Multiplier Inputs */}
          <div className="flex flex-col gap-1.5 bg-neutral-950/40 p-3 rounded-lg border border-neutral-800">
            <div className="flex items-center justify-between">
              <label className="text-[11px] font-semibold text-neutral-400 uppercase tracking-wider">
                Scale Multipliers
              </label>
              {selectedCatalogAsset && (
                <span className="text-[10px] text-neutral-500 font-mono">
                  Base: {selectedCatalogAsset.size.join(' × ')}m
                </span>
              )}
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

          {/* Scale Reference Debug Toggle */}
          <div className="flex items-center justify-between bg-neutral-950/40 p-2.5 rounded-lg border border-neutral-800">
            <div className="flex items-center gap-1.5">
              <span>🧍</span>
              <span className="text-[11px] text-neutral-300 font-medium">
                Scale Reference (1.7m Human)
              </span>
            </div>
            <button
              type="button"
              data-testid="inspector-scale-ref-btn"
              onClick={toggleScaleReference}
              className={`px-2 py-0.5 rounded text-[10px] font-semibold border transition-colors ${
                showScaleReference
                  ? 'bg-sky-600 border-sky-400 text-white'
                  : 'bg-neutral-800 border-neutral-700 text-neutral-400 hover:text-white'
              }`}
            >
              {showScaleReference ? 'Showing' : 'Hidden'}
            </button>
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
      ) : selectedWallIndex !== null && selectedWallSegment ? (
        /* ------------------------------------------------------------- */
        /* CASE B: WALL SELECTED                                         */
        /* ------------------------------------------------------------- */
        <div
          data-testid="wall-inspector"
          className="flex flex-col h-full overflow-y-auto p-4 gap-4"
        >
          {/* Header */}
          <div className="flex items-center justify-between border-b border-neutral-800 pb-2.5">
            <div className="flex items-center gap-2">
              <span className="w-2.5 h-2.5 rounded-full bg-amber-400" />
              <span className="font-semibold text-white text-sm">
                Wall #{selectedWallIndex + 1}
              </span>
            </div>
            <button
              type="button"
              data-testid="deselect-wall-btn"
              onClick={() => setSelectedWallIndex(null)}
              className="text-neutral-400 hover:text-white px-2 py-0.5 rounded hover:bg-neutral-800 transition-colors"
              title="Deselect wall"
            >
              ✕
            </button>
          </div>

          {/* Wall Coordinates Info */}
          <div className="flex flex-col gap-1 bg-neutral-950/40 p-2.5 rounded-lg border border-neutral-800 text-[11px] font-mono">
            <div className="flex justify-between text-neutral-400">
              <span>Start (Corner {selectedWallIndex + 1}):</span>
              <span className="text-neutral-200">
                [{selectedWallSegment.a[0].toFixed(2)}, {selectedWallSegment.a[1].toFixed(2)}]m
              </span>
            </div>
            <div className="flex justify-between text-neutral-400">
              <span>End (Corner {((selectedWallIndex + 1) % outline.length) + 1}):</span>
              <span className="text-neutral-200">
                [{selectedWallSegment.b[0].toFixed(2)}, {selectedWallSegment.b[1].toFixed(2)}]m
              </span>
            </div>
          </div>

          {/* Wall Length & Anchored Resize */}
          <div className="flex flex-col gap-2 bg-neutral-950/40 p-3 rounded-lg border border-neutral-800">
            <div className="flex items-center justify-between">
              <label className="text-[11px] font-semibold text-neutral-400 uppercase tracking-wider">
                Length (m)
              </label>
              <span className="font-mono text-amber-400 font-bold">
                {selectedWallSegment.len.toFixed(2)} m
              </span>
            </div>
            <div className="flex items-center gap-2">
              <input
                type="number"
                data-testid="wall-length-input"
                step="0.05"
                min="0.2"
                value={draftWallLength}
                onChange={(e) => setDraftWallLength(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleWallLengthApply();
                }}
                className="w-full bg-neutral-800 border border-neutral-700 rounded px-2.5 py-1.5 font-mono text-white text-xs focus:border-amber-500"
              />
              <button
                type="button"
                data-testid="wall-apply-length-btn"
                onClick={handleWallLengthApply}
                className="px-3 py-1.5 bg-amber-500 hover:bg-amber-400 text-neutral-950 font-bold rounded text-xs whitespace-nowrap transition-colors"
              >
                Set
              </button>
            </div>

            {/* Anchor Selection Buttons */}
            <div className="flex flex-col gap-1 pt-1">
              <span className="text-[10px] text-neutral-400 uppercase font-semibold">
                Fixed Anchor Point:
              </span>
              <div className="grid grid-cols-3 gap-1 text-[10px]">
                {(['start', 'center', 'end'] as const).map((anchor) => (
                  <button
                    key={anchor}
                    type="button"
                    data-testid={`wall-anchor-${anchor}`}
                    onClick={() => setDraftWallAnchor(anchor)}
                    className={`py-1 rounded font-medium border transition-colors ${
                      draftWallAnchor === anchor
                        ? 'bg-amber-500/20 border-amber-500 text-amber-300 font-semibold'
                        : 'bg-neutral-800 border-neutral-700 text-neutral-400 hover:text-white'
                    }`}
                  >
                    {anchor === 'start'
                      ? 'Fixed Start'
                      : anchor === 'end'
                        ? 'Fixed End'
                        : 'Centered'}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Wall Thickness Override */}
          <div className="flex flex-col gap-2 bg-neutral-950/40 p-3 rounded-lg border border-neutral-800">
            <div className="flex items-center justify-between">
              <label className="text-[11px] font-semibold text-neutral-400 uppercase tracking-wider flex items-center gap-1.5">
                <input
                  type="checkbox"
                  data-testid="wall-thickness-toggle"
                  checked={hasThicknessOverride}
                  onChange={(e) => handleThicknessToggle(e.target.checked)}
                  className="w-3.5 h-3.5 rounded accent-amber-500"
                />
                Thickness Override
              </label>
              <span className="font-mono text-sky-400">
                {(hasThicknessOverride ? draftWallThicknessOverride : room.wallThickness).toFixed(
                  2
                )}{' '}
                m
              </span>
            </div>
            {hasThicknessOverride && (
              <div className="flex items-center gap-2 pt-1">
                <input
                  type="range"
                  min="0.05"
                  max="0.50"
                  step="0.01"
                  value={draftWallThicknessOverride}
                  onChange={(e) => handleThicknessChange(parseFloat(e.target.value))}
                  className="w-full h-1.5 bg-neutral-700 rounded-lg appearance-none cursor-pointer accent-amber-500"
                />
                <input
                  type="number"
                  data-testid="wall-thickness-input"
                  step="0.01"
                  min="0.05"
                  max="0.50"
                  value={draftWallThicknessOverride}
                  onChange={(e) => handleThicknessChange(parseFloat(e.target.value))}
                  className="w-16 bg-neutral-800 border border-neutral-700 rounded px-1.5 py-0.5 text-right font-mono text-white text-xs"
                />
              </div>
            )}
          </div>

          {/* Wall Height Override */}
          <div className="flex flex-col gap-2 bg-neutral-950/40 p-3 rounded-lg border border-neutral-800">
            <div className="flex items-center justify-between">
              <label className="text-[11px] font-semibold text-neutral-400 uppercase tracking-wider flex items-center gap-1.5">
                <input
                  type="checkbox"
                  data-testid="wall-height-toggle"
                  checked={hasHeightOverride}
                  onChange={(e) => handleHeightToggle(e.target.checked)}
                  className="w-3.5 h-3.5 rounded accent-amber-500"
                />
                Height Override
              </label>
              <span className="font-mono text-sky-400">
                {(hasHeightOverride ? draftWallHeightOverride : room.wallHeight).toFixed(2)} m
              </span>
            </div>
            {hasHeightOverride && (
              <div className="flex items-center gap-2 pt-1">
                <input
                  type="range"
                  min="2.0"
                  max="6.0"
                  step="0.05"
                  value={draftWallHeightOverride}
                  onChange={(e) => handleHeightChange(parseFloat(e.target.value))}
                  className="w-full h-1.5 bg-neutral-700 rounded-lg appearance-none cursor-pointer accent-amber-500"
                />
                <input
                  type="number"
                  data-testid="wall-height-input"
                  step="0.05"
                  min="2.0"
                  max="6.0"
                  value={draftWallHeightOverride}
                  onChange={(e) => handleHeightChange(parseFloat(e.target.value))}
                  className="w-16 bg-neutral-800 border border-neutral-700 rounded px-1.5 py-0.5 text-right font-mono text-white text-xs"
                />
              </div>
            )}
          </div>

          {/* Material Color Override */}
          <div className="flex flex-col gap-2 bg-neutral-950/40 p-3 rounded-lg border border-neutral-800">
            <label className="text-[11px] font-semibold text-neutral-400 uppercase tracking-wider">
              Material Colour
            </label>
            <div className="flex items-center gap-2">
              <input
                type="color"
                data-testid="wall-color-picker"
                value={draftWallColor}
                onChange={(e) => handleColorChange(e.target.value)}
                className="w-8 h-8 rounded border border-neutral-700 cursor-pointer bg-neutral-800 p-0.5"
              />
              <div className="flex flex-wrap gap-1.5 flex-1">
                {[
                  { label: 'Concrete', hex: '#3f3f46' },
                  { label: 'Light Grey', hex: '#e4e4e7' },
                  { label: 'Warm Stone', hex: '#d6d3d1' },
                  { label: 'Slate', hex: '#475569' },
                  { label: 'Midnight', hex: '#1e293b' },
                  { label: 'Brick Red', hex: '#991b1b' },
                ].map((preset) => (
                  <button
                    key={preset.hex}
                    type="button"
                    onClick={() => handleColorChange(preset.hex)}
                    className="w-5 h-5 rounded-full border border-neutral-600 hover:scale-110 transition-transform"
                    style={{ backgroundColor: preset.hex }}
                    title={preset.label}
                  />
                ))}
              </div>
            </div>
          </div>

          {/* Openings on this Wall */}
          <div className="flex flex-col gap-2 bg-neutral-950/40 p-3 rounded-lg border border-neutral-800">
            <label className="text-[11px] font-semibold text-neutral-400 uppercase tracking-wider">
              Openings ({selectedWallOpenings.length})
            </label>
            {selectedWallOpenings.length === 0 ? (
              <span className="text-[11px] text-neutral-500 italic">No openings on this wall</span>
            ) : (
              <div className="flex flex-col gap-1.5">
                {selectedWallOpenings.map((op) => (
                  <div
                    key={op.id}
                    onClick={() => selectOpening(op.id)}
                    className="flex items-center justify-between p-2 rounded bg-neutral-900 border border-neutral-800 hover:border-sky-500 cursor-pointer text-[11px]"
                  >
                    <div className="flex items-center gap-1.5">
                      <span>{op.type === 'window' ? '🪟' : '🚪'}</span>
                      <span className="capitalize text-neutral-200 font-medium">{op.type}</span>
                      <span
                        className={`text-[9px] px-1.5 py-0.5 rounded font-mono uppercase ${
                          op.role === 'inlet'
                            ? 'bg-sky-950 border border-sky-600 text-sky-300'
                            : op.role === 'outlet'
                              ? 'bg-amber-950 border border-amber-600 text-amber-300'
                              : 'bg-neutral-800 border border-neutral-700 text-neutral-400'
                        }`}
                      >
                        {op.role}
                      </span>
                    </div>
                    <span className="font-mono text-neutral-400 text-[10px]">
                      {op.width}m × {op.height}m
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Wall Actions */}
          <div className="flex flex-col gap-2 pt-2 border-t border-neutral-800 mt-auto">
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                data-testid="wall-split-btn"
                onClick={handleSplitWall}
                className="py-1.5 px-2.5 rounded-lg bg-neutral-800 hover:bg-neutral-700 text-neutral-200 font-medium border border-neutral-700 text-xs transition-colors"
              >
                Split at Midpoint
              </button>
              <button
                type="button"
                data-testid="wall-extrude-btn"
                onClick={handleExtrudeAlcove}
                className="py-1.5 px-2.5 rounded-lg bg-neutral-800 hover:bg-neutral-700 text-neutral-200 font-medium border border-neutral-700 text-xs transition-colors"
              >
                Extrude Bump (+0.5m)
              </button>
            </div>
            <button
              type="button"
              data-testid="wall-reset-overrides-btn"
              onClick={handleResetWallOverrides}
              className="w-full py-1 text-[11px] text-neutral-400 hover:text-neutral-200 transition-colors"
            >
              Reset Wall Overrides
            </button>
          </div>
        </div>
      ) : selectedVertexIndex !== null ? (
        /* ------------------------------------------------------------- */
        /* CASE C: CORNER VERTEX SELECTED                                */
        /* ------------------------------------------------------------- */
        <div
          data-testid="corner-inspector"
          className="flex flex-col h-full overflow-y-auto p-4 gap-4"
        >
          {/* Header */}
          <div className="flex items-center justify-between border-b border-neutral-800 pb-2.5">
            <div className="flex items-center gap-2">
              <span className="w-2.5 h-2.5 rounded-full bg-sky-400" />
              <span className="font-semibold text-white text-sm">
                Corner #{selectedVertexIndex + 1}
              </span>
            </div>
            <button
              type="button"
              data-testid="deselect-corner-btn"
              onClick={() => setSelectedVertexIndex(null)}
              className="text-neutral-400 hover:text-white px-2 py-0.5 rounded hover:bg-neutral-800 transition-colors"
              title="Deselect corner"
            >
              ✕
            </button>
          </div>

          {/* Coordinates */}
          <div className="flex flex-col gap-1.5 bg-neutral-950/40 p-3 rounded-lg border border-neutral-800">
            <label className="text-[11px] font-semibold text-neutral-400 uppercase tracking-wider">
              Corner Position (X, Z)
            </label>
            <div className="flex items-center justify-between font-mono text-sky-400">
              <span>X: {outline[selectedVertexIndex]?.[0].toFixed(2)} m</span>
              <span>Z: {outline[selectedVertexIndex]?.[1].toFixed(2)} m</span>
            </div>
          </div>

          {/* Actions */}
          <div className="pt-2 border-t border-neutral-800 mt-auto">
            <button
              type="button"
              data-testid="delete-corner-btn"
              disabled={outline.length <= 3}
              onClick={() => {
                mergeCorner(selectedVertexIndex);
                setSelectedVertexIndex(null);
              }}
              className={`w-full py-2 px-3 rounded-lg font-medium text-xs transition-colors ${
                outline.length <= 3
                  ? 'bg-neutral-800/50 text-neutral-500 cursor-not-allowed border border-neutral-800'
                  : 'bg-red-950/60 hover:bg-red-900 border border-red-800/80 text-red-200 cursor-pointer'
              }`}
            >
              {outline.length <= 3
                ? 'Cannot Delete (Min 3 Corners)'
                : 'Delete & Merge Corner (Del)'}
            </button>
          </div>
        </div>
      ) : (
        /* ------------------------------------------------------------- */
        /* CASE D: NOTHING SELECTED (ROOM & SIMULATION PARAMS)           */
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

          {/* Empty Objects Guidance Hint */}
          {room.objects.length === 0 && (
            <div
              data-testid="inspector-empty-objects-hint"
              className="bg-sky-950/40 border border-sky-800/50 rounded-xl p-3 flex items-start gap-2.5 text-xs text-sky-200"
            >
              <span className="text-base">🛋️</span>
              <div className="flex flex-col gap-0.5">
                <span className="font-semibold text-white">Room is empty</span>
                <span className="text-[11px] text-sky-300/80 leading-snug">
                  Drag real-scale furniture or appliances from the Catalog to begin furnishing your
                  room.
                </span>
              </div>
            </div>
          )}

          {/* Room Quick Shapes */}
          <div className="flex flex-col gap-2 bg-neutral-950/40 p-3 rounded-lg border border-neutral-800">
            <label className="text-[11px] font-semibold text-neutral-400 uppercase tracking-wider">
              Quick Shapes
            </label>
            <div className="grid grid-cols-4 gap-1.5">
              {[
                { type: 'rectangle', label: '▭ Rect' },
                { type: 'l-shape', label: '⅃ L-Shape' },
                { type: 'u-shape', label: '⊔ U-Shape' },
                { type: 't-shape', label: '┬ T-Shape' },
              ].map((sh) => (
                <button
                  key={sh.type}
                  type="button"
                  data-testid={`quick-shape-${sh.type}`}
                  onClick={() => {
                    setSelectedQuickShape(sh.type as QuickShapeType);
                    setQuickShape(sh.type as QuickShapeType, quickShapeDims);
                  }}
                  className={`py-1.5 px-1 rounded text-[11px] font-medium border text-center transition-colors cursor-pointer ${
                    selectedQuickShape === sh.type
                      ? 'bg-sky-600 border-sky-400 text-white font-bold'
                      : 'bg-neutral-800 border-neutral-700 text-neutral-300 hover:bg-neutral-700'
                  }`}
                >
                  {sh.label}
                </button>
              ))}
            </div>
          </div>

          {/* Room Overall Dimensions & Scale */}
          <div className="flex flex-col gap-2 bg-neutral-950/40 p-3 rounded-lg border border-neutral-800">
            <div className="flex items-center justify-between">
              <label className="text-[11px] font-semibold text-neutral-400 uppercase tracking-wider">
                Room Bounds (Scale)
              </label>
              <span className="font-mono text-neutral-400 text-[10px]">
                {roomWidth}m × {roomDepth}m
              </span>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <span className="text-[10px] text-neutral-400 block mb-0.5">Width (m):</span>
                <input
                  type="number"
                  data-testid="room-scale-width"
                  step="0.2"
                  min="1.5"
                  value={draftRoomScaleW}
                  onChange={(e) => setDraftRoomScaleW(e.target.value)}
                  className="w-full bg-neutral-800 border border-neutral-700 rounded px-2 py-1 font-mono text-white text-xs"
                />
              </div>
              <div>
                <span className="text-[10px] text-neutral-400 block mb-0.5">Depth (m):</span>
                <input
                  type="number"
                  data-testid="room-scale-depth"
                  step="0.2"
                  min="1.5"
                  value={draftRoomScaleD}
                  onChange={(e) => setDraftRoomScaleD(e.target.value)}
                  className="w-full bg-neutral-800 border border-neutral-700 rounded px-2 py-1 font-mono text-white text-xs"
                />
              </div>
            </div>
            <button
              type="button"
              data-testid="apply-room-scale-btn"
              onClick={() => {
                const w = parseFloat(draftRoomScaleW);
                const d = parseFloat(draftRoomScaleD);
                if (Number.isFinite(w) && Number.isFinite(d) && w >= 1.5 && d >= 1.5) {
                  scaleRoom(w, d);
                }
              }}
              className="py-1 bg-neutral-800 hover:bg-neutral-700 text-sky-400 border border-neutral-700 rounded font-medium text-xs transition-colors cursor-pointer"
            >
              Apply Overall Size
            </button>
          </div>

          {/* Move Room Section */}
          <div className="flex flex-col gap-2 bg-neutral-950/40 p-3 rounded-lg border border-neutral-800">
            <div className="flex items-center justify-between">
              <label className="text-[11px] font-semibold text-neutral-400 uppercase tracking-wider">
                Move Room
              </label>
              <span className="text-[10px] text-neutral-500">or drag center handle ✥</span>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <span className="text-[10px] text-neutral-400 block mb-0.5">ΔX (m):</span>
                <input
                  type="number"
                  data-testid="room-move-dx"
                  step="0.5"
                  value={draftMoveDx}
                  onChange={(e) => setDraftMoveDx(e.target.value)}
                  className="w-full bg-neutral-800 border border-neutral-700 rounded px-2 py-1 font-mono text-white text-xs"
                />
              </div>
              <div>
                <span className="text-[10px] text-neutral-400 block mb-0.5">ΔZ (m):</span>
                <input
                  type="number"
                  data-testid="room-move-dz"
                  step="0.5"
                  value={draftMoveDz}
                  onChange={(e) => setDraftMoveDz(e.target.value)}
                  className="w-full bg-neutral-800 border border-neutral-700 rounded px-2 py-1 font-mono text-white text-xs"
                />
              </div>
            </div>
            <button
              type="button"
              data-testid="apply-room-move-btn"
              onClick={() => {
                const dx = parseFloat(draftMoveDx) || 0;
                const dz = parseFloat(draftMoveDz) || 0;
                if (dx !== 0 || dz !== 0) {
                  moveRoom([dx, dz]);
                  setDraftMoveDx('0');
                  setDraftMoveDz('0');
                }
              }}
              className="py-1 bg-neutral-800 hover:bg-neutral-700 text-neutral-200 border border-neutral-700 rounded font-medium text-xs transition-colors cursor-pointer"
            >
              Translate Room
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

          {/* SECTION: RENDERING & MATERIALS */}
          <div className="pt-2 border-t border-neutral-800 flex flex-col gap-3">
            <span className="text-[11px] font-bold text-sky-400 uppercase tracking-wider">
              Rendering & Materials
            </span>

            {/* Quality Setting */}
            <div className="flex flex-col gap-1.5 bg-neutral-950/40 p-3 rounded-lg border border-neutral-800">
              <label className="text-[11px] font-semibold text-neutral-400 uppercase tracking-wider">
                Graphics Quality
              </label>
              <select
                value={quality}
                onChange={(e) => setQuality(e.target.value as any)}
                className="bg-neutral-800 border border-neutral-700 rounded-lg px-2.5 py-1.5 text-white font-medium focus:outline-none focus:border-sky-500 text-xs"
              >
                <option value="Low">Low (No Post-Processing)</option>
                <option value="Medium">Medium (SSAO + SMAA)</option>
                <option value="High">High (AO + Bloom + SMAA)</option>
              </select>
            </div>

            {/* Wall X-Ray Mode */}
            <div className="flex flex-col gap-1.5 bg-neutral-950/40 p-3 rounded-lg border border-neutral-800">
              <label className="text-[11px] font-semibold text-neutral-400 uppercase tracking-wider">
                Wall Visibility
              </label>
              <select
                value={wallOpacityMode}
                onChange={(e) => setWallOpacityMode(e.target.value as any)}
                className="bg-neutral-800 border border-neutral-700 rounded-lg px-2.5 py-1.5 text-white font-medium focus:outline-none focus:border-sky-500 text-xs"
              >
                <option value="Solid">Solid</option>
                <option value="Auto-fade">Auto-fade</option>
                <option value="Cutaway">Cutaway</option>
              </select>
            </div>

            {/* Materials */}
            <div className="flex items-center gap-2">
              <div className="flex-1 flex flex-col gap-1.5 bg-neutral-950/40 p-3 rounded-lg border border-neutral-800">
                <label className="text-[11px] font-semibold text-neutral-400 uppercase tracking-wider">
                  Floor
                </label>
                <select
                  value={room.floorMaterial ?? 'wood'}
                  onChange={(e) => setFloorMaterial(e.target.value)}
                  className="bg-neutral-800 border border-neutral-700 rounded-lg px-2 py-1 text-white focus:outline-none focus:border-sky-500 text-xs"
                >
                  <option value="wood">Wood</option>
                  <option value="tile">Tile</option>
                  <option value="concrete">Concrete</option>
                  <option value="carpet">Carpet</option>
                </select>
              </div>
              <div className="flex-1 flex flex-col gap-1.5 bg-neutral-950/40 p-3 rounded-lg border border-neutral-800">
                <label className="text-[11px] font-semibold text-neutral-400 uppercase tracking-wider">
                  Walls
                </label>
                <select
                  value={room.wallMaterial ?? 'paint'}
                  onChange={(e) => setWallMaterial(e.target.value)}
                  className="bg-neutral-800 border border-neutral-700 rounded-lg px-2 py-1 text-white focus:outline-none focus:border-sky-500 text-xs"
                >
                  <option value="paint">Paint</option>
                  <option value="brick">Brick</option>
                  <option value="wallpaper">Wallpaper</option>
                </select>
              </div>
            </div>

            {/* UI Theme Toggle */}
            <div className="flex items-center justify-between bg-neutral-950/40 p-3 rounded-lg border border-neutral-800">
              <span className="text-[11px] font-semibold text-neutral-400 uppercase tracking-wider">
                Theme
              </span>
              <button
                type="button"
                onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
                className="px-2 py-1 bg-neutral-800 hover:bg-neutral-700 rounded text-xs text-white"
              >
                {theme === 'dark' ? '🌙 Dark' : '☀️ Light'}
              </button>
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
