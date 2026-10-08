import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { openDB, type IDBPDatabase } from 'idb';
import type { AssetDef } from '../core/catalog';

export interface MyAsset {
  id: string;
  name: string;
  type: string;
  format: string;
  blob: Blob;
  thumbnailDataUrl?: string;
  dimensions: [number, number, number];
  addedAt: number;
}

interface PersistentLibraryState {
  favorites: string[];
  recentlyUsed: string[];
  customVariants: AssetDef[];
  addFavorite: (id: string) => void;
  removeFavorite: (id: string) => void;
  addRecentlyUsed: (id: string) => void;
  addCustomVariant: (variant: AssetDef) => void;
}

export const useLibraryPrefsStore = create<PersistentLibraryState>()(
  persist(
    (set) => ({
      favorites: [],
      recentlyUsed: [],
      customVariants: [],
      addFavorite: (id) => set((s) => ({ favorites: [...new Set([...s.favorites, id])] })),
      removeFavorite: (id) => set((s) => ({ favorites: s.favorites.filter((f) => f !== id) })),
      addRecentlyUsed: (id) => set((s) => {
        const filtered = s.recentlyUsed.filter((r) => r !== id);
        return { recentlyUsed: [id, ...filtered].slice(0, 20) };
      }),
      addCustomVariant: (variant) => set((s) => ({
        customVariants: [...s.customVariants.filter(v => v.id !== variant.id), variant]
      })),
    }),
    { name: 'airforce-library-prefs' }
  )
);

interface AssetLibraryState {
  assets: MyAsset[];
  isLoading: boolean;
  loadAssets: () => Promise<void>;
  addAsset: (asset: MyAsset) => Promise<void>;
  removeAsset: (id: string) => Promise<void>;
}

let dbPromise: Promise<IDBPDatabase> | null = null;
const initDB = () => {
  if (!dbPromise) {
    dbPromise = openDB('AirForceAssetsDB', 1, {
      upgrade(db) {
        if (!db.objectStoreNames.contains('assets')) {
          db.createObjectStore('assets', { keyPath: 'id' });
        }
      },
    });
  }
  return dbPromise;
};

export const useAssetLibraryStore = create<AssetLibraryState>((set, get) => ({
  assets: [],
  isLoading: true,

  loadAssets: async () => {
    set({ isLoading: true });
    try {
      const db = await initDB();
      const assets = await db.getAll('assets');
      set({ assets: assets.sort((a, b) => b.addedAt - a.addedAt), isLoading: false });
    } catch (err) {
      console.error('Failed to load assets from DB', err);
      set({ isLoading: false });
    }
  },

  addAsset: async (asset) => {
    try {
      const db = await initDB();
      await db.put('assets', asset);
      const current = get().assets;
      set({ assets: [asset, ...current] });
    } catch (err) {
      console.error('Failed to save asset to DB', err);
    }
  },

  removeAsset: async (id) => {
    try {
      const db = await initDB();
      await db.delete('assets', id);
      set({ assets: get().assets.filter((a) => a.id !== id) });
    } catch (err) {
      console.error('Failed to delete asset', err);
    }
  },
}));
