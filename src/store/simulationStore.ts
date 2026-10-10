import { create } from 'zustand';
import type { Room } from '../core/schema';
import type { OutdoorAirReading } from '../simulation/outdoorAir';
import type { SimField } from '../simulation/viz/colormap';
import { simulationInputKey, type SimulationSettings } from '../simulation/viz/staleness';
import { getVoxelRunner, type VoxelRunner } from '../simulation/voxel/runner';
import { VoxelQueue } from '../simulation/scenarios/voxelQueue';
import type { VoxelProgress, VoxelSimResult } from '../simulation/voxel/solver';

/**
 * Simulation state, kept apart from the scene store on purpose: nothing here enters undo/redo
 * history or the exported design JSON. Design inputs (outdoor PM2.5, exposure, sources, device
 * settings) live in the room itself; this store holds run settings, results and view options.
 */

export type RunStatus = 'idle' | 'running' | 'done' | 'cancelled' | 'error';

export type SimViewMode = 'pollution' | 'ventilation' | 'airflow';

export interface SimulationState {
  settings: SimulationSettings;
  /** Last live outdoor lookup (value is also written into room.params.outdoorPm25) */
  outdoorLookup: { status: 'idle' | 'loading' | 'done'; reading: OutdoorAirReading | null };

  status: RunStatus;
  progress: VoxelProgress | null;
  error: string | null;
  result: VoxelSimResult | null;
  /** simulationInputKey of the inputs the result was computed from */
  resultKey: string | null;

  viz: {
    /** Master toggle for the whole simulation layer (heatmap, streamlines, chips, legend) */
    show: boolean;
    /** One story at a time: PM2.5 + smoke, age of air + stagnant zones, or airflow only */
    mode: SimViewMode;
    /** PM2.5: stretch YlOrRd over the values in view instead of the absolute AQI bands */
    relative: boolean;
    /** Age of air: stretch viridis to the field's own range */
    autoContrast: boolean;
    /** Height the heatmap samples (drawn on the floor of each room); Advanced */
    sliceHeight: number;
    /** Mid-air vertical slice; Advanced */
    vertical: { enabled: boolean; axis: 'x' | 'z'; position: number | null };
    /** Smoke from active sources (Pollution) */
    smoke: boolean;
    /** Animated streamlines (Airflow; faint in Ventilation) */
    streamlines: boolean;
    /** Particle / streamline density multiplier */
    density: number;
    /** Flow playback speed-up for streamlines and smoke */
    timeScale: number;
    /** Flow arrows with m³/h at every open opening (Airflow) */
    openingArrows: boolean;
    /** Velocity arrows on the sampled layer; Advanced */
    arrows: boolean;
    /** Outline the (at most three) stalest zones (Ventilation) */
    stagnant: boolean;
    hotspots: boolean;
    /** One chip per room (replaces the room-name pills) */
    roomLabels: boolean;
    /** Furniture drawn at ~25 % opacity while the layer is on */
    ghostFurniture: boolean;
    /** Walls cut low (~1 m) and opaque while the layer is on */
    cutaway: boolean;
    /** null = steady state; otherwise an index into result.pm25.snapshots */
    snapshotIndex: number | null;
    playing: boolean;
  };

  /** The Simulation tab is open, so the Insights panel docks at its top instead of floating on the canvas */
  insightsDocked: boolean;
  insightsCollapsed: boolean;
  /** The first-use card on the canvas was closed */
  firstUseDismissed: boolean;
  setUi: (u: Partial<Pick<SimulationState, 'insightsDocked' | 'insightsCollapsed' | 'firstUseDismissed'>>) => void;

  setSettings: (s: Partial<SimulationSettings>) => void;
  setOutdoorLookup: (l: SimulationState['outdoorLookup']) => void;
  setViz: (v: Partial<SimulationState['viz']>) => void;
  toggleShow: () => void;
  runVoxel: (room: Room, neighbours: readonly Room[]) => Promise<void>;
  cancelRun: () => void;
  clearResult: () => void;
}

const initialViz: SimulationState['viz'] = {
  show: true,
  mode: 'pollution',
  relative: false,
  autoContrast: true,
  sliceHeight: 1.2,
  vertical: { enabled: false, axis: 'z', position: null },
  smoke: true,
  streamlines: true,
  density: 1,
  timeScale: 20,
  openingArrows: true,
  arrows: false,
  stagnant: true,
  hotspots: false,
  roomLabels: true,
  ghostFurniture: true,
  cutaway: true,
  snapshotIndex: null,
  playing: false,
};

