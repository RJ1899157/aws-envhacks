import { create } from 'zustand';
import type { Room } from '../core/schema';
import { createShowcaseHouse } from '../showcase/house';
import { loadPrecomputed } from '../showcase/precomputed';
import { STORIES, applyStory, storyById, storySettings, type StoryPreset } from '../showcase/stories';
import { applyScenario } from '../simulation/scenarios/actions';
import { simulationInputKey } from '../simulation/viz/staleness';
import { holdHistory, releaseHistory } from './historyLock';
import { useScenarioStore } from './scenarioStore';
import { useSceneStore } from './sceneStore';
import { getVoxelQueue, useSimulationStore, type SimulationState } from './simulationStore';

/**
 * Example stories: the showcase house opened as a separate, throw-away project. Opening one puts
 * the user's own design, undo history, simulation and scenario state aside (and pauses history);
 * the story's design and precomputed results take their place. Exit puts everything back exactly;
 * "Make a copy to edit" keeps the example as the user's design (one undoable step).
 */

interface CameraSnapshot {
  position: [number, number, number];
  target: [number, number, number];
}

/** How the store reads and moves the camera; Canvas registers it (the store has no scene access). */
export interface CameraAccess {
  get: () => CameraSnapshot | null;
  set: (s: CameraSnapshot) => void;
  /** Frame the house (true) or one room */
  frame: (roomId: string | null) => void;
}
let camera: CameraAccess | null = null;
export function registerShowcaseCamera(access: CameraAccess | null): void {
  camera = access;
}

interface SavedState {
  room: Room;
  otherRooms: Room[];
  sim: Pick<SimulationState, 'settings' | 'result' | 'resultKey' | 'status' | 'progress' | 'error' | 'viz'>;
  scenario: Pick<ReturnType<typeof useScenarioStore.getState>, 'compare' | 'preview' | 'objective' | 'ranking' | 'rankingKey' | 'knownVoxel'>;
  camera: CameraSnapshot | null;
}

export interface ShowcaseState {
  pickerOpen: boolean;
  active: {
    storyId: string;
    /** Where the results came from; null while loading */
    source: 'precomputed' | 'live' | null;
    /** Click → results on screen (ms), for precomputed opens */
    openMs: number | null;
  } | null;
  /** The user's own state while an example is open */
  saved: SavedState | null;

  setPickerOpen: (open: boolean) => void;
  openStory: (id: string) => Promise<void>;
  nextStory: () => Promise<void>;
  seeFix: () => void;
  exit: () => void;
  makeCopy: () => void;
}

/** The story's designs: as set up, and with its fix applied. */
export function storyDesigns(story: StoryPreset): { base: Room[]; fix: Room[] } {
  const base = applyStory(createShowcaseHouse(), story);
  return { base, fix: applyScenario(base, story.fix) };
}

let openToken = 0;

