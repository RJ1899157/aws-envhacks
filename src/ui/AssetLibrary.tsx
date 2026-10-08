import React, { useMemo, useState } from 'react';
import { CATALOG_ASSETS, type AssetDef } from '../core/catalog';
import { useUiStore } from '../store/uiStore';

type CategoryFilter = 'all' | 'furniture' | 'hvac' | 'openings' | 'decor';

const CATEGORY_TABS: { id: CategoryFilter; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'furniture', label: 'Furniture' },
  { id: 'hvac', label: 'Appliances/Airflow' },
  { id: 'openings', label: 'Openings' },
  { id: 'decor', label: 'Decor' },
];

export interface AssetLibraryProps {
  className?: string;
}

/**
 * Thumbnail icon rendering a 3D isometric representation of the asset using its real dimensions and color
 */
const AssetThumbnail: React.FC<{ asset: AssetDef }> = ({ asset }) => {
  return (
    <div
      className="relative w-11 h-11 rounded-md flex items-center justify-center border border-neutral-700/60 overflow-hidden flex-shrink-0 shadow-inner"
      style={{ backgroundColor: `${asset.color}20` }}
    >
      {/* Isometric 3D box glyph */}
      <div
        className="w-5 h-5 rounded-sm shadow-md transition-transform duration-200 group-hover:scale-110"
        style={{
          backgroundColor: asset.color,
          transform: 'rotate(-20deg) skewX(10deg)',
          border: '1px solid rgba(255,255,255,0.2)',
        }}
      />
      {asset.role === 'source' && (
        <span className="absolute bottom-0.5 right-0.5 w-2 h-2 rounded-full bg-cyan-400 animate-pulse shadow-sm" />
      )}
    </div>
  );
};

