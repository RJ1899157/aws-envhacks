/**
 * npm run landing:build: precomputes the landing page's flat into public/showcase/landing/:
 *   manifest.json  hash of the design + settings + solver version, array table of the result
 *   result.bin     gzipped quantized voxel result
 * Re-run after changing the showcase house, landingHouse() or the solver (the app then falls back
 * to solving in the browser until the file matches again).
 */
import fs from 'fs';
import path from 'path';
import zlib from 'zlib';
import { encodeResult } from '../src/showcase/codec';
import { LANDING_DIR, LANDING_SETTINGS, landingHouse, type LandingManifest } from '../src/showcase/landing';
import { SHOWCASE_DIR, storyHash } from '../src/showcase/precomputed';
import { VOXEL_SOLVER_VERSION } from '../src/simulation/constants';
import { runVoxelSimulation } from '../src/simulation/voxel/solver';

const dir = path.resolve(process.cwd(), 'public', SHOWCASE_DIR, LANDING_DIR);
fs.mkdirSync(dir, { recursive: true });
const t0 = Date.now();
const rooms = landingHouse();
const vox = await runVoxelSimulation({ rooms, ...LANDING_SETTINGS });
const { structure, arrays, blob } = encodeResult(vox);
const gz = zlib.gzipSync(blob, { level: 9 });
fs.writeFileSync(path.join(dir, 'result.bin'), gz);
const manifest: LandingManifest = {
  version: 1,
  solverVersion: VOXEL_SOLVER_VERSION,
  settings: LANDING_SETTINGS,
  result: { file: 'result.bin', hash: storyHash(rooms, LANDING_SETTINGS), bytes: gz.byteLength, structure, arrays },
};
fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify(manifest));
console.log(`landing: ${(gz.byteLength / 1e6).toFixed(2)} MB in ${((Date.now() - t0) / 1000).toFixed(0)} s`);
