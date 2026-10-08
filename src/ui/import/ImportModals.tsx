import React, { useState } from 'react';
import { useImportStore } from '../../store/importStore';
import { useAssetLibraryStore } from '../../store/assetLibraryStore';
import { useSceneStore } from '../../store/sceneStore';
import { normalizeGeometry, exportToGLB } from '../../io/import/formats/Normalizer';
import { generateThumbnail } from '../../io/import/formats/ThumbnailGenerator';
import * as THREE from 'three';

export const ImportModals: React.FC = () => {
  const store = useImportStore();
  const { addAsset } = useAssetLibraryStore();
  const { setOutline } = useSceneStore();

  const [sourceUnit, setSourceUnit] = useState<'m' | 'cm' | 'mm' | 'in'>('m');
  const [upAxis, setUpAxis] = useState<'Y' | 'Z'>('Y');
  const [role, setRole] = useState<'solid' | 'source' | 'porous' | 'none'>('solid');

  const handleModelConfirm = async () => {
    if (!store.modelDialog.threeGroup || !store.modelDialog.resolvedFile) return;

    store.setProgressModal({ isOpen: true, progress: 0.8, message: 'Normalizing & Saving...' });
    store.closeModelDialog();

    try {
      // 1. Normalize
      const normalizedGroup = normalizeGeometry(store.modelDialog.threeGroup, {
        sourceUnit,
        upAxis,
        recenterPivot: true,
        flattenHierarchy: true,
      });

      // 2. Compute final dimensions
      const box = new THREE.Box3().setFromObject(normalizedGroup);
      const size = new THREE.Vector3();
      box.getSize(size);

      // 3. Generate GLB and Thumbnail
      const glbBlob = await exportToGLB(normalizedGroup);
      const thumb = generateThumbnail(normalizedGroup);

      // 4. Save to IndexedDB
      const assetId = `imported-${Date.now()}`;
      await addAsset({
        id: assetId,
        name: store.modelDialog.resolvedFile.mainFile.name.replace(/\.[^/.]+$/, ""),
        type: 'furniture',
        format: 'glb',
        blob: glbBlob,
        thumbnailDataUrl: thumb,
        dimensions: [size.x, size.y, size.z],
        addedAt: Date.now(),
      });

      // Optionally add immediately to scene?
      // const pos = [0, 0]; 
      // sceneStore.addObject({ id: ..., assetId, position: pos, ... })
      
      store.setProgressModal({ isOpen: false });
    } catch (err) {
      console.error(err);
      alert('Error saving asset.');
      store.setProgressModal({ isOpen: false });
    }
  };

  const handleFloorplanConfirm = () => {
    // Basic scaling logic
    // ...
    setOutline(store.floorplanDialog.outline); // Need to apply scale here based on user input
    store.closeFloorplanDialog();
  };

  return (
    <>
      {/* Progress Modal */}
      {store.progressModal.isOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="bg-neutral-900 border border-neutral-700 p-6 rounded-xl shadow-2xl flex flex-col gap-4 min-w-[300px]">
            <h3 className="text-white font-bold text-sm">{store.progressModal.message}</h3>
            <div className="w-full bg-neutral-800 h-2 rounded overflow-hidden">
              <div 
                className="bg-sky-500 h-full transition-all duration-300"
                style={{ width: `${Math.max(5, store.progressModal.progress * 100)}%` }}
              />
            </div>
          </div>
        </div>
      )}

      {/* 3D Import Dialog */}
      {store.modelDialog.isOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="bg-neutral-900 border border-neutral-700 p-6 rounded-xl shadow-2xl flex flex-col gap-5 w-[400px]">
            <h3 className="text-white font-bold text-lg">Import 3D Asset</h3>
            
            <div className="flex flex-col gap-3">
              <label className="flex flex-col gap-1 text-sm text-neutral-300">
                <span>Source Unit (Detected Size: {store.modelDialog.detectedSize.map(n => n.toFixed(2)).join(' x ')})</span>
                <select 
                  value={sourceUnit} 
                  onChange={(e) => setSourceUnit(e.target.value as any)}
                  className="bg-neutral-800 border border-neutral-600 rounded p-1.5"
                >
                  <option value="m">Meters (m)</option>
                  <option value="cm">Centimeters (cm)</option>
                  <option value="mm">Millimeters (mm)</option>
                  <option value="in">Inches (in)</option>
                </select>
              </label>

              <label className="flex flex-col gap-1 text-sm text-neutral-300">
                Up Axis
                <select 
                  value={upAxis} 
                  onChange={(e) => setUpAxis(e.target.value as any)}
                  className="bg-neutral-800 border border-neutral-600 rounded p-1.5"
                >
                  <option value="Y">Y-Up (Three.js default)</option>
                  <option value="Z">Z-Up (Blender, CAD)</option>
                </select>
              </label>

              <label className="flex flex-col gap-1 text-sm text-neutral-300">
                Airflow Role
                <select 
                  value={role} 
                  onChange={(e) => setRole(e.target.value as any)}
                  className="bg-neutral-800 border border-neutral-600 rounded p-1.5"
                >
                  <option value="solid">Solid (Blocks Wind)</option>
                  <option value="porous">Porous (Reduces Wind)</option>
                  <option value="source">Pollutant Source</option>
                  <option value="none">Visual Only</option>
                </select>
              </label>
            </div>

            <div className="flex justify-end gap-3 mt-2">
              <button onClick={store.closeModelDialog} className="px-4 py-2 text-neutral-400 hover:text-white">Cancel</button>
              <button onClick={handleModelConfirm} className="px-4 py-2 bg-sky-600 hover:bg-sky-500 text-white font-bold rounded">Import</button>
            </div>
          </div>
        </div>
      )}

      {/* 2D Floorplan Dialog */}
      {store.floorplanDialog.isOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="bg-neutral-900 border border-neutral-700 p-6 rounded-xl shadow-2xl flex flex-col gap-5 w-[400px]">
            <h3 className="text-white font-bold text-lg">Import Floor Plan</h3>
            <p className="text-sm text-neutral-300">
              Found a closed loop outline. Please confirm the scale.
              The first segment is measured as <strong>{store.floorplanDialog.firstLineLengthRaw.toFixed(2)}</strong> units.
            </p>
            {/* Add inputs for scaling here... */}
            <div className="flex justify-end gap-3 mt-2">
              <button onClick={store.closeFloorplanDialog} className="px-4 py-2 text-neutral-400 hover:text-white">Cancel</button>
              <button onClick={handleFloorplanConfirm} className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white font-bold rounded">Apply Outline</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
};
