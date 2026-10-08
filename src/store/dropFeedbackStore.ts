import { create } from 'zustand';
import { prefersReducedMotion } from '../core/motion';

export interface DropRipple {
  id: string;
  x: number;
  z: number;
  radius: number;
  createdAt: number;
}

interface DropFeedbackState {
  ripples: DropRipple[];
  pulsingObjectIds: Record<string, number>; // objectId -> trigger timestamp
  triggerDropFeedback: (
    objectId: string,
    x: number,
    z: number,
    footprintRadius?: number
  ) => void;
  removeRipple: (id: string) => void;
  clearPulsingObject: (objectId: string) => void;
}

export const useDropFeedbackStore = create<DropFeedbackState>((set) => ({
  ripples: [],
  pulsingObjectIds: {},

  triggerDropFeedback: (objectId, x, z, footprintRadius = 0.8) => {
    if (prefersReducedMotion()) return;

    const id = `ripple-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const now = performance.now();

    set((state) => ({
      ripples: [
        ...state.ripples.slice(-10), // keep at most 10 active ripples
        { id, x, z, radius: footprintRadius, createdAt: now },
      ],
      pulsingObjectIds: {
        ...state.pulsingObjectIds,
        [objectId]: now,
      },
    }));

    // Auto-remove ripple after 450 ms
    setTimeout(() => {
      set((state) => ({
        ripples: state.ripples.filter((r) => r.id !== id),
      }));
    }, 450);

    // Auto-remove pulse after 220 ms
    setTimeout(() => {
      set((state) => {
        const next = { ...state.pulsingObjectIds };
        delete next[objectId];
        return { pulsingObjectIds: next };
      });
    }, 220);
  },

  removeRipple: (id) =>
    set((state) => ({ ripples: state.ripples.filter((r) => r.id !== id) })),

  clearPulsingObject: (objectId) =>
    set((state) => {
      const next = { ...state.pulsingObjectIds };
      delete next[objectId];
      return { pulsingObjectIds: next };
    }),
}));
