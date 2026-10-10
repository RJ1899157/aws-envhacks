import React, { useMemo, useState, useRef, useEffect } from 'react';
import {
  Folder,
  Star,
  Clock,
  Package,
  Search,
  ChevronLeft,
  ChevronRight,
  X,
  Home,
  Armchair,
  type LucideIcon,
} from 'lucide-react';
import { CATALOG_ASSETS, type AssetDef } from '../core/catalog';
import { ROOM_TYPES, ROOM_TYPE_ORDER, roomGridOrigin, roomTypeOf } from '../core/rooms';
import { presetSummary } from '../core/roomPresets';
import { openingSubTypeFor } from '../core/openingPresets';
import type { RoomType } from '../core/schema';
import { polygonBounds } from '../core/parser';
import { computeSmartSnap } from '../core/smartSnap';
import { useUiStore } from '../store/uiStore';
import { useSceneStore } from '../store/sceneStore';
import { useAssetLibraryStore, useLibraryPrefsStore } from '../store/assetLibraryStore';
import { Canvas, useFrame } from '@react-three/fiber';
import { RoundedBoxPlaceholder } from '../builder/AssetMesh';
import { Tooltip } from './components/Tooltip';

type TabType = 'categories' | 'favorites' | 'recent' | 'my-assets';
const TABS: { id: TabType; label: string; icon: LucideIcon }[] = [
  { id: 'categories', label: 'Categories', icon: Folder },
  { id: 'favorites', label: 'Favorites', icon: Star },
  { id: 'recent', label: 'Recent', icon: Clock },
  { id: 'my-assets', label: 'My Assets', icon: Package },
];

const CATEGORIES = [
  'All',
  'Bedroom',
  'Living',
  'Dining',
  'Kitchen',
  'Bathroom',
  'Office',
  'Appliances and Airflow',
  'Pollution sources',
  'Openings',
  'Walls',
  'Decor',
];

// Turntable Component
const Turntable = ({ asset }: { asset: AssetDef }) => {
  const ref = useRef<any>();
  useFrame((_, delta) => {
    if (ref.current) ref.current.rotation.y += delta;
  });
  return (
    <group ref={ref} position={[0, -asset.size[1] / 2, 0]}>
      <RoundedBoxPlaceholder
        id={asset.id}
        size={asset.size}
        color={asset.color}
        role={asset.role}
      />
      <ambientLight intensity={0.6} />
      <directionalLight position={[5, 10, 5]} intensity={1.5} />
    </group>
  );
};

// Context Menu for custom variant
const ContextMenu = ({
  x,
  y,
  asset,
  onClose,
  onEdit,
}: {
  x: number;
  y: number;
  asset: AssetDef;
  onClose: () => void;
  onEdit: (v: AssetDef) => void;
}) => {
  const [color, setColor] = useState(asset.color);
  return (
    <div
      className="fixed z-[80] bg-neutral-900/95 border border-white/10 shadow-2xl rounded-[10px] p-3 text-xs w-52 text-white backdrop-blur-md animate-in fade-in zoom-in-95 duration-100"
      style={{ left: x, top: y }}
    >
      <div className="font-semibold mb-2 pb-1.5 border-b border-white/10 flex items-center justify-between">
        <span className="truncate">Edit Variant</span>
        <button type="button" onClick={onClose} className="text-neutral-400 hover:text-white">
          <X size={14} />
        </button>
      </div>
      <div className="text-[11px] text-neutral-300 font-medium mb-1 truncate">{asset.label}</div>
      <label className="block mb-1 text-[10px] uppercase text-neutral-400 font-semibold tracking-wider">
        Base Color
      </label>
      <input
        type="color"
        value={color}
        onChange={(e) => setColor(e.target.value)}
        className="w-full mb-3 h-8 bg-transparent cursor-pointer rounded"
      />
      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => {
            onEdit({ ...asset, id: `${asset.id}-var-${Date.now()}`, color });
            onClose();
          }}
          className="flex-1 bg-indigo-600 hover:bg-indigo-500 text-white font-medium py-1 rounded-[6px] transition-colors"
        >
          Save
        </button>
        <button
          type="button"
          onClick={onClose}
          className="flex-1 bg-white/10 hover:bg-white/15 text-neutral-300 py-1 rounded-[6px] transition-colors"
        >
          Cancel
        </button>
      </div>
    </div>
  );
};

