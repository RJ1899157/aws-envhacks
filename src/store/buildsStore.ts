import { create } from 'zustand';
import { openDB, type IDBPDatabase } from 'idb';
import { RoomSchema, type Room } from '../core/schema';
import { parseRoom } from '../core/parser';

/**
 * Saved builds ("My builds"): whole designs (every room) kept in the browser's IndexedDB under a
 * name, plus file download / open so a build can be backed up, moved or shared.
 */

export interface Build {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  /** Every room of the design; the first one is the room that was active when saved */
  rooms: Room[];
}

/** File format of a downloaded build. */
export interface BuildFile {
  app: 'airforce';
  kind: 'build';
  version: 1;
  name: string;
  savedAt: string;
  rooms: Room[];
}

const DB_NAME = 'AirForceBuildsDB';
const STORE = 'builds';
let dbPromise: Promise<IDBPDatabase> | null = null;
function db(): Promise<IDBPDatabase> {
  if (!dbPromise) {
    dbPromise = openDB(DB_NAME, 1, {
      upgrade(d) {
        if (!d.objectStoreNames.contains(STORE)) d.createObjectStore(STORE, { keyPath: 'id' });
      },
    });
  }
  return dbPromise;
}

const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v)) as T;
const newId = () => `build-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;

/** Stable fingerprint of a design, to tell whether it changed since it was saved. */
export function designFingerprint(rooms: readonly Room[]): string {
  return JSON.stringify(rooms);
}

interface BuildsState {
  builds: Build[];
  loaded: boolean;
  error: string | null;
  load: () => Promise<void>;
  /** Saves `rooms` as a new build (no id) or over an existing one; returns the saved build */
  save: (rooms: readonly Room[], name: string, id?: string | null) => Promise<Build>;
  rename: (id: string, name: string) => Promise<void>;
  remove: (id: string) => Promise<void>;
}

export const useBuildsStore = create<BuildsState>()((set, get) => ({
  builds: [],
  loaded: false,
  error: null,

  load: async () => {
    try {
      const all = (await (await db()).getAll(STORE)) as Build[];
      set({ builds: all.sort((a, b) => b.updatedAt - a.updatedAt), loaded: true, error: null });
    } catch {
      set({ loaded: true, error: 'Saved builds are unavailable in this browser (private window or storage blocked).' });
    }
  },

  save: async (rooms, name, id) => {
    const now = Date.now();
    const existing = id ? get().builds.find((b) => b.id === id) : undefined;
    const build: Build = { id: existing?.id ?? newId(), name: name.trim() || 'My build', createdAt: existing?.createdAt ?? now, updatedAt: now, rooms: clone([...rooms]) };
    await (await db()).put(STORE, build);
    set((s) => ({ builds: [build, ...s.builds.filter((b) => b.id !== build.id)], error: null }));
    return build;
  },

  rename: async (id, name) => {
    const b = get().builds.find((x) => x.id === id);
    if (!b || !name.trim()) return;
    const next = { ...b, name: name.trim() };
    await (await db()).put(STORE, next);
    set((s) => ({ builds: s.builds.map((x) => (x.id === id ? next : x)) }));
  },

  remove: async (id) => {
    await (await db()).delete(STORE, id);
    set((s) => ({ builds: s.builds.filter((b) => b.id !== id) }));
  },
}));

/** A downloadable file of a build. */
export function buildToFile(name: string, rooms: readonly Room[]): Blob {
  const file: BuildFile = { app: 'airforce', kind: 'build', version: 1, name, savedAt: new Date().toISOString(), rooms: clone([...rooms]) };
  return new Blob([JSON.stringify(file, null, 2)], { type: 'application/json' });
}

/** Safe file name for a build. */
export function buildFileName(name: string): string {
  return `${name.trim().replace(/[^\w\- ]+/g, '').replace(/\s+/g, '-').toLowerCase() || 'airforce-build'}.airforce.json`;
}

/**
 * Reads a build file: this app's format, or the old editor's export (a room, optionally with
 * `otherRooms`). Throws with a readable message when the file isn't a design.
 */
export function parseBuildFile(text: string): { name: string; rooms: Room[] } {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error("This file isn't an AirForce build (it isn't valid JSON).");
  }
  const d = data as Partial<BuildFile> & { otherRooms?: unknown[]; name?: string };
  if (d && d.app === 'airforce' && Array.isArray(d.rooms)) {
    const rooms = d.rooms.map((r) => RoomSchema.parse(r));
    if (rooms.length === 0) throw new Error('This build has no rooms.');
    return { name: d.name || 'Imported build', rooms };
  }
  // Old editor export: the room itself, with any other rooms alongside
  const first = parseRoom(data);
  if (!first.room) throw new Error(first.issues.find((i) => i.level === 'error')?.message ?? "This file isn't an AirForce build.");
  const others = Array.isArray(d.otherRooms) ? d.otherRooms.map((r) => parseRoom(r).room).filter((r): r is Room => Boolean(r)) : [];
  return { name: first.room.name || 'Imported build', rooms: [first.room, ...others] };
}
