import { create } from 'zustand';
import { useUiStore } from '../../store/uiStore';

/** Where the user is in the app: choosing a start, designing, or looking at results. */
export type AltPhase = 'start' | 'design' | 'results';

export type DesignStep = 'rooms' | 'ventilation' | 'pollution' | 'furniture';

/** In order. 'ventilation' is the Doors & windows step (ids kept so saved sessions still resume). */
export const DESIGN_STEPS: { id: DesignStep; label: string }[] = [
  { id: 'rooms', label: 'Rooms' },
  { id: 'ventilation', label: 'Doors & windows' },
  { id: 'furniture', label: 'Furniture' },
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
  /** The landing intro (animated example + why this exists) before the start choices; first visit only */
  intro: boolean;
  setIntro: (intro: boolean) => void;
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
  ui.setDividerAxis(null);
  if (ui.toolMode !== 'select') ui.setToolMode('select');
}

export const useAltStore = create<AltState>()((set) => ({
  phase: 'start',
  intro: true,
  setIntro: (intro) => set({ intro }),
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
