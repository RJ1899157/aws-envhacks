import type { Room } from '../../core/schema';
import { INDIA_NAAQS_PM25_24H, OCCUPANCY_WEIGHTS, OCCUPIED_WEIGHT_MIN, WHO_2021_PM25_24H } from '../constants';
import type { NetworkResult } from '../house/network';
import { sliceCellRooms } from '../viz/stagnation';
import type { VoxelSimResult } from '../voxel/solver';

/**
 * House-level metrics: the one function behind the scenario comparison, the ranked actions and
 * the compare view. PM2.5 values are steady state with every source on (what the room chips show),
 * from the network model or, when a current voxel result exists, its breathing-zone room means.
 */

export interface RoomValues {
  roomId: string;
  name: string;
  /** PM2.5 in the breathing zone (µg/m³, steady) */
  pm25: number;
  ageMinutes: number;
  ach: number;
  volumeM3: number;
  weight: number;
}

export interface HouseMetrics {
  source: 'network' | 'voxel';
  /** Occupancy-weighted breathing-zone PM2.5 (µg/m³) */
  weightedPm25: number;
  /** Share of the house's air volume above India's 24-h NAAQS (60) and the WHO 24-h guideline (15) */
  fracAboveNaaqs: number;
  fracAboveWho: number;
  worstRoom: { roomId: string; name: string; pm25: number };
  /** Volume-weighted mean age of air (min) */
  meanAgeMinutes: number;
  /** Time (s) until every occupied room is below 60 µg/m³; 0 = never above, null = not within the run */
  timeBelowNaaqsS: number | null;
  rooms: RoomValues[];
}

/** What a ranking optimises: the occupancy-weighted house, or one room. */
export type Objective = { kind: 'house' } | { kind: 'room'; roomId: string };

/** Occupancy weight of a room: its own `occupancyWeight`, else the default for its type. */
export function occupancyWeight(room: Pick<Room, 'type' | 'occupancyWeight'>): number {
  if (room.occupancyWeight !== undefined) return room.occupancyWeight;
  return OCCUPANCY_WEIGHTS[room.type ?? 'basic'] ?? OCCUPANCY_WEIGHTS.basic;
}

/** Occupancy-weighted mean of the rooms' PM2.5 (plain mean if every weight is 0). */
export function weightedPm25(rooms: readonly RoomValues[], weights?: (r: RoomValues) => number): number {
  const w = weights ?? ((r: RoomValues) => r.weight);
  let sw = 0;
  let s = 0;
  for (const r of rooms) {
    sw += w(r);
    s += w(r) * r.pm25;
  }
  return sw > 0 ? s / sw : rooms.reduce((a, r) => a + r.pm25, 0) / Math.max(1, rooms.length);
}

/** The objective's value: house-weighted PM2.5, or the focus room's PM2.5. */
export function objectiveValue(m: HouseMetrics, objective: Objective): number {
  if (objective.kind === 'room') return m.rooms.find((r) => r.roomId === objective.roomId)?.pm25 ?? m.weightedPm25;
  return m.weightedPm25;
}

function timeBelow(net: NetworkResult, rooms: readonly Room[]): number | null {
  let worst = 0;
  for (const z of net.zones) {
    const room = rooms.find((r) => r.id === z.roomId) ?? net.house.zones[z.index]!.room;
    if (occupancyWeight(room) < OCCUPIED_WEIGHT_MIN) continue;
    const th = z.thresholds.find((t) => t.valueUgM3 === INDIA_NAAQS_PM25_24H);
    if (!th) continue;
    if (th.crossing === 'falls-below' && th.timeS !== null) worst = Math.max(worst, th.timeS);
    else if (th.initiallyAbove || th.crossing === 'rises-above') return null;
  }
  return worst;
}

