import React, { useEffect, useState } from 'react';
import { useSceneStore } from '../store/sceneStore';

export interface ContextMenuState {
  x: number;
  y: number;
  targetType: 'object' | 'wall' | 'opening' | 'floor';
  targetId?: string; // id for objects/openings, index for walls
}

export const ContextMenu: React.FC = () => {
  const [menu, setMenu] = useState<ContextMenuState | null>(null);
  const { deleteSelected, duplicateSelected, clearSelection } = useSceneStore();

  useEffect(() => {
    const handleCustomMenu = (e: CustomEvent<ContextMenuState>) => {
      setMenu(e.detail);
    };

    const hide = () => setMenu(null);

    window.addEventListener('canvas-context-menu', handleCustomMenu as EventListener);
    window.addEventListener('click', hide);
    window.addEventListener('pointerdown', hide);

    return () => {
      window.removeEventListener('canvas-context-menu', handleCustomMenu as EventListener);
      window.removeEventListener('click', hide);
      window.removeEventListener('pointerdown', hide);
    };
  }, []);

  if (!menu) return null;

  return (
    <div 
      className="absolute bg-neutral-900 border border-neutral-700 shadow-xl rounded py-1 z-[200] text-sm text-neutral-200 min-w-[150px]"
      style={{ left: menu.x, top: menu.y }}
      onPointerDown={e => e.stopPropagation()}
    >
      {menu.targetType === 'object' && (
        <>
          <div className="px-4 py-1 hover:bg-sky-600 cursor-pointer" onClick={() => { duplicateSelected(); setMenu(null); }}>Duplicate</div>
          <div className="px-4 py-1 hover:bg-red-600 cursor-pointer" onClick={() => { deleteSelected(); setMenu(null); }}>Delete</div>
        </>
      )}
      {menu.targetType === 'opening' && (
        <>
          <div className="px-4 py-1 hover:bg-sky-600 cursor-pointer" onClick={() => { duplicateSelected(); setMenu(null); }}>Duplicate</div>
          <div className="px-4 py-1 hover:bg-red-600 cursor-pointer" onClick={() => { deleteSelected(); setMenu(null); }}>Delete</div>
        </>
      )}
      {menu.targetType === 'floor' && (
        <>
          <div className="px-4 py-1 hover:bg-sky-600 cursor-pointer" onClick={() => { clearSelection(); setMenu(null); }}>Clear Selection</div>
          <div className="px-4 py-1 hover:bg-sky-600 cursor-pointer" onClick={() => { window.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', metaKey: true })); setMenu(null); }}>Command Palette</div>
        </>
      )}
    </div>
  );
};
