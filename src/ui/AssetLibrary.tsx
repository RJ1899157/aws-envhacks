import React, { useMemo, useState, useRef, useEffect } from 'react';
import { CATALOG_ASSETS, type AssetDef } from '../core/catalog';
import { useUiStore } from '../store/uiStore';
import { useSceneStore } from '../store/sceneStore';
import { useAssetLibraryStore, useLibraryPrefsStore } from '../store/assetLibraryStore';
import { Canvas, useFrame } from '@react-three/fiber';
import { RoundedBoxPlaceholder } from '../builder/AssetMesh';

type TabType = 'categories' | 'favorites' | 'recent' | 'my-assets';
const TABS: { id: TabType; label: string; icon: string }[] = [
  { id: 'categories', label: 'Categories', icon: '📁' },
  { id: 'favorites', label: 'Favorites', icon: '⭐' },
  { id: 'recent', label: 'Recent', icon: '🕒' },
  { id: 'my-assets', label: 'My Assets', icon: '📦' },
];

const CATEGORIES = [
  'All', 'Bedroom', 'Living', 'Dining', 'Kitchen', 'Bathroom', 
  'Office', 'Appliances and Airflow', 'Openings', 'Decor'
];

// Context Menu
const ContextMenu = ({ x, y, asset, onClose, onEdit }: { x: number, y: number, asset: AssetDef, onClose: () => void, onEdit: (v: AssetDef) => void }) => {
  const [color, setColor] = useState(asset.color);
  return (
    <div className="fixed z-50 bg-neutral-800 border border-neutral-700 shadow-xl rounded-md p-3 text-xs w-48 text-white" style={{ left: x, top: y }}>
      <div className="font-bold mb-2 pb-2 border-b border-neutral-700">Edit Variant: {asset.label}</div>
      <label className="block mb-2 text-neutral-400">Color</label>
      <input type="color" value={color} onChange={e => setColor(e.target.value)} className="w-full mb-3 h-8 bg-transparent cursor-pointer rounded" />
      <div className="flex gap-2">
        <button onClick={() => { onEdit({ ...asset, id: `${asset.id}-var-${Date.now()}`, color }); onClose(); }} className="flex-1 bg-sky-600 hover:bg-sky-500 py-1 rounded">Save Variant</button>
        <button onClick={onClose} className="flex-1 bg-neutral-700 hover:bg-neutral-600 py-1 rounded">Cancel</button>
      </div>
    </div>
  );
};

// Turntable Component
const Turntable = ({ asset }: { asset: AssetDef }) => {
  const ref = useRef<any>();
  useFrame((_, delta) => {
    if (ref.current) ref.current.rotation.y += delta;
  });
  return (
    <group ref={ref} position={[0, -asset.size[1]/2, 0]}>
      <RoundedBoxPlaceholder id={asset.id} size={asset.size} color={asset.color} role={asset.role} />
      <ambientLight intensity={0.5} />
      <directionalLight position={[5, 10, 5]} intensity={1.5} />
    </group>
  );
};

