import fs from 'fs';
import path from 'path';
import { describe, expect, it } from 'vitest';
import { parseRoom } from '../../core/parser';
import { RoomSchema, type Room, type Scenario, type ScenarioAction } from '../../core/schema';
import { opening, rectRoom } from '../../test/simulationFixtures';
import { simulateHouseNetwork } from '../house/network';
import { isPm25SourceObject } from '../sources';
import { simulationInputKey } from '../viz/staleness';
import { runVoxelSimulation } from '../voxel/solver';
import { applyActions, applyScenario, describeAction, diffDesigns, objectFromAsset } from './actions';
import { compareRooms, verdict } from './compare';
import { networkMetrics, occupancyWeight, voxelMetrics } from './metrics';
import { rankActions } from './rank';
import { VoxelQueue } from './voxelQueue';
import type { VoxelSimResult } from '../voxel/solver';

/** test-designs/house-demo.json as the app loads it (active room + otherRooms). */
function demoHouse(outdoor?: number): Room[] {
  const raw = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../../../test-designs/house-demo.json'), 'utf8'));
  const rooms = [parseRoom(raw).room!, ...raw.otherRooms.map((r: unknown) => parseRoom(r).room!)];
  return outdoor === undefined ? rooms : rooms.map((r) => ({ ...r, params: { ...r.params, outdoorPm25: { valueUgM3: outdoor, source: 'manual' as const } } }));
}
const byName = (rooms: readonly Room[], name: string) => rooms.find((r) => r.name === name)!;
const deepFreeze = <T,>(o: T): T => {
  if (o && typeof o === 'object' && !Object.isFrozen(o)) {
    Object.freeze(o);
    for (const v of Object.values(o)) deepFreeze(v);
  }
  return o;
};

function everyActionScenario(rooms: Room[]): Scenario {
  const living = byName(rooms, 'Living Room');
  const b1 = byName(rooms, 'Bedroom 1');
  const b2 = byName(rooms, 'Bedroom 2');
  const kitchen = byName(rooms, 'Kitchen');
  return {
    id: 's1',
    name: 'Everything',
    actions: [
      { type: 'setOpening', roomId: living.id!, openingId: 'living-window-n1', openFraction: 1 },
      { type: 'toggleDevice', roomId: b1.id!, objectId: 'demo-purifier', enabled: false },
      { type: 'moveObject', roomId: b1.id!, objectId: 'demo-purifier', toRoomId: b2.id!, position: [-1.2, 0, 3.6] },
      { type: 'addDevice', roomId: kitchen.id!, objectId: 'hood-x', kind: 'rangeHood', assetId: 'range-hood', position: [2.85, 1.6, 2.3] },
      { type: 'removeObject', roomId: living.id!, objectId: 'coffee-table-demo-1' },
      { type: 'setSource', roomId: living.id!, sourceId: 'demo-incense', enabled: false },
      { type: 'setDeviceParam', roomId: b1.id!, objectId: 'demo-purifier', param: 'cadrM3h', value: 450 },
    ],
  };
}

