import { getCatalogAsset } from '../../core/catalog';
import { wallSegment } from '../../core/parser';
import type { Opening, Room, ScenarioAction, SceneObject } from '../../core/schema';
import { OCCUPIED_WEIGHT_MIN, WINDOW_AJAR_FRACTION } from '../constants';
import { deviceFor } from '../devices';
import { interiorOpeningIds, isOpeningOpen } from '../geometry';
import type { NetworkResult } from '../house/network';
import { STALE_AGE_MINUTES } from '../viz/insights';
import { placedSourceParams } from '../sources';
import { occupancyWeight } from './metrics';
import { freeSpot } from './placement';

/**
 * Candidate single actions for the ranking, enumerated from the design and its network result:
 * - every exterior window: open fully / ajar / close (whichever it isn't already)
 * - every interior door: open / close
 * - every exhaust fan / range hood that is off: turn on
 * - an existing purifier: move to each other occupied room (visual centre, clear of furniture);
 *   switched off: turn on
 * - a purifier (catalogue CADR) added to each occupied room without one
 * - a pedestal fan in each stagnant occupied room, aimed at the room's outflow
 * - every PM2.5 source: stop it; move it next to an outlet window; cooking: use the hood (turn
 *   an existing hood on) or add one above it
 */

export type Effort = 'Free' | 'Low' | 'Purchase';

export interface Candidate {
  id: string;
  actions: ScenarioAction[];
  effort: Effort;
}

const COOKING = new Set(['gas-stove-frying', 'gas-stove-boiling', 'tawa-roti']);
const EFFORT_RANK: Record<Effort, number> = { Free: 0, Low: 1, Purchase: 2 };

/** The costlier of two efforts (a combination costs what its dearest part costs). */
export function maxEffort(a: Effort, b: Effort): Effort {
  return EFFORT_RANK[a] >= EFFORT_RANK[b] ? a : b;
}

/** Effort of a single action: open/close/move/stop are free, switching on a device you own is low, buying one is a purchase. */
export function effortOf(a: ScenarioAction): Effort {
  if (a.type === 'addDevice') return 'Purchase';
  if (a.type === 'toggleDevice' || a.type === 'setDeviceParam') return a.type === 'toggleDevice' && !a.enabled ? 'Free' : 'Low';
  return 'Free';
}

/** Point 0.4 m inside an opening's centre (world XZ) and the outward wall normal. */
function openingPoint(room: Room, op: Opening, inset = 0.4): { p: [number, number]; normal: [number, number] } | null {
  try {
    const seg = wallSegment(room, op.wallIndex);
    const u = op.offset + op.width / 2;
    return { p: [seg.a[0] + seg.dir[0] * u - seg.normal[0] * inset, seg.a[1] + seg.dir[1] * u - seg.normal[1] * inset], normal: seg.normal as [number, number] };
  } catch {
    return null;
  }
}

/** The opening a zone pushes most air out through (exterior or interior), from the network. */
function mainOutflow(net: NetworkResult, zone: number): string | null {
  let best: string | null = null;
  let q = 0;
  for (const p of net.paths) {
    const out = p.from === zone ? p.forwardM3s : p.to === zone ? p.backwardM3s : 0;
    if (p.openingId && out > q) {
      q = out;
      best = p.openingId;
    }
  }
  return best;
}

/** Ids of generated devices are stable, so the same candidate always hashes the same (voxel cache). */
const newId = (prefix: string, at: string) => `suggested-${prefix}-${at}`;

