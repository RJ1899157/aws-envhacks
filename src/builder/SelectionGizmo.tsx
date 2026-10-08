import React, { useCallback, useEffect, useMemo, useRef } from 'react';
import { useThree } from '@react-three/fiber';
import { TransformControls } from '@react-three/drei';
import type { TransformControls as TransformControlsImpl } from 'three-stdlib';
import * as THREE from 'three';
import { wallSegment } from '../core/parser';
import { degToRad, snap } from '../core/units';
import type { Vec3 } from '../core/schema';
import { useSceneStore } from '../store/sceneStore';
import { useUiStore } from '../store/uiStore';
import { sharedOrbitControlsRef } from './Canvas';

interface DragStartObjectState {
  id: string;
  position: Vec3;
  rotation: Vec3;
  elevation: number;
}

interface DragStartOpeningState {
  id: string;
  offset: number;
  sill: number;
}

export const SelectionGizmo: React.FC = () => {
  const { camera } = useThree();

  // Scene store state
  const room = useSceneStore((state) => state.room);
  const selectedObjectId = useSceneStore((state) => state.selectedObjectId);
  const selectedObjectIds = useSceneStore((state) => state.selectedObjectIds);
  const selectedOpeningId = useSceneStore((state) => state.selectedOpeningId);
  const selectedOpeningIds = useSceneStore((state) => state.selectedOpeningIds);
  const updateObject = useSceneStore((state) => state.updateObject);
  const updateOpening = useSceneStore((state) => state.updateOpening);
  const duplicateSelected = useSceneStore((state) => state.duplicateSelected);
  const deleteSelected = useSceneStore((state) => state.deleteSelected);
  const selectAll = useSceneStore((state) => state.selectAll);
  const clearSelection = useSceneStore((state) => state.clearSelection);
  const setIsDragging = useSceneStore((state) => state.setIsDragging);

  // UI store state
  const toolMode = useUiStore((state) => state.toolMode);
  const transformMode = useUiStore((state) => state.transformMode);
  const setTransformMode = useUiStore((state) => state.setTransformMode);
  const setToolMode = useUiStore((state) => state.setToolMode);
  const view = useUiStore((state) => state.view);
  const setView = useUiStore((state) => state.setView);
  const snapEnabled = useUiStore((state) => state.snapEnabled);
  const gridStep = useUiStore((state) => state.gridStep);
  const rotationSnapDeg = useUiStore((state) => state.rotationSnapDeg);
  const transformY = useUiStore((state) => state.transformY);
  const showPrecisionGizmo = useUiStore((state) => state.showPrecisionGizmo);
  const numericInputBuffer = useUiStore((state) => state.numericInputBuffer);
  const setNumericInputBuffer = useUiStore((state) => state.setNumericInputBuffer);

  // 3D Anchor Pivot
  const pivotRef = useRef<THREE.Group>(null);
  const transformRef = useRef<TransformControlsImpl | null>(null);

  // Drag Session tracking
  const isDraggingInternal = useRef<boolean>(false);
  const dragStartPivotPos = useRef<THREE.Vector3>(new THREE.Vector3());
  const dragStartPivotRotY = useRef<number>(0);
  const dragStartObjectsRef = useRef<DragStartObjectState[]>([]);
  const dragStartOpeningRef = useRef<DragStartOpeningState | null>(null);

  // Selected item queries
  const selectedObjects = useMemo(() => {
    const ids = new Set(
      selectedObjectIds.length > 0 ? selectedObjectIds : selectedObjectId ? [selectedObjectId] : []
    );
    return room.objects.filter((o) => ids.has(o.id));
  }, [room.objects, selectedObjectIds, selectedObjectId]);

  const selectedOpening = useMemo(() => {
    const targetId = selectedOpeningIds[0] ?? selectedOpeningId;
    if (!targetId) return null;
    return room.openings.find((op) => op.id === targetId) ?? null;
  }, [room.openings, selectedOpeningIds, selectedOpeningId]);

  const hasSelection = selectedObjects.length > 0 || selectedOpening !== null;

  // Synchronize anchor pivot position and rotation with selection
  useEffect(() => {
    if (isDraggingInternal.current || !pivotRef.current) return;

    if (selectedObjects.length > 0) {
      if (selectedObjects.length === 1) {
        const obj = selectedObjects[0]!;
        const elev = obj.elevation ?? 0;
        pivotRef.current.position.set(obj.position[0], obj.position[1] + elev, obj.position[2]);
        pivotRef.current.rotation.set(0, obj.rotation?.[1] ?? 0, 0);
      } else {
        // Centroid of multiple selected objects
        let sumX = 0;
        let sumY = 0;
        let sumZ = 0;
        for (const o of selectedObjects) {
          sumX += o.position[0];
          sumY += o.position[1] + (o.elevation ?? 0);
          sumZ += o.position[2];
        }
        const count = selectedObjects.length;
        pivotRef.current.position.set(sumX / count, sumY / count, sumZ / count);
        pivotRef.current.rotation.set(0, 0, 0);
      }
    } else if (selectedOpening) {
      if (room.outline.length >= 2) {
        const seg = wallSegment(room, selectedOpening.wallIndex);
        const uMid = selectedOpening.offset + selectedOpening.width / 2;
        const vMid = selectedOpening.sill + selectedOpening.height / 2;
        const tMid = room.wallThickness / 2;

        const posX = seg.a[0] + uMid * seg.dir[0] + tMid * seg.normal[0];
        const posY = vMid;
        const posZ = seg.a[1] + uMid * seg.dir[1] + tMid * seg.normal[1];

        pivotRef.current.position.set(posX, posY, posZ);
        pivotRef.current.rotation.set(0, 0, 0);
      }
    }
  }, [selectedObjects, selectedOpening, room]);

  // Frame selection helper (F key)
  const frameSelection = useCallback(() => {
    if (!pivotRef.current || !hasSelection) return;
    const targetPos = pivotRef.current.position.clone();

    // Determine bounding radius of selection
    let maxDim = 1.5;
    if (selectedObjects.length > 0) {
      for (const o of selectedObjects) {
        maxDim = Math.max(maxDim, ...o.size);
      }
    } else if (selectedOpening) {
      maxDim = Math.max(maxDim, selectedOpening.width, selectedOpening.height);
    }

    const dist = maxDim * 2.5;
    const targetCam =
      view === '2d'
        ? new THREE.Vector3(targetPos.x, targetPos.y + dist * 1.5, targetPos.z + 0.001)
        : new THREE.Vector3(
            targetPos.x + dist * 0.7,
            targetPos.y + dist * 0.6,
            targetPos.z + dist * 0.7
          );

    camera.position.copy(targetCam);
    if (sharedOrbitControlsRef.current) {
      sharedOrbitControlsRef.current.target.copy(targetPos);
      sharedOrbitControlsRef.current.update();
    }
  }, [camera, hasSelection, selectedObjects, selectedOpening, view]);

  // Keyboard shortcut listener
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Ignore when focused in text input elements
      const target = e.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)
      ) {
        return;
      }

      const key = e.key;
      const isCtrlOrCmd = e.ctrlKey || e.metaKey;

      // 1. Undo / Redo (Ctrl+Z / Ctrl+Shift+Z / Cmd+Z / Cmd+Shift+Z)
      if (isCtrlOrCmd && (key === 'z' || key === 'Z')) {
        e.preventDefault();
        if (e.shiftKey) {
          useSceneStore.temporal.getState().redo();
        } else {
          useSceneStore.temporal.getState().undo();
        }
        return;
      }

      // 2. Select All (Ctrl+A / Cmd+A)
      if (isCtrlOrCmd && (key === 'a' || key === 'A')) {
        e.preventDefault();
        selectAll();
        return;
      }

      // 3. Tab: Toggle 2D / 3D
      if (key === 'Tab') {
        e.preventDefault();
        setView(view === '3d' ? '2d' : '3d');
        return;
      }

      // 4. Escape: cancel numeric input, tool, or clear selection
      if (key === 'Escape') {
        e.preventDefault();
        if (numericInputBuffer !== null) {
          setNumericInputBuffer(null);
        } else if (toolMode !== 'select') {
          setToolMode('select');
        } else {
          clearSelection();
        }
        return;
      }

      // 5. Delete / Backspace / X: delete selected
      if (
        hasSelection &&
        (key === 'Delete' ||
          (key === 'Backspace' && numericInputBuffer === null) ||
          key === 'x' ||
          key === 'X')
      ) {
        e.preventDefault();
        deleteSelected();
        return;
      }

      // 6. Shift + D: duplicate selected
      if (hasSelection && e.shiftKey && (key === 'd' || key === 'D')) {
        e.preventDefault();
        duplicateSelected();
        return;
      }

      // 7. G: Move mode
      if (key === 'g' || key === 'G') {
        e.preventDefault();
        setToolMode('select');
        setTransformMode('translate');
        return;
      }

      // 8. R: Rotate mode
      if (key === 'r' || key === 'R') {
        e.preventDefault();
        setToolMode('select');
        setTransformMode('rotate');
        return;
      }

      // 9. F: Frame selection
      if (key === 'f' || key === 'F') {
        e.preventDefault();
        frameSelection();
        return;
      }

      // 10. Numeric input while moving / rotating (type 0.5 then Enter)
      if (hasSelection && toolMode === 'select') {
        if (/^[0-9.-]$/.test(key)) {
          e.preventDefault();
          const current = numericInputBuffer ?? '';
          if (key === '-' && current.length > 0) return;
          if (key === '.' && current.includes('.')) return;
          setNumericInputBuffer(current + key);
          return;
        }

        if (key === 'Backspace' && numericInputBuffer !== null) {
          e.preventDefault();
          const next = numericInputBuffer.slice(0, -1);
          setNumericInputBuffer(next.length > 0 ? next : null);
          return;
        }

        if (key === 'Enter' && numericInputBuffer !== null) {
          e.preventDefault();
          const val = parseFloat(numericInputBuffer);
          setNumericInputBuffer(null);

          if (!isNaN(val)) {
            if (transformMode === 'translate') {
              if (selectedObjects.length > 0) {
                // Apply translation delta along X by value in meters
                for (const obj of selectedObjects) {
                  const updatedPos: Vec3 = [
                    Number((obj.position[0] + val).toFixed(4)),
                    obj.position[1],
                    obj.position[2],
                  ];
                  updateObject(obj.id, { position: updatedPos });
                }
              } else if (selectedOpening) {
                // Set offset directly to typed value in meters
                const seg = wallSegment(room, selectedOpening.wallIndex);
                const maxOffset = Math.max(0, seg.len - selectedOpening.width);
                const clamped = Math.max(0, Math.min(maxOffset, val));
                updateOpening(selectedOpening.id, { offset: clamped });
              }
            } else if (transformMode === 'rotate') {
              // Apply rotation delta in degrees
              const radDelta = degToRad(val);
              for (const obj of selectedObjects) {
                const currentRotY = obj.rotation?.[1] ?? 0;
                const newRotY = Number((currentRotY + radDelta).toFixed(4));
                const updatedRot: Vec3 = [0, newRotY, 0];
                updateObject(obj.id, { rotation: updatedRot });
              }
            }
          }
          return;
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [
    clearSelection,
    deleteSelected,
    duplicateSelected,
    frameSelection,
    hasSelection,
    numericInputBuffer,
    room,
    selectAll,
    selectedObjects,
    selectedOpening,
    setNumericInputBuffer,
    setToolMode,
    setTransformMode,
    setView,
    toolMode,
    transformMode,
    updateObject,
    updateOpening,
    view,
  ]);

  // Start and End Drag Handlers
  const handleDragStart = useCallback(() => {
    isDraggingInternal.current = true;

    // Disable OrbitControls while dragging the gizmo
    if (sharedOrbitControlsRef.current) {
      sharedOrbitControlsRef.current.enabled = false;
    }

    // Notify sceneStore to coalesce drag mutations into one undo step
    setIsDragging(true);

    // Record start transforms for all selected objects
    if (pivotRef.current) {
      dragStartPivotPos.current.copy(pivotRef.current.position);
      dragStartPivotRotY.current = pivotRef.current.rotation.y;
    }

    dragStartObjectsRef.current = selectedObjects.map((obj) => ({
      id: obj.id,
      position: [...obj.position] as Vec3,
      rotation: [...(obj.rotation ?? [0, 0, 0])] as Vec3,
      elevation: obj.elevation ?? 0,
    }));

    if (selectedOpening) {
      dragStartOpeningRef.current = {
        id: selectedOpening.id,
        offset: selectedOpening.offset,
        sill: selectedOpening.sill,
      };
    } else {
      dragStartOpeningRef.current = null;
    }
  }, [selectedObjects, selectedOpening, setIsDragging]);

  const handleDragEnd = useCallback(() => {
    isDraggingInternal.current = false;

    // Re-enable OrbitControls
    if (sharedOrbitControlsRef.current) {
      sharedOrbitControlsRef.current.enabled = true;
    }

    // Finalize drag session in store (one drag = one undo step)
    setIsDragging(false);
  }, [setIsDragging]);

  // Handle TransformControls Dragging Changed (Start & End)
  useEffect(() => {
    const controls = transformRef.current;
    if (!controls) return;

    type DraggingEventMap = {
      'dragging-changed': { value?: boolean };
    };

    const dispatcher = controls as unknown as THREE.EventDispatcher<DraggingEventMap>;
    const handleDraggingChanged = (event: { value?: boolean }) => {
      if (event.value) {
        handleDragStart();
      } else {
        handleDragEnd();
      }
    };

    dispatcher.addEventListener('dragging-changed', handleDraggingChanged);
    return () => {
      dispatcher.removeEventListener('dragging-changed', handleDraggingChanged);
    };
  }, [handleDragStart, handleDragEnd]);

  // Real-time object transformation and collision checking on change
  const handleObjectChange = useCallback(() => {
    if (!isDraggingInternal.current || !pivotRef.current) return;

    if (selectedObjects.length > 0) {
      const deltaX = pivotRef.current.position.x - dragStartPivotPos.current.x;
      const deltaY = transformY ? pivotRef.current.position.y - dragStartPivotPos.current.y : 0;
      const deltaZ = pivotRef.current.position.z - dragStartPivotPos.current.z;
      const deltaRotY = pivotRef.current.rotation.y - dragStartPivotRotY.current;

      for (const startState of dragStartObjectsRef.current) {
        let newX = startState.position[0] + deltaX;
        let newY = startState.position[1] + deltaY;
        let newZ = startState.position[2] + deltaZ;
        let newRotY = startState.rotation[1] + deltaRotY;

        if (snapEnabled) {
          newX = snap(newX, gridStep);
          newZ = snap(newZ, gridStep);
          if (transformY) newY = snap(newY, gridStep);
          newRotY = snap(newRotY, degToRad(rotationSnapDeg));
        }

        const origObj = room.objects.find((o) => o.id === startState.id);
        if (!origObj) continue;

        updateObject(startState.id, {
          position: [newX, newY, newZ],
          rotation: [0, newRotY, 0],
        });
      }
    } else if (selectedOpening && dragStartOpeningRef.current) {
      if (room.outline.length < 2) return;
      const seg = wallSegment(room, selectedOpening.wallIndex);

      // Project translation vector onto wall direction
      const dispX = pivotRef.current.position.x - dragStartPivotPos.current.x;
      const dispY = pivotRef.current.position.y - dragStartPivotPos.current.y;
      const dispZ = pivotRef.current.position.z - dragStartPivotPos.current.z;

      const deltaU = dispX * seg.dir[0] + dispZ * seg.dir[1];
      let newOffset = dragStartOpeningRef.current.offset + deltaU;

      if (snapEnabled) {
        newOffset = snap(newOffset, gridStep);
      }

      // Clamp inside wall length
      const maxOffset = Math.max(0, seg.len - selectedOpening.width);
      newOffset = Math.max(0, Math.min(maxOffset, newOffset));

      let newSill = selectedOpening.sill;
      if (transformY) {
        newSill = dragStartOpeningRef.current.sill + dispY;
        if (snapEnabled) newSill = snap(newSill, gridStep);
        const maxSill = Math.max(0, room.wallHeight - selectedOpening.height);
        newSill = Math.max(0, Math.min(maxSill, newSill));
      }

      updateOpening(selectedOpening.id, {
        offset: newOffset,
        sill: newSill,
      });
    }
  }, [
    gridStep,
    room,
    rotationSnapDeg,
    selectedObjects,
    selectedOpening,
    snapEnabled,
    transformY,
    updateObject,
    updateOpening,
  ]);

  if (!hasSelection || toolMode !== 'select' || !showPrecisionGizmo) {
    return null;
  }

  // Active transform constraints
  const isOpening = selectedOpening !== null;
  const isRotate = transformMode === 'rotate' && !isOpening;

  return (
    <group name="selection-gizmo-container">
      {/* Invisible anchor pivot attached to selection */}
      <group ref={pivotRef} />

      {/* drei TransformControls */}
      <TransformControls
        ref={transformRef}
        object={pivotRef.current ?? undefined}
        mode={isRotate ? 'rotate' : 'translate'}
        translationSnap={snapEnabled ? gridStep : null}
        rotationSnap={snapEnabled ? degToRad(rotationSnapDeg) : null}
        size={0.75}
        space="world"
        // Translation: XZ plane by default, Y only if transformY is enabled
        showX={!isRotate}
        showY={isRotate ? true : transformY}
        showZ={!isRotate}
        onMouseDown={handleDragStart}
        onMouseUp={handleDragEnd}
        onObjectChange={handleObjectChange}
      />
    </group>
  );
};

export default SelectionGizmo;
