import React, { useCallback } from 'react';
import type { ThreeEvent } from '@react-three/fiber';
import { useSceneStore } from '../store/sceneStore';
import { useUiStore } from '../store/uiStore';
import { AssetMesh } from './AssetMesh';
import type { SceneObject } from '../core/schema';
import { startDirectObjectDrag } from './DirectObjectManipulator';
import { cameraController } from './cameraController';
import { sharedOrbitControlsRef } from './Canvas';

interface PlacedObjectItemProps {
  object: SceneObject;
  isSelected: boolean;
  isColliding: boolean;
  onSelect: (id: string, shiftKey: boolean) => void;
}

/**
 * Individual memoized object item.
 * Ensures that modifying one object does NOT re-render unchanged siblings,
 * maintaining 60 FPS even with 50+ objects in the room.
 */
const PlacedObjectItem = React.memo<PlacedObjectItemProps>(
  ({ object, isSelected, isColliding, onSelect }) => {
    // Read the tool at click time so the handler never goes stale
    const handlePointerDown = useCallback(
      (e: ThreeEvent<PointerEvent>) => {
        if (useUiStore.getState().toolMode === 'select' && e.button === 0) {
          e.stopPropagation();
          useUiStore.getState().setSelectedWallIndex(null);
          onSelect(object.id, e.shiftKey);
          startDirectObjectDrag(object.id, e);
        }
      },
      [onSelect, object.id]
    );

    const handleDoubleClick = useCallback(
      (e: ThreeEvent<MouseEvent>) => {
        e.stopPropagation();
        const controls = sharedOrbitControlsRef.current;
        if (controls) cameraController.fitSelection(object.id, useSceneStore.getState().room, controls.object, controls);
      },
      [object.id]
    );

    return (
      <AssetMesh
        object={object}
        isSelected={isSelected}
        isColliding={isColliding}
        onPointerDown={handlePointerDown}
        onDoubleClick={handleDoubleClick}
      />
    );
  }
);

/**
 * Renders all 3D placed objects from the sceneStore
 * with granular selectors and memoized object dispatch.
 */
export const PlacedObjects: React.FC = () => {
  const objects = useSceneStore((state) => state.room.objects);
  const selectedObjectId = useSceneStore((state) => state.selectedObjectId);
  const selectedObjectIds = useSceneStore((state) => state.selectedObjectIds);
  const selectObject = useSceneStore((state) => state.selectObject);

  const handleSelect = useCallback(
    (id: string, shiftKey: boolean) => {
      selectObject(id, shiftKey);
    },
    [selectObject]
  );

  return (
    <group name="placed-objects">
      {objects.map((obj) => {
        const isSelected = selectedObjectIds.includes(obj.id) || selectedObjectId === obj.id;

        return (
          <PlacedObjectItem
            key={obj.id}
            object={obj}
            isSelected={isSelected}
            isColliding={false}
            onSelect={handleSelect}
          />
        );
      })}
    </group>
  );
};

export default PlacedObjects;