export const AssetLibrary: React.FC = () => {
  const { assets: myAssets, loadAssets } = useAssetLibraryStore();
  const prefs = useLibraryPrefsStore();
  const [activeTab, setActiveTab] = useState<TabType>('categories');
  const [activeCat, setActiveCat] = useState('All');
  const [searchQuery, setSearchQuery] = useState('');
  const [isCollapsed, setIsCollapsed] = useState(false);
  const [hoveredAsset, setHoveredAsset] = useState<AssetDef | null>(null);
  const [contextMenu, setContextMenu] = useState<{ x: number, y: number, asset: AssetDef } | null>(null);

  const activeAssetId = useUiStore((state) => state.activeAssetId);
  const setActiveAssetId = useUiStore((state) => state.setActiveAssetId);
  const setToolMode = useUiStore((state) => state.setToolMode);
  
  useEffect(() => { loadAssets(); }, [loadAssets]);

  const allAssets = useMemo(() => {
    const custom = myAssets.map(a => ({
      id: a.id, label: a.name, category: 'my-assets', role: 'solid', elevation: 0,
      color: '#4ade80', size: a.dimensions, thumbnailDataUrl: a.thumbnailDataUrl
    } as AssetDef));
    return [...CATALOG_ASSETS, ...prefs.customVariants, ...custom];
  }, [myAssets, prefs.customVariants]);

  const filtered = useMemo(() => {
    let list = allAssets;
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      list = list.filter(a => a.label.toLowerCase().includes(q) || a.id.toLowerCase().includes(q));
    } else {
      if (activeTab === 'favorites') list = list.filter(a => prefs.favorites.includes(a.id));
      else if (activeTab === 'recent') list = prefs.recentlyUsed.map(id => allAssets.find(a => a.id === id)).filter(Boolean) as AssetDef[];
      else if (activeTab === 'my-assets') list = list.filter(a => a.category === 'my-assets');
      else if (activeCat !== 'All') list = list.filter(a => a.category === activeCat);
    }
    return list;
  }, [allAssets, searchQuery, activeTab, activeCat, prefs.favorites, prefs.recentlyUsed]);

  const handleSelectAsset = (asset: AssetDef) => {
    prefs.addRecentlyUsed(asset.id);
    if (activeAssetId === asset.id) {
      setActiveAssetId(null); setToolMode('select');
    } else {
      setActiveAssetId(asset.id); setToolMode(asset.wallMounted ? 'opening' : 'place');
    }
  };

  const handleDoubleClickPlace = (asset: AssetDef) => {
    prefs.addRecentlyUsed(asset.id);
    const centerObj = {
      id: `asset-${Date.now()}`,
      assetId: asset.id,
      name: asset.label,
      position: [0, asset.elevation || 0, 0] as [number, number, number],
      rotation: [0, 0, 0] as [number, number, number],
      size: asset.size,
      role: asset.role,
      color: asset.color,
      elevation: asset.elevation || 0,
      wallMounted: asset.wallMounted || false,
    };
    useSceneStore.getState().addObject(centerObj);
  };

  const handleDragStart = (e: React.DragEvent, asset: AssetDef) => {
    prefs.addRecentlyUsed(asset.id);
    e.dataTransfer.setData('text/plain', asset.id);
    e.dataTransfer.setData('application/json', JSON.stringify(asset));
    e.dataTransfer.effectAllowed = 'copy';
    setActiveAssetId(asset.id); setToolMode(asset.wallMounted ? 'opening' : 'place');
  };

  return (
    <>
      <aside className={`pointer-events-auto absolute top-20 left-4 z-20 flex flex-col bg-neutral-900/90 backdrop-blur-md border border-neutral-700/60 rounded-xl shadow-2xl transition-all duration-300 text-neutral-200 select-none ${isCollapsed ? 'w-12 h-12 overflow-hidden' : 'w-80 max-h-[calc(100vh-10rem)]'}`}>
        <div className="flex items-center justify-between p-3 border-b border-neutral-800">
          {!isCollapsed && <h2 className="text-sm font-bold text-white tracking-wide">Asset Library</h2>}
          <button onClick={() => setIsCollapsed(!isCollapsed)} className="p-1 text-neutral-400 hover:text-white rounded">
            {isCollapsed ? '📖' : '➖'}
          </button>
        </div>

        {!isCollapsed && (
          <>
            <div className="p-2 border-b border-neutral-800 relative">
              <input type="text" placeholder="Search..." value={searchQuery} onChange={e => setSearchQuery(e.target.value)} className="w-full bg-neutral-950/80 border border-neutral-700 rounded px-2 py-1.5 text-xs text-white" />
            </div>

            {!searchQuery && (
              <div className="flex bg-neutral-950 border-b border-neutral-800 text-[11px]">
                {TABS.map(t => (
                  <button key={t.id} onClick={() => setActiveTab(t.id)} className={`flex-1 py-1.5 text-center transition-colors ${activeTab === t.id ? 'bg-neutral-800 text-white font-bold' : 'text-neutral-400 hover:bg-neutral-900'}`}>{t.icon}</button>
                ))}
              </div>
            )}

            {!searchQuery && activeTab === 'categories' && (
              <div className="flex flex-wrap gap-1 p-2 border-b border-neutral-800 max-h-24 overflow-y-auto">
                {CATEGORIES.map(c => (
                  <button key={c} onClick={() => setActiveCat(c)} className={`px-2 py-1 rounded text-[10px] ${activeCat === c ? 'bg-sky-600 text-white' : 'bg-neutral-800 text-neutral-400 hover:bg-neutral-700'}`}>{c}</button>
                ))}
              </div>
            )}

            <div className="flex-1 overflow-y-auto p-2 space-y-1.5 max-h-[40vh] relative">
              {filtered.map(asset => (
                <div key={asset.id} 
                  draggable onDragStart={e => handleDragStart(e, asset)} 
                  onClick={() => handleSelectAsset(asset)}
                  onDoubleClick={() => handleDoubleClickPlace(asset)}
                  onContextMenu={(e) => { e.preventDefault(); setContextMenu({ x: e.clientX, y: e.clientY, asset }); }}
                  onMouseEnter={() => setHoveredAsset(asset)}
                  onMouseLeave={() => setHoveredAsset(null)}
                  className={`group relative flex items-center gap-3 p-2 rounded-lg cursor-grab active:cursor-grabbing border ${activeAssetId === asset.id ? 'bg-sky-950/60 border-sky-500' : 'bg-neutral-800/40 border-neutral-700/40 hover:bg-neutral-800'}`}
                >
                  <div className="w-10 h-10 rounded bg-black/40 border border-neutral-700 flex items-center justify-center shrink-0">
                    <div className="w-5 h-5 rounded-sm" style={{ backgroundColor: asset.color, transform: 'rotate(-20deg) skewX(10deg)', border: '1px solid rgba(255,255,255,0.2)' }} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex justify-between items-center">
                      <span className="font-semibold text-xs text-white truncate">{asset.label}</span>
                      <button onClick={(e) => { e.stopPropagation(); prefs.favorites.includes(asset.id) ? prefs.removeFavorite(asset.id) : prefs.addFavorite(asset.id); }} className="text-xs">{prefs.favorites.includes(asset.id) ? '⭐' : '☆'}</button>
                    </div>
                    <div className="text-[9px] text-neutral-400 mt-0.5">{asset.size.map(s => s.toFixed(2)).join(' x ')}m</div>
                  </div>
                </div>
              ))}
            </div>
            <div className="p-2 border-t border-neutral-800 text-[10px] text-neutral-400">Right-click to Edit Variants</div>
          </>
        )}
      </aside>

      {/* Hover Tooltip Turntable */}
      {hoveredAsset && !isCollapsed && (
        <div className="pointer-events-none absolute left-80 top-20 ml-6 z-30 bg-neutral-900 border border-neutral-700 rounded-lg shadow-2xl w-48 overflow-hidden">
          <div className="bg-neutral-950 h-40">
            {/* Turntable Canvas */}
            <Canvas camera={{ position: [2, 2, 2], fov: 40 }}>
              <Turntable asset={hoveredAsset} />
            </Canvas>
          </div>
          <div className="p-3 text-xs text-white">
            <div className="font-bold">{hoveredAsset.label}</div>
            <div className="text-neutral-400 mt-1">{hoveredAsset.category}</div>
            <div className="text-neutral-400 mt-1 font-mono">{hoveredAsset.size.map(s => s.toFixed(2)).join(' x ')} m</div>
            {hoveredAsset.defaultAirflow && <div className="text-cyan-400 mt-1">Airflow: {hoveredAsset.defaultAirflow} m³/h</div>}
            <div className="text-neutral-500 mt-2 text-[9px]">Double-click to place center</div>
          </div>
        </div>
      )}

      {/* Context Menu */}
      {contextMenu && <ContextMenu x={contextMenu.x} y={contextMenu.y} asset={contextMenu.asset} onClose={() => setContextMenu(null)} onEdit={prefs.addCustomVariant} />}
    </>
  );
};

export default AssetLibrary;
