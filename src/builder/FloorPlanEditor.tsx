import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ThreeEvent } from '@react-three/fiber';
import { Html } from '@react-three/drei';
import * as THREE from 'three';
import { isPolygonSimple, polygonBounds, signedArea, wallSegment } from '../core/parser';
import type { Vec2 } from '../core/schema';
import { snap } from '../core/units';
import { useSceneStore } from '../store/sceneStore';
import { useUiStore } from '../store/uiStore';
import { sharedOrbitControlsRef } from './Canvas';

export const FloorPlanEditor: React.FC = () => {
  const room = useSceneStore((state) => state.room);
  const moveVertex = useSceneStore((state) => state.moveVertex);
  const insertVertex = useSceneStore((state) => state.insertVertex);
  const removeVertex = useSceneStore((state) => state.removeVertex);
  const setOutline = useSceneStore((state) => state.setOutline);
  const setIsDragging = useSceneStore((state) => state.setIsDragging);

  const toolMode = useUiStore((state) => state.toolMode);
  const setToolMode = useUiStore((state) => state.setToolMode);
  const snapEnabled = useUiStore((state) => state.snapEnabled);
  const gridStep = useUiStore((state) => state.gridStep);
  const showDimensions = useUiStore((state) => state.showDimensions);
  const selectedVertexIndex = useUiStore((state) => state.selectedVertexIndex);
  const setSelectedVertexIndex = useUiStore((state) => state.setSelectedVertexIndex);

  // Drawing state for 'draw-floor' mode
  const [drawingPoints, setDrawingPoints] = useState<Vec2[]>([]);
  const [cursorPos, setCursorPos] = useState<Vec2 | null>(null);
  const [isCloseHovered, setIsCloseHovered] = useState<boolean>(false);

  // Dragging vertex state in 'select' mode
  const [draggingIndex, setDraggingIndex] = useState<number | null>(null);
  const dragStartPos = useRef<Vec2 | null>(null);
  const originalOutline = useRef<Vec2[] | null>(null);
  const [hasSelfIntersection, setHasSelfIntersection] = useState<boolean>(false);
  const [flashRedEdge, setFlashRedEdge] = useState<boolean>(false);

  // Blender-style numeric input while dragging or editing vertex
  const [numericInput, setNumericInput] = useState<string>('');

  // Shift key orthogonal lock tracking
  const isShiftPressed = useRef<boolean>(false);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Shift') isShiftPressed.current = true;
    };
    const handleKeyUp = (e: KeyboardEvent) => {
      if (e.key === 'Shift') isShiftPressed.current = false;
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
            // Ensure Counter-Clockwise winding
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
        // Delete or Backspace to remove selected vertex (min 3)
        if ((e.key === 'Delete' || e.key === 'Backspace') && selectedVertexIndex !== null) {
          e.preventDefault();
          if (room.outline.length > 3) {
            const candidate = room.outline.filter((_, idx) => idx !== selectedVertexIndex);
            if (isPolygonSimple(candidate)) {
              removeVertex(selectedVertexIndex);
              setSelectedVertexIndex(null);
            } else {
              triggerRedFlash();
            }
          } else {
            triggerRedFlash();
          }
          return;
        }

        // Blender numeric input handling when dragging or vertex selected
        const activeIdx = draggingIndex ?? selectedVertexIndex;
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
              const n = room.outline.length;
              const prevIdx = (activeIdx - 1 + n) % n;
              const prevPt = room.outline[prevIdx]!;
              const currPt = room.outline[activeIdx]!;

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

                const candidate = [...room.outline];
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
    draggingIndex,
    room.outline,
    numericInput,
    snapEnabled,
    gridStep,
    moveVertex,
    removeVertex,
    setOutline,
    setIsDragging,
    setSelectedVertexIndex,
    setToolMode,
    triggerRedFlash,
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
      const ref =
        toolMode === 'draw-floor' && drawingPoints.length > 0
          ? drawingPoints[drawingPoints.length - 1]
          : (dragStartPos.current ?? undefined);

      const processed = processPoint(point.x, point.z, ref);

      if (toolMode === 'draw-floor') {
        setCursorPos(processed);
        if (drawingPoints.length >= 3) {
          const first = drawingPoints[0]!;
          const distToFirst = Math.hypot(processed[0] - first[0], processed[1] - first[1]);
          setIsCloseHovered(distToFirst < 0.35);
        } else {
          setIsCloseHovered(false);
        }
      } else if (toolMode === 'select' && draggingIndex !== null) {
        const candidateOutline = [...room.outline];
        candidateOutline[draggingIndex] = processed;

        const isSimple = isPolygonSimple(candidateOutline);
        if (isSimple) {
          moveVertex(draggingIndex, processed);
          setHasSelfIntersection(false);
        } else {
          setHasSelfIntersection(true);
        }
      }
    },
    [toolMode, drawingPoints, draggingIndex, room.outline, processPoint, moveVertex]
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
        // Deselect vertex if clicking empty ground
        setSelectedVertexIndex(null);
        setNumericInput('');
      }
    },
    [
      toolMode,
      drawingPoints,
      processPoint,
      setOutline,
      setSelectedVertexIndex,
      setToolMode,
      triggerRedFlash,
    ]
  );

  // Start dragging a vertex handle
  const handleVertexPointerDown = useCallback(
    (index: number, e: ThreeEvent<PointerEvent>) => {
      if (e.button !== 0 || toolMode !== 'select') return;
      e.stopPropagation();

      setSelectedVertexIndex(index);
      setDraggingIndex(index);
      dragStartPos.current = [...room.outline[index]!];
      originalOutline.current = room.outline.map((pt) => [...pt]);
      setIsDragging(true);
      setHasSelfIntersection(false);
      setNumericInput('');

      if (sharedOrbitControlsRef.current) {
        sharedOrbitControlsRef.current.enabled = false;
      }
    },
    [toolMode, room.outline, setSelectedVertexIndex, setIsDragging]
  );

  // End dragging vertex
  const handlePointerUp = useCallback(() => {
    if (draggingIndex !== null) {
      if (hasSelfIntersection && originalOutline.current) {
        // Revert self-intersecting drag
        setOutline(originalOutline.current);
        triggerRedFlash();
      }

      setDraggingIndex(null);
      dragStartPos.current = null;
      originalOutline.current = null;
      setIsDragging(false);
      setHasSelfIntersection(false);

      if (sharedOrbitControlsRef.current) {
        sharedOrbitControlsRef.current.enabled = true;
      }
    }
  }, [draggingIndex, hasSelfIntersection, setOutline, setIsDragging, triggerRedFlash]);

  // Window pointerup safeguard
  useEffect(() => {
    window.addEventListener('pointerup', handlePointerUp);
    return () => window.removeEventListener('pointerup', handlePointerUp);
  }, [handlePointerUp]);

  // Handle midpoint click to insert a vertex
  const handleMidpointClick = useCallback(
    (index: number, e: ThreeEvent<PointerEvent>) => {
      if (e.button !== 0 || toolMode !== 'select') return;
      e.stopPropagation();

      const seg = wallSegment(room, index);
      const midX = (seg.a[0] + seg.b[0]) / 2;
      const midZ = (seg.a[1] + seg.b[1]) / 2;

      insertVertex(index, [midX, midZ]);
      setSelectedVertexIndex(index + 1);
    },
    [toolMode, room, insertVertex, setSelectedVertexIndex]
  );

  // Dimensions & bounds for HUD room area
  const roomArea = useMemo(() => {
    return Math.abs(signedArea(room.outline));
  }, [room.outline]);

  const bounds = useMemo(() => {
    return polygonBounds(room.outline);
  }, [room.outline]);

  // Wall segments geometry for dimension labels & midpoint handles
  const wallData = useMemo(() => {
    if (room.outline.length < 2) return [];
    return room.outline
      .map((_, i) => {
        try {
          const seg = wallSegment(room, i);
          const midX = (seg.a[0] + seg.b[0]) / 2;
          const midZ = (seg.a[1] + seg.b[1]) / 2;
          return {
            index: i,
            len: seg.len,
            midX,
            midZ,
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
      normalX: number;
      normalZ: number;
    }[];
  }, [room]);

  return (
    <group name="floor-plan-editor">
      {/* Invisible ground plane raycaster for pointer events */}
      <mesh
        position={[0, 0, 0]}
        rotation={[-Math.PI / 2, 0, 0]}
        visible={false}
        onPointerMove={handleGroundPointerMove}
        onPointerDown={handleGroundPointerDown}
        onPointerUp={handlePointerUp}
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
              onClick={(e) => {
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
          {drawingPoints.length > 1 && (
            <primitive
              object={
                new THREE.Line(
                  new THREE.BufferGeometry().setFromPoints(
                    drawingPoints.map((p) => new THREE.Vector3(p[0], 0.05, p[1]))
                  ),
                  new THREE.LineBasicMaterial({ color: 0x38bdf8, linewidth: 3 })
                )
              }
            />
          )}

          {/* Active rubberband line to cursor */}
          {drawingPoints.length > 0 && cursorPos && (
            <>
              <primitive
                object={
                  new THREE.Line(
                    new THREE.BufferGeometry().setFromPoints([
                      new THREE.Vector3(
                        drawingPoints[drawingPoints.length - 1]![0],
                        0.05,
                        drawingPoints[drawingPoints.length - 1]![1]
                      ),
                      new THREE.Vector3(cursorPos[0], 0.05, cursorPos[1]),
                    ]),
                    new THREE.LineDashedMaterial({
                      color: 0x67e8f9,
                      dashSize: 0.2,
                      gapSize: 0.1,
                    })
                  )
                }
              />

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
          SELECT MODE: VERTICES & MIDPOINT HANDLES
          ========================================= */}
      {toolMode === 'select' && (
        <group name="select-mode-handles">
          {/* 1. Draggable Corner Vertex Handles */}
          {room.outline.map((pt, index) => {
            const isSelected = selectedVertexIndex === index;
            const isDraggingThis = draggingIndex === index;
            const isError = (hasSelfIntersection && isDraggingThis) || flashRedEdge;

            return (
              <mesh
                key={`vertex-${index}`}
                position={[pt[0], 0.05, pt[1]]}
                onPointerDown={(e) => handleVertexPointerDown(index, e)}
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

          {/* 2. Wall Midpoint Handles (Click to insert/split wall) */}
          {wallData.map((w) => (
            <mesh
              key={`midpoint-${w.index}`}
              position={[w.midX, 0.04, w.midZ]}
              onPointerDown={(e) => handleMidpointClick(w.index, e)}
            >
              <cylinderGeometry args={[0.07, 0.07, 0.05, 12]} />
              <meshStandardMaterial color="#e4e4e7" emissive="#71717a" emissiveIntensity={0.2} />
            </mesh>
          ))}

          {/* 3. Blender-style Numeric Input HUD */}
          {(draggingIndex !== null || selectedVertexIndex !== null) && numericInput.length > 0 && (
            <Html
              center
              position={[
                room.outline[draggingIndex ?? selectedVertexIndex!]![0],
                0.45,
                room.outline[draggingIndex ?? selectedVertexIndex!]![1],
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
        </group>
      )}

      {/* =========================================
          LIVE DIMENSIONS & ROOM AREA
          ========================================= */}
      {showDimensions && (
        <group name="live-dimensions">
          {/* Wall Length Labels */}
          {wallData.map((w) => {
            const posX = w.midX + w.normalX * 0.28;
            const posZ = w.midZ + w.normalZ * 0.28;
            const isError = flashRedEdge || hasSelfIntersection;

            return (
              <Html
                key={`dim-${w.index}`}
                center
                position={[posX, 0.06, posZ]}
                className="pointer-events-none select-none"
              >
                <div
                  className={`backdrop-blur-sm border text-[10px] font-mono font-medium px-1.5 py-0.5 rounded shadow whitespace-nowrap transition-colors duration-150 ${
                    isError
                      ? 'bg-red-950/90 border-red-500 text-red-200'
                      : 'bg-neutral-900/85 border-neutral-700/60 text-neutral-200'
                  }`}
                >
                  {w.len.toFixed(2)}m
                </div>
              </Html>
            );
          })}

          {/* Room Area Floor Badge */}
          <Html
            center
            position={[
              (bounds.min[0] + bounds.max[0]) / 2,
              0.02,
              (bounds.min[1] + bounds.max[1]) / 2,
            ]}
            className="pointer-events-none select-none"
          >
            <div className="bg-neutral-950/75 backdrop-blur-sm border border-neutral-800 text-neutral-400 text-[11px] font-mono px-2 py-1 rounded shadow">
              Area: <span className="font-bold text-neutral-100">{roomArea.toFixed(2)} m²</span>
            </div>
          </Html>
        </group>
      )}
    </group>
  );
};

export default FloorPlanEditor;
