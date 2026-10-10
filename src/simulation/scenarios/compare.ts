import type { Room } from '../../core/schema';
import { percentile } from '../viz/colormap';
import type { GridInfo } from '../voxel/analysis';
import type { HouseMetrics, Objective, RoomValues } from './metrics';

export type CompareMetric = 'pm25' | 'age' | 'ach';

export interface RoomComparison {
  roomId: string;
  name: string;
  a: number;
  b: number;
  delta: number;
  fraction: number;
  /** Lower is better for PM2.5 and age, higher for air changes */
  better: boolean | null;
}

const valueOf = (r: RoomValues, m: CompareMetric) => (m === 'pm25' ? r.pm25 : m === 'age' ? r.ageMinutes : r.ach);

/** Per-room A → B for a metric, in A's room order. `better` is null when the change is negligible. */
export function compareRooms(a: HouseMetrics, b: HouseMetrics, metric: CompareMetric, minFraction = 0.01): RoomComparison[] {
  return a.rooms.map((ra) => {
    const rb = b.rooms.find((x) => x.roomId === ra.roomId);
    const va = valueOf(ra, metric);
    const vb = rb ? valueOf(rb, metric) : NaN;
    const delta = vb - va;
    const fraction = va !== 0 ? delta / Math.abs(va) : 0;
    const lowerIsBetter = metric !== 'ach';
    return { roomId: ra.roomId, name: ra.name, a: va, b: vb, delta, fraction, better: Math.abs(fraction) < minFraction ? null : lowerIsBetter ? delta < 0 : delta > 0 };
  });
}

const GERUND: Record<string, string> = {
  Close: 'Closing',
  Open: 'Opening',
  Leave: 'Leaving',
  Turn: 'Turning',
  Move: 'Moving',
  Add: 'Adding',
  Remove: 'Removing',
  Stop: 'Stopping',
  Start: 'Starting',
  Set: 'Setting',
  Run: 'Running',
};

/** "Closing the east window and turning on the purifier" from action texts (or the scenario name). */
export function actionPhrase(texts: readonly string[], name?: string): string {
  if (texts.length === 0) return name ? `"${name}"` : 'This scenario';
  if (texts.length > 2) return name ? `"${name}" (${texts.length} changes)` : `These ${texts.length} changes`;
  return texts
    .map((t, i) => {
      const [verb, ...rest] = t.split(' ');
      const g = GERUND[verb!] ?? verb!;
      return [i === 0 ? g : g.toLowerCase(), ...rest].join(' ');
    })
    .join(' and ');
}

const r0 = (n: number) => Math.round(n).toString();
const signedPct = (f: number) => `${f <= 0 ? '−' : '+'}${Math.abs(Math.round(f * 100))}%`;

/**
 * One-line verdict from the numbers, e.g. "Closing both windows and running the purifier cuts
 * Bedroom 1 PM2.5 from 176 to 41 µg/m³ (−77%)". The subject is the focus room when it changes, else
 * the room that changes most (occupied rooms for PM2.5), with the house figure alongside. `metric`
 * 'age' speaks of the age of air instead (the Ventilation view).
 */
export function verdict(texts: readonly string[], a: HouseMetrics, b: HouseMetrics, objective: Objective, name?: string, metric: 'pm25' | 'age' = 'pm25'): string {
  const subject = actionPhrase(texts, name);
  const rooms = compareRooms(a, b, metric);
  const what = metric === 'pm25' ? 'PM2.5' : 'air age';
  const unit = metric === 'pm25' ? 'µg/m³' : 'min';
  const eligible = rooms.filter((r) => metric === 'age' || (a.rooms.find((x) => x.roomId === r.roomId)?.weight ?? 0) >= 0.5);
  const biggest = [...eligible].sort((x, y) => Math.abs(y.fraction) - Math.abs(x.fraction))[0];
  const focusRoom = objective.kind === 'room' ? rooms.find((r) => r.roomId === objective.roomId) : undefined;
  const largestDelta = [...eligible].sort((x, y) => Math.abs(y.delta) - Math.abs(x.delta))[0];
  // Air age: the room whose air changes most is the story; PM2.5: the focus room when it moves
  const focus = metric === 'age' ? largestDelta : focusRoom && Math.abs(focusRoom.fraction) >= 0.05 ? focusRoom : objective.kind === 'room' ? biggest : largestDelta;
  const houseA = metric === 'pm25' ? a.weightedPm25 : a.meanAgeMinutes;
  const houseB = metric === 'pm25' ? b.weightedPm25 : b.meanAgeMinutes;
  const houseF = (houseB - houseA) / Math.max(1e-9, houseA);
  if (!focus || Math.abs(focus.fraction) < 0.01) {
    if (Math.abs(houseF) < 0.01) return `${subject} barely changes ${what} anywhere in the house.`;
    return `${subject} ${houseF < 0 ? 'cuts' : 'raises'} the house's ${metric === 'pm25' ? 'occupancy-weighted PM2.5' : 'mean air age'} from ${r0(houseA)} to ${r0(houseB)} ${unit} (${signedPct(houseF)}).`;
  }
  const verb = focus.delta < 0 ? 'cuts' : 'raises';
  const house = objective.kind === 'house' ? `; house ${signedPct(houseF)}` : '';
  return `${subject} ${verb} ${focus.name} ${what} from ${r0(focus.a)} to ${r0(focus.b)} ${unit} (${signedPct(focus.fraction)}${house}).`;
}

/** b − a per cell (NaN where either is). */
export function differenceField(a: ArrayLike<number>, b: ArrayLike<number>): Float32Array {
  const out = new Float32Array(a.length);
  for (let i = 0; i < a.length; i++) out[i] = b[i]! - a[i]!;
  return out;
}

/** Symmetric colour domain for a difference field: ±98th percentile of |Δ|, at least `floor`. */
export function differenceDomain(diff: ArrayLike<number>, floor = 1): [number, number] {
  const abs = Float32Array.from(diff as ArrayLike<number>, (v) => (Number.isFinite(v) ? Math.abs(v) : NaN));
  const m = Math.max(floor, percentile(abs, 0.98) || 0);
  return [-m, m];
}

/**
 * A cell field holding each room's value uniformly (cells whose centre is inside the room outline;
 * NaN elsewhere): stands in for a side of the comparison that has only a network result.
 */
export function roomUniformField(grid: GridInfo, rooms: readonly Room[], valueOf: (room: Room) => number, cellRoom: Int32Array): Float32Array {
  const out = new Float32Array(grid.nx * grid.ny * grid.nz).fill(NaN);
  const vals = rooms.map(valueOf);
  for (let k = 0; k < grid.nz; k++)
    for (let i = 0; i < grid.nx; i++) {
      const r = cellRoom[k * grid.nx + i]!;
      if (r < 0) continue;
      for (let j = 0; j < grid.ny; j++) out[i + grid.nx * (j + grid.ny * k)] = vals[r]!;
    }
  return out;
}
