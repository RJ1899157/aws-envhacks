import type { Room, ScenarioAction } from '../../core/schema';
import { ACTION_MIN_DELTA_FRACTION, ACTION_MIN_DELTA_UGM3 } from '../constants';
import type { NetworkResult } from '../house/network';
import { roomCause } from '../viz/explain';
import { actionTarget, applyActions, describeAction, roomOfObject } from './actions';
import { evaluateDesign, type Evaluation } from './evaluate';
import { generateCandidates, maxEffort, type Candidate, type Effort } from './generate';
import { objectiveValue, type HouseMetrics, type Objective } from './metrics';

/**
 * Ranked actions: every candidate scored with the network model on the objective (house-weighted
 * PM2.5 or one room's), the top singles combined in pairs, near-zero changes dropped, and anything
 * that makes the objective worse listed separately under "Avoid". Each result carries structured
 * data for later explanation (actions, deltas per room, effort, supporting facts).
 */

export interface RoomDelta {
  roomId: string;
  name: string;
  before: number;
  after: number;
  delta: number;
  /** delta / before */
  fraction: number;
}

export interface RankedAction {
  id: string;
  actions: ScenarioAction[];
  /** Plain-language text of each action */
  texts: string[];
  effort: Effort;
  /** Objective after − before (µg/m³; negative = better) */
  delta: number;
  fraction: number;
  before: number;
  after: number;
  /** Rooms whose PM2.5 changes by more than the near-zero threshold, largest change first */
  roomDeltas: RoomDelta[];
  metricsAfter: HouseMetrics;
  /** Supporting facts from the network and explain.ts, e.g. "outdoor 250 > indoor 176 (Living Room)" */
  facts: string[];
  /** Voxel check: pending until run; then whether the voxel solver agrees on the direction */
  verified: 'unverified' | 'pending' | 'verified' | 'disagrees';
  voxelDelta?: number;
}

export interface Ranking {
  objective: Objective;
  baseline: Evaluation;
  baselineValue: number;
  /** Improvements, best first */
  better: RankedAction[];
  /** Changes that make the objective worse, worst first */
  avoid: RankedAction[];
  candidates: number;
  evaluated: number;
  runtimeMs: number;
  /** Wall time of the background voxel verification so far (ms) */
  verifyMs?: number;
}

export interface RankOptions {
  objective?: Objective;
  durationS?: number;
  /** Singles combined in pairs */
  pairTop?: number;
  minDeltaUgM3?: number;
  minDeltaFraction?: number;
  /** Candidates to score instead of the generated ones (tests) */
  candidates?: Candidate[];
}

const r0 = (n: number) => Math.round(n).toString();

/** What two actions must not both change: the same opening/object, or a second purifier for one room. */
function conflictKeys(a: ScenarioAction): string[] {
  const keys = [actionTarget(a)];
  if (a.type === 'addDevice' && a.kind === 'purifier') keys.push(`purifier-in:${a.roomId}`);
  if (a.type === 'moveObject' && a.toRoomId && a.objectId.includes('purifier')) keys.push(`purifier-in:${a.toRoomId}`);
  return keys;
}

/** Rooms an action set touches (where to look for the supporting facts). */
function touchedRooms(actions: readonly ScenarioAction[], rooms: readonly Room[]): string[] {
  const ids = new Set<string>();
  for (const a of actions) {
    ids.add(a.roomId);
    if (a.type === 'moveObject' && a.toRoomId) ids.add(a.toRoomId);
    if (a.type !== 'setOpening' && a.type !== 'addDevice') {
      const holder = roomOfObject(rooms, a.type === 'setSource' ? a.sourceId : a.objectId);
      if (holder?.id) ids.add(holder.id);
    }
  }
  return [...ids];
}

/** Facts behind a result: outdoor vs indoor levels, the main inter-room flows, air changes, and explain.ts's cause. */
export function supportingFacts(net: NetworkResult, actions: readonly ScenarioAction[], rooms: readonly Room[], mostAffected: string | null): string[] {
  const facts: string[] = [];
  const touched = touchedRooms(actions, rooms);
  const outdoor = net.outdoorUgM3;
  for (const id of touched) {
    const z = net.zones.find((x) => x.roomId === id);
    if (!z) continue;
    if (actions.some((a) => a.type === 'setOpening')) facts.push(`outdoor ${r0(outdoor)} ${outdoor > z.cssUgM3 ? '>' : '<'} indoor ${r0(z.cssUgM3)} µg/m³ (${z.name})`);
    facts.push(`${z.name}: ${z.achOutdoor.toFixed(1)} outdoor-air changes/h`);
    const flows = net.paths
      .filter((p) => p.to >= 0 && (p.from === z.index || p.to === z.index))
      .map((p) => ({ p, q: Math.max(p.forwardM3s, p.backwardM3s), fwd: p.forwardM3s >= p.backwardM3s }))
      .sort((a, b) => b.q - a.q)[0];
    if (flows && flows.q * 3600 > 5) {
      const [a, b] = flows.fwd ? [flows.p.from, flows.p.to] : [flows.p.to, flows.p.from];
      facts.push(`${net.zones[a]!.name} → ${net.zones[b]!.name} ${r0(flows.q * 3600)} m³/h`);
    }
  }
  const zi = mostAffected ? net.zones.findIndex((z) => z.roomId === mostAffected) : -1;
  if (zi >= 0) facts.push(`${net.zones[zi]!.name}: ${roomCause(net, zi, 'pollution')}`);
  return [...new Set(facts)];
}

