/**
 * Writes test-designs/house-standin.json (multi-room stand-in around house.json's Bedroom 2, all
 * shut) and test-designs/house-demo.json (the demo scenario). house.json itself is not modified.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { parseRoom } from '../src/core/parser';
import { createDemoScenario, createStandinHouse, toExportJson } from '../src/simulation/house/demoHouse';

const bedroom2 = parseRoom(JSON.parse(readFileSync('test-designs/house.json', 'utf8'))).room;
if (!bedroom2) throw new Error('test-designs/house.json did not parse');
const standin = createStandinHouse(bedroom2);
writeFileSync('test-designs/house-standin.json', toExportJson(standin) + '\n');
writeFileSync('test-designs/house-demo.json', toExportJson(createDemoScenario(standin)) + '\n');
console.log(`Wrote house-standin.json and house-demo.json (${standin.length} rooms)`);
