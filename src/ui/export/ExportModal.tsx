import React, { useState } from 'react';
import { useExportStore } from '../../store/exportStore';
import { ExportFormat, ExportOptions } from '../../io/export/exporters/ExportManager';

export const ExportModal: React.FC = () => {
  const store = useExportStore();
  const [format, setFormat] = useState<ExportFormat>('glb');
  const [includeWalls, setIncludeWalls] = useState(true);
  const [includeFurniture, setIncludeFurniture] = useState(true);
  const [includeOpenings, setIncludeOpenings] = useState(true);
  const [applyMaterials, setApplyMaterials] = useState(true);
  const [stlScale, setStlScale] = useState(1);
  const selectionOnly = false; // Add state if needed later

  if (!store.isOpen) return null;

  const handleExport = () => {
    // The actual triggering needs the three scene.
    // We can dispatch an event or rely on a SceneExporter component inside Canvas.
    window.dispatchEvent(new CustomEvent('airforce:run-export', {
      detail: {
        format, includeWalls, includeFurniture, includeOpenings, applyMaterials, selectionOnly, stlScale
      } as ExportOptions
    }));
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="bg-neutral-900 border border-neutral-700 p-6 rounded-xl shadow-2xl flex flex-col gap-5 w-[450px]">
        <h3 className="text-white font-bold text-lg">Export Scene</h3>
        
        {!store.isExporting ? (
          <div className="flex flex-col gap-4">
            <div className="flex flex-col gap-1">
              <label className="text-sm text-neutral-300">Format</label>
              <select 
                value={format} 
                onChange={(e) => setFormat(e.target.value as ExportFormat)}
                className="bg-neutral-800 border border-neutral-600 rounded p-2 text-white"
              >
                <optgroup label="3D Models">
                  <option value="glb">GLB (Binary glTF - Recommended)</option>
                  <option value="gltf">GLTF (Zipped)</option>
                  <option value="obj">OBJ (Zipped)</option>
                  <option value="stl">STL (3D Printing)</option>
                  <option value="usdz">USDZ (Apple AR)</option>
                  <option value="fbx" disabled>FBX (Export GLB, then convert)</option>
                </optgroup>
                <optgroup label="2D / Documents">
                  <option value="svg">SVG Floorplan</option>
                  <option value="pdf">PDF Floorplan</option>
                  <option value="dxf">DXF Floorplan</option>
                  <option value="json">AirForce JSON</option>
                </optgroup>
                <optgroup label="Project">
                  <option value="airforce">.airforce Project Bundle</option>
                </optgroup>
              </select>
            </div>

            {['glb', 'gltf', 'obj', 'stl', 'usdz'].includes(format) && (
              <div className="flex flex-col gap-2 p-3 bg-neutral-800/50 border border-neutral-700 rounded-lg">
                <span className="text-xs font-semibold text-neutral-400 uppercase tracking-wide">Include</span>
                <label className="flex items-center gap-2 text-sm text-neutral-200">
                  <input type="checkbox" checked={includeWalls} onChange={e => setIncludeWalls(e.target.checked)} /> Walls
                </label>
                <label className="flex items-center gap-2 text-sm text-neutral-200">
                  <input type="checkbox" checked={includeOpenings} onChange={e => setIncludeOpenings(e.target.checked)} /> Openings
                </label>
                <label className="flex items-center gap-2 text-sm text-neutral-200">
                  <input type="checkbox" checked={includeFurniture} onChange={e => setIncludeFurniture(e.target.checked)} /> Furniture
                </label>
                <hr className="border-neutral-700 my-1" />
                <label className="flex items-center gap-2 text-sm text-neutral-200">
                  <input type="checkbox" checked={applyMaterials} onChange={e => setApplyMaterials(e.target.checked)} /> Apply Materials
                </label>
              </div>
            )}

            {format === 'stl' && (
              <div className="flex flex-col gap-1">
                <label className="text-sm text-neutral-300">Scale Multiplier (e.g., 0.02 for 1:50)</label>
                <input 
                  type="number" 
                  step="0.001"
                  value={stlScale}
                  onChange={e => setStlScale(parseFloat(e.target.value))}
                  className="bg-neutral-800 border border-neutral-600 rounded p-1.5 text-white"
                />
              </div>
            )}

            <div className="flex justify-end gap-3 mt-2">
              <button onClick={() => store.setIsOpen(false)} className="px-4 py-2 text-neutral-400 hover:text-white">Cancel</button>
              <button onClick={handleExport} className="px-5 py-2 bg-sky-600 hover:bg-sky-500 text-white font-bold rounded">Export</button>
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-4 py-4 items-center">
            <div className="w-full bg-neutral-800 h-3 rounded overflow-hidden">
              <div 
                className="bg-sky-500 h-full transition-all duration-300"
                style={{ width: `${Math.max(5, store.progress * 100)}%` }}
              />
            </div>
            <span className="text-sm text-sky-200 animate-pulse">{store.message}</span>
            <button onClick={store.cancelExport} className="mt-4 px-4 py-1.5 border border-neutral-600 text-neutral-300 rounded hover:bg-neutral-800">Cancel</button>
          </div>
        )}
      </div>
    </div>
  );
};
