import { getCatalogAsset } from '../core/catalog';
import type { Pm25ScheduleWindow, Pm25Source, Room, SceneObject } from '../core/schema';
import { PM25_SOURCE_PRESETS, type Pm25SourcePresetId } from './constants';
import { deviceKindOf } from './devices';

/**
 * PM2.5 sources of a room: the room-level list (`params.pm25Sources`, spread evenly through the
 * room unless attached to an object) plus placed source objects (device 'pm25Source'), which emit
 * into a small volume at their position and emission height.
 */

export interface PlacedSourceParams {
  preset: Pm25SourcePresetId;
  label: string;
  rateUgMin: number;
  /** Emission height above the floor (m) */
  heightM: number;
  schedule: Pm25ScheduleWindow[];
  enabled: boolean;
}

const PRESET_BY_ASSET = new Map(Object.entries(PM25_SOURCE_PRESETS).map(([id, p]) => [p.assetId as string, id as Pm25SourcePresetId]));

export function isPm25SourceObject(obj: SceneObject): boolean {
  return deviceKindOf(obj) === 'pm25Source';
}

/** Preset of a source object: explicit `sourcePreset`, else its asset, else frying. */
export function sourcePresetOf(obj: SceneObject): Pm25SourcePresetId {
  const explicit = obj.sourcePreset as Pm25SourcePresetId | undefined;
  if (explicit && explicit in PM25_SOURCE_PRESETS) return explicit;
  return PRESET_BY_ASSET.get(obj.assetId) ?? 'gas-stove-frying';
}

/**
 * How far above its own base a source emits (m): the preset's emission height minus the height its
 * catalogue marker usually sits at (a pan 0.1 m above the hob, an incense tip 0.3 m above its stand).
 */
export function emissionOffsetM(preset: Pm25SourcePresetId): number {
  const def = PM25_SOURCE_PRESETS[preset];
  const usualBase = getCatalogAsset(def.assetId)?.elevation ?? 0;
  return Math.max(0.02, def.heightM - usualBase);
}

/** Resolved parameters of a placed source (object fields override the preset). Null for non-sources. */
export function placedSourceParams(obj: SceneObject): PlacedSourceParams | null {
  if (!isPm25SourceObject(obj)) return null;
  const preset = sourcePresetOf(obj);
  const def = PM25_SOURCE_PRESETS[preset];
  return {
    preset,
    label: def.label,
    rateUgMin: obj.emissionRateUgMin ?? def.rateUgMin,
    // Emits from where it actually rests (floor, counter, shelf…), unless set explicitly
    heightM: obj.emissionHeightM ?? (obj.position[1] ?? 0) + (obj.elevation ?? 0) + emissionOffsetM(preset),
    schedule: obj.sourceSchedule ?? [],
    enabled: obj.enabled !== false,
  };
}

/** Enabled placed sources of a room as Pm25Source entries with a world position [x, height, z]. */
export function placedSources(room: Room): Pm25Source[] {
  const out: Pm25Source[] = [];
  for (const obj of room.objects) {
    const p = placedSourceParams(obj);
    if (!p || !p.enabled || p.rateUgMin <= 0) continue;
    out.push({
      id: obj.id,
      label: obj.name || p.label,
      kind: p.preset,
      emissionRateUgMin: p.rateUgMin,
      ...(p.schedule.length > 0 && { schedule: p.schedule }),
      position: [obj.position[0], p.heightM, obj.position[2]],
    });
  }
  return out;
}

/** Every PM2.5 source of a room: room-level ones first, then placed ones. */
export function roomPm25Sources(room: Room): Pm25Source[] {
  return [...(room.params.pm25Sources ?? []), ...placedSources(room)];
}

/**
 * Whether a source emits at time t (s). `null` asks about the steady state, which assumes every
 * source is on (a scheduled source's "if it kept going" level).
 */
export function sourceActiveAt(src: Pick<Pm25Source, 'schedule'>, tS: number | null): boolean {
  if (tS === null || !src.schedule || src.schedule.length === 0) return true;
  const tMin = tS / 60;
  return src.schedule.some((w) => tMin >= w.startMin && tMin < w.startMin + w.durationMin);
}

export interface SourceEvent {
  tS: number;
  label: string;
  kind: 'start' | 'end';
}

/** Start/end events of scheduled sources across rooms, for the playback timeline. */
export function sourceEvents(rooms: readonly Room[], durationS: number): SourceEvent[] {
  const events: SourceEvent[] = [];
  for (const room of rooms)
    for (const src of roomPm25Sources(room)) {
      const name = src.label ?? 'Source';
      for (const w of src.schedule ?? []) {
        if (w.startMin * 60 <= durationS) events.push({ tS: w.startMin * 60, label: `${name} starts`, kind: 'start' });
        const end = (w.startMin + w.durationMin) * 60;
        if (end < durationS) events.push({ tS: end, label: `${name} stops`, kind: 'end' });
      }
    }
  return events.sort((a, b) => a.tS - b.tS);
}
