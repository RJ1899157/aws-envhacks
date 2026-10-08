import { create } from 'zustand';
import { temporal } from 'zundo';
import { immer } from 'zustand/middleware/immer';
import { createDefaultRoom } from '../core/defaultRoom';
import { parseRoom, type ParseIssue } from '../core/parser';
import type { Opening, OpeningRole, Room, RoomParams, SceneObject, Vec2 } from '../core/types';

export interface SceneState {
  room: Room;
  selectedObjectId: string | null;
  selectedObjectIds: string[];
  selectedOpeningId: string | null;
  selectedOpeningIds: string[];
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
  duplicateSelected: () => SceneObject[];
  deleteSelected: () => void;
  addOpening: (
    opening: Omit<Opening, 'role' | 'openFraction'> &
      Partial<Pick<Opening, 'role' | 'openFraction'>>
  ) => void;
  updateOpening: (id: string, updates: Partial<Omit<Opening, 'id'>>) => void;
  removeOpening: (id: string) => void;
  setOpeningRole: (id: string, role: OpeningRole) => void;
  setOpeningsRole: (ids: string[], role: OpeningRole) => void;
  setOpeningsOpenFraction: (ids: string[], fraction: number) => void;
  selectObject: (id: string | null, multi?: boolean) => void;
  selectOpening: (id: string | null, multi?: boolean) => void;
  selectAll: () => void;
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
      selectedObjectIds: [],
      selectedOpeningId: null,
      selectedOpeningIds: [],
      isDragging: false,

      loadRoom: (room) => {
        resetDragTracking();
        set((state) => {
          state.room = room;
          state.selectedObjectId = null;
          state.selectedObjectIds = [];
          state.selectedOpeningId = null;
          state.selectedOpeningIds = [];
          state.isDragging = false;
        });
      },

      resetRoom: () => {
        resetDragTracking();
        set((state) => {
          state.room = createDefaultRoom();
          state.selectedObjectId = null;
          state.selectedObjectIds = [];
          state.selectedOpeningId = null;
          state.selectedOpeningIds = [];
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
          state.selectedObjectIds = [object.id];
          state.selectedOpeningId = null;
          state.selectedOpeningIds = [];
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
          state.selectedObjectIds = state.selectedObjectIds.filter((oId) => oId !== id);
          state.selectedObjectId = state.selectedObjectIds[0] ?? null;
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
          state.selectedObjectIds = [newId];
          state.selectedOpeningId = null;
          state.selectedOpeningIds = [];
        });
        return duplicated;
      },

