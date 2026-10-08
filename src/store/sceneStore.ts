import { create } from 'zustand';
import { temporal } from 'zundo';
import { immer } from 'zustand/middleware/immer';
import { createDefaultRoom } from '../core/defaultRoom';
import { parseRoom, type ParseIssue } from '../core/parser';
import type { Opening, OpeningRole, Room, RoomParams, SceneObject, Vec2 } from '../core/types';

export interface SceneState {
  room: Room;
  selectedObjectId: string | null;
  selectedOpeningId: string | null;
  isDragging: boolean;

  // Actions
  loadRoom: (room: Room) => void;
  resetRoom: () => void;
  setOutline: (outline: Vec2[]) => void;
  moveVertex: (index: number, position: Vec2) => void;
  insertVertex: (index: number, position: Vec2) => void;
  removeVertex: (index: number) => void;
  setWallHeight: (height: number) => void;
  setParams: (params: Partial<RoomParams>) => void;
  addObject: (object: SceneObject) => void;
  updateObject: (id: string, updates: Partial<Omit<SceneObject, 'id'>>) => void;
  removeObject: (id: string) => void;
  duplicateObject: (id: string) => SceneObject | null;
  addOpening: (opening: Opening) => void;
  updateOpening: (id: string, updates: Partial<Omit<Opening, 'id'>>) => void;
  removeOpening: (id: string) => void;
  setOpeningRole: (id: string, role: OpeningRole) => void;
  selectObject: (id: string | null) => void;
  selectOpening: (id: string | null) => void;
  clearSelection: () => void;
  setIsDragging: (isDragging: boolean) => void;
  exportRoom: () => string;
  importRoom: (json: string | unknown) => { success: boolean; issues: ParseIssue[] };
}

// Drag coalescing internal tracking
let isExplicitDragging = false;
let explicitDragSaved = false;
let isCurrentMutationDrag = false;
let lastDragMutationTime = 0;
const DRAG_COALESCE_INTERVAL_MS = 250;

function markDragMutation(): void {
  isCurrentMutationDrag = true;
}

export function resetDragTracking(): void {
  isExplicitDragging = false;
  explicitDragSaved = false;
  isCurrentMutationDrag = false;
  lastDragMutationTime = 0;
}

export interface HistoryState {
  room: Room;
}

