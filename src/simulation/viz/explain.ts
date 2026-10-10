import { totalFlow, type Device } from '../devices';
import type { NetworkResult } from '../house/network';
import { roomPm25Sources } from '../sources';
import { xzToBearing } from '../../core/wind';

const r0 = (n: number) => Math.round(n).toString();

/** Air flowing into zone `i` from each other zone (m³/s), from the network path flows. */
export function inflowsFrom(network: NetworkResult, i: number): Map<number, number> {
  const m = new Map<number, number>();
  for (const p of network.paths) {
    if (p.to < 0) continue;
    if (p.to === i && p.forwardM3s > 0) m.set(p.from, (m.get(p.from) ?? 0) + p.forwardM3s);
    if (p.from === i && p.backwardM3s > 0) m.set(p.to, (m.get(p.to) ?? 0) + p.backwardM3s);
  }
  return m;
}

/** The facts both explanations are built from (steady state, every source on). */
function roomFacts(network: NetworkResult, zoneIndex: number, devices: readonly Device[]) {
  const zone = network.zones[zoneIndex]!;
  const outdoor = network.outdoorUgM3;
  const css = zone.cssUgM3;
  const ratio = outdoor > 0 ? css / outdoor : 0;
  const purifierAch = (totalFlow(devices, 'clean') * 3600) / zone.volumeM3;
  const room = network.house.zones[zoneIndex]!.room;
  const ownSources = roomPm25Sources(room);

  // Biggest PM2.5 import from another room
  let neighbour: { index: number; name: string; flow: number; share: number } | null = null;
  const imports = inflowsFrom(network, zoneIndex);
  const gains = [...imports.entries()].map(([j, q]) => ({ j, q, mass: q * network.zones[j]!.cssUgM3 }));
  const totalIn = zone.totalInflowM3s * css;
  const top = gains.filter((g) => network.zones[g.j]!.cssUgM3 > css).sort((a, b) => b.mass - a.mass)[0];
  if (top && totalIn > 0) neighbour = { index: top.j, name: network.zones[top.j]!.name, flow: top.q, share: top.mass / totalIn };

  // Own emission against the biggest import from a dirtier room
  const ownUgS = ownSources.reduce((sum, src) => sum + src.emissionRateUgMin / 60, 0);
  const topOwn = [...ownSources].sort((x, y) => y.emissionRateUgMin - x.emissionRateUgMin)[0];
  const importUgS = top ? top.mass : 0;
  const ownDominates = !!topOwn && css > outdoor * 1.05 && ownUgS >= importUgS;
  return { zone, outdoor, css, ratio, purifierAch, hasPurifier: purifierAch > 0, room, imports, neighbour, topOwn, ownDominates };
}

/**
 * One or two plain-language sentences on what drives a room's PM2.5, e.g. "PM2.5 drifts in from the
 * Kitchen through the open door (~430 m³/h), keeping this room at about 210 µg/m³."
 */
