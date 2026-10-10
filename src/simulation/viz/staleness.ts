import type { Room } from '../../core/schema';

/** Settings that change the solver output but are not part of the design. */
export interface SimulationSettings {
  durationS: number;
  resolution: 'live' | 'full';
}

/** Object / room fields with no effect on the airflow (names, colours, lock and visibility flags). */
const COSMETIC_KEYS = new Set(['name', 'color', 'isLocked', 'isHidden', 'floorMaterial', 'wallMaterial', 'datetime', 'humidity', 'pressurePa', 'flipHinge', 'flipSwing', 'subType', 'type', 'scenarios', 'occupancyWeight']);

function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([k, v]) => v !== undefined && !COSMETIC_KEYS.has(k))
      .sort(([a], [b]) => (a < b ? -1 : 1));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stable(v)}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

/** FNV-1a hash of a string, base 36. */
function hash(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36);
}

/**
 * Fingerprint of everything a whole-house result depends on: every room (minus cosmetic fields), in
 * an order-independent way, the primary room's environment (wind, temperatures, outdoor PM2.5 come
 * from it) and the run settings. A stored result is out of date when its key differs.
 */
export function simulationInputKey(room: Room, neighbours: readonly Room[], settings: SimulationSettings): string {
  const rooms = [room, ...neighbours].map((r) => stable(r)).sort();
  return hash(stable({ rooms, primaryParams: room.params, settings }));
}

export function isResultStale(resultKey: string | null, currentKey: string): boolean {
  return resultKey !== null && resultKey !== currentKey;
}
