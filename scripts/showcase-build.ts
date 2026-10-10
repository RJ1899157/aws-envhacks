/**
 * npm run showcase:build: precomputes the showcase stories into public/showcase/<story>/:
 *   manifest.json  hashes, metrics, ranked actions, array table of each result
 *   baseline.bin   gzipped quantized voxel result of the story as set up
 *   fix.bin        the same for the story's fix scenario
 * Runs the network model and the voxel solver (0.2 m) in Node, outside the worker.
 */
import fs from 'fs';
import path from 'path';
import zlib from 'zlib';
import { createShowcaseHouse } from '../src/showcase/house';
import { STORIES, applyStory, storySettings } from '../src/showcase/stories';
import { encodeResult } from '../src/showcase/codec';
import { SHOWCASE_DIR, storyHash, type PrecomputedVariant, type ShowcaseManifest } from '../src/showcase/precomputed';
import { VOXEL_SOLVER_VERSION } from '../src/simulation/constants';
import { applyScenario } from '../src/simulation/scenarios/actions';
import { evaluateDesign } from '../src/simulation/scenarios/evaluate';
import { objectiveValue, voxelMetrics, type HouseMetrics } from '../src/simulation/scenarios/metrics';
import { rankActions } from '../src/simulation/scenarios/rank';
import { simulationInputKey } from '../src/simulation/viz/staleness';
import { runVoxelSimulation } from '../src/simulation/voxel/solver';
import type { Room } from '../src/core/schema';

const OUT = path.resolve(process.cwd(), 'public', SHOWCASE_DIR);
const VERIFY_TOP = 3;
const only = process.argv[2];

const house = createShowcaseHouse();
let total = 0;
const summary: string[] = [];
for (const story of STORIES) {
  if (only && story.id !== only) continue;
  const t0 = Date.now();
  const settings = storySettings(story);
  const base = applyStory(house, story);
  const fix = applyScenario(base, story.fix);
  const dir = path.join(OUT, story.id);
  fs.mkdirSync(dir, { recursive: true });

  const run = async (rooms: Room[]) => {
    const vox = await runVoxelSimulation({ rooms, resolution: settings.resolution, durationS: settings.durationS });
    return { vox, metrics: voxelMetrics(vox, rooms, evaluateDesign(rooms, settings.durationS).network) };
  };
  const variant = async (name: 'baseline' | 'fix', rooms: Room[]) => {
    const { vox, metrics } = await run(rooms);
    const { structure, arrays, blob } = encodeResult(vox);
    const gz = zlib.gzipSync(blob, { level: 9 });
    fs.writeFileSync(path.join(dir, `${name}.bin`), gz);
    const v: PrecomputedVariant = { file: `${name}.bin`, hash: storyHash(rooms, settings), bytes: gz.byteLength, structure, arrays };
    return { v, metrics };
  };
  const b = await variant('baseline', base);
  const f = await variant('fix', fix);

  // Ranked actions for the story's focus room, with the top ones checked by the voxel solver
  const objective = { kind: 'room' as const, roomId: story.view.focusRoomId };
  const ranking = rankActions(base, { objective, durationS: settings.durationS });
  const knownVoxel: Record<string, HouseMetrics> = {};
  const before = objectiveValue(b.metrics, objective);
  const verified = new Map<string, { verified: string; voxelDelta: number }>();
  for (const r of ranking.better.slice(0, VERIFY_TOP)) {
    const d = applyScenario(base, r);
    const { metrics } = await run(d);
    knownVoxel[simulationInputKey(d[0]!, d.slice(1), settings)] = metrics;
    const delta = objectiveValue(metrics, objective) - before;
    verified.set(r.id, { verified: Math.sign(delta) === Math.sign(r.delta) ? 'verified' : 'disagrees', voxelDelta: delta });
  }

  const manifest: ShowcaseManifest = {
    version: 1,
    storyId: story.id,
    solverVersion: VOXEL_SOLVER_VERSION,
    settings,
    baseline: b.v,
    fix: f.v,
    metrics: { baseline: b.metrics, fix: f.metrics },
    ranking: {
      objective,
      runtimeMs: Math.round(ranking.runtimeMs),
      better: ranking.better.slice(0, 8).map((r) => ({ id: r.id, texts: r.texts, effort: r.effort, delta: r.delta, fraction: r.fraction, ...(verified.get(r.id) ?? { verified: 'unverified' }) })),
      avoid: ranking.avoid.slice(0, 6).map((r) => ({ id: r.id, texts: r.texts, effort: r.effort, delta: r.delta, fraction: r.fraction })),
    },
    knownVoxel,
  };
  const json = JSON.stringify(manifest);
  fs.writeFileSync(path.join(dir, 'manifest.json'), json);
  const size = b.v.bytes + f.v.bytes + json.length;
  total += size;
  const focus = (m: HouseMetrics) => m.rooms.find((r) => r.roomId === story.view.focusRoomId)!;
  summary.push(
    `${story.id}: ${(size / 1e6).toFixed(2)} MB (baseline ${(b.v.bytes / 1e6).toFixed(2)}, fix ${(f.v.bytes / 1e6).toFixed(2)}, manifest ${(json.length / 1e3).toFixed(0)} kB) in ${((Date.now() - t0) / 1000).toFixed(0)} s · ${focus(b.metrics).name} ${focus(b.metrics).pm25.toFixed(0)} → ${focus(f.metrics).pm25.toFixed(0)} µg/m³ · house ${b.metrics.weightedPm25.toFixed(0)} → ${f.metrics.weightedPm25.toFixed(0)} · ranked ${ranking.evaluated} in ${ranking.runtimeMs.toFixed(0)} ms`
  );
  console.log(summary[summary.length - 1]);
}
fs.writeFileSync(path.join(OUT, 'stories.json'), JSON.stringify(STORIES.map((s) => s.id)));
console.log(`\nTotal ${(total / 1e6).toFixed(2)} MB in public/${SHOWCASE_DIR}`);
