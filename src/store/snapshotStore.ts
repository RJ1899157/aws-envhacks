import { create } from 'zustand';
import { openDB, type IDBPDatabase } from 'idb';
import { useSceneStore } from './sceneStore';
import type { Room } from '../core/schema';

export interface Snapshot {
  id: string;
  name: string;
  timestamp: number;
  room: Room;
}

interface SnapshotState {
  snapshots: Snapshot[];
  isLoading: boolean;
  loadSnapshots: () => Promise<void>;
  saveSnapshot: (name: string) => Promise<void>;
  restoreSnapshot: (id: string) => Promise<void>;
  deleteSnapshot: (id: string) => Promise<void>;
}

let dbPromise: Promise<IDBPDatabase> | null = null;
const initDB = () => {
  if (!dbPromise) {
    dbPromise = openDB('AirForceSnapshotsDB', 1, {
      upgrade(db) {
        if (!db.objectStoreNames.contains('snapshots')) {
          db.createObjectStore('snapshots', { keyPath: 'id' });
        }
      },
    });
  }
  return dbPromise;
};

export const useSnapshotStore = create<SnapshotState>((set, get) => ({
  snapshots: [],
  isLoading: true,

  loadSnapshots: async () => {
    set({ isLoading: true });
    try {
      const db = await initDB();
      const snapshots = await db.getAll('snapshots');
      set({ snapshots: snapshots.sort((a, b) => b.timestamp - a.timestamp), isLoading: false });
    } catch (err) {
      console.error('Failed to load snapshots', err);
      set({ isLoading: false });
    }
  },

  saveSnapshot: async (name) => {
    try {
      const db = await initDB();
      const room = useSceneStore.getState().room;
      const snapshot: Snapshot = {
        id: `snap-${Date.now()}`,
        name,
        timestamp: Date.now(),
        room: JSON.parse(JSON.stringify(room)), // Deep clone
      };
      await db.put('snapshots', snapshot);
      const current = get().snapshots;
      set({ snapshots: [snapshot, ...current] });
    } catch (err) {
      console.error('Failed to save snapshot', err);
    }
  },

  restoreSnapshot: async (id) => {
    const snap = get().snapshots.find(s => s.id === id);
    if (snap) {
      useSceneStore.getState().loadRoom(JSON.parse(JSON.stringify(snap.room)));
    }
  },

  deleteSnapshot: async (id) => {
    try {
      const db = await initDB();
      await db.delete('snapshots', id);
      set({ snapshots: get().snapshots.filter((s) => s.id !== id) });
    } catch (err) {
      console.error('Failed to delete snapshot', err);
    }
  },
}));