      duplicateSelected: () => {
        const duplicatedList: SceneObject[] = [];
        set((state) => {
          const idsToDuplicate = [...state.selectedObjectIds];
          if (idsToDuplicate.length === 0) return;

          const newSelectedIds: string[] = [];
          for (const id of idsToDuplicate) {
            const original = state.room.objects.find((o) => o.id === id);
            if (!original) continue;

            const newId = `${original.assetId}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
            const duplicated: SceneObject = {
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
            duplicatedList.push(duplicated);
            newSelectedIds.push(newId);
          }

          if (newSelectedIds.length > 0) {
            state.selectedObjectIds = newSelectedIds;
            state.selectedObjectId = newSelectedIds[0] ?? null;
            state.selectedOpeningId = null;
            state.selectedOpeningIds = [];
          }
        });
        return duplicatedList;
      },

      deleteSelected: () =>
        set((state) => {
          if (state.selectedObjectIds.length > 0) {
            const idsToRemove = new Set(state.selectedObjectIds);
            state.room.objects = state.room.objects.filter((o) => !idsToRemove.has(o.id));
            state.selectedObjectIds = [];
            state.selectedObjectId = null;
          }
          if (state.selectedOpeningIds.length > 0) {
            const idsToRemove = new Set(state.selectedOpeningIds);
            state.room.openings = state.room.openings.filter((op) => !idsToRemove.has(op.id));
            state.selectedOpeningIds = [];
            state.selectedOpeningId = null;
          }
        }),

      addOpening: (opening) =>
        set((state) => {
          const defaultRole: OpeningRole = opening.type === 'door' ? 'closed' : 'inlet';
          const finalOpening: Opening = {
            ...opening,
            role: opening.role ?? defaultRole,
            openFraction: opening.openFraction ?? (defaultRole === 'closed' ? 0 : 0.5),
          };
          state.room.openings.push(finalOpening);
          state.selectedOpeningId = finalOpening.id;
          state.selectedOpeningIds = [finalOpening.id];
          state.selectedObjectId = null;
          state.selectedObjectIds = [];
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
          state.selectedOpeningIds = state.selectedOpeningIds.filter((oId) => oId !== id);
          state.selectedOpeningId = state.selectedOpeningIds[0] ?? null;
        }),

      setOpeningRole: (id, role) =>
        set((state) => {
          const op = state.room.openings.find((o) => o.id === id);
          if (op) {
            op.role = role;
            if (role === 'closed') {
              op.openFraction = 0;
            } else if (op.openFraction === 0) {
              op.openFraction = 0.5;
            }
          }
        }),

      setOpeningsRole: (ids, role) =>
        set((state) => {
          const idSet = new Set(ids);
          for (const op of state.room.openings) {
            if (idSet.has(op.id)) {
              op.role = role;
              if (role === 'closed') {
                op.openFraction = 0;
              } else if (op.openFraction === 0) {
                op.openFraction = 0.5;
              }
            }
          }
        }),

      setOpeningsOpenFraction: (ids, fraction) =>
        set((state) => {
          const idSet = new Set(ids);
          const clamped = Math.max(0, Math.min(1, fraction));
          for (const op of state.room.openings) {
            if (idSet.has(op.id)) {
              op.openFraction = clamped;
              if (clamped > 0 && op.role === 'closed') {
                op.role = op.type === 'door' ? 'outlet' : 'inlet';
              }
            }
          }
        }),

      selectObject: (id, multi = false) =>
        set((state) => {
          state.selectedOpeningId = null;
          state.selectedOpeningIds = [];

          if (id === null) {
            state.selectedObjectId = null;
            state.selectedObjectIds = [];
            return;
          }

          if (multi) {
            const idx = state.selectedObjectIds.indexOf(id);
            if (idx >= 0) {
              state.selectedObjectIds.splice(idx, 1);
            } else {
              state.selectedObjectIds.push(id);
            }
            state.selectedObjectId = state.selectedObjectIds[0] ?? null;
          } else {
            state.selectedObjectId = id;
            state.selectedObjectIds = [id];
          }
        }),

      selectOpening: (id, multi = false) =>
        set((state) => {
          state.selectedObjectId = null;
          state.selectedObjectIds = [];

          if (id === null) {
            state.selectedOpeningId = null;
            state.selectedOpeningIds = [];
            return;
          }

          if (multi) {
            const idx = state.selectedOpeningIds.indexOf(id);
            if (idx >= 0) {
              state.selectedOpeningIds.splice(idx, 1);
            } else {
              state.selectedOpeningIds.push(id);
            }
            state.selectedOpeningId = state.selectedOpeningIds[0] ?? null;
          } else {
            state.selectedOpeningId = id;
            state.selectedOpeningIds = [id];
          }
        }),

      selectAll: () =>
        set((state) => {
          state.selectedObjectIds = state.room.objects.map((o) => o.id);
          state.selectedObjectId = state.selectedObjectIds[0] ?? null;
          state.selectedOpeningId = null;
          state.selectedOpeningIds = [];
        }),

      clearSelection: () =>
        set((state) => {
          state.selectedObjectId = null;
          state.selectedObjectIds = [];
          state.selectedOpeningId = null;
          state.selectedOpeningIds = [];
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
            state.selectedObjectIds = [];
            state.selectedOpeningId = null;
            state.selectedOpeningIds = [];
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
