import fs from 'fs';
import path from 'path';
import zlib from 'zlib';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { parseRoom } from '../core/parser';
import { RoomSchema, ScenarioSchema, type Room } from '../core/schema';
import { applyActions } from '../simulation/scenarios/actions';
import { runVoxelSimulation, type VoxelSimResult } from '../simulation/voxel/solver';
import { decodeResult, encodeResult } from './codec';
import { SHOWCASE_ROOM_IDS, createShowcaseHouse } from './house';
import { storyHash, type ShowcaseManifest } from './precomputed';
import { STORIES, StoryPresetSchema, applyStory, storySettings } from './stories';
import { useSceneStore } from '../store/sceneStore';
import { setVoxelRunnerFactory, useSimulationStore } from '../store/simulationStore';
import { storyDesigns, useShowcaseStore } from '../store/showcaseStore';
import { createBedroomSample } from '../core/samples';

const PUBLIC = path.resolve(__dirname, '../../public/showcase');
const area = (o: readonly [number, number][]) => Math.abs(o.reduce((s, [x, z], i) => s + x * o[(i + 1) % o.length]![1] - o[(i + 1) % o.length]![0] * z, 0) / 2);

describe('showcase house and stories', () => {
  it('is a 2BHK of 70–90 m² with plainly named rooms and ~3 m ceilings', () => {
    const house = createShowcaseHouse();
    expect(house.map((r) => r.name).sort()).toEqual(['Bathroom', 'Bedroom 1', 'Bedroom 2', 'Kitchen', 'Living Room']);
    const total = house.reduce((s, r) => s + area(r.outline), 0);
    expect(total).toBeGreaterThan(70);
    expect(total).toBeLessThan(90);
    for (const r of house) expect(r.wallHeight).toBeGreaterThanOrEqual(2.9);
    expect(house.find((r) => r.id === SHOWCASE_ROOM_IDS.bathroom)!.openings.filter((o) => o.type === 'window')).toEqual([]);
    expect(house.find((r) => r.id === SHOWCASE_ROOM_IDS.bedroom2)!.openings.filter((o) => o.type === 'window').length).toBe(1);
  });

  it('every preset is valid against the schema, and so are its designs and fix', () => {
    const house = createShowcaseHouse();
    expect(STORIES.length).toBe(4);
    for (const story of STORIES) {
      expect(StoryPresetSchema.parse(story)).toEqual(story);
      expect(story.outdoorPm25).toBeGreaterThan(0);
      ScenarioSchema.parse(story.fix);
      const base = applyStory(house, story);
      for (const r of base) expect(() => RoomSchema.parse(r)).not.toThrow();
      // Every fix action finds its target and changes the design
      for (const a of story.fix.actions) expect(JSON.stringify(applyActions(base, [a]))).not.toBe(JSON.stringify(base));
      // Outdoor conditions are fixed (never live) and the same in every room
      expect(new Set(base.map((r) => JSON.stringify(r.params.outdoorPm25))).size).toBe(1);
      expect(base[0]!.params.outdoorPm25?.source).toBe('manual');
    }
  });

  it('precomputed manifests match the current showcase design (re-run npm run showcase:build if this fails)', () => {
    let total = 0;
    for (const story of STORIES) {
      const file = path.join(PUBLIC, story.id, 'manifest.json');
      expect(fs.existsSync(file), `${file} missing`).toBe(true);
      const m = JSON.parse(fs.readFileSync(file, 'utf8')) as ShowcaseManifest;
      const { base, fix } = storyDesigns(story);
      const settings = storySettings(story);
      expect(m.baseline.hash).toBe(storyHash(base, settings));
      expect(m.fix.hash).toBe(storyHash(fix, settings));
      total += m.baseline.bytes + m.fix.bytes + fs.statSync(file).size;
    }
    expect(total).toBeLessThan(10e6);
  });
});