export const AssetLibrary: React.FC<AssetLibraryProps> = ({ className = '' }) => {
  const [activeCategory, setActiveCategory] = useState<CategoryFilter>('all');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [isCollapsed, setIsCollapsed] = useState<boolean>(false);

  const activeAssetId = useUiStore((state) => state.activeAssetId);
  const setActiveAssetId = useUiStore((state) => state.setActiveAssetId);
  const setToolMode = useUiStore((state) => state.setToolMode);

  // Filter assets by selected tab and search term
  const filteredAssets = useMemo(() => {
    return CATALOG_ASSETS.filter((asset) => {
      const matchesCategory = activeCategory === 'all' || asset.category === activeCategory;
      const matchesSearch =
        searchQuery.trim() === '' ||
        asset.label.toLowerCase().includes(searchQuery.toLowerCase()) ||
        asset.id.toLowerCase().includes(searchQuery.toLowerCase()) ||
        asset.role.toLowerCase().includes(searchQuery.toLowerCase());
      return matchesCategory && matchesSearch;
    });
  }, [activeCategory, searchQuery]);

  const handleSelectAsset = (asset: AssetDef) => {
    if (activeAssetId === asset.id) {
      // Deselect
      setActiveAssetId(null);
      setToolMode('select');
    } else {
      setActiveAssetId(asset.id);
      setToolMode(asset.wallMounted ? 'opening' : 'place');
    }
  };

  const handleDragStart = (e: React.DragEvent<HTMLDivElement>, asset: AssetDef) => {
    e.dataTransfer.setData('text/plain', asset.id);
    e.dataTransfer.setData('application/json', JSON.stringify(asset));
    e.dataTransfer.effectAllowed = 'copy';

    // Also activate placement in UI state
    setActiveAssetId(asset.id);
    setToolMode(asset.wallMounted ? 'opening' : 'place');
  };

  return (
    <aside
      className={`pointer-events-auto absolute top-20 left-4 z-20 flex flex-col bg-neutral-900/90 backdrop-blur-md border border-neutral-700/60 rounded-xl shadow-2xl transition-all duration-300 text-neutral-200 select-none ${
        isCollapsed ? 'w-12 h-12 overflow-hidden' : 'w-80 max-h-[calc(100vh-10rem)]'
      } ${className}`}
    >
      {/* Header & Toggle */}
      <div className="flex items-center justify-between p-3.5 border-b border-neutral-800">
        {!isCollapsed && (
          <div className="flex items-center gap-2">
            <h2 className="text-sm font-bold text-white tracking-wide">Catalog</h2>
            <span className="text-[11px] px-2 py-0.5 rounded-full bg-neutral-800 text-neutral-400 font-mono">
              {filteredAssets.length}
            </span>
          </div>
        )}
        <button
          type="button"
          onClick={() => setIsCollapsed(!isCollapsed)}
          className="p-1 rounded-md text-neutral-400 hover:text-white hover:bg-neutral-800 transition-colors ml-auto"
          title={isCollapsed ? 'Expand library' : 'Collapse library'}
        >
          {isCollapsed ? (
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M4 6h16M4 12h16M4 18h16"
              />
            </svg>
          ) : (
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M15 19l-7-7 7-7"
              />
            </svg>
          )}
        </button>
      </div>

      {!isCollapsed && (
        <>
          {/* Search Box */}
          <div className="p-3 border-b border-neutral-800/80">
            <div className="relative">
              <input
                type="text"
                placeholder="Search assets..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full bg-neutral-950/80 border border-neutral-700/60 rounded-lg px-3 py-1.5 pl-8 text-xs text-neutral-100 placeholder-neutral-500 focus:outline-none focus:border-sky-500 focus:ring-1 focus:ring-sky-500 transition-all font-sans"
              />
              <svg
                className="w-3.5 h-3.5 text-neutral-500 absolute left-2.5 top-2.5"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
                />
              </svg>
              {searchQuery && (
                <button
                  type="button"
                  onClick={() => setSearchQuery('')}
                  className="absolute right-2.5 top-2 text-neutral-400 hover:text-white text-xs"
                >
                  &times;
                </button>
              )}
            </div>
          </div>

          {/* Category Tabs */}
          <div className="flex items-center gap-1 p-2 overflow-x-auto border-b border-neutral-800 scrollbar-none text-[11px]">
            {CATEGORY_TABS.map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => setActiveCategory(tab.id)}
                className={`px-2.5 py-1 rounded-md font-medium whitespace-nowrap transition-colors ${
                  activeCategory === tab.id
                    ? 'bg-sky-600 text-white shadow-sm'
                    : 'text-neutral-400 hover:text-neutral-200 hover:bg-neutral-800'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>

          {/* Scrollable Asset List */}
          <div className="flex-1 overflow-y-auto p-2.5 space-y-1.5 max-h-[50vh]">
            {filteredAssets.length === 0 ? (
              <div
                data-testid="asset-library-empty-state"
                className="text-center py-10 px-4 flex flex-col items-center gap-2"
              >
                <span className="text-2xl">🔍</span>
                <span className="text-xs font-medium text-neutral-400">
                  No matching assets found
                </span>
                <span className="text-[11px] text-neutral-500">
                  Try another search query or select another category
                </span>
              </div>
            ) : (
              filteredAssets.map((asset) => {
                const isSelected = activeAssetId === asset.id;
                const [w, h, d] = asset.size;
                const dimensionLabel = `${w.toFixed(2)} x ${h.toFixed(2)} x ${d.toFixed(2)} m`;

                return (
                  <div
                    key={asset.id}
                    draggable
                    onDragStart={(e) => handleDragStart(e, asset)}
                    onClick={() => handleSelectAsset(asset)}
                    className={`group flex items-center gap-3 p-2 rounded-lg cursor-grab active:cursor-grabbing border transition-all ${
                      isSelected
                        ? 'bg-sky-950/60 border-sky-500 shadow-md ring-1 ring-sky-500'
                        : 'bg-neutral-800/40 hover:bg-neutral-800/80 border-neutral-700/40 hover:border-neutral-600'
                    }`}
                  >
                    <AssetThumbnail asset={asset} />

                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between gap-1">
                        <span className="font-semibold text-xs text-white truncate">
                          {asset.label}
                        </span>
                        {asset.wallMounted && (
                          <span className="text-[9px] px-1.5 py-0.2 rounded bg-amber-950/80 border border-amber-600/50 text-amber-300 font-mono uppercase">
                            Wall
                          </span>
                        )}
                      </div>

                      <div className="flex items-center gap-2 mt-0.5 text-[10px] text-neutral-400 font-mono">
                        <span>{dimensionLabel}</span>
                        {asset.defaultAirflow && (
                          <span className="text-cyan-400 font-sans">
                            {asset.defaultAirflow} m³/h
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })
            )}
          </div>

          {/* Footer Guide */}
          <div className="p-2.5 border-t border-neutral-800 text-[10px] text-neutral-400 flex items-center justify-between">
            <span>Drag or click to place</span>
            <span className="font-mono text-neutral-500">Shift = repeat</span>
          </div>
        </>
      )}
    </aside>
  );
};

export default AssetLibrary;