describe('scenario actions', () => {
  it('applyScenario never mutates the baseline', () => {
    const rooms = demoHouse();
    const before = JSON.stringify(rooms);
    deepFreeze(rooms); // any write would throw
    const scenario = everyActionScenario(rooms);
    const after = applyScenario(rooms, scenario);
    expect(JSON.stringify(rooms)).toBe(before);
    // ...and it did change the copy
    expect(byName(after, 'Bedroom 2').objects.some((o) => o.id === 'demo-purifier')).toBe(true);
    expect(byName(after, 'Bedroom 1').objects.some((o) => o.id === 'demo-purifier')).toBe(false);
    expect(byName(after, 'Kitchen').objects.find((o) => o.id === 'hood-x')?.elevation).toBe(1.6);
    expect(byName(after, 'Living Room').openings.find((o) => o.id === 'living-window-n1')).toMatchObject({ openFraction: 1, role: 'inlet' });
    // Untouched rooms are shared, not copied
    expect(byName(after, 'Bathroom')).toBe(byName(rooms, 'Bathroom'));
  });

  it('describes actions in plain language', () => {
    const rooms = demoHouse();
    const [open, off, move, add, remove, stop] = everyActionScenario(rooms).actions.map((a) => describeAction(a, rooms));
    expect(open).toBe('Open the first north window in Living Room fully');
    expect(off).toBe('Turn off the air purifier in Bedroom 1');
    expect(move).toBe('Move the air purifier to Bedroom 2');
    expect(add).toBe('Add a range hood (400 m³/h) to Kitchen');
    expect(remove).toBe('Remove the coffee table from Living Room');
    expect(stop).toBe('Stop the incense in Living Room');
    const b1 = byName(rooms, 'Bedroom 1');
    expect(describeAction({ type: 'setOpening', roomId: b1.id!, openingId: 'b1-window-east', openFraction: 0 }, rooms)).toBe('Close the east window in Bedroom 1');
    const kitchen = byName(rooms, 'Kitchen');
    expect(describeAction({ type: 'setOpening', roomId: kitchen.id!, openingId: 'kitchen-door-living', openFraction: 0 }, rooms)).toBe('Close the door between Kitchen and Living Room');
  });

  it('apply → describe → save → reload round-trips through JSON', () => {
    const rooms = demoHouse();
    const scenario = everyActionScenario(rooms);
    const texts = scenario.actions.map((a) => describeAction(a, rooms));
    const saved = [{ ...rooms[0]!, scenarios: [scenario] }, ...rooms.slice(1)];
    const json = JSON.stringify({ ...saved[0], otherRooms: saved.slice(1) });
    const raw = JSON.parse(json);
    const reloaded = [parseRoom(raw).room!, ...raw.otherRooms.map((r: unknown) => parseRoom(r).room!)];
    const back = reloaded[0]!.scenarios![0]!;
    expect(back).toEqual(scenario);
    expect(back.actions.map((a: ScenarioAction) => describeAction(a, reloaded))).toEqual(texts);
    const strip = (rs: Room[]) => JSON.stringify(rs.map(({ scenarios: _s, ...r }) => r));
    expect(strip(applyScenario(reloaded, back))).toBe(strip(applyScenario(rooms, scenario)));
  });

  it('loads old JSON without scenarios exactly as before, and scenarios never make results stale', () => {
    const raw = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../../../test-designs/house-demo.json'), 'utf8'));
    const room = parseRoom(raw).room!;
    expect('scenarios' in room).toBe(false);
    expect('occupancyWeight' in room).toBe(false);
    // Parsing with the schema is unchanged by the new optional fields
    const plain = { ...raw };
    delete plain.otherRooms;
    expect(RoomSchema.parse(plain)).toEqual(room);
    const settings = { durationS: 3600, resolution: 'live' as const };
    const withScenarios = { ...room, scenarios: [everyActionScenario(demoHouse())], occupancyWeight: 0.2 };
    expect(simulationInputKey(withScenarios, [], settings)).toBe(simulationInputKey(room, [], settings));
  });

  it('records what-if edits as actions that reproduce the edited design', () => {
    const base = demoHouse();
    const scenario = everyActionScenario(base);
    const edited = applyScenario(base, scenario);
    const recorded = diffDesigns(base, edited);
    const strip = (rs: Room[]) => JSON.stringify(rs);
    expect(strip(applyActions(base, recorded))).toBe(strip(edited));
    expect(diffDesigns(base, base)).toEqual([]);
  });
});