export function explainRoom(network: NetworkResult, zoneIndex: number, devices: readonly Device[], stagnantAgeMinutes?: number | null): string {
  const { zone, outdoor, css, ratio, purifierAch, hasPurifier, neighbour, topOwn, ownDominates } = roomFacts(network, zoneIndex, devices);
  const pct = `${r0(ratio * 100)}% of outdoor`;
  let main: string;
  if (ownDominates && topOwn) {
    const label = topOwn.label ?? 'indoor source';
    main = `The ${label.toLowerCase()} in this room pushes PM2.5 to about ${r0(css)} µg/m³, ${(css / Math.max(outdoor, 1)).toFixed(1)}× the outdoor level.`;
  } else if (neighbour && neighbour.share > 0.3) {
    main = `PM2.5 drifts in from the ${neighbour.name} (~${r0(neighbour.flow * 3600)} m³/h), keeping this room at about ${r0(css)} µg/m³${topOwn ? ` (the ${(topOwn.label ?? 'source').toLowerCase()} here adds to it)` : ''}.`;
  } else if (zone.achOutdoor >= 5 && ratio >= 0.8) {
    main = `Most of this room is near outdoor levels because the openings change its air about ${r0(zone.achOutdoor)} times an hour${hasPurifier ? ', far more than the purifier can clean' : ''}.`;
  } else if (hasPurifier && ratio <= 0.35) {
    main = `The purifier keeps this room at about ${pct}: little outdoor air gets in (${zone.achOutdoor.toFixed(1)} air changes an hour against ${purifierAch.toFixed(1)} clean-air changes).`;
  } else if (hasPurifier) {
    main = `The purifier helps, but outdoor air comes in about as fast as it cleans (${zone.achOutdoor.toFixed(1)} vs ${purifierAch.toFixed(1)} changes an hour), so the room settles at about ${pct}.`;
  } else if (zone.achOutdoor < 1) {
    main = `With this room shut, only slow leaks bring outdoor air in (${zone.achOutdoor.toFixed(1)} changes an hour) and deposition removes some of it, so it settles at about ${pct}.`;
  } else {
    main = `PM2.5 settles at about ${r0(css)} µg/m³ (${pct}) with ${zone.achOutdoor.toFixed(1)} outdoor-air changes an hour.`;
  }

  if (stagnantAgeMinutes) main += ` Air goes stale in part of the room (about ${r0(stagnantAgeMinutes)} min old).`;
  return main;
}

export type CauseMode = 'pollution' | 'ventilation' | 'airflow';

const COMPASS_WORDS = ['north', 'north-east', 'east', 'south-east', 'south', 'south-west', 'west', 'north-west'];
const capital = (t: string) => t.charAt(0).toUpperCase() + t.slice(1);

/** The opening a network path runs through, with its type and (for outdoor openings) the facade it faces. */
function pathOpening(network: NetworkResult, pathId: string): { type: 'door' | 'window' | 'other'; facing: string | null } {
  const hp = network.house.paths.find((p) => p.id === pathId);
  const g = hp?.geometry;
  const op = g && hp?.openingId ? network.house.zones[g.room]?.room.openings.find((o) => o.id === hp.openingId) : undefined;
  const type = op?.type === 'door' ? 'door' : op?.type === 'window' ? 'window' : 'other';
  const facing = g && hp && hp.to < 0 ? COMPASS_WORDS[Math.round(xzToBearing(g.normal) / 45) % 8]! : null;
  return { type, facing };
}

/** Biggest outdoor-air inlet of a zone (an open window or door to outdoors), if any. */
function topOutdoorInlet(network: NetworkResult, i: number) {
  const inlets = network.paths.filter((p) => p.to < 0 && p.from === i && p.kind !== 'leak' && p.backwardM3s > 1e-5).sort((a, b) => b.backwardM3s - a.backwardM3s);
  const top = inlets[0];
  return top ? { flow: top.backwardM3s, ...pathOpening(network, top.id) } : null;
}

/** Whether the zone has any open window or door to outdoors (whichever way air moves through it). */
function hasOutdoorOpening(network: NetworkResult, i: number): boolean {
  return network.paths.some((p) => p.to < 0 && p.from === i && p.kind !== 'leak' && p.areaM2 > 0);
}

/** How air gets from zone j into zone i: "the open door", "the gap under the door", … */
function routeBetween(network: NetworkResult, i: number, j: number): string {
  const paths = network.paths.filter((p) => (p.from === i && p.to === j) || (p.from === j && p.to === i));
  const open = paths.filter((p) => p.kind === 'opening').sort((a, b) => b.forwardM3s + b.backwardM3s - (a.forwardM3s + a.backwardM3s))[0];
  if (open) {
    const t = pathOpening(network, open.id).type;
    return t === 'door' ? 'the open door' : t === 'window' ? 'the interior window' : 'the opening';
  }
  return paths.some((p) => p.kind === 'undercut') ? 'the gap under the door' : 'gaps between the rooms';
}

const inletWords = (inlet: NonNullable<ReturnType<typeof topOutdoorInlet>>) =>
  `the ${inlet.facing ? `${inlet.facing} ` : ''}${inlet.type === 'other' ? 'opening' : inlet.type}`;

