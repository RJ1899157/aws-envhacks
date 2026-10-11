import type { Room } from '../core/schema';
import type { VoxelSimResult } from '../simulation/voxel/solver';
import { decodeResult } from './codec';
import { createShowcaseHouse, SC } from './house';
import { gunzip, SHOWCASE_DIR, storyHash, type PrecomputedVariant } from './precomputed';

/**
 * The landing page's flat: the showcase house on the 10th floor, with the kitchen frying and clean
 * outdoor air so the smoke is what stands out. Its voxel result is precomputed (npm run landing:build) into
 * public/showcase/landing/, so the landing shows it instantly instead of solving in the browser.
 */

/** The app's default simulation settings (simulationStore): the precomputed result is for these */
export const LANDING_SETTINGS = { durationS: 4 * 3600, resolution: 'live' as const };
export const LANDING_DIR = 'landing';

export function landingHouse(): Room[] {
  return createShowcaseHouse().map((r) => ({
    ...r,
    params: { ...r.params, floorLevel: 10, outdoorPm25: { valueUgM3: 15, source: 'manual' as const } },
    objects: r.objects.map((o) => (o.id === SC.frying ? { ...o, enabled: true } : o)),
  }));
}

export interface LandingManifest {
  version: 1;
  solverVersion: string;
  settings: typeof LANDING_SETTINGS;
  result: PrecomputedVariant;
}

/** The precomputed result of `rooms`, or null when the file is missing or was computed for another design or solver. */
export async function loadLandingResult(rooms: readonly Room[], baseUrl = '/'): Promise<VoxelSimResult | null> {
  try {
    const dir = `${baseUrl}${SHOWCASE_DIR}/${LANDING_DIR}/`;
    const res = await fetch(`${dir}manifest.json`);
    if (!res.ok) return null;
    const manifest = (await res.json()) as LandingManifest;
    if (manifest.result.hash !== storyHash(rooms, LANDING_SETTINGS)) return null;
    const blob = await fetch(`${dir}${manifest.result.file}`);
    if (!blob.ok) return null;
    return decodeResult(manifest.result, await gunzip(new Uint8Array(await blob.arrayBuffer())));
  } catch {
    return null;
  }
}