describe('house metrics', () => {
  it('weights bedrooms and the living room above the kitchen and bathroom, overridable per room', () => {
    const rooms = demoHouse();
    expect(occupancyWeight(byName(rooms, 'Bedroom 1'))).toBe(1);
    expect(occupancyWeight(byName(rooms, 'Living Room'))).toBe(0.8);
    expect(occupancyWeight(byName(rooms, 'Kitchen'))).toBe(0.3);
    expect(occupancyWeight(byName(rooms, 'Bathroom'))).toBe(0.1);
    expect(occupancyWeight({ ...byName(rooms, 'Kitchen'), occupancyWeight: 0.9 })).toBe(0.9);
    const m = networkMetrics(simulateHouseNetwork(rooms));
    expect(m.weightedPm25).toBeGreaterThan(0);
    expect(m.worstRoom.name).toBe('Kitchen');
    expect(m.fracAboveNaaqs).toBeGreaterThan(0);
    expect(m.fracAboveWho).toBeGreaterThanOrEqual(m.fracAboveNaaqs);
    expect(m.meanAgeMinutes).toBeGreaterThan(0);
  });

  it('writes a verdict from the numbers', () => {
    const rooms = demoHouse(250);
    const b2 = byName(rooms, 'Bedroom 2');
    const scenario: Scenario = { id: 'p', name: 'Purifier', actions: [{ type: 'addDevice', roomId: b2.id!, objectId: 'p1', kind: 'purifier', assetId: 'air-purifier', position: [-1.2, 0, 3.6] }] };
    const a = networkMetrics(simulateHouseNetwork(rooms));
    const b = networkMetrics(simulateHouseNetwork(applyScenario(rooms, scenario)));
    const text = verdict(scenario.actions.map((x) => describeAction(x, rooms)), a, b, { kind: 'room', roomId: b2.id! });
    expect(text).toMatch(/^Adding an air purifier \(300 m³\/h\) to Bedroom 2 cuts Bedroom 2 PM2\.5 from \d+ to \d+ µg\/m³ \(−\d+%\)\.$/);
    expect(compareRooms(a, b, 'pm25').find((r) => r.roomId === b2.id)!.better).toBe(true);
  });
});

describe('ranked actions', () => {
  it('at outdoor 250 with no indoor sources, closing windows ranks above opening them; opening goes under Avoid', () => {
    const rooms = demoHouse(250).map((r) => ({ ...r, objects: r.objects.filter((o) => !isPm25SourceObject(o)) }));
    const rk = rankActions(rooms);
    const closeIdx = rk.better.findIndex((r) => r.actions.every((a) => a.type === 'setOpening' && a.openFraction === 0));
    const openIdx = rk.better.findIndex((r) => r.actions.some((a) => a.type === 'setOpening' && a.openFraction > 0) && r.actions.length === 1);
    expect(closeIdx).toBeGreaterThanOrEqual(0);
    expect(openIdx === -1 || closeIdx < openIdx).toBe(true);
    expect(rk.avoid.some((r) => r.actions.length === 1 && r.actions[0]!.type === 'setOpening' && r.actions[0]!.openFraction === 1)).toBe(true);
    expect(rk.runtimeMs).toBeLessThan(5000);
  });

  it('at outdoor 60 with frying: the hood, the kitchen window and the kitchen door rank at the top', () => {
    const rooms = demoHouse(60);
    const kitchen = byName(rooms, 'Kitchen');
    const hood = { ...objectFromAsset('range-hood', 'hood-1', [2.85, 1.6, 2.3]), enabled: false };
    const withHood = rooms.map((r) => (r === kitchen ? { ...r, objects: [...r.objects, hood] } : r));
    // Ventilation and device actions (stopping the cooking itself ranks first and is set aside here)
    const ventilation = (rk: ReturnType<typeof rankActions>) => rk.better.filter((r) => r.actions.length === 1 && r.actions[0]!.type !== 'setSource' && r.effort !== 'Purchase').map((r) => r.texts[0]!);
    const house = ventilation(rankActions(withHood, { pairTop: 0 })).slice(0, 3);
    expect(house).toContain('Turn on the range hood in Kitchen');
    expect(house).toContain('Open the east window in Kitchen fully');
    const living = ventilation(rankActions(withHood, { pairTop: 0, objective: { kind: 'room', roomId: byName(rooms, 'Living Room').id! } })).slice(0, 3);
    expect(living).toContain('Close the door between Kitchen and Living Room');
  });

  it('re-ranks for a focus room', () => {
    const rooms = demoHouse(60);
    const house = rankActions(rooms);
    const b2 = rankActions(rooms, { objective: { kind: 'room', roomId: byName(rooms, 'Bedroom 2').id! } });
    expect(b2.better[0]!.texts.join()).not.toBe(house.better[0]!.texts.join());
    expect(b2.better[0]!.texts.join()).toMatch(/purifier.*Bedroom 2/);
  });

  it('carries structured data: texts, effort, per-room deltas and supporting facts', () => {
    const rk = rankActions(demoHouse(250));
    const top = rk.better[0]!;
    expect(top.texts.length).toBe(top.actions.length);
    expect(['Free', 'Low', 'Purchase']).toContain(top.effort);
    expect(top.roomDeltas.length).toBeGreaterThan(0);
    expect(top.facts.length).toBeGreaterThan(0);
    expect(top.verified).toBe('unverified');
    // Near-zero results are dropped
    expect([...rk.better, ...rk.avoid].every((r) => Math.abs(r.delta) >= 0.5 || Math.abs(r.fraction) >= 0.01)).toBe(true);
  });
});

