import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { parseRoom } from '../../core/parser';
import type { Room } from '../../core/schema';
import { device, opening, rectRoom } from '../../test/simulationFixtures';
import { DISCHARGE_COEFFICIENT, DOOR_UNDERCUT_HEIGHT_M } from '../constants';
import { crossVentilationFlow, localWindSpeed, pressureCoefficient } from '../ventilation';
import { createDemoScenario, createStandinHouse } from './demoHouse';
import { buildHouse } from './house';
import { simulateHouseNetwork } from './network';

const bedroom2 = parseRoom(JSON.parse(readFileSync('test-designs/house.json', 'utf8'))).room!;
const still = { indoorTempC: 25, outdoorTempC: 25 };

/** Two 4 × 3 rooms side by side (x 0–4 and 4.15–8.15) sharing the wall at x ≈ 4. */
function twoRooms(doorOpen: number, extraA: Partial<Room> = {}, extraB: Partial<Room> = {}): Room[] {
  const a = rectRoom(4, 3, 2.5, { id: 'a', name: 'A', openings: [opening('door', 1, { type: 'door', subType: 'single-door', offset: 1, width: 0.9, height: 2.1, sill: 0, role: doorOpen > 0 ? 'inlet' : 'closed', openFraction: doorOpen })], ...extraA });
  const b = rectRoom(4, 3, 2.5, { id: 'b', name: 'B', outline: [[4.15, 0], [8.15, 0], [8.15, 3], [4.15, 3]], ...extraB });
  return [a, b];
}

describe('house model', () => {
  it('turns a door on a shared wall into an interior path plus an undercut', () => {
    const house = buildHouse(twoRooms(0.5), still);
    const kinds = house.paths.filter((p) => p.kind !== 'leak').map((p) => [p.kind, p.from, p.to]);
    expect(kinds).toEqual([
      ['opening', 0, 1],
      ['undercut', 0, 1],
    ]);
    const undercut = house.paths.find((p) => p.kind === 'undercut')!;
    expect(undercut.areaM2).toBeCloseTo(0.9 * DOOR_UNDERCUT_HEIGHT_M);
    // A closed door keeps only its undercut
    expect(buildHouse(twoRooms(0), still).paths.filter((p) => p.kind === 'opening')).toHaveLength(0);
  });
});

describe('network model', () => {
  it('closes the mass balance to 1e-6 on the demo house', () => {
    const r = simulateHouseNetwork(createDemoScenario(createStandinHouse(bedroom2)));
    expect(r.massBalanceError).toBeLessThan(1e-6);
    for (const z of r.zones) {
      const inflow = r.paths.reduce((s, p) => s + (p.to === z.index ? p.forwardM3s : 0) + (p.from === z.index ? p.backwardM3s : 0), 0);
      const outflow = r.paths.reduce((s, p) => s + (p.from === z.index ? p.forwardM3s : 0) + (p.to === z.index ? p.backwardM3s : 0), 0) + z.exhaustM3s;
      expect(Math.abs(inflow - outflow) / Math.max(inflow, 1e-9)).toBeLessThan(1e-6);
    }
  });

  it('reproduces the two-opening cross-ventilation formula', () => {
    const room = rectRoom(4, 3, 2.5, { openings: [opening('n', 0), opening('s', 2)] });
    const env = { windSpeed: 3, windDirDeg: 0, exposure: 'open' as const, ...still };
    const r = simulateHouseNetwork([room], env);
    const U = localWindSpeed(3, 'open');
    const expected = crossVentilationFlow(1, 1, U, pressureCoefficient(0, 'open') - pressureCoefficient(180, 'open'));
    const n = r.paths.find((p) => p.id === 'n')!;
    // Leaks add a sliver of flow; the window pair carries the rest
    expect(-n.flowM3s / expected).toBeGreaterThan(0.97);
    expect(-n.flowM3s / expected).toBeLessThan(1.03);
    expect(DISCHARGE_COEFFICIENT).toBeGreaterThan(0);
  });

  it('a house with every door shut still exchanges air through the undercuts', () => {
    // Exhaust fan in B, door shut, B's only make-up is A's air through the undercut (and B's leak)
    const rooms = twoRooms(0, { openings: [...twoRooms(0)[0]!.openings, opening('w', 3)] }, { objects: [device('fan', 'exhaust-fan', { exhaustFlowM3h: 60 })] });
    const r = simulateHouseNetwork(rooms, { windSpeed: 0, ...still });
    const undercut = r.paths.find((p) => p.kind === 'undercut')!;
    expect(undercut.flowM3s).toBeGreaterThan(0.002); // A → B, > 7 m³/h
    expect(r.zones[1]!.achTotal).toBeGreaterThan(r.zones[1]!.achOutdoor);
    // A closed room next to a cooking room gets some of its PM2.5
    const withSource = twoRooms(0, { params: { ...rooms[0]!.params, ...still, windSpeed: 0, pm25Sources: [{ id: 'c', emissionRateUgMin: 2000 }] } }, { objects: rooms[1]!.objects });
    const a = simulateHouseNetwork(withSource, { windSpeed: 0, ...still, outdoorUgM3: 0 });
    expect(a.zones[1]!.cssUgM3).toBeGreaterThan(1);
  });

  it('stack effect: with outdoors colder, air enters low and leaves high through one tall opening', () => {
    const room = rectRoom(4, 3, 2.7, { openings: [opening('door', 0, { type: 'door', sill: 0, height: 2.1, width: 0.9 })] });
    const r = simulateHouseNetwork([room], { windSpeed: 0, indoorTempC: 25, outdoorTempC: 5 });
    const door = r.paths.find((p) => p.id === 'door')!;
    expect(door.forwardM3s).toBeGreaterThan(0.01); // out (top)
    expect(door.backwardM3s).toBeGreaterThan(0.01); // in (bottom)
    expect(Math.abs(door.flowM3s)).toBeLessThan(0.1 * door.forwardM3s);
  });
});
