import { create } from 'zustand';
import type { PlacementIssue } from '../core/placementValidator';

export interface PlacementIssuesState {
  // Mapping of objectId -> list of active placement issues
  issues: Record<string, PlacementIssue[]>;
  // Set of object IDs whose issues have been dismissed by the user ("Keep anyway")
  dismissedObjectIds: string[];
  // Timestamps when an object issue was first flagged (for 1.5s soft red pulse)
  flaggedTimestamps: Record<string, number>;

  // Actions
  setIssues: (newIssues: Record<string, PlacementIssue[]>) => void;
  dismissObject: (objectId: string) => void;
  clearDismissed: (objectId: string) => void;
  clearAll: () => void;
}

export const usePlacementIssuesStore = create<PlacementIssuesState>()((set, get) => ({
  issues: {},
  dismissedObjectIds: [],
  flaggedTimestamps: {},

  setIssues: (newIssues) => {
    const now = Date.now();
    const currentTimestamps = { ...get().flaggedTimestamps };
    const currentIssues = get().issues;

    // Track timestamps for newly flagged objects
    for (const id of Object.keys(newIssues)) {
      if (!currentIssues[id] || currentIssues[id].length === 0) {
        currentTimestamps[id] = now;
      }
    }

    // Clean up timestamps for resolved objects
    for (const id of Object.keys(currentTimestamps)) {
      if (!newIssues[id] || newIssues[id].length === 0) {
        delete currentTimestamps[id];
      }
    }

    // Clean up dismissed IDs if object has no issues anymore (so if moved again and hits new issue, it can alert)
    const activeDismissed = get().dismissedObjectIds.filter((id) => Boolean(newIssues[id]));

    set({
      issues: newIssues,
      flaggedTimestamps: currentTimestamps,
      dismissedObjectIds: activeDismissed,
    });
  },

  dismissObject: (objectId) => {
    set((state) => ({
      dismissedObjectIds: state.dismissedObjectIds.includes(objectId)
        ? state.dismissedObjectIds
        : [...state.dismissedObjectIds, objectId],
    }));
  },

  clearDismissed: (objectId) => {
    set((state) => ({
      dismissedObjectIds: state.dismissedObjectIds.filter((id) => id !== objectId),
    }));
  },

  clearAll: () => {
    set({ issues: {}, dismissedObjectIds: [], flaggedTimestamps: {} });
  },
}));
