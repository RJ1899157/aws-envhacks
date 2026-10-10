import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { flushSync, type ThreeEvent } from '@react-three/fiber';
import { Html } from '@react-three/drei';
import * as THREE from 'three';
import { isPolygonSimple, polygonBounds, signedArea, wallSegment } from '../core/parser';
import type { OpeningSubType, Vec2 } from '../core/schema';
import {
  createOpeningFromPreset,
  fitOpeningToWall,
  OPENING_PRESETS,
  resolveOpeningOverlapOnWall,
} from '../core/openingPresets';
import { snap } from '../core/units';
import { snapRoomMove, snapWallMove } from '../core/rooms';
import { objectsFlushAgainstWall } from '../core/smartSnap';
import {
  moveWallPerpendicular,
  extrudeWallAlcove,
  type LengthAnchor,
} from '../core/wallOperations';
import { useSceneStore } from '../store/sceneStore';
import { useUiStore } from '../store/uiStore';
import { sharedOrbitControlsRef } from './Canvas';
import { setCanvasCursor, resetCanvasCursor } from '../core/cursor';

/** True in 3D when the camera is outside this wall, i.e. the wall is faded out between camera and room. */
function isWallFacingAwayFromCamera(
  w: { midX: number; midZ: number; normalX: number; normalZ: number },
  camera: THREE.Camera,
  view: '2d' | '3d'
): boolean {
  if (view !== '3d') return false;
  return (camera.position.x - w.midX) * w.normalX + (camera.position.z - w.midZ) * w.normalZ > 0;
}

