import React, { useEffect } from 'react';
import { useSceneStore } from '../store/sceneStore';
import { useUiStore } from '../store/uiStore';
import { AssetMesh } from './AssetMesh';

/**
 * Renders all 3D placed objects from the sceneStore
 * and handles click selection and Delete/Backspace removal.
 */
export const PlacedObjects: React.FC = () => {
  const room = useSceneStore((state) => state.room);
  const selectedObjectId = useSceneStore((state) => state.selectedObjectId);
  const selectObject = useSceneStore((state) => state.selectObject);
  const removeObject = useSceneStore((state) => state.removeObject);
  const duplicateObject = useSceneStore((state) => state.duplicateObject);
  const toolMode = useUiStore((state) => state.toolMode);

  // Keyboard shortcuts for selected object: Delete to remove, Shift+D to duplicate
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)
      ) {
        return;
      }

      if (selectedObjectId && toolMode === 'select') {
        if (e.key === 'Delete' || e.key === 'Backspace') {
          e.preventDefault();
          removeObject(selectedObjectId);
        } else if (e.key === 'd' || e.key === 'D') {
          if (e.shiftKey) {
            e.preventDefault();
            duplicateObject(selectedObjectId);
          }
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [selectedObjectId, toolMode, removeObject, duplicateObject]);

  return (
    <group name="placed-objects">
      {room.objects.map((obj) => (
        <AssetMesh
          key={obj.id}
          object={obj}
          isSelected={selectedObjectId === obj.id}
          onPointerDown={(e) => {
            if (toolMode === 'select' && e.button === 0) {
              e.stopPropagation();
              selectObject(obj.id);
            }
          }}
        />
      ))}
    </group>
  );
};

export default PlacedObjects;