export const useShowcaseStore = create<ShowcaseState>()((set, get) => ({
  pickerOpen: false,
  active: null,
  saved: null,

  setPickerOpen: (pickerOpen) => set({ pickerOpen }),

  openStory: async (id) => {
    const story = storyById(id);
    if (!story) return;
    const t0 = performance.now();
    const token = ++openToken;
    const scenarios = useScenarioStore.getState();
    if (scenarios.whatIf) scenarios.discardWhatIf();
    if (!get().saved) {
      const scene = useSceneStore.getState();
      const sim = useSimulationStore.getState();
      set({
        saved: {
          room: scene.room,
          otherRooms: scene.otherRooms,
          sim: { settings: sim.settings, result: sim.result, resultKey: sim.resultKey, status: sim.status, progress: sim.progress, error: sim.error, viz: sim.viz },
          scenario: { compare: scenarios.compare, preview: scenarios.preview, objective: scenarios.objective, ranking: scenarios.ranking, rankingKey: scenarios.rankingKey, knownVoxel: scenarios.knownVoxel },
          camera: camera?.get() ?? null,
        },
      });
      holdHistory();
    }
    const { base, fix } = storyDesigns(story);
    const settings = storySettings(story);
    useSceneStore.getState().loadRoom(base[0]!, base.slice(1));
    const sim = useSimulationStore.getState();
    sim.setSettings(settings);
    sim.setViz({ show: true, mode: story.view.mode, snapshotIndex: null, playing: false });
    useSimulationStore.setState({ result: null, resultKey: null, status: 'idle', progress: null, error: null });
    useScenarioStore.setState({ compare: null, preview: null, objective: { kind: 'room', roomId: story.view.focusRoomId }, ranking: null, rankingKey: null, knownVoxel: {} });
    set({ pickerOpen: false, active: { storyId: id, source: null, openMs: null } });

    const loaded = await loadPrecomputed(story, base, fix, settings, (import.meta as { env?: { BASE_URL?: string } }).env?.BASE_URL ?? '/');
    if (token !== openToken) return;
    const frame = () => camera?.frame(story.view.camera === 'house' ? null : story.view.focusRoomId);
    if (loaded) {
      const q = getVoxelQueue();
      const baseKey = simulationInputKey(base[0]!, base.slice(1), settings);
      q.put(baseKey, loaded.baseline);
      q.put(simulationInputKey(fix[0]!, fix.slice(1), settings), loaded.fix);
      useScenarioStore.getState().setKnownVoxel(loaded.manifest.knownVoxel);
      useSimulationStore.setState({ result: loaded.baseline, resultKey: baseKey, status: 'done', progress: null, error: null });
      if (story.view.autoplay) useSimulationStore.getState().setViz({ snapshotIndex: 0, playing: true });
      set({ active: { storyId: id, source: 'precomputed', openMs: performance.now() - t0 } });
      frame();
    } else {
      // No (current) precomputed results: the normal run, with its progress overlay
      set({ active: { storyId: id, source: 'live', openMs: null } });
      frame();
      await useSimulationStore.getState().runVoxel(base[0]!, base.slice(1));
      if (token === openToken && story.view.autoplay && useSimulationStore.getState().status === 'done') useSimulationStore.getState().setViz({ snapshotIndex: 0, playing: true });
    }
  },

  nextStory: async () => {
    const cur = get().active?.storyId;
    const i = STORIES.findIndex((s) => s.id === cur);
    await get().openStory(STORIES[(i + 1) % STORIES.length]!.id);
  },

  seeFix: () => {
    const story = storyById(get().active?.storyId ?? '');
    if (!story) return;
    useScenarioStore.getState().openCompare({ kind: 'baseline' }, { kind: 'saved', id: story.fix.id }, story.view.compareView);
  },

  exit: () => {
    const saved = get().saved;
    if (!saved) return;
    ++openToken;
    const scenarios = useScenarioStore.getState();
    if (scenarios.whatIf) scenarios.discardWhatIf();
    useSimulationStore.getState().setViz({ playing: false });
    useSceneStore.setState({ room: saved.room, otherRooms: saved.otherRooms, selectedObjectId: null, selectedObjectIds: [], selectedOpeningId: null, selectedOpeningIds: [] });
    useSimulationStore.setState({ ...saved.sim });
    useScenarioStore.setState({ ...saved.scenario });
    releaseHistory();
    if (saved.camera) camera?.set(saved.camera);
    set({ saved: null, active: null });
  },

  makeCopy: () => {
    const { room, otherRooms } = useSceneStore.getState();
    const copy = [room, ...otherRooms];
    const sim = useSimulationStore.getState();
    const result = { result: sim.result, resultKey: sim.resultKey, status: sim.status };
    get().exit();
    // A normal, undoable change of the user's design; the example's results come along
    useSceneStore.getState().loadRoom(copy[0]!, copy.slice(1));
    useSimulationStore.setState(result);
  },
}));

