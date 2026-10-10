import { create } from 'zustand';
import { useUiStore } from '../../store/uiStore';

/** Where the user is in the app: choosing a start, designing, looking at results, or in an example. */
export type AltPhase = 'start' | 'design' | 'results' | 'example';

export type DesignStep = 'rooms' | 'ventilation' | 'pollution' | 'furniture';

/** In order. 'ventilation' is the Doors & windows step (ids kept so saved sessions still resume). */
export const DESIGN_STEPS: { id: DesignStep; label: string }[] = [
  { id: 'rooms', label: 'Rooms' },
  { id: 'furniture', label: 'Furniture' },
  { id: 'ventilation', label: 'Doors & windows' },
  { id: 'pollution', label: 'Pollution sources' },
];

/** The saved build being edited: its id and name, and the design as it was last saved */
export interface OpenBuild {
  id: string;
  name: string;
  fingerprint: string;
}

interface AltState {
  phase: AltPhase;
  /** Saved build this design belongs to (null = never saved) */
  build: OpenBuild | null;
  setBuild: (build: OpenBuild | null) => void;
  step: DesignStep;
  /** What the user said they are designing on the start screen */
  project: 'room' | 'house';
  setPhase: (phase: AltPhase) => void;
  setStep: (step: DesignStep) => void;
  startDesign: (project: 'room' | 'house') => void;
  reset: () => void;
}

/** Drops any placement in progress (asset, opening or room waiting for a click). */
export function cancelPlacement(): void {
  const ui = useUiStore.getState();
  ui.setActiveAssetId(null);
  ui.setPendingRoomType(null);
  ui.setDraggedOpeningPreview(null);
  ui.setGhostPosition(null);
  if (ui.toolMode !== 'select') ui.setToolMode('select');
}

export const useAltStore = create<AltState>()((set) => ({
  phase: 'start',
  step: 'rooms',
  project: 'room',
  build: null,
  setBuild: (build) => set({ build }),
  setPhase: (phase) => {
    cancelPlacement();
    set({ phase });
  },
  setStep: (step) => {
    cancelPlacement();
    set({ step });
  },
  startDesign: (project) => set({ phase: 'design', step: 'rooms', project, build: null }),
  reset: () => set({ phase: 'start', step: 'rooms', project: 'room', build: null }),
}));