describe('compact result encoding', () => {
  it('round-trips a voxel result within 16-bit precision, keeping NaN and exact zeros', async () => {
    const room = createBedroomSample();
    const r = await runVoxelSimulation({ rooms: [room], resolution: 'live', durationS: 600 });
    const { structure, arrays, blob } = encodeResult(r);
    const back = decodeResult({ structure, arrays }, zlib.gunzipSync(zlib.gzipSync(blob)));
    expect(back.zones).toEqual(r.zones);
    expect(back.grid.fluid).toEqual(r.grid.fluid);
    expect(back.grid.zoneOf).toEqual(r.grid.zoneOf);
    const maxErr = (a: Float32Array, b: Float32Array) => {
      let e = 0;
      let m = 0;
      for (let i = 0; i < a.length; i++) {
        if (Number.isNaN(a[i]!)) expect(Number.isNaN(b[i]!)).toBe(true);
        else e = Math.max(e, Math.abs(a[i]! - b[i]!));
        if (Number.isFinite(a[i]!)) m = Math.max(m, Math.abs(a[i]!));
      }
      return e / Math.max(m, 1e-9);
    };
    expect(maxErr(r.pm25.steady, back.pm25.steady)).toBeLessThan(1e-4);
    expect(maxErr(r.velocity.cell, back.velocity.cell)).toBeLessThan(1e-4);
    for (let i = 0; i < r.velocity.faces.u.length; i++) expect(back.velocity.faces.u[i] === 0).toBe(r.velocity.faces.u[i] === 0);
    expect(back.pm25.snapshots.length).toBe(r.pm25.snapshots.length);
  }, 60000);
});

/** Serves public/ like the dev server. */
function servePublic(missing = false) {
  return vi.fn(async (url: string) => {
    const file = path.resolve(__dirname, '../../public', String(url).replace(/^\//, ''));
    if (missing || !fs.existsSync(file)) return new Response('not found', { status: 404 });
    return new Response(fs.readFileSync(file));
  });
}

describe('opening an example', () => {
  const user = () => {
    const room = createBedroomSample();
    room.name = 'My flat';
    useSceneStore.getState().loadRoom(room, []);
    useSceneStore.temporal.getState().clear();
    useSceneStore.getState().setRoomName('My flat (edited)');
    return JSON.stringify([useSceneStore.getState().room, ...useSceneStore.getState().otherRooms]);
  };
  afterEach(() => {
    vi.unstubAllGlobals();
    useShowcaseStore.getState().exit();
  });

  it('shows precomputed results instantly and exit leaves the user design, history and settings unchanged', async () => {
    vi.stubGlobal('fetch', servePublic());
    const before = user();
    const past = useSceneStore.temporal.getState().pastStates.length;
    const settings = useSimulationStore.getState().settings;
    const run = vi.fn();
    setVoxelRunnerFactory(() => ({ run: run as never, cancel: () => {} }));
    const t0 = performance.now();
    await useShowcaseStore.getState().openStory('smog-day');
    const ms = performance.now() - t0;
    expect(run).not.toHaveBeenCalled();
    expect(useShowcaseStore.getState().active?.source).toBe('precomputed');
    expect(useSimulationStore.getState().status).toBe('done');
    expect(useSceneStore.getState().room.name).toBe('Bedroom 1');
    expect(ms).toBeLessThan(5000); // decode in Node; the browser figure is in the report
    // Editing inside the example doesn't reach the user's history
    useSceneStore.getState().setRoomName('Scratch');
    await useShowcaseStore.getState().nextStory();
    useShowcaseStore.getState().exit();
    expect(JSON.stringify([useSceneStore.getState().room, ...useSceneStore.getState().otherRooms])).toBe(before);
    expect(useSceneStore.temporal.getState().pastStates.length).toBe(past);
    expect(useSimulationStore.getState().settings).toEqual(settings);
    expect(useShowcaseStore.getState().saved).toBeNull();
  }, 60000);

  it('falls back to a live run when the precomputed files are missing', async () => {
    vi.stubGlobal('fetch', servePublic(true));
    user();
    const run = vi.fn(async () => ({ zones: [] }) as unknown as VoxelSimResult);
    setVoxelRunnerFactory(() => ({ run, cancel: () => {} }));
    await useShowcaseStore.getState().openStory('dinner-time');
    expect(useShowcaseStore.getState().active?.source).toBe('live');
    expect(run).toHaveBeenCalledTimes(1);
  });

  it('"Make a copy to edit" keeps the example as the user design, one undo away from theirs', async () => {
    vi.stubGlobal('fetch', servePublic());
    const before = user();
    await useShowcaseStore.getState().openStory('forgotten-rooms');
    useShowcaseStore.getState().makeCopy();
    expect(useShowcaseStore.getState().active).toBeNull();
    expect(useSceneStore.getState().room.name).toBe('Bedroom 1');
    useSceneStore.temporal.getState().undo();
    expect(JSON.stringify([useSceneStore.getState().room, ...useSceneStore.getState().otherRooms])).toBe(before);
  }, 60000);
});

describe('old designs', () => {
  it('still load unchanged', () => {
    const raw = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../../test-designs/house-demo.json'), 'utf8'));
    const room = parseRoom(raw).room as Room;
    expect(room.name).toBe('Living Room');
    expect('scenarios' in room).toBe(false);
  });
});