export const FloorPlanEditor: React.FC = () => {
  const room = useSceneStore((state) => state.room);
  const otherRooms = useSceneStore((state) => state.otherRooms);
  const outline = useSceneStore((state) => state.room.outline);
  const moveVertex = useSceneStore((state) => state.moveVertex);
  const setOutline = useSceneStore((state) => state.setOutline);
  const setIsDragging = useSceneStore((state) => state.setIsDragging);
  const moveWall = useSceneStore((state) => state.moveWall);
  const extrudeWall = useSceneStore((state) => state.extrudeWall);
  const setWallLength = useSceneStore((state) => state.setWallLength);
  const splitWall = useSceneStore((state) => state.splitWall);
  const addOpening = useSceneStore((state) => state.addOpening);
  const updateOpening = useSceneStore((state) => state.updateOpening);
  const mergeCorner = useSceneStore((state) => state.mergeCorner);
  const moveRoom = useSceneStore((state) => state.moveRoom);
  const scaleRoom = useSceneStore((state) => state.scaleRoom);

  const toolMode = useUiStore((state) => state.toolMode);
  const view = useUiStore((state) => state.view);
  const setToolMode = useUiStore((state) => state.setToolMode);
  const snapEnabled = useUiStore((state) => state.snapEnabled);
  const gridStep = useUiStore((state) => state.gridStep);
  const showDimensions = useUiStore((state) => state.showDimensions);
  const showAllWallDimensions = useUiStore((state) => state.showAllWallDimensions);
  const selectedVertexIndex = useUiStore((state) => state.selectedVertexIndex);
  const setSelectedVertexIndex = useUiStore((state) => state.setSelectedVertexIndex);
  const selectedWallIndex = useUiStore((state) => state.selectedWallIndex);
  const setSelectedWallIndex = useUiStore((state) => state.setSelectedWallIndex);
  const hoveredWallIndex = useUiStore((state) => state.hoveredWallIndex);
  const setHoveredWallIndex = useUiStore((state) => state.setHoveredWallIndex);
  const setToastMessage = useUiStore((state) => state.setToastMessage);

  // -------------------------------------------------------------
  // DRAW-FLOOR MODE STATE
  // -------------------------------------------------------------
  const [drawingPoints, setDrawingPoints] = useState<Vec2[]>([]);
  const [cursorPos, setCursorPos] = useState<Vec2 | null>(null);
  const [isCloseHovered, setIsCloseHovered] = useState<boolean>(false);

  // -------------------------------------------------------------
  // SELECT MODE: CORNER VERTEX DRAG
  // -------------------------------------------------------------
  const [draggingVertexIndex, setDraggingVertexIndex] = useState<number | null>(null);
  const dragVertexStartPos = useRef<Vec2 | null>(null);
  const originalOutline = useRef<Vec2[] | null>(null);
  const [hasSelfIntersection, setHasSelfIntersection] = useState<boolean>(false);
  const [flashRedEdge, setFlashRedEdge] = useState<boolean>(false);
  const [cornerAngleDeg, setCornerAngleDeg] = useState<number | null>(null);

  // -------------------------------------------------------------
  // SELECT MODE: WALL DRAG (BODY OR ALT-EXTRUDE)
  // -------------------------------------------------------------
  const [hoveredStretchIndex, setHoveredStretchIndex] = useState<number | null>(null);

  // Room selection (via the centre handle): Delete/Backspace removes the room
  const roomSelected = useUiStore((state) => state.roomSelected);
  const selectedObjectCount = useSceneStore((state) => state.selectedObjectIds.length + state.selectedOpeningIds.length);
  const deleteActiveRoom = useCallback(() => {
    const scene = useSceneStore.getState();
    const ui = useUiStore.getState();
    ui.setRoomSelected(false);
    if (scene.otherRooms.length === 0) {
      ui.setToastMessage('This is the only room, so it can’t be deleted');
      return;
    }
    const name = scene.room.name;
    if (scene.room.id) scene.removeRoom(scene.room.id);
    ui.setToastMessage(`Deleted ${name}`, true);
  }, []);
  useEffect(() => {
    // Any other selection, or switching rooms, deselects the room
    if (selectedObjectCount > 0 || selectedWallIndex !== null || toolMode !== 'select') {
      useUiStore.getState().setRoomSelected(false);
    }
  }, [selectedObjectCount, selectedWallIndex, toolMode]);
  useEffect(() => {
    useUiStore.getState().setRoomSelected(false);
  }, [room.id]);
  useEffect(() => {
    if (!roomSelected) return;
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) return;
      if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault();
        deleteActiveRoom();
      } else if (e.key === 'Escape') {
        useUiStore.getState().setRoomSelected(false);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [roomSelected, deleteActiveRoom]);
  const attachedObjects = useRef<{ id: string; position: [number, number, number] }[]>([]);
  const previewAttachedObjects = useCallback((normal: readonly [number, number], delta: number) => {
    const originals = attachedObjects.current;
    if (originals.length === 0) return;
    useSceneStore.setState((state) => {
      for (const { id, position } of originals) {
        const obj = state.room.objects.find((o) => o.id === id);
        if (obj) obj.position = [position[0] + delta * normal[0], position[1], position[2] + delta * normal[1]];
      }
    });
  }, []);
  const [draggingWallState, setDraggingWallState] = useState<{
    index: number;
    startPoint: Vec2;
    isExtrude: boolean;
    accumulatedDelta: number;
  } | null>(null);

  // -------------------------------------------------------------
  // SELECT MODE: ROOM CENTER MOVE DRAG
  // -------------------------------------------------------------
  const [draggingRoomCenter, setDraggingRoomCenter] = useState<{
    startPoint: Vec2;
    accumulatedDelta: Vec2;
  } | null>(null);

  // -------------------------------------------------------------
  // SELECT MODE: ROOM SCALE DRAG
  // -------------------------------------------------------------
  const [draggingRoomScale, setDraggingRoomScale] = useState<{
    startPoint: Vec2;
    startWidth: number;
    startDepth: number;
    accumulatedWidth: number;
    accumulatedDepth: number;
  } | null>(null);

  // -------------------------------------------------------------
  // WALL LENGTH POPOVER (Double-click wall length label)
  // -------------------------------------------------------------
  const [popoverWallIndex, setPopoverWallIndex] = useState<number | null>(null);
  const [popoverLength, setPopoverLength] = useState<string>('');
  const [popoverAnchor, setPopoverAnchor] = useState<LengthAnchor>('center');

  // -------------------------------------------------------------
  // WALL OPENING QUICK MENU (Double-click wall body)
  // -------------------------------------------------------------
  const [wallQuickMenu, setWallQuickMenu] = useState<{
    wallIndex: number;
    position: [number, number, number];
    clickOffset: number;
  } | null>(null);

  // Blender-style numeric input while dragging or editing vertex
  const [numericInput, setNumericInput] = useState<string>('');

  // Shift & Alt key tracking
  const isShiftPressed = useRef<boolean>(false);
  const isAltPressed = useRef<boolean>(false);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Shift') isShiftPressed.current = true;
      if (e.key === 'Alt') isAltPressed.current = true;
    };
    const handleKeyUp = (e: KeyboardEvent) => {
      if (e.key === 'Shift') isShiftPressed.current = false;
      if (e.key === 'Alt') isAltPressed.current = false;
    };
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
    };
  }, []);

  // Flash red trigger helper
  const triggerRedFlash = useCallback(() => {
    setFlashRedEdge(true);
    setTimeout(() => {
      setFlashRedEdge(false);
    }, 600);
  }, []);

  // Keyboard actions: Delete/Backspace to remove vertex, Esc to cancel drawing, Enter to close
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)
      ) {
        return;
      }

      // Drawing mode shortcuts
      if (toolMode === 'draw-floor') {
        if (e.key === 'Escape') {
          e.preventDefault();
          setDrawingPoints([]);
          setToolMode('select');
        } else if (e.key === 'Enter') {
          e.preventDefault();
          if (drawingPoints.length >= 3) {
            const finalOutline = [...drawingPoints];
            if (signedArea(finalOutline) < 0) {
              finalOutline.reverse();
            }
            if (isPolygonSimple(finalOutline)) {
              setOutline(finalOutline);
              setDrawingPoints([]);
              setToolMode('select');
            } else {
              triggerRedFlash();
            }
          }
        } else if (e.key === 'Backspace' || e.key === 'Delete') {
          e.preventDefault();
          setDrawingPoints((prev) => prev.slice(0, -1));
        }
        return;
      }

      // Select mode shortcuts
      if (toolMode === 'select') {
        // Delete or Backspace to remove selected corner vertex (min 3)
        if ((e.key === 'Delete' || e.key === 'Backspace') && selectedVertexIndex !== null) {
          e.preventDefault();
          if (outline.length > 3) {
            mergeCorner(selectedVertexIndex);
            setSelectedVertexIndex(null);
          } else {
            triggerRedFlash();
            setToastMessage('Room must have at least 3 corners');
          }
          return;
        }

        // Blender numeric input handling when dragging or vertex selected
        const activeIdx = draggingVertexIndex ?? selectedVertexIndex;
        if (activeIdx !== null) {
          if (e.key >= '0' && e.key <= '9') {
            e.preventDefault();
            setNumericInput((prev) => prev + e.key);
          } else if (e.key === '.' && !numericInput.includes('.')) {
            e.preventDefault();
            setNumericInput((prev) => prev + '.');
          } else if (e.key === 'Backspace' && numericInput.length > 0) {
            e.preventDefault();
            setNumericInput((prev) => prev.slice(0, -1));
          } else if (e.key === 'Escape') {
            e.preventDefault();
            setNumericInput('');
          } else if (e.key === 'Enter' && numericInput.length > 0) {
            e.preventDefault();
            const targetLen = parseFloat(numericInput);
            if (Number.isFinite(targetLen) && targetLen > 0.1) {
              const n = outline.length;
              const prevIdx = (activeIdx - 1 + n) % n;
              const prevPt = outline[prevIdx]!;
              const currPt = outline[activeIdx]!;

              const dx = currPt[0] - prevPt[0];
              const dz = currPt[1] - prevPt[1];
              const currLen = Math.hypot(dx, dz);

              if (currLen > 1e-4) {
                const dirX = dx / currLen;
                const dirZ = dz / currLen;
                let newX = prevPt[0] + targetLen * dirX;
                let newZ = prevPt[1] + targetLen * dirZ;

                if (snapEnabled) {
                  newX = snap(newX, gridStep);
                  newZ = snap(newZ, gridStep);
                }

                const candidate = [...outline];
                candidate[activeIdx] = [newX, newZ];

                if (isPolygonSimple(candidate)) {
                  moveVertex(activeIdx, [newX, newZ]);
                  setIsDragging(false);
                  setNumericInput('');
                } else {
                  triggerRedFlash();
                }
              }
            }
          }
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [
    toolMode,
    drawingPoints,
    selectedVertexIndex,
    draggingVertexIndex,
    outline,
    numericInput,
    snapEnabled,
    gridStep,
    moveVertex,
    mergeCorner,
    setOutline,
    setIsDragging,
    setSelectedVertexIndex,
    setToolMode,
    triggerRedFlash,
    setToastMessage,
  ]);

  // Snaps 2D coordinates according to snap settings and orthogonal lock
  const processPoint = useCallback(
    (rawX: number, rawZ: number, refPoint?: Vec2): Vec2 => {
      let x = rawX;
      let z = rawZ;

      // Orthogonal lock when Shift is held
      if (isShiftPressed.current && refPoint) {
        const dx = Math.abs(x - refPoint[0]);
        const dz = Math.abs(z - refPoint[1]);
        if (dx > dz) {
          z = refPoint[1];
        } else {
          x = refPoint[0];
        }
      }

      // Grid snap
      if (snapEnabled) {
        x = snap(x, gridStep);
        z = snap(z, gridStep);
      }

      return [x, z];
    },
    [snapEnabled, gridStep]
  );

  // Ground plane pointer movement
  const handleGroundPointerMove = useCallback(
    (e: ThreeEvent<PointerEvent>) => {
      const point = e.point;

      // 1. Draw floor mode
      if (toolMode === 'draw-floor') {
        const ref = drawingPoints.length > 0 ? drawingPoints[drawingPoints.length - 1] : undefined;
        const processed = processPoint(point.x, point.z, ref);
        setCursorPos(processed);
        if (drawingPoints.length >= 3) {
          const first = drawingPoints[0]!;
          const distToFirst = Math.hypot(processed[0] - first[0], processed[1] - first[1]);
          setIsCloseHovered(distToFirst < 0.35);
        } else {
          setIsCloseHovered(false);
        }
        return;
      }

      if (toolMode !== 'select') return;

      // 2. Corner vertex dragging with angle snapping & angle guide
      if (draggingVertexIndex !== null) {
        const ref = dragVertexStartPos.current ?? undefined;
        const processed = processPoint(point.x, point.z, ref);

        // Smart angle snapping (90° / 45°) relative to adjacent walls
        const n = outline.length;
        const prevIdx = (draggingVertexIndex - 1 + n) % n;
        const nextIdx = (draggingVertexIndex + 1) % n;
        const P = outline[prevIdx]!;
        const Q = outline[nextIdx]!;

        const v1x = P[0] - processed[0];
        const v1z = P[1] - processed[1];
        const v2x = Q[0] - processed[0];
        const v2z = Q[1] - processed[1];
        const len1 = Math.hypot(v1x, v1z);
        const len2 = Math.hypot(v2x, v2z);

        if (len1 > 1e-4 && len2 > 1e-4) {
          const dot = (v1x * v2x + v1z * v2z) / (len1 * len2);
          const clampedDot = Math.max(-1, Math.min(1, dot));
          let angleDeg = (Math.acos(clampedDot) * 180) / Math.PI;

          // Snap to 90° or 45° if within 3.5 degrees
          const targetAngles = [45, 90, 135];
          for (const target of targetAngles) {
            if (Math.abs(angleDeg - target) < 3.5) {
              angleDeg = target;
              break;
            }
          }
          setCornerAngleDeg(angleDeg);
        } else {
          setCornerAngleDeg(null);
        }

        const candidateOutline = [...outline];
        candidateOutline[draggingVertexIndex] = processed;

        const isSimple = isPolygonSimple(candidateOutline);
        if (isSimple) {
          moveVertex(draggingVertexIndex, processed);
          setHasSelfIntersection(false);
        } else {
          setHasSelfIntersection(true);
        }
        return;
      }

      // 3. Wall dragging (perpendicular or extrude)
      if (draggingWallState !== null) {
        if (!originalOutline.current) return;
        const { index, startPoint, isExtrude } = draggingWallState;
        const seg = wallSegment({ outline: originalOutline.current }, index);

        const dx = point.x - startPoint[0];
        const dz = point.z - startPoint[1];
        let deltaNormal = dx * seg.normal[0] + dz * seg.normal[1];

        if (snapEnabled) {
          deltaNormal = snap(deltaNormal, gridStep);
        }
        if (!isExtrude) {
          // Snap flush to a neighbouring room's wall and never stretch into it
          deltaNormal = snapWallMove(originalOutline.current, index, deltaNormal, otherRooms, room.wallThickness);
        }

        const candidate = isExtrude
          ? extrudeWallAlcove(originalOutline.current, index, deltaNormal)
          : moveWallPerpendicular(originalOutline.current, index, deltaNormal);

        const isSimple = isPolygonSimple(candidate);
        if (isSimple) {
          setOutline(candidate);
          setHasSelfIntersection(false);
        } else {
          setHasSelfIntersection(true);
        }

        if (!isExtrude) previewAttachedObjects(seg.normal, isSimple ? deltaNormal : 0);
        setDraggingWallState((prev) => (prev ? { ...prev, accumulatedDelta: deltaNormal } : null));
        return;
      }

      // 4. Room center dragging (move entire room)
      if (draggingRoomCenter !== null) {
        if (!originalOutline.current) return;
        const { startPoint } = draggingRoomCenter;
        let deltaX = point.x - startPoint[0];
        let deltaZ = point.z - startPoint[1];

        if (snapEnabled) {
          deltaX = snap(deltaX, gridStep);
          deltaZ = snap(deltaZ, gridStep);
          // Pull the room flush against neighbouring rooms so walls are shared
          [deltaX, deltaZ] = snapRoomMove(originalOutline.current, [deltaX, deltaZ], otherRooms, room.wallThickness);
        }

        const candidate = originalOutline.current.map(
          (pt) => [Number((pt[0] + deltaX).toFixed(4)), Number((pt[1] + deltaZ).toFixed(4))] as Vec2
        );

        if (isPolygonSimple(candidate)) {
          setOutline(candidate);
          setHasSelfIntersection(false);
        }

        setDraggingRoomCenter((prev) =>
          prev ? { ...prev, accumulatedDelta: [deltaX, deltaZ] } : null
        );
        return;
      }

      // 5. Room scale dragging
      if (draggingRoomScale !== null) {
        const { startPoint, startWidth, startDepth } = draggingRoomScale;
        let deltaX = (point.x - startPoint[0]) * 2;
        let deltaZ = (point.z - startPoint[1]) * 2;

        if (snapEnabled) {
          deltaX = snap(deltaX, gridStep);
          deltaZ = snap(deltaZ, gridStep);
        }

        const targetW = Math.max(1.5, Number((startWidth + deltaX).toFixed(2)));
        const targetD = Math.max(1.5, Number((startDepth + deltaZ).toFixed(2)));

        setDraggingRoomScale((prev) =>
          prev ? { ...prev, accumulatedWidth: targetW, accumulatedDepth: targetD } : null
        );
      }
    },
    [
      previewAttachedObjects,
      toolMode,
      drawingPoints,
      draggingVertexIndex,
      draggingWallState,
      draggingRoomCenter,
      draggingRoomScale,
      outline,
      processPoint,
      moveVertex,
      setOutline,
      snapEnabled,
      gridStep,
      otherRooms,
      room.wallThickness,
    ]
  );

  // Ground plane click for adding points in 'draw-floor' mode
  const handleGroundPointerDown = useCallback(
    (e: ThreeEvent<PointerEvent>) => {
      if (e.button !== 0) return; // Only respond to left clicks

      if (toolMode === 'draw-floor') {
        e.stopPropagation();
        const ref = drawingPoints.length > 0 ? drawingPoints[drawingPoints.length - 1] : undefined;
        const processed = processPoint(e.point.x, e.point.z, ref);

        // If clicking close to the first point and >= 3 points, close outline
        if (drawingPoints.length >= 3) {
          const first = drawingPoints[0]!;
          const dist = Math.hypot(processed[0] - first[0], processed[1] - first[1]);
          if (dist < 0.35) {
            const finalOutline = [...drawingPoints];
            if (signedArea(finalOutline) < 0) {
              finalOutline.reverse();
            }
            if (isPolygonSimple(finalOutline)) {
              setOutline(finalOutline);
              setDrawingPoints([]);
              setToolMode('select');
            } else {
              triggerRedFlash();
            }
            return;
          }
        }

        setDrawingPoints((prev) => [...prev, processed]);
      } else if (toolMode === 'select') {
        // Deselect if clicking empty ground
        setSelectedVertexIndex(null);
        setSelectedWallIndex(null);
        setPopoverWallIndex(null);
        setNumericInput('');
      }
    },
    [
      toolMode,
      drawingPoints,
      processPoint,
      setOutline,
      setSelectedVertexIndex,
      setSelectedWallIndex,
      setToolMode,
      triggerRedFlash,
    ]
  );

  // Start dragging a corner vertex handle
  const handleVertexPointerDown = useCallback(
    (index: number, e: ThreeEvent<PointerEvent>) => {
      if (e.button !== 0 || toolMode !== 'select') return;
      e.stopPropagation();

      setSelectedVertexIndex(index);
      setSelectedWallIndex(null);
      flushSync(() => setDraggingVertexIndex(index));
      dragVertexStartPos.current = [...outline[index]!];
      originalOutline.current = outline.map((pt) => [...pt]);
      setIsDragging(true);
      setHasSelfIntersection(false);
      setNumericInput('');

      if (sharedOrbitControlsRef.current) {
        sharedOrbitControlsRef.current.enabled = false;
      }
    },
    [toolMode, outline, setSelectedVertexIndex, setSelectedWallIndex, setIsDragging]
  );

  // Start dragging a wall body (perpendicular or Alt-extrude)
  const handleWallPointerDown = useCallback(
    (index: number, e: ThreeEvent<PointerEvent>) => {
      if (e.button !== 0 || toolMode !== 'select') return;
      e.stopPropagation();

      useSceneStore.getState().clearSelection();
      setSelectedWallIndex(index);
      setSelectedVertexIndex(null);
      originalOutline.current = outline.map((pt) => [...pt]);

      const isExtrude = e.altKey || isAltPressed.current;
      // Remember the furniture against this wall so it can follow the wall live while dragging
      const currentRoom = useSceneStore.getState().room;
      const attachedIds = new Set(isExtrude ? [] : objectsFlushAgainstWall(currentRoom, index));
      attachedObjects.current = currentRoom.objects
        .filter((o) => attachedIds.has(o.id))
        .map((o) => ({ id: o.id, position: [...o.position] as [number, number, number] }));
      flushSync(() => setDraggingWallState({
        index,
        startPoint: [e.point.x, e.point.z],
        isExtrude,
        accumulatedDelta: 0,
      }));

      setIsDragging(true);
      setHasSelfIntersection(false);

      if (sharedOrbitControlsRef.current) {
        sharedOrbitControlsRef.current.enabled = false;
      }
    },
    [toolMode, outline, setSelectedWallIndex, setSelectedVertexIndex, setIsDragging]
  );

  // Double-click wall body to open opening quick menu at cursor
  const handleWallDoubleClick = useCallback(
    (index: number, e: ThreeEvent<MouseEvent>) => {
      if (toolMode !== 'select') return;
      e.stopPropagation();
      const seg = wallSegment(room, index);
      const toCursorX = e.point.x - seg.a[0];
      const toCursorZ = e.point.z - seg.a[1];
      const cursorT = toCursorX * seg.dir[0] + toCursorZ * seg.dir[1];
      setWallQuickMenu({
        wallIndex: index,
        position: [e.point.x, 0.25, e.point.z],
        clickOffset: Math.max(0, Math.min(seg.len, cursorT)),
      });
      setSelectedWallIndex(index);
    },
    [toolMode, room, setSelectedWallIndex]
  );

  const handleAddOpeningFromMenu = useCallback(
    (subType: OpeningSubType) => {
      if (!wallQuickMenu) return;
      const preset = OPENING_PRESETS[subType];
      const targetWall = wallQuickMenu.wallIndex;
      const seg = wallSegment(room, targetWall);
      const maxOffset = Math.max(0, seg.len - preset.width);
      let targetOffset = wallQuickMenu.clickOffset - preset.width / 2;
      targetOffset = Math.max(0, Math.min(maxOffset, targetOffset));

      const isOpenWall = subType === 'open-wall';
      const resolution = resolveOpeningOverlapOnWall(
        room,
        targetWall,
        isOpenWall ? 0 : targetOffset,
        isOpenWall ? seg.len : preset.width
      );

      if (!resolution.canPlace) {
        setToastMessage(resolution.errorMessage ?? 'Openings cannot overlap on the same wall');
      } else {
        const opening = fitOpeningToWall(createOpeningFromPreset(subType, targetWall, resolution.finalOffset), room);
        addOpening(opening);
        for (const pushed of resolution.pushedOpenings) {
          updateOpening(pushed.id, { offset: pushed.offset });
        }
      }
      setWallQuickMenu(null);
    },
    [wallQuickMenu, room, addOpening, updateOpening, setToastMessage]
  );

  // End dragging any element
  const handlePointerUp = useCallback(() => {
    // 1. End vertex drag
    if (draggingVertexIndex !== null) {
      if (hasSelfIntersection && originalOutline.current) {
        setOutline(originalOutline.current);
        triggerRedFlash();
      }
      setDraggingVertexIndex(null);
      dragVertexStartPos.current = null;
      originalOutline.current = null;
      setCornerAngleDeg(null);
      setIsDragging(false);
      setHasSelfIntersection(false);

      if (sharedOrbitControlsRef.current) {
        sharedOrbitControlsRef.current.enabled = true;
      }
    }

    // 2. End wall drag
    if (draggingWallState !== null) {
      const { index, isExtrude, accumulatedDelta } = draggingWallState;
      // Put the previewed furniture back; moveWall re-applies the move as one undo step
      previewAttachedObjects([0, 0], 0);
      attachedObjects.current = [];
      if (hasSelfIntersection && originalOutline.current) {
        setOutline(originalOutline.current);
        triggerRedFlash();
      } else if (originalOutline.current && Math.abs(accumulatedDelta) > 1e-4) {
        // Revert temporary outline and commit action so history/undo and openings sync properly
        setOutline(originalOutline.current);
        if (isExtrude) {
          extrudeWall(index, accumulatedDelta);
        } else {
          moveWall(index, accumulatedDelta);
        }
      }

      setDraggingWallState(null);
      originalOutline.current = null;
      setIsDragging(false);
      setHasSelfIntersection(false);

      if (sharedOrbitControlsRef.current) {
        sharedOrbitControlsRef.current.enabled = true;
      }
    }

    // 3. End room center move drag
    if (draggingRoomCenter !== null) {
      const { accumulatedDelta } = draggingRoomCenter;
      if (originalOutline.current && (accumulatedDelta[0] !== 0 || accumulatedDelta[1] !== 0)) {
        setOutline(originalOutline.current);
        moveRoom(accumulatedDelta);
      }
      setDraggingRoomCenter(null);
      originalOutline.current = null;
      setIsDragging(false);
      if (sharedOrbitControlsRef.current) {
        sharedOrbitControlsRef.current.enabled = true;
      }
    }

    // 4. End room scale drag
    if (draggingRoomScale !== null) {
      const { accumulatedWidth, accumulatedDepth } = draggingRoomScale;
      scaleRoom(accumulatedWidth, accumulatedDepth);
      setDraggingRoomScale(null);
      setIsDragging(false);
      if (sharedOrbitControlsRef.current) {
        sharedOrbitControlsRef.current.enabled = true;
      }
    }
  }, [
    previewAttachedObjects,
    draggingVertexIndex,
    draggingWallState,
    draggingRoomCenter,
    draggingRoomScale,
    hasSelfIntersection,
    setOutline,
    moveWall,
    extrudeWall,
    moveRoom,
    scaleRoom,
    setIsDragging,
    triggerRedFlash,
  ]);

  // Window pointerup safeguard
  useEffect(() => {
    window.addEventListener('pointerup', handlePointerUp);
    return () => window.removeEventListener('pointerup', handlePointerUp);
  }, [handlePointerUp]);

  const bounds = useMemo(() => {
    return polygonBounds(outline);
  }, [outline]);

  // Room centroid for center move handle
  const roomCentroid = useMemo(() => {
    if (outline.length === 0) return [0, 0] as Vec2;
    let sx = 0;
    let sz = 0;
    for (const pt of outline) {
      sx += pt[0];
      sz += pt[1];
    }
    return [sx / outline.length, sz / outline.length] as Vec2;
  }, [outline]);

  // Wall segments geometry for dimension labels, hit boxes, and midpoint handles
  const wallData = useMemo(() => {
    if (outline.length < 2) return [];
    return outline
      .map((_, i) => {
        try {
          const seg = wallSegment({ outline }, i);
          const midX = (seg.a[0] + seg.b[0]) / 2;
          const midZ = (seg.a[1] + seg.b[1]) / 2;
          const angle = Math.atan2(seg.b[1] - seg.a[1], seg.b[0] - seg.a[0]);
          return {
            index: i,
            len: seg.len,
            midX,
            midZ,
            angle,
            normalX: seg.normal[0],
            normalZ: seg.normal[1],
          };
        } catch {
          return null;
        }
      })
      .filter(Boolean) as {
      index: number;
      len: number;
      midX: number;
      midZ: number;
      angle: number;
      normalX: number;
      normalZ: number;
    }[];
  }, [outline]);

  // Memoized line connecting placed drawing points
  const connectedLine = useMemo(() => {
    if (drawingPoints.length < 2) return null;
    const geom = new THREE.BufferGeometry().setFromPoints(
      drawingPoints.map((p) => new THREE.Vector3(p[0], 0.05, p[1]))
    );
    const mat = new THREE.LineBasicMaterial({ color: 0x38bdf8, linewidth: 2 });
    return new THREE.Line(geom, mat);
  }, [drawingPoints]);

  useEffect(() => {
    return () => {
      connectedLine?.geometry.dispose();
      (connectedLine?.material as THREE.Material | undefined)?.dispose();
    };
  }, [connectedLine]);

  // Memoized rubberband line to cursor
  const rubberbandLine = useMemo(() => {
    if (drawingPoints.length === 0 || !cursorPos) return null;
    const last = drawingPoints[drawingPoints.length - 1]!;
    const geom = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(last[0], 0.05, last[1]),
      new THREE.Vector3(cursorPos[0], 0.05, cursorPos[1]),
    ]);
    const mat = new THREE.LineDashedMaterial({
      color: 0x67e8f9,
      dashSize: 0.2,
      gapSize: 0.1,
    });
    const line = new THREE.Line(geom, mat);
    line.computeLineDistances();
    return line;
  }, [drawingPoints, cursorPos]);

  useEffect(() => {
    return () => {
      rubberbandLine?.geometry.dispose();
      (rubberbandLine?.material as THREE.Material | undefined)?.dispose();
    };
  }, [rubberbandLine]);

  // Handle popover exact length commit
  const handleApplyPopoverLength = useCallback(() => {
    if (popoverWallIndex === null) return;
    const targetLen = parseFloat(popoverLength);
    if (!Number.isFinite(targetLen) || targetLen <= 0.1) return;

    const res = setWallLength(popoverWallIndex, targetLen, popoverAnchor);
    if (res.removedOpenings.length > 0) {
      setToastMessage(
        `${res.removedOpenings.length} opening(s) removed (wall too short)`,
        true
      );
    }
    setPopoverWallIndex(null);
  }, [popoverWallIndex, popoverLength, popoverAnchor, setWallLength, setToastMessage]);

  // End drags on any mouse-up, even outside the canvas. Runs a frame later so React has rendered the
  // state set by the matching pointer-down (a very fast click would otherwise see stale state).
  const roomDiscPressed = useRef(false);
  useEffect(() => {
    const reset = () => {
      roomDiscPressed.current = false;
    };
    window.addEventListener('pointerdown', reset, true);
    return () => window.removeEventListener('pointerdown', reset, true);
  }, []);
  const handlePointerUpRef = useRef(handlePointerUp);
  handlePointerUpRef.current = handlePointerUp;
  useEffect(() => {
    const onUp = () => requestAnimationFrame(() => handlePointerUpRef.current());
    window.addEventListener('pointerup', onUp);
    return () => window.removeEventListener('pointerup', onUp);
  }, []);

  return (
    <group name="floor-plan-editor">
      {/* Invisible ground plane raycaster for pointer events */}
      <mesh
        position={[0, 0, 0]}
        rotation={[-Math.PI / 2, 0, 0]}
        visible={false}
        onPointerMove={handleGroundPointerMove}
        onPointerDown={handleGroundPointerDown}
      >
        <planeGeometry args={[2000, 2000]} />
      </mesh>

      {/* =========================================
          DRAW-FLOOR MODE VISUALIZATIONS
          ========================================= */}
      {toolMode === 'draw-floor' && (
        <group name="draw-floor-mode">
          {/* Placed points */}
          {drawingPoints.map((pt, i) => (
            <mesh
              key={`draw-pt-${i}`}
              position={[pt[0], 0.05, pt[1]]}
              onPointerDown={(e) => {
                if (i === 0 && drawingPoints.length >= 3) {
                  e.stopPropagation();
                  const finalOutline = [...drawingPoints];
                  if (signedArea(finalOutline) < 0) finalOutline.reverse();
                  if (isPolygonSimple(finalOutline)) {
                    setOutline(finalOutline);
                    setDrawingPoints([]);
                    setToolMode('select');
                  } else {
                    triggerRedFlash();
                  }
                }
              }}
            >
              <sphereGeometry args={[i === 0 && isCloseHovered ? 0.18 : 0.12, 16, 16]} />
              <meshStandardMaterial
                color={i === 0 && isCloseHovered ? '#22c55e' : '#38bdf8'}
                emissive={i === 0 && isCloseHovered ? '#15803d' : '#0284c7'}
                emissiveIntensity={0.6}
              />
            </mesh>
          ))}

          {/* Connected segments */}
          {connectedLine && <primitive object={connectedLine} />}

          {/* Active rubberband line to cursor */}
          {rubberbandLine && cursorPos && (
            <>
              <primitive object={rubberbandLine} />

              {/* Cursor preview pin */}
              <mesh position={[cursorPos[0], 0.05, cursorPos[1]]}>
                <sphereGeometry args={[0.09, 16, 16]} />
                <meshStandardMaterial color="#67e8f9" />
              </mesh>

              {/* Live dimension on active rubberband segment */}
              <Html
                center
                position={[
                  (drawingPoints[drawingPoints.length - 1]![0] + cursorPos[0]) / 2,
                  0.1,
                  (drawingPoints[drawingPoints.length - 1]![1] + cursorPos[1]) / 2,
                ]}
                className="pointer-events-none select-none"
              >
                <div className="bg-neutral-900/90 border border-cyan-500/60 text-cyan-300 text-[10px] font-mono font-semibold px-1.5 py-0.5 rounded shadow">
                  {Math.hypot(
                    cursorPos[0] - drawingPoints[drawingPoints.length - 1]![0],
                    cursorPos[1] - drawingPoints[drawingPoints.length - 1]![1]
                  ).toFixed(2)}
                  m
                </div>
              </Html>
            </>
          )}

          {/* Closing prompt banner */}
          {drawingPoints.length >= 3 && isCloseHovered && drawingPoints[0] && (
            <Html
              center
              position={[drawingPoints[0][0], 0.4, drawingPoints[0][1]]}
              className="pointer-events-none select-none"
            >
              <div className="bg-emerald-950/90 border border-emerald-500 text-emerald-300 text-xs font-semibold px-2 py-1 rounded shadow animate-pulse">
                Click or Enter to close room
              </div>
            </Html>
          )}
        </group>
      )}

      {/* =========================================
          SELECT MODE: VERTICES, WALL BODIES & HANDLES
          ========================================= */}
      {toolMode === 'select' && (
        <group name="select-mode-handles">
          {/* 1. Interactive Wall Body Hit Meshes (Perpendicular Drag / Alt-Extrude) */}
          {wallData.map((w) => {
            const isSelected = selectedWallIndex === w.index;
            const isHovered = hoveredWallIndex === w.index;
            const isDraggingThis = draggingWallState?.index === w.index;
            const isError = (hasSelfIntersection && isDraggingThis) || flashRedEdge;

            return (
              <mesh
                key={`wall-hit-${w.index}`}
                // Offset outward so the grab strip covers the wall, not the floor inside the room
                position={[w.midX + w.normalX * 0.175, 0.04, w.midZ + w.normalZ * 0.175]}
                rotation={[0, -w.angle, 0]}
                onPointerOver={(e) => {
                  if (isWallFacingAwayFromCamera(w, e.camera, view)) return;
                  e.stopPropagation();
                  setHoveredWallIndex(w.index);
                  setCanvasCursor('move');
                }}
                onPointerOut={(e) => {
                  e.stopPropagation();
                  setHoveredWallIndex(null);
                  resetCanvasCursor();
                }}
                onPointerDown={(e) => {
                  // Walls between the camera and the room are faded out; let clicks/orbits pass through
                  if (isWallFacingAwayFromCamera(w, e.camera, view)) return;
                  setCanvasCursor('grabbing');
                  handleWallPointerDown(w.index, e);
                }}
                onPointerUp={() => resetCanvasCursor()}
                onDoubleClick={(e) => handleWallDoubleClick(w.index, e)}
              >
                <boxGeometry args={[w.len, 0.08, 0.35]} />
                <meshStandardMaterial
                  color={
                    isError
                      ? '#ef4444'
                      : isDraggingThis
                        ? '#10b981'
                        : isSelected
                          ? '#f59e0b'
                          : '#38bdf8'
                  }
                  transparent
                  opacity={isSelected || isDraggingThis || isError ? 0.4 : isHovered ? 0.25 : 0.001}
                />
              </mesh>
            );
          })}

          {/* 1b. Stretch handles: drag a wall in or out to resize the room. One outside and one
              inside each wall, so a wall shared with a neighbouring room can still be grabbed */}
          {wallData.flatMap((w) => [1, -1].map((side) => ({ w, side }))).map(({ w, side }) => {
            const isDraggingThis = draggingWallState?.index === w.index && !draggingWallState.isExtrude;
            const isHovered = hoveredStretchIndex === w.index;
            const offset = side > 0 ? room.wallThickness + 0.28 : -0.4;
            const hx = w.midX + w.normalX * offset;
            const hz = w.midZ + w.normalZ * offset;
            // Rotate so the handle's local +X points along the wall's outward normal
            const rotY = Math.atan2(-w.normalZ, w.normalX);
            const color = isDraggingThis ? '#10b981' : isHovered ? '#818cf8' : '#6366f1';
            const sizeAcross = wallData[(w.index + 1) % wallData.length]?.len ?? 0;

            return (
              <group key={`stretch-${w.index}-${side}`} position={[hx, 0.06, hz]} rotation={[0, rotY, 0]}>
                <mesh
                  onPointerOver={(e) => {
                    e.stopPropagation();
                    setHoveredStretchIndex(w.index);
                    setCanvasCursor(Math.abs(w.normalX) > Math.abs(w.normalZ) ? 'ew-resize' : 'ns-resize');
                  }}
                  onPointerOut={() => {
                    setHoveredStretchIndex(null);
                    resetCanvasCursor();
                  }}
                  onPointerDown={(e) => {
                    if (e.button !== 0) return;
                    handleWallPointerDown(w.index, e);
                  }}
                  onPointerUp={() => resetCanvasCursor()}
                >
                  <boxGeometry args={[0.42, 0.05, 0.26]} />
                  <meshBasicMaterial color={color} />
                </mesh>
                {/* Double arrow: out and in */}
                <mesh position={[0.17, 0.04, 0]} rotation={[0, 0, -Math.PI / 2]} raycast={() => null}>
                  <coneGeometry args={[0.07, 0.12, 3]} />
                  <meshBasicMaterial color="#ffffff" />
                </mesh>
                <mesh position={[-0.17, 0.04, 0]} rotation={[0, 0, Math.PI / 2]} raycast={() => null}>
                  <coneGeometry args={[0.07, 0.12, 3]} />
                  <meshBasicMaterial color="#ffffff" />
                </mesh>
                {(isDraggingThis || isHovered) && side > 0 && (
                  <Html center position={[0, 0.3, 0]} className="pointer-events-none select-none" zIndexRange={[30, 0]}>
                    <div className="whitespace-nowrap rounded bg-neutral-950/90 px-1.5 py-0.5 font-mono text-[11px] font-semibold text-emerald-300 shadow">
                      {isDraggingThis ? `${sizeAcross.toFixed(2)} m` : 'Drag to stretch'}
                    </div>
                  </Html>
                )}
              </group>
            );
          })}

          {/* 2. Draggable Corner Vertex Handles */}
          {outline.map((pt, index) => {
            const isSelected = selectedVertexIndex === index;
            const isDraggingThis = draggingVertexIndex === index;
            const isError = (hasSelfIntersection && isDraggingThis) || flashRedEdge;

            return (
              <mesh
                key={`vertex-${index}`}
                position={[pt[0], 0.05, pt[1]]}
                visible={isSelected || isDraggingThis || hoveredWallIndex !== null && (() => { const wall = wallData[hoveredWallIndex]; return !!wall && ((wall.midX === pt[0] && wall.midZ === pt[1]) || Math.hypot(wall.midX - pt[0], wall.midZ - pt[1]) <= wall.len / 2 + 0.01); })()}
                onPointerOver={(e) => {
                  e.stopPropagation();
                  setCanvasCursor('move');
                }}
                onPointerOut={() => resetCanvasCursor()}
                onPointerDown={(e) => {
                  setCanvasCursor('grabbing');
                  handleVertexPointerDown(index, e);
                }}
                onPointerUp={() => resetCanvasCursor()}
              >
                <cylinderGeometry args={[0.13, 0.13, 0.08, 16]} />
                <meshStandardMaterial
                  color={
                    isError
                      ? '#ef4444'
                      : isDraggingThis
                        ? '#10b981'
                        : isSelected
                          ? '#f59e0b'
                          : '#38bdf8'
                  }
                  emissive={
                    isError
                      ? '#b91c1c'
                      : isDraggingThis
                        ? '#047857'
                        : isSelected
                          ? '#d97706'
                          : '#0284c7'
                  }
                  emissiveIntensity={isSelected || isDraggingThis || isError ? 0.7 : 0.3}
                />
              </mesh>
            );
          })}

          {/* 3. Wall Midpoint "+" Button (Click to split wall) */}
          {wallData.map((w) => {
            const isVisible = hoveredWallIndex === w.index || selectedWallIndex === w.index;
            if (!isVisible) return null;

            return (
              <Html
                key={`midpoint-btn-${w.index}`}
                center
                position={[w.midX, 0.12, w.midZ]}
                className="select-none"
              >
                <button
                  type="button"
                  data-testid={`wall-split-btn-${w.index}`}
                  onClick={(e) => {
                    e.stopPropagation();
                    splitWall(w.index, [w.midX, w.midZ]);
                    setSelectedWallIndex(null);
                  }}
                  className="w-5 h-5 bg-sky-500 hover:bg-sky-400 text-white rounded-full flex items-center justify-center text-xs font-bold shadow-lg hover:scale-110 transition-transform cursor-pointer"
                  title="Click to split wall (insert corner)"
                >
                  +
                </button>
              </Html>
            );
          })}

          {/* Wall Opening Quick Menu (Triggered on Double-Clicking any wall) */}
          {wallQuickMenu && (
            <Html
              center
              position={wallQuickMenu.position}
              zIndexRange={[160, 0]}
              className="select-none pointer-events-auto"
            >
              <div
                data-testid="wall-quick-menu"
                className="bg-neutral-900/95 backdrop-blur-md border border-neutral-700/80 shadow-2xl rounded-xl p-2.5 text-neutral-200 w-52 flex flex-col gap-1.5 text-xs font-sans"
                onPointerDown={(e) => e.stopPropagation()}
                onClick={(e) => e.stopPropagation()}
              >
                <div className="flex items-center justify-between pb-1.5 border-b border-neutral-800">
                  <span className="font-semibold text-white text-[11px] uppercase tracking-wider">
                    Add on Wall #{wallQuickMenu.wallIndex + 1}
                  </span>
                  <button
                    type="button"
                    onClick={() => setWallQuickMenu(null)}
                    className="text-neutral-400 hover:text-white p-0.5 rounded hover:bg-neutral-800 text-xs"
                    title="Close"
                  >
                    ✕
                  </button>
                </div>

                <div className="flex flex-col gap-1">
                  <button
                    type="button"
                    data-testid="quick-add-door"
                    onClick={() => handleAddOpeningFromMenu('single-door')}
                    className="flex items-center justify-between px-2 py-1.5 rounded-lg hover:bg-sky-600/30 hover:border-sky-500/50 border border-transparent text-left transition-all group cursor-pointer"
                  >
                    <div className="flex items-center gap-2">
                      <span className="text-amber-400">🚪</span>
                      <span className="font-medium text-white group-hover:text-sky-300">Add Door</span>
                    </div>
                    <span className="text-[10px] text-neutral-400 font-mono">0.9 m</span>
                  </button>

                  <button
                    type="button"
                    data-testid="quick-add-window"
                    onClick={() => handleAddOpeningFromMenu('window')}
                    className="flex items-center justify-between px-2 py-1.5 rounded-lg hover:bg-sky-600/30 hover:border-sky-500/50 border border-transparent text-left transition-all group cursor-pointer"
                  >
                    <div className="flex items-center gap-2">
                      <span className="text-sky-400">🪟</span>
                      <span className="font-medium text-white group-hover:text-sky-300">Add Window</span>
                    </div>
                    <span className="text-[10px] text-neutral-400 font-mono">1.2 m</span>
                  </button>

                  <button
                    type="button"
                    data-testid="quick-add-wide-window"
                    onClick={() => handleAddOpeningFromMenu('wide-window')}
                    className="flex items-center justify-between px-2 py-1.5 rounded-lg hover:bg-sky-600/30 hover:border-sky-500/50 border border-transparent text-left transition-all group cursor-pointer"
                  >
                    <div className="flex items-center gap-2">
                      <span className="text-sky-400">🪟</span>
                      <span className="font-medium text-white group-hover:text-sky-300">Add Wide Window</span>
                    </div>
                    <span className="text-[10px] text-neutral-400 font-mono">1.8 m</span>
                  </button>

                  <button
                    type="button"
                    data-testid="quick-add-archway"
                    onClick={() => handleAddOpeningFromMenu('archway')}
                    className="flex items-center justify-between px-2 py-1.5 rounded-lg hover:bg-sky-600/30 hover:border-sky-500/50 border border-transparent text-left transition-all group cursor-pointer"
                  >
                    <div className="flex items-center gap-2">
                      <span className="text-stone-300">🏛</span>
                      <span className="font-medium text-white group-hover:text-sky-300">Add Archway</span>
                    </div>
                    <span className="text-[10px] text-neutral-400 font-mono">1.0 m</span>
                  </button>

                  <button
                    type="button"
                    data-testid="quick-add-sliding-door"
                    onClick={() => handleAddOpeningFromMenu('sliding-door')}
                    className="flex items-center justify-between px-2 py-1.5 rounded-lg hover:bg-sky-600/30 hover:border-sky-500/50 border border-transparent text-left transition-all group cursor-pointer"
                  >
                    <div className="flex items-center gap-2">
                      <span className="text-amber-400">↔</span>
                      <span className="font-medium text-white group-hover:text-sky-300">Add Sliding Door</span>
                    </div>
                    <span className="text-[10px] text-neutral-400 font-mono">1.8 m</span>
                  </button>
                </div>

                <div className="border-t border-neutral-800 pt-1 mt-0.5">
                  <button
                    type="button"
                    onClick={() => {
                      if (wallQuickMenu) {
                        splitWall(wallQuickMenu.wallIndex, [wallQuickMenu.position[0], wallQuickMenu.position[2]]);
                        setWallQuickMenu(null);
                      }
                    }}
                    className="w-full text-center py-1 text-[10px] text-neutral-400 hover:text-white hover:bg-neutral-800/80 rounded transition-colors cursor-pointer"
                  >
                    Split wall at this point
                  </button>
                </div>
              </div>
            </Html>
          )}

          {/* 4. Live Degree Readout during Corner Angle Snapping */}
          {draggingVertexIndex !== null && cornerAngleDeg !== null && (
            <Html
              center
              position={[outline[draggingVertexIndex]![0], 0.35, outline[draggingVertexIndex]![1]]}
              className="pointer-events-none select-none"
            >
              <div className="bg-neutral-900/95 border border-cyan-400 text-cyan-200 font-mono text-xs font-bold px-2 py-1 rounded shadow-xl flex items-center gap-1">
                <span>📐</span>
                <span>{cornerAngleDeg.toFixed(1)}°</span>
              </div>
            </Html>
          )}

          {/* 5. Blender-style Numeric Input HUD */}
          {(draggingVertexIndex !== null || selectedVertexIndex !== null) &&
            numericInput.length > 0 && (
              <Html
                center
                position={[
                  outline[draggingVertexIndex ?? selectedVertexIndex!]![0],
                  0.45,
                  outline[draggingVertexIndex ?? selectedVertexIndex!]![1],
                ]}
                className="pointer-events-none select-none"
              >
                <div className="bg-neutral-900/95 border border-amber-500 text-amber-300 font-mono text-xs px-2.5 py-1.5 rounded-md shadow-xl flex items-center gap-1.5 whitespace-nowrap">
                  <span className="text-neutral-400 font-sans">Wall Length:</span>
                  <span className="font-bold text-amber-200">{numericInput} m</span>
                  <span className="text-[10px] text-neutral-400 font-sans">
                    (Enter: apply, Esc: cancel)
                  </span>
                </div>
              </Html>
            )}

          {/* 6. Room Center Move Handle */}
          <group position={[roomCentroid[0], 0.02, roomCentroid[1]]}>
            <mesh
              onPointerOver={(e) => {
                e.stopPropagation();
                setCanvasCursor('move');
              }}
              onPointerOut={() => resetCanvasCursor()}
              onPointerDown={(e) => {
                if (e.button !== 0) return;
                e.stopPropagation();
                roomDiscPressed.current = true;
                setCanvasCursor('grabbing');
                originalOutline.current = outline.map((pt) => [...pt]);
                flushSync(() => setDraggingRoomCenter({
                  startPoint: [e.point.x, e.point.z],
                  accumulatedDelta: [0, 0],
                }));
                setIsDragging(true);
                if (sharedOrbitControlsRef.current) {
                  sharedOrbitControlsRef.current.enabled = false;
                }
              }}
              onPointerUp={() => resetCanvasCursor()}
              onClick={(e) => {
                // A click without dragging selects the room itself (only if the press began on the disc,
                // not on furniture standing over it)
                if (e.delta > 4 || !roomDiscPressed.current) return;
                e.stopPropagation();
                useSceneStore.getState().clearSelection();
                setSelectedWallIndex(null);
                setSelectedVertexIndex(null);
                useUiStore.getState().setRoomSelected(true);
              }}
            >
              <cylinderGeometry args={[0.26, 0.26, 0.03, 24]} />
              <meshStandardMaterial
                color={roomSelected ? '#f59e0b' : '#6366f1'}
                emissive={roomSelected ? '#b45309' : '#4338ca'}
                emissiveIntensity={draggingRoomCenter || roomSelected ? 0.8 : 0.3}
                roughness={0.4}
              />
            </mesh>
            {roomSelected && !draggingRoomCenter && (
              <Html center position={[0, 0.5, 0]} className="select-none" zIndexRange={[60, 0]}>
                <div
                  data-testid="room-selected-panel"
                  className="flex items-center gap-2 whitespace-nowrap rounded-full border border-neutral-700/80 bg-neutral-900/95 px-3 py-1.5 text-xs text-neutral-200 shadow-2xl backdrop-blur-md"
                  onPointerDown={(e) => e.stopPropagation()}
                >
                  <span className="font-semibold text-white">{room.name}</span>
                  <button
                    type="button"
                    data-testid="delete-room-btn"
                    onClick={deleteActiveRoom}
                    className="rounded-md px-2 py-0.5 font-medium text-red-400 hover:bg-red-500/15 hover:text-red-300"
                    title="Delete room (Delete)"
                  >
                    Delete room
                  </button>
                  <button
                    type="button"
                    onClick={() => useUiStore.getState().setRoomSelected(false)}
                    className="text-neutral-500 hover:text-white"
                    aria-label="Deselect room"
                  >
                    ✕
                  </button>
                </div>
              </Html>
            )}
            <Html center position={[0, 0.12, 0]} className="pointer-events-none select-none">
              <span className="text-white text-xs select-none pointer-events-none font-bold">
                ✥
              </span>
            </Html>
          </group>

          {/* 7. Room Scale Handle at Outer Corner */}
          <group position={[bounds.max[0] + 0.35, 0.03, bounds.max[1] + 0.35]}>
            <mesh
              onPointerOver={(e) => {
                e.stopPropagation();
                setCanvasCursor('nwse-resize');
              }}
              onPointerOut={() => resetCanvasCursor()}
              onPointerDown={(e) => {
                if (e.button !== 0) return;
                e.stopPropagation();
                setCanvasCursor('nwse-resize');
                const curW = bounds.max[0] - bounds.min[0];
                const curD = bounds.max[1] - bounds.min[1];
                flushSync(() => setDraggingRoomScale({
                  startPoint: [e.point.x, e.point.z],
                  startWidth: curW,
                  startDepth: curD,
                  accumulatedWidth: curW,
                  accumulatedDepth: curD,
                }));
                setIsDragging(true);
                if (sharedOrbitControlsRef.current) {
                  sharedOrbitControlsRef.current.enabled = false;
                }
              }}
              onPointerUp={() => resetCanvasCursor()}
            >
              <boxGeometry args={[0.2, 0.06, 0.2]} />
              <meshStandardMaterial
                color="#a855f7"
                emissive="#7e22ce"
                emissiveIntensity={draggingRoomScale ? 0.8 : 0.4}
              />
            </mesh>
            <Html center position={[0, 0.12, 0]} className="pointer-events-none select-none">
              <span className="text-white text-[10px] select-none pointer-events-none font-bold">
                ⤢
              </span>
            </Html>
          </group>
        </group>
      )}

      {/* Empty State Guide for Draw Floor mode */}
      {toolMode === 'draw-floor' && drawingPoints.length === 0 && (
        <Html center position={[0, 0.25, 0]} className="pointer-events-none select-none">
          <div
            data-testid="draw-floor-empty-guide"
            className="bg-neutral-900/90 backdrop-blur-md border border-sky-500/50 rounded-xl px-4 py-2.5 shadow-2xl text-xs text-neutral-200 flex items-center gap-2.5 font-sans"
          >
            <span className="text-xl">📐</span>
            <div className="flex flex-col">
              <span className="font-semibold text-white">
                Click anywhere to start drawing floor
              </span>
              <span className="text-[11px] text-neutral-400">
                Click corners on the grid. Click start point or press Enter to close. Esc to cancel.
              </span>
            </div>
          </div>
        </Html>
      )}

      {/* =========================================
          LIVE DIMENSIONS & WALL LENGTH POPOVER
          ========================================= */}
      <group name="live-dimensions">
        {wallData.map((w) => {
          const isSelected = selectedWallIndex === w.index;
          const isHovered = hoveredWallIndex === w.index;
          const shouldShow = (showDimensions && showAllWallDimensions) || isSelected || isHovered;
          if (!shouldShow) return null;

          const posX = w.midX + w.normalX * 0.32;
          const posZ = w.midZ + w.normalZ * 0.32;
          const isError = flashRedEdge || hasSelfIntersection;

          return (
            <React.Fragment key={`dim-group-${w.index}`}>
              <Html center position={[posX, 0.08, posZ]} className="select-none" distanceFactor={0}>
                <div
                  data-testid={`wall-dim-${w.index}`}
                  onDoubleClick={(e) => {
                    e.stopPropagation();
                    setPopoverWallIndex(w.index);
                    setPopoverLength(w.len.toFixed(2));
                    setPopoverAnchor('center');
                  }}
                  onClick={(e) => {
                    e.stopPropagation();
                    setSelectedWallIndex(w.index);
                    setSelectedVertexIndex(null);
                  }}
                  className={`cursor-pointer backdrop-blur-sm border text-[10px] font-mono font-medium px-1.5 py-0.5 rounded shadow whitespace-nowrap transition-colors duration-150 ${
                    isError
                      ? 'bg-red-950/90 border-red-500 text-red-200'
                      : isSelected
                        ? 'bg-amber-950/90 border-amber-500 text-amber-200 ring-1 ring-amber-400'
                        : isHovered
                          ? 'bg-sky-950/90 border-sky-500 text-sky-200'
                          : 'bg-neutral-900/85 border-neutral-700/60 text-neutral-200 hover:border-neutral-500'
                  }`}
                  title="Double-click to set exact length"
                >
                  {w.len.toFixed(2)}m
                </div>
              </Html>

              {/* Exact Wall Length Popover */}
              {popoverWallIndex === w.index && (
                <Html center position={[w.midX, 0.45, w.midZ]} className="select-none z-50">
                  <div
                    data-testid="wall-length-popover"
                    className="bg-neutral-900/95 border border-sky-500/80 rounded-xl p-3 shadow-2xl backdrop-blur-md flex flex-col gap-2 w-56 text-neutral-200 animate-in fade-in"
                  >
                    <div className="flex items-center justify-between text-xs font-semibold text-white">
                      <span>Wall #{w.index + 1} Length</span>
                      <button
                        type="button"
                        onClick={() => setPopoverWallIndex(null)}
                        className="text-neutral-400 hover:text-white text-sm"
                      >
                        ✕
                      </button>
                    </div>

                    <div className="flex items-center gap-1.5">
                      <input
                        type="number"
                        data-testid="popover-length-input"
                        step="0.05"
                        min="0.2"
                        value={popoverLength}
                        onChange={(e) => setPopoverLength(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') handleApplyPopoverLength();
                          if (e.key === 'Escape') setPopoverWallIndex(null);
                        }}
                        autoFocus
                        className="w-full bg-neutral-800 border border-neutral-700 rounded px-2 py-1 font-mono text-white text-xs focus:outline-none focus:border-sky-500"
                      />
                      <span className="text-neutral-400 font-mono text-xs">m</span>
                    </div>

                    <div className="flex flex-col gap-1">
                      <span className="text-[10px] text-neutral-400 uppercase font-semibold">
                        Anchor:
                      </span>
                      <div className="grid grid-cols-3 gap-1 text-[10px]">
                        {(['start', 'center', 'end'] as const).map((anchor) => (
                          <button
                            key={anchor}
                            type="button"
                            data-testid={`anchor-${anchor}-btn`}
                            onClick={() => setPopoverAnchor(anchor)}
                            className={`py-1 rounded capitalize font-medium border transition-colors ${
                              popoverAnchor === anchor
                                ? 'bg-sky-600 border-sky-400 text-white'
                                : 'bg-neutral-800 border-neutral-700 text-neutral-300 hover:bg-neutral-700'
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

                    <button
                      type="button"
                      data-testid="apply-popover-length-btn"
                      onClick={handleApplyPopoverLength}
                      className="mt-1 w-full py-1 bg-sky-500 hover:bg-sky-400 text-neutral-950 font-bold rounded text-xs transition-colors cursor-pointer"
                    >
                      Apply Length
                    </button>
                  </div>
                </Html>
              )}
            </React.Fragment>
          );
        })}
      </group>
    </group>
  );
};

export default FloorPlanEditor;