export const AssetLibrary: React.FC = () => {
  const { assets: myAssets, loadAssets } = useAssetLibraryStore();
  const prefs = useLibraryPrefsStore();
  const [activeTab, setActiveTab] = useState<TabType>('categories');
  const [activeCat, setActiveCat] = useState('All');
  const [searchQuery, setSearchQuery] = useState('');
  const [isCollapsed, setIsCollapsed] = useState(false);
  const [panel, setPanel] = useState<'assets' | 'rooms'>('assets');
  const pendingRoomType = useUiStore((state) => state.pendingRoomType);

  // "+ Add room" elsewhere in the UI opens this panel on the Rooms side
  useEffect(() => {
    const open = () => {
      setPanel('rooms');
      setIsCollapsed(false);
    };
    window.addEventListener('airforce:open-rooms', open);
    return () => window.removeEventListener('airforce:open-rooms', open);
  }, []);

  // Like placing an asset: pick a spot for the new room in the plan view
  const startRoomPlacement = (type: RoomType) => {
    const ui = useUiStore.getState();
    ui.setSelectedWallIndex(null);
    ui.setActiveAssetId(null);
    ui.setPendingRoomType(type);
    ui.setToolMode('room');
  };
  const [hoveredAsset, setHoveredAsset] = useState<AssetDef | null>(null);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; asset: AssetDef } | null>(
    null
  );

  const activeAssetId = useUiStore((state) => state.activeAssetId);
  const setActiveAssetId = useUiStore((state) => state.setActiveAssetId);
  const setToolMode = useUiStore((state) => state.setToolMode);

  // Open on the active room's own category (Bathroom -> toilet, sink...) whenever the room changes
  const activeRoomId = useSceneStore((state) => state.room.id);
  const roomCategory = useSceneStore((state) => ROOM_TYPES[roomTypeOf(state.room)].assetCategory);
  useEffect(() => {
    setActiveTab('categories');
    setActiveCat(roomCategory);
  }, [activeRoomId, roomCategory]);

  useEffect(() => {
    loadAssets();
  }, [loadAssets]);

  const allAssets = useMemo(() => {
    const custom = myAssets.map(
      (a) =>
        ({
          id: a.id,
          label: a.name,
          category: 'my-assets',
          role: 'solid',
          elevation: 0,
          color: '#4ade80',
          size: a.dimensions,
          thumbnailDataUrl: a.thumbnailDataUrl,
        }) as AssetDef
    );
    return [...CATALOG_ASSETS, ...prefs.customVariants, ...custom];
  }, [myAssets, prefs.customVariants]);

  const filtered = useMemo(() => {
    let list = allAssets;
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      list = list.filter(
        (a) => a.label.toLowerCase().includes(q) || a.id.toLowerCase().includes(q)
      );
    } else {
      if (activeTab === 'favorites') list = list.filter((a) => prefs.favorites.includes(a.id));
      else if (activeTab === 'recent')
        list = prefs.recentlyUsed
          .map((id) => allAssets.find((a) => a.id === id))
          .filter(Boolean) as AssetDef[];
      else if (activeTab === 'my-assets') list = list.filter((a) => a.category === 'my-assets');
      else if (activeCat !== 'All') list = list.filter((a) => a.category === activeCat);
      // In "All", list the active room's own assets first
      else if (roomCategory !== 'All')
        list = [
          ...list.filter((a) => a.category === roomCategory),
          ...list.filter((a) => a.category !== roomCategory),
        ];
    }
    return list;
  }, [
    allAssets,
    searchQuery,
    activeTab,
    activeCat,
    roomCategory,
    prefs.favorites,
    prefs.recentlyUsed,
  ]);

  const handleSelectAsset = (asset: AssetDef) => {
    prefs.addRecentlyUsed(asset.id);
    if (activeAssetId === asset.id) {
      setActiveAssetId(null);
      setToolMode('select');
    } else {
      setActiveAssetId(asset.id);
      setToolMode(openingSubTypeFor(asset.id) ? 'opening' : 'place');
    }
  };

  const handleDoubleClickPlace = (asset: AssetDef) => {
    prefs.addRecentlyUsed(asset.id);
    // Doors, windows and wall appliances need a wall: start placing instead of dropping mid-room
    if (asset.wallMounted) {
      setActiveAssetId(asset.id);
      setToolMode(openingSubTypeFor(asset.id) ? 'opening' : 'place');
      return;
    }
    // Drop it in the middle of the active room (not the world origin, which may be another room)
    const { room, snapEnabled, gridStep } = {
      ...useSceneStore.getState(),
      ...useUiStore.getState(),
    };
    const b = polygonBounds(room.outline);
    const { snappedPos } = computeSmartSnap({
      candidatePos: [(b.min[0] + b.max[0]) / 2, 0, (b.min[1] + b.max[1]) / 2],
      candidateRotY: 0,
      objectSize: asset.size,
      startPos: [0, 0, 0],
      room,
      gridStep,
      gridOrigin: roomGridOrigin(room),
      snapEnabled,
    });
    const centerObj = {
      id: `asset-${Date.now()}`,
      assetId: asset.id,
      name: asset.label,
      position: [snappedPos[0], 0, snappedPos[2]] as [number, number, number],
      rotation: [0, 0, 0] as [number, number, number],
      size: asset.size,
      role: asset.role,
      color: asset.color,
      elevation: asset.elevation || 0,
      wallMounted: false,
    };
    useSceneStore.getState().addObject(centerObj);
  };

  const handleDragStart = (e: React.DragEvent, asset: AssetDef) => {
    prefs.addRecentlyUsed(asset.id);
    e.dataTransfer.setData('text/plain', asset.id);
    e.dataTransfer.setData('application/json', JSON.stringify(asset));
    e.dataTransfer.effectAllowed = 'copy';
    setActiveAssetId(asset.id);
    setToolMode(openingSubTypeFor(asset.id) ? 'opening' : 'place');
  };

  return (
    <>
      <aside
        data-testid="asset-library-sidebar"
        className={`pointer-events-auto fixed top-14 left-3 z-[15] flex flex-col bg-neutral-900/85 dark:bg-[#121826]/85 backdrop-blur-md border border-neutral-300/20 dark:border-white/10 rounded-[10px] shadow-2xl transition-all duration-150 text-neutral-200 select-none overflow-hidden ${
          isCollapsed ? 'w-12 h-auto py-2.5 items-center' : 'w-[280px] max-h-[calc(100vh-4.5rem)]'
        }`}
      >
        {/* Rail Mode (Collapsed: 48px width) */}
        {isCollapsed ? (
          <div className="flex flex-col items-center gap-3">
            <Tooltip label="Expand Asset Library" side="right">
              <button
                type="button"
                onClick={() => setIsCollapsed(false)}
                className="w-8 h-8 rounded-[6px] hover:bg-white/10 text-neutral-400 hover:text-white flex items-center justify-center transition-colors"
                aria-label="Expand Library"
              >
                <ChevronRight size={18} strokeWidth={1.75} />
              </button>
            </Tooltip>

            <div className="w-6 h-px bg-white/10" />

            <Tooltip label="Add a room" side="right">
              <button
                type="button"
                onClick={() => {
                  setPanel('rooms');
                  setIsCollapsed(false);
                }}
                className="w-8 h-8 rounded-[6px] flex items-center justify-center transition-colors text-neutral-400 hover:text-white hover:bg-white/10"
                aria-label="Rooms"
              >
                <Home size={18} strokeWidth={1.75} />
              </button>
            </Tooltip>

            {TABS.map((t) => {
              const Icon = t.icon;
              return (
                <Tooltip key={t.id} label={t.label} side="right">
                  <button
                    type="button"
                    onClick={() => {
                      setPanel('assets');
                      setActiveTab(t.id);
                      setIsCollapsed(false);
                    }}
                    className={`w-8 h-8 rounded-[6px] flex items-center justify-center transition-colors ${
                      activeTab === t.id
                        ? 'bg-indigo-600 text-white'
                        : 'text-neutral-400 hover:text-white hover:bg-white/10'
                    }`}
                  >
                    <Icon size={18} strokeWidth={1.75} />
                  </button>
                </Tooltip>
              );
            })}
          </div>
        ) : (
          /* Expanded Mode (280px width) */
          <>
            {/* Header */}
            <div className="flex items-center justify-between px-3 py-2.5 border-b border-neutral-200/10 dark:border-white/10">
              <div
                className="flex items-center rounded-[7px] bg-black/30 p-0.5 text-xs font-medium"
                role="tablist"
              >
                {(
                  [
                    ['assets', 'Assets', Armchair],
                    ['rooms', 'Rooms', Home],
                  ] as const
                ).map(([id, label, Icon]) => (
                  <button
                    key={id}
                    type="button"
                    role="tab"
                    aria-selected={panel === id}
                    data-testid={`library-panel-${id}`}
                    onClick={() => setPanel(id)}
                    className={`flex items-center gap-1.5 rounded-[5px] px-2.5 py-1 transition-colors ${
                      panel === id
                        ? 'bg-indigo-600 text-white shadow-sm'
                        : 'text-neutral-400 hover:text-white'
                    }`}
                  >
                    <Icon size={13} strokeWidth={1.9} />
                    {label}
                  </button>
                ))}
              </div>
              <Tooltip label="Collapse to rail">
                <button
                  type="button"
                  onClick={() => setIsCollapsed(true)}
                  className="p-1 text-neutral-400 hover:text-white rounded-[6px] hover:bg-white/10 transition-colors"
                  aria-label="Collapse Library"
                >
                  <ChevronLeft size={16} strokeWidth={1.75} />
                </button>
              </Tooltip>
            </div>

            {panel === 'rooms' ? (
              <div
                className="flex-1 overflow-y-auto p-2 space-y-1.5 max-h-[calc(100vh-9rem)]"
                data-testid="rooms-panel"
              >
                <p className="px-1 pb-1 text-[11px] text-neutral-400">
                  Pick a room, then click in the plan to place it.{' '}
                  <kbd className="rounded bg-white/10 px-1 text-[10px]">R</kbd> rotates.
                </p>
                {ROOM_TYPE_ORDER.map((type) => {
                  const info = ROOM_TYPES[type];
                  const isPending = pendingRoomType === type;
                  return (
                    <button
                      key={type}
                      type="button"
                      data-testid={`room-card-${type}`}
                      onClick={() => startRoomPlacement(type)}
                      className={`w-full rounded-[8px] border p-2.5 text-left transition-colors ${
                        isPending
                          ? 'border-indigo-500 bg-indigo-500/15'
                          : 'border-white/10 bg-black/20 hover:border-indigo-500/60 hover:bg-white/5'
                      }`}
                    >
                      <div className="flex items-baseline justify-between">
                        <span className="text-xs font-semibold text-white">{info.label}</span>
                        <span className="font-mono text-[10px] text-neutral-500">
                          {info.size[0]} × {info.size[1]} m
                        </span>
                      </div>
                      <div className="mt-0.5 text-[11px] leading-snug text-neutral-400">
                        {presetSummary(type)}
                      </div>
                    </button>
                  );
                })}
              </div>
            ) : (
              <>
                {/* Search Input */}
                <div className="px-2.5 pt-2.5 pb-2 border-b border-neutral-200/10 dark:border-white/10 relative">
                  <div className="relative flex items-center">
                    <Search
                      size={14}
                      strokeWidth={1.75}
                      className="absolute left-2.5 text-neutral-400 pointer-events-none"
                    />
                    <input
                      type="text"
                      placeholder="Search assets..."
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      className="w-full bg-black/20 dark:bg-white/5 border border-neutral-300/30 dark:border-white/10 rounded-[6px] pl-8 pr-7 py-1 text-xs text-white placeholder-neutral-500 outline-none focus:border-indigo-500"
                    />
                    {searchQuery && (
                      <button
                        type="button"
                        onClick={() => setSearchQuery('')}
                        className="absolute right-2 text-neutral-400 hover:text-white"
                      >
                        <X size={13} />
                      </button>
                    )}
                  </div>
                </div>

                {/* Tab Selector */}
                {!searchQuery && (
                  <div className="flex bg-black/20 dark:bg-white/5 border-b border-neutral-200/10 dark:border-white/10 p-1 gap-1">
                    {TABS.map((t) => {
                      const Icon = t.icon;
                      const isActive = activeTab === t.id;
                      return (
                        <Tooltip key={t.id} label={t.label}>
                          <button
                            type="button"
                            aria-label={t.label}
                            onClick={() => setActiveTab(t.id)}
                            className={`flex-1 py-1 rounded-[4px] flex items-center justify-center transition-colors ${
                              isActive
                                ? 'bg-indigo-600 text-white font-medium shadow-sm'
                                : 'text-neutral-400 hover:text-white hover:bg-white/5'
                            }`}
                          >
                            <Icon size={14} strokeWidth={1.75} />
                          </button>
                        </Tooltip>
                      );
                    })}
                  </div>
                )}

                {/* Category Pills */}
                {!searchQuery && activeTab === 'categories' && (
                  <div className="flex flex-wrap gap-1 p-2 border-b border-neutral-200/10 dark:border-white/10 max-h-24 overflow-y-auto">
                    {CATEGORIES.map((c) => (
                      <button
                        key={c}
                        type="button"
                        onClick={() => setActiveCat(c)}
                        className={`px-2 py-0.5 rounded-[4px] text-[10px] font-medium transition-colors ${
                          activeCat === c
                            ? 'bg-indigo-600 text-white'
                            : 'bg-black/20 dark:bg-white/5 text-neutral-400 hover:text-white hover:bg-white/10'
                        }`}
                      >
                        {c}
                      </button>
                    ))}
                  </div>
                )}

                {/* Assets List */}
                <div className="flex-1 overflow-y-auto p-2 space-y-1.5 max-h-[50vh]">
                  {filtered.length === 0 ? (
                    <div className="py-6 text-center text-xs text-neutral-400">No assets found</div>
                  ) : (
                    filtered.map((asset) => (
                      <div
                        key={asset.id}
                        draggable
                        onDragStart={(e) => handleDragStart(e, asset)}
                        onClick={() => handleSelectAsset(asset)}
                        onDoubleClick={() => handleDoubleClickPlace(asset)}
                        onContextMenu={(e) => {
                          e.preventDefault();
                          setContextMenu({ x: e.clientX, y: e.clientY, asset });
                        }}
                        onMouseEnter={() => setHoveredAsset(asset)}
                        onMouseLeave={() => setHoveredAsset(null)}
                        className={`group relative flex items-center gap-2.5 p-2 rounded-[8px] cursor-grab active:cursor-grabbing border transition-colors ${
                          activeAssetId === asset.id
                            ? 'bg-indigo-950/60 border-indigo-500'
                            : 'bg-black/10 dark:bg-white/5 border-neutral-300/20 dark:border-white/5 hover:bg-black/20 dark:hover:bg-white/10 hover:border-white/20'
                        }`}
                      >
                        {/* Visual Thumbnail */}
                        <div className="w-8 h-8 rounded-[6px] bg-black/40 border border-white/10 flex items-center justify-center shrink-0">
                          <div
                            className="w-4 h-4 rounded-sm shadow-sm"
                            style={{
                              backgroundColor: asset.color,
                              transform: 'rotate(-15deg)',
                              border: '1px solid rgba(255,255,255,0.2)',
                            }}
                          />
                        </div>

                        <div className="flex-1 min-w-0">
                          <div className="flex items-center justify-between">
                            <span className="font-medium text-xs text-white truncate">
                              {asset.label}
                            </span>
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                prefs.favorites.includes(asset.id)
                                  ? prefs.removeFavorite(asset.id)
                                  : prefs.addFavorite(asset.id);
                              }}
                              className="text-neutral-400 hover:text-amber-400 p-0.5"
                              title="Toggle favorite"
                            >
                              <Star
                                size={12}
                                className={
                                  prefs.favorites.includes(asset.id)
                                    ? 'text-amber-400 fill-amber-400'
                                    : ''
                                }
                              />
                            </button>
                          </div>
                          <div className="text-[10px] text-neutral-400 font-mono mt-0.5">
                            {asset.size.map((s) => s.toFixed(2)).join(' × ')} m
                          </div>
                        </div>
                      </div>
                    ))
                  )}
                </div>

                <div className="px-3 py-1.5 border-t border-neutral-200/10 dark:border-white/10 text-[10px] text-neutral-500 flex justify-between items-center">
                  <span>Right-click to edit</span>
                  <span>Double-click to add</span>
                </div>
              </>
            )}
          </>
        )}
      </aside>

      {/* Hover Tooltip Turntable */}
      {hoveredAsset && !isCollapsed && (
        <div className="pointer-events-none fixed left-[300px] top-20 z-[30] bg-neutral-900/95 dark:bg-[#121826]/95 border border-white/10 rounded-[10px] shadow-2xl w-48 overflow-hidden backdrop-blur-md animate-in fade-in zoom-in-95 duration-100">
          <div className="bg-black/60 h-36">
            <Canvas camera={{ position: [2, 2, 2], fov: 40 }}>
              <Turntable asset={hoveredAsset} />
            </Canvas>
          </div>
          <div className="p-2.5 text-xs text-white flex flex-col gap-1">
            <div className="font-semibold text-xs truncate">{hoveredAsset.label}</div>
            <div className="text-[10px] text-neutral-400">{hoveredAsset.category}</div>
            <div className="text-[11px] text-indigo-300 font-mono">
              {hoveredAsset.size.map((s) => s.toFixed(2)).join(' × ')} m
            </div>
            {hoveredAsset.defaultAirflow && (
              <div className="text-[10px] text-cyan-400 font-mono">
                💨 {hoveredAsset.defaultAirflow} m³/h
              </div>
            )}
          </div>
        </div>
      )}

      {/* Context Menu */}
      {contextMenu && (
        <ContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          asset={contextMenu.asset}
          onClose={() => setContextMenu(null)}
          onEdit={prefs.addCustomVariant}
        />
      )}
    </>
  );
};

export default AssetLibrary;