function score(base: Evaluation, objective: Objective, candidate: Candidate, durationS: number, minAbs: number, minFrac: number): RankedAction {
  const design = applyActions(base.rooms, candidate.actions);
  const ev = evaluateDesign(design, durationS);
  const before = objectiveValue(base.metrics, objective);
  const after = objectiveValue(ev.metrics, objective);
  const roomDeltas: RoomDelta[] = ev.metrics.rooms
    .map((r) => {
      const b = base.metrics.rooms.find((x) => x.roomId === r.roomId);
      const bv = b?.pm25 ?? NaN;
      return { roomId: r.roomId, name: r.name, before: bv, after: r.pm25, delta: r.pm25 - bv, fraction: bv > 0 ? (r.pm25 - bv) / bv : 0 };
    })
    .filter((d) => Math.abs(d.delta) >= minAbs && Math.abs(d.fraction) >= minFrac)
    .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));
  return {
    id: candidate.id,
    actions: candidate.actions,
    texts: candidate.actions.map((a) => describeAction(a, base.rooms)),
    effort: candidate.effort,
    delta: after - before,
    fraction: before > 0 ? (after - before) / before : 0,
    before,
    after,
    roomDeltas,
    metricsAfter: ev.metrics,
    facts: supportingFacts(base.network, candidate.actions, base.rooms, roomDeltas[0]?.roomId ?? null),
    verified: 'unverified',
  };
}

const EFFORT_ORDER: Record<Effort, number> = { Free: 0, Low: 1, Purchase: 2 };

/** Best first; near-equal deltas put the cheaper effort first. */
function byDeltaThenEffort(a: RankedAction, b: RankedAction): number {
  if (Math.abs(a.delta - b.delta) > 0.1) return a.delta - b.delta;
  return EFFORT_ORDER[a.effort] - EFFORT_ORDER[b.effort];
}

/**
 * Drops results that repeat a better-ranked one: same effect (within 0.2 µg/m³) while sharing an
 * action or reading the same bar the ordinal (the first or the second of two north windows).
 */
const generic = (texts: readonly string[]) => texts.map((t) => t.replace(/\b(first|second|third|fourth) /g, '')).sort().join('|');

function dedupe(list: RankedAction[]): RankedAction[] {
  const out: RankedAction[] = [];
  for (const r of list) {
    const keys = new Set(r.actions.map((a) => JSON.stringify(a)));
    const gist = generic(r.texts);
    const twin = out.find((o) => Math.abs(o.delta - r.delta) < 0.2 && (o.actions.some((a) => keys.has(JSON.stringify(a))) || generic(o.texts) === gist));
    if (!twin) out.push(r);
  }
  return out;
}

/** Scores, combines and ranks candidate actions for a design. */
export function rankActions(rooms: readonly Room[], opts: RankOptions = {}): Ranking {
  const t0 = performance.now();
  const objective = opts.objective ?? { kind: 'house' };
  const durationS = opts.durationS ?? 4 * 3600;
  const minAbs = opts.minDeltaUgM3 ?? ACTION_MIN_DELTA_UGM3;
  const minFrac = opts.minDeltaFraction ?? ACTION_MIN_DELTA_FRACTION;
  const base = evaluateDesign(rooms, durationS);
  const baselineValue = objectiveValue(base.metrics, objective);
  const candidates = opts.candidates ?? generateCandidates(rooms, base.network);
  const significant = (r: RankedAction) => Math.abs(r.delta) >= minAbs || Math.abs(r.fraction) >= minFrac;

  const singles = candidates.map((c) => score(base, objective, c, durationS, minAbs, minFrac)).filter(significant);
  let evaluated = candidates.length;
  const better = singles.filter((r) => r.delta < 0).sort(byDeltaThenEffort);
  const avoid = singles.filter((r) => r.delta > 0).sort((a, b) => b.delta - a.delta);

  // Pairs of the top singles that don't touch the same thing; kept when they beat both parts
  const top = better.slice(0, opts.pairTop ?? 5);
  const pairs: RankedAction[] = [];
  for (let i = 0; i < top.length; i++)
    for (let j = i + 1; j < top.length; j++) {
      const a = top[i]!;
      const b = top[j]!;
      const targets = new Set(a.actions.flatMap(conflictKeys));
      if (b.actions.some((x) => conflictKeys(x).some((k) => targets.has(k)))) continue;
      const pair = score(base, objective, { id: `${a.id}+${b.id}`, actions: [...a.actions, ...b.actions], effort: maxEffort(a.effort, b.effort) }, durationS, minAbs, minFrac);
      evaluated++;
      // Worth listing only if clearly better than the better part alone
      const bestPart = Math.min(a.delta, b.delta);
      if (pair.delta < bestPart - Math.max(2 * minAbs, 0.05 * Math.abs(bestPart))) pairs.push(pair);
    }
  const ranked = dedupe([...better, ...pairs].sort(byDeltaThenEffort));
  return { objective, baseline: base, baselineValue, better: ranked, avoid, candidates: candidates.length, evaluated, runtimeMs: performance.now() - t0 };
}

/** "−52% Bedroom 1 PM2.5" / "−18% house PM2.5" for a ranked result. */
export function deltaLabel(r: Pick<RankedAction, 'fraction'>, objective: Objective, roomName?: string): string {
  const sign = r.fraction <= 0 ? '−' : '+';
  const what = objective.kind === 'room' ? `${roomName ?? 'room'} PM2.5` : 'house PM2.5';
  return `${sign}${Math.abs(Math.round(r.fraction * 100))}% ${what}`;
}
