import { create } from 'zustand';
import { temporal } from 'zundo';
import { immer } from 'zustand/middleware/immer';
import {
  DEFAULT_ROTATION_SNAP_DEGREES,
  DEFAULT_TRANSLATION_SNAP_METERS,
  DEFAULT_WALL_HEIGHT_METERS,
} from '../core/constants';
import type { FloorPoint, Opening, PlacedAsset, Room, SnapConfig } from '../core/types';

export interface SceneState {
  room: Room;
  placedAssets: PlacedAsset[];
  selectedId: string | null;
  snapConfig: SnapConfig;

  // Actions
  setRoom: (room: Room) => void;
  setWallHeight: (height: number) => void;
  updatePolygon: (polygon: FloorPoint[]) => void;
  addOpening: (opening: Opening) => void;
  removeOpening: (openingId: string) => void;
  addPlacedAsset: (asset: PlacedAsset) => void;
  updatePlacedAsset: (id: string, updates: Partial<Omit<PlacedAsset, 'id'>>) => void;
  removePlacedAsset: (id: string) => void;
  selectObject: (id: string | null) => void;
  setSnapConfig: (config: Partial<SnapConfig>) => void;
  resetScene: () => void;
}

/**
 * Default empty 5m x 4m room polygon (counter-clockwise on XZ plane: [x, z])
 */
export const createDefaultRoom = (): Room => ({
  id: 'default-room',
  name: 'Main Room',
  polygon: [
    [-2.5, -2],
    [2.5, -2],
    [2.5, 2],
    [-2.5, 2],
  ],
  wallHeight: DEFAULT_WALL_HEIGHT_METERS,
  openings: [],
});

export const initialSceneData = {
  room: createDefaultRoom(),
  placedAssets: [] as PlacedAsset[],
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

      updatePolygon: (polygon) =>
        set((state) => {
          state.room.polygon = polygon;
        }),

      addOpening: (opening) =>
        set((state) => {
          state.room.openings.push(opening);
        }),

      removeOpening: (openingId) =>
        set((state) => {
          state.room.openings = state.room.openings.filter((op) => op.id !== openingId);
        }),

      addPlacedAsset: (asset) =>
        set((state) => {
          state.placedAssets.push(asset);
        }),

      updatePlacedAsset: (id, updates) =>
        set((state) => {
          const index = state.placedAssets.findIndex((a) => a.id === id);
          if (index !== -1 && state.placedAssets[index]) {
            state.placedAssets[index] = {
              ...state.placedAssets[index],
              ...updates,
            };
          }
        }),

      removePlacedAsset: (id) =>
        set((state) => {
          state.placedAssets = state.placedAssets.filter((a) => a.id !== id);
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
          state.placedAssets = [];
          state.selectedId = null;
          state.snapConfig = {
            translation: DEFAULT_TRANSLATION_SNAP_METERS,
            rotation: DEFAULT_ROTATION_SNAP_DEGREES,
            enabled: true,
          };
        }),
    })),
    {
      // zundo temporal config: track room and placedAssets changes
      partialize: (state) => ({
        room: state.room,
        placedAssets: state.placedAssets,
      }),
    }
  )
);
