import React from 'react';
import { useSceneStore } from '../store/sceneStore';
import { useUiStore } from '../store/uiStore';
import { AssetMesh } from './AssetMesh';

/**
 * Renders all 3D placed objects from the sceneStore
 * and handles click selection with Shift multi-select.
 */
export const PlacedObjects: React.FC = () => {
  const room = useSceneStore((state) => state.room);
  const selectedObjectId = useSceneStore((state) => state.selectedObjectId);
  const selectedObjectIds = useSceneStore((state) => state.selectedObjectIds);
  const selectObject = useSceneStore((state) => state.selectObject);
  const isCollisionWarning = useUiStore((state) => state.isCollisionWarning);
  const toolMode = useUiStore((state) => state.toolMode);

  return (
    <group name="placed-objects">
      {room.objects.map((obj) => {
        const isSelected = selectedObjectIds.includes(obj.id) || selectedObjectId === obj.id;
        const isColliding = isSelected && isCollisionWarning;

        return (
          <AssetMesh
            key={obj.id}
            object={obj}
            isSelected={isSelected}
            isColliding={isColliding}
            onPointerDown={(e) => {
              if (toolMode === 'select' && e.button === 0) {
                e.stopPropagation();
                selectObject(obj.id, e.shiftKey);
              }
            }}
          />
        );
      })}
    </group>
  );
};

export default PlacedObjects;
