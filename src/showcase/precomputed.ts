import type { Room } from '../core/schema';
import { VOXEL_SOLVER_VERSION } from '../simulation/constants';
import type { HouseMetrics } from '../simulation/scenarios/metrics';
import type { Effort } from '../simulation/scenarios/generate';
import { simulationInputKey } from '../simulation/viz/staleness';
import type { VoxelSimResult } from '../simulation/voxel/solver';
import { decodeResult, type EncodedResult } from './codec';
import type { StoryPreset } from './stories';

/** Where the build script writes and the app reads precomputed stories (under public/). */
export const SHOWCASE_DIR = 'showcase';

export interface PrecomputedVariant extends EncodedResult {
  /** File holding the gzipped blob, relative to the story folder */
  file: string;
  /** storyHash of the design this result was computed for */
  hash: string;
  /** Size of the gzipped blob (bytes) */
  bytes: number;
}

export interface ShowcaseManifest {
  version: 1;
  storyId: string;
  solverVersion: string;
  settings: { durationS: number; resolution: 'live' };
  baseline: PrecomputedVariant;
  fix: PrecomputedVariant;
  metrics: { baseline: HouseMetrics; fix: HouseMetrics };
  /** Ranked actions for the story's focus room (network model, top ones voxel-checked) */
  ranking: {
    objective: { kind: 'house' } | { kind: 'room'; roomId: string };
    runtimeMs: number;
    better: { id: string; texts: string[]; effort: Effort; delta: number; fraction: number; verified: string; voxelDelta?: number }[];
    avoid: { id: string; texts: string[]; effort: Effort; delta: number; fraction: number }[];
  };
  /** Voxel metrics of the voxel-checked ranked designs, by voxel cache key, so the app needn't re-run them */
  knownVoxel: Record<string, HouseMetrics>;
}

/** Hash of a design + simulation inputs + solver version: precomputed results apply only when it matches. */
export function storyHash(rooms: readonly Room[], settings: { durationS: number; resolution: 'live' | 'full' }): string {
  return `${simulationInputKey(rooms[0]!, rooms.slice(1), settings)}:${VOXEL_SOLVER_VERSION}`;
}

/** Un-gzips a blob in the browser (DecompressionStream) when it starts with the gzip magic bytes. */
export async function gunzip(bytes: Uint8Array): Promise<Uint8Array> {
  if (bytes[0] !== 0x1f || bytes[1] !== 0x8b) return bytes;
  const stream = new Blob([bytes as BlobPart]).stream().pipeThrough(new DecompressionStream('gzip'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

export interface LoadedStory {
  manifest: ShowcaseManifest;
  baseline: VoxelSimResult;
  fix: VoxelSimResult;
}

/**
 * Loads a story's precomputed results if its manifest hashes match the given designs; null when a
 * file is missing or out of date (the caller then runs the solver).
 */
export async function loadPrecomputed(story: StoryPreset, base: readonly Room[], fix: readonly Room[], settings: { durationS: number; resolution: 'live' }, baseUrl = '/'): Promise<LoadedStory | null> {
  try {
    const dir = `${baseUrl}${SHOWCASE_DIR}/${story.id}/`;
    const res = await fetch(`${dir}manifest.json`);
    if (!res.ok) return null;
    const manifest = (await res.json()) as ShowcaseManifest;
    if (manifest.baseline.hash !== storyHash(base, settings) || manifest.fix.hash !== storyHash(fix, settings)) return null;
    const blob = async (v: PrecomputedVariant) => {
      const r = await fetch(`${dir}${v.file}`);
      if (!r.ok) throw new Error(`missing ${v.file}`);
      return decodeResult(v, await gunzip(new Uint8Array(await r.arrayBuffer())));
    };
    const [baseline, fixResult] = await Promise.all([blob(manifest.baseline), blob(manifest.fix)]);
    return { manifest, baseline, fix: fixResult };
  } catch {
    return null;
  }
}