function assemble(source: HouseMetrics['source'], rooms: RoomValues[], fracAboveNaaqs: number, fracAboveWho: number, timeBelowNaaqsS: number | null): HouseMetrics {
  const worst = rooms.reduce((a, r) => (r.pm25 > a.pm25 ? r : a), rooms[0] ?? { roomId: '', name: '', pm25: NaN, ageMinutes: 0, ach: 0, volumeM3: 0, weight: 0 });
  const vol = rooms.reduce((a, r) => a + r.volumeM3, 0);
  return {
    source,
    weightedPm25: weightedPm25(rooms),
    fracAboveNaaqs,
    fracAboveWho,
    worstRoom: { roomId: worst.roomId, name: worst.name, pm25: worst.pm25 },
    meanAgeMinutes: vol > 0 ? rooms.reduce((a, r) => a + r.ageMinutes * r.volumeM3, 0) / vol : NaN,
    timeBelowNaaqsS,
    rooms,
  };
}

/** Metrics from the network model (well-mixed rooms: breathing zone = room value). */
export function networkMetrics(net: NetworkResult): HouseMetrics {
  const roomsIn = net.house.zones.map((z) => z.room);
  const rooms: RoomValues[] = net.zones.map((z, i) => ({
    roomId: z.roomId,
    name: z.name,
    pm25: z.cssUgM3,
    ageMinutes: z.ageMinutes,
    ach: z.achOutdoor,
    volumeM3: z.volumeM3,
    weight: occupancyWeight(net.house.zones[i]!.room),
  }));
  const vol = rooms.reduce((a, r) => a + r.volumeM3, 0) || 1;
  const above = (t: number) => rooms.filter((r) => r.pm25 > t).reduce((a, r) => a + r.volumeM3, 0) / vol;
  return assemble('network', rooms, above(INDIA_NAAQS_PM25_24H), above(WHO_2021_PM25_24H), timeBelow(net, roomsIn));
}

/**
 * Metrics from a voxel result: per-room means over the breathing zone (cells whose centre is in
 * the room outline, between the breathing heights), volume shares over every fluid cell. Air
 * changes and the time to fall below 60 come from the network (`net`), which the voxel run doesn't
 * resolve per room.
 */
export function voxelMetrics(result: VoxelSimResult, rooms: readonly Room[], net: NetworkResult): HouseMetrics {
  const g = result.grid;
  const cellRoom = sliceCellRooms(g, rooms.map((r) => r.outline));
  const [h0, h1] = result.breathingZone.heightM;
  const j0 = Math.max(0, Math.floor((h0 - g.origin[1]) / g.dx));
  const j1 = Math.min(g.ny - 1, Math.floor((h1 - g.origin[1]) / g.dx));
  const sum = new Float64Array(rooms.length);
  const cnt = new Float64Array(rooms.length);
  const field = result.pm25.steady;
  let fluid = 0;
  let a60 = 0;
  let a15 = 0;
  for (let k = 0; k < g.nz; k++)
    for (let j = 0; j < g.ny; j++)
      for (let i = 0; i < g.nx; i++) {
        const v = field[i + g.nx * (j + g.ny * k)]!;
        const r = cellRoom[k * g.nx + i]!;
        if (!Number.isFinite(v) || r < 0) continue;
        fluid++;
        if (v > INDIA_NAAQS_PM25_24H) a60++;
        if (v > WHO_2021_PM25_24H) a15++;
        if (j >= j0 && j <= j1) {
          sum[r] = sum[r]! + v;
          cnt[r] = cnt[r]! + 1;
        }
      }
  const netRooms = networkMetrics(net).rooms;
  const values: RoomValues[] = rooms.map((room, ri) => {
    const nz = netRooms.find((n) => n.roomId === room.id);
    const vz = result.zones.find((z) => z.roomId === room.id);
    return {
      roomId: room.id ?? `room-${ri}`,
      name: room.name,
      pm25: cnt[ri]! > 0 ? sum[ri]! / cnt[ri]! : (vz?.voxelPm25Steady ?? nz?.pm25 ?? NaN),
      ageMinutes: vz?.voxelAgeMinutes ?? nz?.ageMinutes ?? NaN,
      ach: nz?.ach ?? NaN,
      volumeM3: nz?.volumeM3 ?? vz?.volumeM3 ?? 0,
      weight: occupancyWeight(room),
    };
  });
  return assemble('voxel', values, fluid > 0 ? a60 / fluid : 0, fluid > 0 ? a15 / fluid : 0, timeBelow(net, rooms));
}