export function generateCandidates(rooms: readonly Room[], net: NetworkResult): Candidate[] {
  const out: Candidate[] = [];
  const add = (id: string, actions: ScenarioAction[]) => out.push({ id, actions, effort: actions.map(effortOf).reduce(maxEffort, 'Free' as Effort) });
  const occupied = rooms.filter((r) => occupancyWeight(r) >= OCCUPIED_WEIGHT_MIN);
  const allObjects = rooms.flatMap((r) => r.objects.map((o) => ({ o, room: r })));

  // Openings
  for (const room of rooms) {
    if (!room.id) continue;
    const interior = interiorOpeningIds(room, rooms.filter((r) => r !== room));
    for (const op of room.openings) {
      const f = isOpeningOpen(op) ? op.openFraction : 0;
      const targets = interior.has(op.id) ? [1, 0] : op.type === 'window' ? [1, WINDOW_AJAR_FRACTION, 0] : [];
      for (const t of targets) if (Math.abs(t - f) > 0.05) add(`opening:${op.id}:${t}`, [{ type: 'setOpening', roomId: room.id, openingId: op.id, openFraction: t }]);
    }
  }

  // Exhaust devices and purifiers
  for (const { o, room } of allObjects) {
    const d = deviceFor(o);
    if (!d || !room.id) continue;
    if (d.role === 'exhaust' && !d.enabled) add(`on:${o.id}`, [{ type: 'toggleDevice', roomId: room.id, objectId: o.id, enabled: true }]);
    if (d.role === 'clean') {
      if (!d.enabled) add(`on:${o.id}`, [{ type: 'toggleDevice', roomId: room.id, objectId: o.id, enabled: true }]);
      for (const target of occupied) {
        if (target.id === room.id || !target.id) continue;
        const spot = freeSpot(target, Math.max(o.size[0], o.size[2]) / 2);
        if (spot) add(`move:${o.id}:${target.id}`, [{ type: 'moveObject', roomId: room.id, objectId: o.id, toRoomId: target.id, position: [spot[0], o.position[1], spot[1]] }]);
      }
    }
  }

  // New purifiers in occupied rooms without a working one
  const purifier = getCatalogAsset('air-purifier');
  for (const target of occupied) {
    if (!target.id || target.objects.some((o) => deviceFor(o)?.role === 'clean' && o.enabled !== false)) continue;
    const spot = freeSpot(target, Math.max(purifier?.size[0] ?? 0.4, purifier?.size[2] ?? 0.4) / 2);
    if (spot) add(`add-purifier:${target.id}`, [{ type: 'addDevice', roomId: target.id, objectId: newId('purifier', target.id), kind: 'purifier', assetId: 'air-purifier', position: [spot[0], 0, spot[1]] }]);
  }

  // Pedestal fans in stagnant occupied rooms, aimed at the main outflow
  for (const target of occupied) {
    const zi = net.zones.findIndex((z) => z.roomId === target.id);
    if (zi < 0 || !target.id || net.zones[zi]!.ageMinutes <= STALE_AGE_MINUTES) continue;
    const spot = freeSpot(target, 0.25);
    const outId = mainOutflow(net, zi);
    const holder = rooms.find((r) => r.openings.some((op) => op.id === outId));
    const op = holder?.openings.find((x) => x.id === outId);
    const aim = holder && op ? openingPoint(holder, op, 0)?.p : null;
    if (!spot) continue;
    const rotationY = aim ? Math.atan2(aim[0] - spot[0], aim[1] - spot[1]) : 0;
    add(`add-fan:${target.id}`, [{ type: 'addDevice', roomId: target.id, objectId: newId('fan', target.id), kind: 'pedestalFan', assetId: 'pedestal-fan', position: [spot[0], 0, spot[1]], rotationY }]);
  }

  // Sources
  for (const { o, room } of allObjects) {
    const p = placedSourceParams(o);
    if (!p || !p.enabled || p.rateUgMin <= 0 || !room.id) continue;
    add(`stop:${o.id}`, [{ type: 'setSource', roomId: room.id, sourceId: o.id, enabled: false }]);
    // Next to the window this room breathes out through
    const zi = net.zones.findIndex((z) => z.roomId === room.id);
    const outlet = net.paths
      .filter((x) => x.to < 0 && x.from === zi && x.kind === 'window' && x.forwardM3s > x.backwardM3s)
      .sort((a, b) => b.forwardM3s - a.forwardM3s)[0];
    const win = outlet && room.openings.find((x) => x.id === outlet.openingId);
    const at = win && openingPoint(room, win);
    if (at) add(`move-source:${o.id}`, [{ type: 'moveObject', roomId: room.id, objectId: o.id, position: [at.p[0], o.position[1], at.p[1]] }]);
    if (COOKING.has(p.preset)) {
      const hood = room.objects.find((x: SceneObject) => deviceFor(x)?.kind === 'rangeHood');
      if (hood && hood.enabled === false) {
        add(`hood:${o.id}`, [
          { type: 'toggleDevice', roomId: room.id, objectId: hood.id, enabled: true },
          ...(Math.hypot(hood.position[0] - o.position[0], hood.position[2] - o.position[2]) > 0.3 ? [{ type: 'moveObject' as const, roomId: room.id, objectId: o.id, position: [hood.position[0], o.position[1], hood.position[2]] as [number, number, number] }] : []),
        ]);
      } else if (!hood) {
        add(`add-hood:${o.id}`, [{ type: 'addDevice', roomId: room.id, objectId: newId('hood', o.id), kind: 'rangeHood', assetId: 'range-hood', position: [o.position[0], 1.6, o.position[2]] }]);
      }
    }
  }
  return out;
}