describe('purifier in the bedroom', () => {
  it('reduces bedroom PM2.5 in both the network and the voxel model', async () => {
    const bedroom = rectRoom(4, 3, 2.6, { id: 'bed', type: 'bedroom', openings: [opening('w', 0, { openFraction: 0.3 })], params: { outdoorPm25: { valueUgM3: 150, source: 'manual' } } as Room['params'] });
    const scenario: Scenario = { id: 'p', name: 'p', actions: [{ type: 'addDevice', roomId: 'bed', objectId: 'pur', kind: 'purifier', assetId: 'air-purifier', position: [2, 0, 1.5] }] };
    const after = applyScenario([bedroom], scenario);
    const netA = simulateHouseNetwork([bedroom]);
    const netB = simulateHouseNetwork(after);
    expect(netB.zones[0]!.cssUgM3).toBeLessThan(netA.zones[0]!.cssUgM3 * 0.8);
    const input = (rooms: Room[]) => ({ rooms, resolution: 'live' as const, durationS: 1800 });
    const [va, vb] = [await runVoxelSimulation(input([bedroom])), await runVoxelSimulation(input(after))];
    const ma = voxelMetrics(va, [bedroom], netA);
    const mb = voxelMetrics(vb, after, netB);
    expect(mb.rooms[0]!.pm25).toBeLessThan(ma.rooms[0]!.pm25 * 0.9);
  }, 120000);
});

describe('voxel queue', () => {
  const fakeRunner = () => {
    let calls = 0;
    const runner = {
      run: async () => {
        calls++;
        return { tag: calls } as unknown as VoxelSimResult;
      },
      cancel: () => {},
    };
    return { runner, calls: () => calls };
  };
  const input = { rooms: [rectRoom(3, 3, 2.6)], resolution: 'live' as const, durationS: 600 };

  it('serves an identical design + inputs from the cache without running again', async () => {
    const f = fakeRunner();
    const q = new VoxelQueue(() => f.runner);
    const r1 = await q.enqueue({ key: 'k', label: 'a', priority: 'low', input });
    const r2 = await q.enqueue({ key: 'k', label: 'a', priority: 'high', input });
    expect(r2).toBe(r1);
    expect(f.calls()).toBe(1);
    await q.enqueue({ key: 'other', label: 'b', priority: 'low', input });
    expect(f.calls()).toBe(2);
  });

  it('runs one job at a time and joins a request for a job already queued', async () => {
    const resolvers: ((r: VoxelSimResult) => void)[] = [];
    const q = new VoxelQueue(() => ({ run: () => new Promise<VoxelSimResult>((res) => resolvers.push(res)), cancel: () => {} }));
    const a = q.enqueue({ key: 'a', label: 'a', priority: 'low', input });
    const b = q.enqueue({ key: 'b', label: 'b', priority: 'low', input });
    const b2 = q.enqueue({ key: 'b', label: 'b', priority: 'low', input });
    expect(b2).toBe(b);
    expect(resolvers.length).toBe(1);
    expect(q.state().queued.map((j) => j.key)).toEqual(['b']);
    resolvers[0]!({ tag: 'a' } as unknown as VoxelSimResult);
    await a;
    await Promise.resolve();
    expect(resolvers.length).toBe(2);
    q.cancel('b');
    await expect(b).rejects.toThrow(/cancelled/);
  });
});
