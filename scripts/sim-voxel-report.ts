import { readFileSync } from 'node:fs';
import { parseRoom } from '../src/core/parser';
import type { Room } from '../src/core/schema';
import { buildVoxelReport } from '../src/simulation/voxelReport';

// Whole-house demo first (test-designs/house-demo.json, made by scripts/make-demo-house.ts)
const raw = JSON.parse(readFileSync('test-designs/house-demo.json', 'utf8')) as { otherRooms?: unknown[] };
const house = [parseRoom(raw).room!, ...(raw.otherRooms ?? []).map((r) => parseRoom(r).room!)].filter((r): r is Room => Boolean(r));

await buildVoxelReport({ house, log: (line) => console.log(line) });
