import { create } from 'zustand';
import { temporal } from 'zundo';
import { immer } from 'zustand/middleware/immer';
import {
  DEFAULT_ROTATION_SNAP_DEGREES,
  DEFAULT_TRANSLATION_SNAP_METERS,
} from '../core/constants';
import { createDefaultRoom } from '../core/defaultRoom';
import type { Opening, Room, SceneObject, Vec2 } from '../core/types';

export interface SnapConfig {
  translation: number;
  rotation: number;
  enabled: boolean;
}

export interface SceneState {
  room: Room;
  selectedId: string | null;
  snapConfig: SnapConfig;

  // Actions
  setRoom: (room: Room) => void;
  setWallHeight: (height: number) => void;
  setWallThickness: (thickness: number) => void;
  updateOutline: (outline: Vec2[]) => void;
  addOpening: (opening: Opening) => void;
  updateOpening: (id: string, updates: Partial<Omit<Opening, 'id'>>) => void;
  removeOpening: (openingId: string) => void;
  addObject: (object: SceneObject) => void;
  updateObject: (id: string, updates: Partial<Omit<SceneObject, 'id'>>) => void;
  removeObject: (id: string) => void;
  selectObject: (id: string | null) => void;
  setSnapConfig: (config: Partial<SnapConfig>) => void;
  resetScene: () => void;
}

export const initialSceneData = {
  room: createDefaultRoom(),
  selectedId: null as string | null,
  snapConfig: {
    translation: DEFAULT_TRANSLATION_SNAP_METERS,
    rotation: DEFAULT_ROTATION_SNAP_DEGREES,
    enabled: true,
  },
};

export const useSceneStore = create<SceneState>()(
  temporal(
    immer((set) => ({
      ...initialSceneData,

      setRoom: (room) =>
        set((state) => {
          state.room = room;
        }),

      setWallHeight: (height) =>
        set((state) => {
          state.room.wallHeight = height;
        }),

      setWallThickness: (thickness) =>
        set((state) => {
          state.room.wallThickness = thickness;
        }),

      updateOutline: (outline) =>
        set((state) => {
          state.room.outline = outline;
        }),

      addOpening: (opening) =>
        set((state) => {
          state.room.openings.push(opening);
        }),

      updateOpening: (id, updates) =>
        set((state) => {
          const index = state.room.openings.findIndex((o) => o.id === id);
          if (index !== -1 && state.room.openings[index]) {
            state.room.openings[index] = {
              ...state.room.openings[index],
              ...updates,
            };
          }
        }),

      removeOpening: (openingId) =>
        set((state) => {
          state.room.openings = state.room.openings.filter((op) => op.id !== openingId);
        }),

      addObject: (object) =>
        set((state) => {
          state.room.objects.push(object);
        }),

      updateObject: (id, updates) =>
        set((state) => {
          const index = state.room.objects.findIndex((o) => o.id === id);
          if (index !== -1 && state.room.objects[index]) {
            state.room.objects[index] = {
              ...state.room.objects[index],
              ...updates,
            };
          }
        }),

      removeObject: (id) =>
        set((state) => {
          state.room.objects = state.room.objects.filter((o) => o.id !== id);
          if (state.selectedId === id) {
            state.selectedId = null;
          }
        }),

      selectObject: (id) =>
        set((state) => {
          state.selectedId = id;
        }),

      setSnapConfig: (config) =>
        set((state) => {
          state.snapConfig = { ...state.snapConfig, ...config };
        }),

      resetScene: () =>
        set((state) => {
          state.room = createDefaultRoom();
          state.selectedId = null;
          state.snapConfig = {
            translation: DEFAULT_TRANSLATION_SNAP_METERS,
            rotation: DEFAULT_ROTATION_SNAP_DEGREES,
            enabled: true,
          };
        }),
    })),
    {
      partialize: (state) => ({
        room: state.room,
      }),
    }
  )
);
