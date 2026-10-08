import React, { useState } from 'react';
import { useSceneStore } from '../store/sceneStore';

export const Outliner: React.FC = () => {
  const [collapsed, setCollapsed] = useState(false);
  const { room, selectedObjectIds, selectedOpeningIds, selectObject, selectOpening, updateObject, updateOpening, setWallOverride } = useSceneStore();

  if (collapsed) {
    return (
      <div className="absolute right-4 top-20 bg-neutral-900/90 text-white p-2 rounded cursor-pointer z-50 border border-neutral-700" onClick={() => setCollapsed(false)}>
        📋 Outliner
      </div>
    );
  }

  const toggleWallVis = (idx: number, e: React.MouseEvent) => {
    e.stopPropagation();
    const isHidden = room.wallOverrides?.[idx]?.isHidden;
    setWallOverride(idx, { isHidden: !isHidden });
  };
  const toggleWallLock = (idx: number, e: React.MouseEvent) => {
    e.stopPropagation();
    const isLocked = room.wallOverrides?.[idx]?.isLocked;
    setWallOverride(idx, { isLocked: !isLocked });
  };

  const toggleObjVis = (id: string, isHidden: boolean, e: React.MouseEvent) => { e.stopPropagation(); updateObject(id, { isHidden: !isHidden }); };
  const toggleObjLock = (id: string, isLocked: boolean, e: React.MouseEvent) => { e.stopPropagation(); updateObject(id, { isLocked: !isLocked }); };
  
  const toggleOpenVis = (id: string, isHidden: boolean, e: React.MouseEvent) => { e.stopPropagation(); updateOpening(id, { isHidden: !isHidden }); };
  const toggleOpenLock = (id: string, isLocked: boolean, e: React.MouseEvent) => { e.stopPropagation(); updateOpening(id, { isLocked: !isLocked }); };

  return (
    <div className="absolute right-4 top-20 w-64 max-h-[60vh] bg-neutral-900/95 border border-neutral-700/60 rounded-xl shadow-2xl z-50 flex flex-col text-sm text-neutral-300 overflow-hidden select-none">
      <div className="flex justify-between items-center p-3 border-b border-neutral-800 bg-neutral-950">
        <h3 className="font-bold text-white">Outliner</h3>
        <button onClick={() => setCollapsed(true)} className="text-neutral-500 hover:text-white">➖</button>
      </div>
      <div className="overflow-y-auto flex-1 p-2 space-y-4 text-xs">
        {/* Walls */}
        <div>
          <div className="font-bold text-neutral-500 mb-1">Walls</div>
          {room.outline.map((_, i) => {
            const ov = room.wallOverrides?.[i] || {};
            return (
              <div key={`wall-${i}`} className="flex justify-between items-center py-1 px-2 hover:bg-neutral-800 rounded">
                <span>{ov.name || `Wall ${i + 1}`}</span>
                <div className="flex gap-2 text-neutral-500">
                  <span onClick={(e) => toggleWallVis(i, e)} className={`cursor-pointer ${ov.isHidden ? 'text-red-400' : 'hover:text-white'}`}>{ov.isHidden ? '👁️‍🗨️' : '👁️'}</span>
                  <span onClick={(e) => toggleWallLock(i, e)} className={`cursor-pointer ${ov.isLocked ? 'text-red-400' : 'hover:text-white'}`}>{ov.isLocked ? '🔒' : '🔓'}</span>
                </div>
              </div>
            );
          })}
        </div>

        {/* Openings */}
        <div>
          <div className="font-bold text-neutral-500 mb-1">Openings</div>
          {room.openings.map(op => (
            <div key={op.id} onClick={() => selectOpening(op.id)} className={`flex justify-between items-center py-1 px-2 hover:bg-neutral-800 rounded cursor-pointer ${selectedOpeningIds.includes(op.id) ? 'bg-sky-900/50 text-sky-200' : ''}`}>
              <span>{op.subType || op.type} (Wall {op.wallIndex + 1})</span>
              <div className="flex gap-2 text-neutral-500">
                <span onClick={(e) => toggleOpenVis(op.id, !!op.isHidden, e)} className={`cursor-pointer ${op.isHidden ? 'text-red-400' : 'hover:text-white'}`}>{op.isHidden ? '👁️‍🗨️' : '👁️'}</span>
                <span onClick={(e) => toggleOpenLock(op.id, !!op.isLocked, e)} className={`cursor-pointer ${op.isLocked ? 'text-red-400' : 'hover:text-white'}`}>{op.isLocked ? '🔒' : '🔓'}</span>
              </div>
            </div>
          ))}
        </div>

        {/* Objects */}
        <div>
          <div className="font-bold text-neutral-500 mb-1">Objects</div>
          {room.objects.map(obj => (
            <div key={obj.id} onClick={() => selectObject(obj.id)} className={`flex justify-between items-center py-1 px-2 hover:bg-neutral-800 rounded cursor-pointer ${selectedObjectIds.includes(obj.id) ? 'bg-sky-900/50 text-sky-200' : ''}`}>
              <span className="truncate max-w-[120px]">{obj.name}</span>
              <div className="flex gap-2 text-neutral-500">
                <span onClick={(e) => toggleObjVis(obj.id, !!obj.isHidden, e)} className={`cursor-pointer ${obj.isHidden ? 'text-red-400' : 'hover:text-white'}`}>{obj.isHidden ? '👁️‍🗨️' : '👁️'}</span>
                <span onClick={(e) => toggleObjLock(obj.id, !!obj.isLocked, e)} className={`cursor-pointer ${obj.isLocked ? 'text-red-400' : 'hover:text-white'}`}>{obj.isLocked ? '🔒' : '🔓'}</span>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};