/** Smoke particles at density 1 and the frame-rate cap. */
export const BASE_PARTICLES = 1500;
export const MAX_PARTICLES = 3000;
export const DENSITY_RANGE: readonly [number, number] = [0.25, 2];

/** Heatmap field of a view mode (Airflow has none). */
export function fieldOfMode(mode: SimViewMode): SimField | null {
  return mode === 'pollution' ? 'pm25' : mode === 'ventilation' ? 'age' : null;
}

/** Incremented per run so a superseded run never overwrites newer state. */
let runToken = 0;

let runnerFactory: () => Pick<VoxelRunner, 'run' | 'cancel'> = getVoxelRunner;

/**
 * Every voxel run goes through one queue on the shared worker: the user's Run (which pre-empts
 * background work) and scenario / verification runs, cached by design + inputs.
 */
let voxelQueue = new VoxelQueue(() => runnerFactory());

export function getVoxelQueue(): VoxelQueue {
  return voxelQueue;
}

/** Tests swap the worker-backed runner for an in-process one (with a fresh queue and cache). */
export function setVoxelRunnerFactory(factory: () => Pick<VoxelRunner, 'run' | 'cancel'>): void {
  runnerFactory = factory;
  voxelQueue = new VoxelQueue(() => runnerFactory());
}

export const useSimulationStore = create<SimulationState>()((set, get) => ({
  settings: { durationS: 4 * 3600, resolution: 'live' },
  outdoorLookup: { status: 'idle', reading: null },
  status: 'idle',
  progress: null,
  error: null,
  result: null,
  resultKey: null,
  viz: initialViz,
  insightsDocked: false,
  insightsCollapsed: false,
  firstUseDismissed: false,
  setUi: (u) => set(u),

  setSettings: (s) => set((st) => ({ settings: { ...st.settings, ...s } })),
  setOutdoorLookup: (outdoorLookup) => set({ outdoorLookup }),
  setViz: (v) =>
    set((st) => ({
      viz: { ...st.viz, ...v, density: Math.min(DENSITY_RANGE[1], Math.max(DENSITY_RANGE[0], v.density ?? st.viz.density)) },
    })),
  toggleShow: () => set((st) => ({ viz: { ...st.viz, show: !st.viz.show } })),

  runVoxel: async (room, neighbours) => {
    const { settings } = get();
    const key = simulationInputKey(room, neighbours, settings);
    const token = ++runToken;
    // Same design and inputs as a cached run: instant
    const cached = voxelQueue.get(key);
    if (cached) {
      set((st) => ({ status: 'done', progress: null, error: null, result: cached, resultKey: key, viz: { ...st.viz, snapshotIndex: null, playing: false } }));
      return;
    }
    // A result for another design must not keep playing while this one computes: drop it now
    set((st) => ({
      status: 'running',
      progress: { phase: 'setup', fraction: 0, message: 'Starting' },
      error: null,
      ...(st.resultKey !== key && { result: null, resultKey: null, viz: { ...st.viz, snapshotIndex: null, playing: false } }),
    }));
    // Background scenario runs wait (the one in flight is re-queued) while the user's run goes
    voxelQueue.suspend();
    try {
      // Starting a run cancels any run in flight (inside the runner)
      const result = await runnerFactory().run(
        { rooms: [room, ...neighbours], resolution: settings.resolution, durationS: settings.durationS },
        (progress) => {
          if (token === runToken) set({ progress });
        }
      );
      voxelQueue.put(key, result);
      if (token !== runToken) return;
      set((st) => ({
        status: 'done',
        progress: null,
        result,
        resultKey: key,
        viz: { ...st.viz, snapshotIndex: null, playing: false },
      }));
    } catch (err) {
      if (token !== runToken) return; // superseded by a newer run
      if (err instanceof Error && err.name === 'VoxelCancelledError') set({ status: 'cancelled', progress: null });
      else set({ status: 'error', progress: null, error: err instanceof Error ? err.message : String(err) });
    } finally {
      if (token === runToken) voxelQueue.resume();
    }
  },

  cancelRun: () => {
    runnerFactory().cancel();
    set({ status: 'cancelled', progress: null });
  },

  clearResult: () => set({ result: null, resultKey: null, status: 'idle', progress: null, error: null }),
}));