/**
 * The dominant cause of a room's state in a few plain words, for the Insights list. Built from the
 * same facts as explainRoom, with the emphasis of the view mode:
 * - pollution: "Kitchen frying smoke drifts in through the open door"
 * - ventilation: "No window to outdoors, air ~40 min old"
 * - airflow: "Outdoor air entering through the east window"
 */
export function roomCause(network: NetworkResult, zoneIndex: number, mode: CauseMode, opts: { ageMinutes?: number | null } = {}): string {
  const devices = network.house.zones[zoneIndex]!.devices;
  const f = roomFacts(network, zoneIndex, devices);
  const inlet = topOutdoorInlet(network, zoneIndex);
  const outdoorOpen = hasOutdoorOpening(network, zoneIndex);
  const age = opts.ageMinutes ?? f.zone.ageMinutes;
  const exhaust = f.zone.exhaustM3s > 0;
  // A fan blowing outdoor air in, when it brings more than the biggest open window
  const supplyLeads = f.zone.supplyM3s > 0 && f.zone.supplyM3s >= (inlet?.flow ?? 0);
  // Biggest air supply from another room (any direction of PM2.5)
  const fromRooms = [...f.imports.entries()].sort((a, b) => b[1] - a[1])[0];
  const roomSupplyDominates = fromRooms && fromRooms[1] > (inlet?.flow ?? 0) && fromRooms[1] * 3600 > 0.5 * f.zone.volumeM3;

  if (mode === 'pollution') {
    if (f.ownDominates && f.topOwn) return `${capital((f.topOwn.label ?? 'Indoor source').toLowerCase())} smoke in this room`;
    if (f.hasPurifier && f.ratio <= 0.35) return 'Purifier cleans faster than polluted air gets in';
    if (f.neighbour && f.neighbour.share > 0.3) {
      const src = roomPm25Sources(network.house.zones[f.neighbour.index]!.room).sort((a, b) => b.emissionRateUgMin - a.emissionRateUgMin)[0];
      const what = src ? `${f.neighbour.name} ${(src.label ?? 'source').toLowerCase()} smoke` : `Polluted air from the ${f.neighbour.name}`;
      return `${what} drifts in through ${routeBetween(network, zoneIndex, f.neighbour.index)}`;
    }
    if (supplyLeads && f.ratio >= 0.8) return 'Outdoor air blown in by the fan (unfiltered)';
    if (inlet && f.ratio >= 0.8) return `Outdoor air entering through ${inletWords(inlet)}`;
    if (f.hasPurifier) return 'Purifier helps, but outdoor air comes in about as fast';
    if (!outdoorOpen) return 'Closed room: slow leaks bring outdoor air in';
    return inlet ? `Outdoor air through ${inletWords(inlet)}` : 'Mostly outdoor air';
  }

  if (mode === 'ventilation') {
    const old = age >= 60;
    if (supplyLeads && !old) return 'Fresh outdoor air blown in by the fan';
    if (inlet && !old) return `Fresh outdoor air through ${inletWords(inlet)}`;
    if (roomSupplyDominates && !old) return `Air arrives second-hand from the ${network.zones[fromRooms[0]]!.name}`;
    if (!outdoorOpen) return `No window open to outdoors, air ~${r0(age)} min old`;
    return `Window open but little air moves through, air ~${r0(age)} min old`;
  }

  // airflow
  if (supplyLeads && !roomSupplyDominates) return `Fan blows outdoor air in; it leaves through ${outdoorOpen ? 'the open windows' : 'gaps around doors and windows'}`;
  if (inlet && !roomSupplyDominates) return `Outdoor air entering through ${inletWords(inlet)}`;
  if (roomSupplyDominates) return `Air comes mostly from the ${network.zones[fromRooms[0]]!.name} through ${routeBetween(network, zoneIndex, fromRooms[0])}`;
  if (exhaust) return 'Exhaust fan blows room air out; fresh air leaks in to replace it';
  return outdoorOpen ? 'Openings face away from the wind: little air moves' : 'Only slow leaks: no open window or door';
}