export const useSceneStore = create<SceneState>()(
  temporal<SceneState, [], [['zustand/immer', never]], HistoryState>(
    immer((set, get) => ({
      room: createDefaultRoom(),
      selectedObjectId: null,
      selectedOpeningId: null,
      isDragging: false,

      loadRoom: (room) => {
        resetDragTracking();
        set((state) => {
          state.room = room;
          state.selectedObjectId = null;
          state.selectedOpeningId = null;
          state.isDragging = false;
        });
      },

      resetRoom: () => {
        resetDragTracking();
        set((state) => {
          state.room = createDefaultRoom();
          state.selectedObjectId = null;
          state.selectedOpeningId = null;
          state.isDragging = false;
        });
      },

      setOutline: (outline) =>
        set((state) => {
          state.room.outline = outline;
        }),

      moveVertex: (index, position) => {
        markDragMutation();
        set((state) => {
          const n = state.room.outline.length;
          if (n === 0) return;
          const safeIndex = ((index % n) + n) % n;
          state.room.outline[safeIndex] = position;
        });
      },

      insertVertex: (index, position) =>
        set((state) => {
          const n = state.room.outline.length;
          const safeIndex = ((index % n) + n) % n;
          // Inserts new vertex directly after the specified wall index
          state.room.outline.splice(safeIndex + 1, 0, position);
        }),

      removeVertex: (index) =>
        set((state) => {
          // Refuse removal if outline would drop below 3 vertices
          if (state.room.outline.length <= 3) {
            return;
          }
          const n = state.room.outline.length;
          const safeIndex = ((index % n) + n) % n;
          state.room.outline.splice(safeIndex, 1);
        }),

      setWallHeight: (height) =>
        set((state) => {
          state.room.wallHeight = height;
        }),

      setParams: (params) =>
        set((state) => {
          state.room.params = { ...state.room.params, ...params };
        }),

      addObject: (object) =>
        set((state) => {
          state.room.objects.push(object);
          state.selectedObjectId = object.id;
          state.selectedOpeningId = null;
        }),

      updateObject: (id, updates) => {
        if (updates.position || updates.rotation) {
          markDragMutation();
        }
        set((state) => {
          const index = state.room.objects.findIndex((o) => o.id === id);
          if (index !== -1 && state.room.objects[index]) {
            state.room.objects[index] = {
              ...state.room.objects[index],
              ...updates,
            };
          }
        });
      },

      removeObject: (id) =>
        set((state) => {
          state.room.objects = state.room.objects.filter((o) => o.id !== id);
          if (state.selectedObjectId === id) {
            state.selectedObjectId = null;
          }
        }),

      duplicateObject: (id) => {
        let duplicated: SceneObject | null = null;
        set((state) => {
          const original = state.room.objects.find((o) => o.id === id);
          if (!original) return;

          const newId = `${original.assetId}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
          duplicated = {
            ...original,
            id: newId,
            name: `${original.name} (Copy)`,
            position: [
              Number((original.position[0] + 0.3).toFixed(4)),
              original.position[1],
              Number((original.position[2] + 0.3).toFixed(4)),
            ],
          };
          state.room.objects.push(duplicated);
          state.selectedObjectId = newId;
          state.selectedOpeningId = null;
        });
        return duplicated;
      },

      addOpening: (opening) =>
        set((state) => {
          state.room.openings.push(opening);
          state.selectedOpeningId = opening.id;
          state.selectedObjectId = null;
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

      removeOpening: (id) =>
        set((state) => {
          state.room.openings = state.room.openings.filter((o) => o.id !== id);
          if (state.selectedOpeningId === id) {
            state.selectedOpeningId = null;
          }
        }),

      setOpeningRole: (id, role) =>
        set((state) => {
          const op = state.room.openings.find((o) => o.id === id);
          if (op) {
            op.role = role;
          }
        }),

      selectObject: (id) =>
        set((state) => {
          state.selectedObjectId = id;
          state.selectedOpeningId = null;
        }),

      selectOpening: (id) =>
        set((state) => {
          state.selectedOpeningId = id;
          state.selectedObjectId = null;
        }),

      clearSelection: () =>
        set((state) => {
          state.selectedObjectId = null;
          state.selectedOpeningId = null;
        }),

      setIsDragging: (isDragging) => {
        isExplicitDragging = isDragging;
        if (!isDragging) {
          explicitDragSaved = false;
        }
        set((state) => {
          state.isDragging = isDragging;
        });
      },

      exportRoom: () => {
        const currentRoom = get().room;
        const parseResult = parseRoom(currentRoom);
        if (!parseResult.room) {
          throw new Error(
            `Cannot export invalid room: ${parseResult.issues.map((i) => i.message).join('; ')}`
          );
        }
        return JSON.stringify(parseResult.room, null, 2);
      },

      importRoom: (json) => {
        let raw: unknown;
        if (typeof json === 'string') {
          try {
            raw = JSON.parse(json);
          } catch {
            return {
              success: false,
              issues: [
                {
                  level: 'error',
                  message: 'Invalid JSON string provided for room import',
                },
              ],
            };
          }
        } else {
          raw = json;
        }

        const parseResult = parseRoom(raw);
        if (parseResult.room) {
          resetDragTracking();
          set((state) => {
            state.room = parseResult.room!;
            state.selectedObjectId = null;
            state.selectedOpeningId = null;
            state.isDragging = false;
          });
          return { success: true, issues: parseResult.issues };
        }

        return { success: false, issues: parseResult.issues };
      },
    })),
    {
      limit: 100,
      equality: (pastState, currentState) => pastState.room === currentState.room,
      // Only room changes are undoable; selection changes are not
      partialize: (state): HistoryState => ({ room: state.room }),
      handleSet: (handleSet) => (pastState, replace) => {
        const isDrag = isCurrentMutationDrag || isExplicitDragging;
        isCurrentMutationDrag = false;

        if (isDrag) {
          const now = Date.now();

          // 1. Explicit drag session (e.g. mousedown -> drag -> mouseup)
          if (isExplicitDragging) {
            if (!explicitDragSaved) {
              handleSet(pastState, replace);
              explicitDragSaved = true;
            }
            return;
          }

          // 2. Rapid automatic position/vertex updates (< 250ms apart)
          if (now - lastDragMutationTime < DRAG_COALESCE_INTERVAL_MS && lastDragMutationTime > 0) {
            lastDragMutationTime = now;
            // Coalesce into initial entry
            return;
          }

          lastDragMutationTime = now;
        } else {
          lastDragMutationTime = 0;
        }

        // Discrete mutation or initial drag update: record history entry
        handleSet(pastState, replace);
      },
    }
  )
);
