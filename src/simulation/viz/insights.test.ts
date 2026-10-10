import { describe, expect, it } from 'vitest';
import { createBedroomSample } from '../../core/samples';
import { opening, rectRoom } from '../../test/simulationFixtures';
import type { GridInfo } from '../voxel/analysis';
import { createDemoScenario, createStandinHouse } from '../house/demoHouse';
import { simulateHouseNetwork } from '../house/network';
import { roomCause } from './explain';
import { achBand, ageBand, formatMetric, houseSummary, rankRooms, type RoomMetrics } from './insights';
import { pickStaleZones, sliceCellRooms } from './stagnation';

const rooms: RoomMetrics[] = [
  { roomId: 'a', name: 'Living Room', pm25: 176, ageMinutes: 4, ach: 11.7 },
  { roomId: 'b', name: 'Kitchen', pm25: 221, ageMinutes: 6, ach: 6 },
  { roomId: 'c', name: 'Bedroom 1', pm25: 30, ageMinutes: 140, ach: 0.4 },
  { roomId: 'd', name: 'Bathroom', pm25: 45, ageMinutes: 38, ach: 1.5 },
];

describe('insight wording', () => {
  it('gives every metric a unit and a band word', () => {
    expect(formatMetric('pollution', 176).text).toBe('176 µg/m³ · Very poor');
    expect(formatMetric('pollution', 25).text).toBe('25 µg/m³ · Good');
    expect(formatMetric('ventilation', 38).text).toBe('38 min · OK');
    expect(formatMetric('ventilation', 4.4).text).toBe('4.4 min · Fresh');
    expect(formatMetric('airflow', 4).text).toBe('4.0 air changes/h · Good');
    expect(ageBand(90)).toBe('Stale');
    expect(ageBand(200)).toBe('Very stale');
    expect(achBand(0.7)).toBe('Low');
    expect(achBand(0.2)).toBe('Very low');
  });

  it('ranks rooms worst first for the view mode', () => {
    expect(rankRooms('pollution', rooms).map((r) => r.name)).toEqual(['Kitchen', 'Living Room', 'Bathroom', 'Bedroom 1']);
    expect(rankRooms('ventilation', rooms)[0]!.name).toBe('Bedroom 1');
    expect(rankRooms('airflow', rooms)[0]!.name).toBe('Bedroom 1');
  });

  it('sums the house up in one line', () => {
    expect(houseSummary('pollution', rooms)).toBe('2 of 4 rooms are above the Indian 24-h limit (60 µg/m³); worst: Kitchen');
    expect(houseSummary('ventilation', rooms)).toMatch(/^1 of 4 rooms have stale air .*stalest: Bedroom 1$/);
    expect(houseSummary('airflow', rooms)).toMatch(/^1 of 4 rooms get under 1 .*least: Bedroom 1$/);
    expect(houseSummary('pollution', rooms.slice(2))).toMatch(/^All 2 rooms are within/);
  });
});

describe('dominant cause', () => {
  it('names the neighbouring source and the route for a room polluted from next door', () => {
    const house = createDemoScenario(createStandinHouse(createBedroomSample()));
    const net = simulateHouseNetwork(house);
    const living = net.zones.findIndex((z) => z.name === 'Living Room');
    const kitchen = net.zones.findIndex((z) => z.name === 'Kitchen');
    expect(roomCause(net, living, 'pollution')).toMatch(/^Kitchen .*smoke drifts in through the open door$/);
    expect(roomCause(net, kitchen, 'pollution')).toMatch(/smoke in this room$/);
  });

  it('points at the window outdoor air comes through, and at shut rooms', () => {
    // Windows on the north and south walls, wind from the north
    const open = rectRoom(4, 3, 2.5, { openings: [opening('a', 0), opening('b', 2)] });
    const net = simulateHouseNetwork([open], { outdoorUgM3: 150, exposure: 'open', windSpeed: 3, windDirDeg: 0 });
    expect(roomCause(net, 0, 'airflow')).toMatch(/^Outdoor air entering through the (north|south) window$/);
    const shut = rectRoom(4, 3, 2.5);
    const net2 = simulateHouseNetwork([shut], { outdoorUgM3: 150 });
    expect(roomCause(net2, 0, 'ventilation')).toMatch(/^No window open to outdoors, air ~\d+ min old$/);
    expect(roomCause(net2, 0, 'airflow')).toBe('Only slow leaks: no open window or door');
  });
});

describe('stale-zone highlighting', () => {
  // 10 × 1 × 6 grid at 0.5 m: two stale patches and fresh air elsewhere
  const grid: GridInfo = { nx: 10, ny: 1, nz: 6, dx: 0.5, origin: [0, 0, 0] };
  const make = (f: (i: number, k: number) => number) => Float32Array.from({ length: 60 }, (_, c) => f(c % 10, Math.floor(c / 10)));

  it('keeps only the worst ~20 % above the threshold, at most three zones, with closed outlines', () => {
    const norm = make((i, k) => (i >= 6 && i <= 8 && k >= 2 && k <= 4 ? 3 : i <= 1 && k <= 1 ? 2 : 0.5));
    const age = make((i, k) => (i >= 6 && i <= 8 && k >= 2 && k <= 4 ? 60 : i <= 1 && k <= 1 ? 40 : 10));
    const zones = pickStaleZones(grid, norm, age, 0.2);
    expect(zones.length).toBeGreaterThanOrEqual(1);
    expect(zones.length).toBeLessThanOrEqual(3);
    // Worst first, labelled with its mean age, outline closed (every endpoint shared by two segments)
    expect(zones[0]!.meanAgeMinutes).toBeCloseTo(60);
    const ends = new Map<string, number>();
    for (const [x0, z0, x1, z1] of zones[0]!.segments) for (const k of [`${x0},${z0}`, `${x1},${z1}`]) ends.set(k, (ends.get(k) ?? 0) + 1);
    expect([...ends.values()].every((n) => n === 2)).toBe(true);
    // Anchor inside the patch
    expect(zones[0]!.anchor[0]).toBeGreaterThan(3.5);
    expect(zones[0]!.anchor[1]).toBeGreaterThan(1.5);
  });

  it('shows nothing when no air is past the stagnant threshold', () => {
    const norm = make(() => 0.8);
    expect(pickStaleZones(grid, norm, make(() => 5), 0.2)).toEqual([]);
  });

  it('never joins stale air across a wall into one zone', () => {
    // One stale band across the grid, but the left and right halves are different rooms
    const norm = make((_, k) => (k >= 2 && k <= 3 ? 3 : 0.5));
    const age = make(() => 60);
    const cellRoom = sliceCellRooms(grid, [
      [[0, 0], [2.5, 0], [2.5, 3], [0, 3]],
      [[2.5, 0], [5, 0], [5, 3], [2.5, 3]],
    ]);
    expect(pickStaleZones(grid, norm, age, 0.2).length).toBe(1);
    const split = pickStaleZones(grid, norm, age, 0.2, { cellRoom });
    expect(split.length).toBe(2);
    expect(split.every((z) => z.areaM2 === 2.5)).toBe(true);
  });

  it('caps the count even when the whole house is stale', () => {
    // Checkerboard of stale cells: many tiny patches, which the area floor drops
    const norm = make((i, k) => ((i + k) % 2 ? 4 : 2));
    const zones = pickStaleZones(grid, norm, make(() => 50), 0.2, { minAreaM2: 0 });
    expect(zones.length).toBe(3);
  });
});
