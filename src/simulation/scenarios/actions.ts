import { produce } from 'immer';
import { getCatalogAsset } from '../../core/catalog';
import { wallSegment } from '../../core/parser';
import type { Opening, Room, Scenario, ScenarioAction, SceneObject } from '../../core/schema';
import { xzToBearing } from '../../core/wind';
import { deviceKindOf } from '../devices';
import { interiorOpeningIds, isOpeningOpen } from '../geometry';
import { isPm25SourceObject, placedSourceParams } from '../sources';

/**
 * Scenario actions: pure functions over a design (the house's rooms, active room first, the order
 * the network model takes). Nothing here mutates its input; every apply returns new rooms with
 * structural sharing. An action whose target is missing (deleted since) is skipped.
 */

export type Design = readonly Room[];
export type { Scenario, ScenarioAction };

const ORDINALS = ['first', 'second', 'third', 'fourth'];
const COMPASS = ['north', 'north-east', 'east', 'south-east', 'south', 'south-west', 'west', 'north-west'];

function roomById(rooms: Design, id: string | undefined): Room | undefined {
  return rooms.find((r) => r.id === id);
}

/** The room holding an object (objects can move between rooms). */
export function roomOfObject(rooms: Design, objectId: string): Room | undefined {
  return rooms.find((r) => r.objects.some((o) => o.id === objectId));
}

/** Builds a placed object from its catalogue asset (catalogue size, height, role and airflow). */
export function objectFromAsset(assetId: string, objectId: string, position: [number, number, number], rotationY = 0): SceneObject {
  const a = getCatalogAsset(assetId);
  return {
    id: objectId,
    assetId,
    name: a?.label ?? assetId,
    position: [position[0], 0, position[2]],
    rotation: [0, rotationY, 0],
    size: (a?.size ?? [0.4, 0.6, 0.4]) as [number, number, number],
    elevation: a?.elevation ?? position[1] ?? 0,
    role: a?.role ?? 'source',
    wallMounted: a?.wallMounted ?? false,
    ...(a?.color && { color: a.color }),
    ...(a?.defaultAirflow !== undefined && { defaultAirflow: a.defaultAirflow }),
  };
}

function applyOne(rooms: Room[], action: ScenarioAction): void {
  switch (action.type) {
    case 'setOpening': {
      const op = roomById(rooms, action.roomId)?.openings.find((o) => o.id === action.openingId);
      if (!op) return;
      op.openFraction = action.openFraction;
      // A "closed" tag would keep the opening shut whatever its fraction
      if (action.openFraction > 0 && op.role === 'closed') op.role = 'inlet';
      return;
    }
    case 'toggleDevice': {
      const obj = roomOfObject(rooms, action.objectId)?.objects.find((o) => o.id === action.objectId);
      if (obj) obj.enabled = action.enabled;
      return;
    }
    case 'moveObject': {
      const from = roomOfObject(rooms, action.objectId);
      const to = roomById(rooms, action.toRoomId ?? from?.id) ?? from;
      if (!from || !to) return;
      const i = from.objects.findIndex((o) => o.id === action.objectId);
      const obj = from.objects[i]!;
      obj.position = [action.position[0], obj.position[1], action.position[2]];
      if (to !== from) {
        from.objects.splice(i, 1);
        to.objects.push(obj);
        // A room-level source attached to the moved object stays with it
      }
      return;
    }
    case 'addDevice': {
      const room = roomById(rooms, action.roomId);
      if (!room || rooms.some((r) => r.objects.some((o) => o.id === action.objectId))) return;
      room.objects.push(objectFromAsset(action.assetId, action.objectId, action.position, action.rotationY));
      return;
    }
    case 'removeObject': {
      const room = roomOfObject(rooms, action.objectId);
      if (room) room.objects = room.objects.filter((o) => o.id !== action.objectId);
      return;
    }
    case 'setSource': {
      const room = roomById(rooms, action.roomId) ?? rooms.find((r) => r.objects.some((o) => o.id === action.sourceId));
      if (!room) return;
      const obj = rooms.flatMap((r) => r.objects).find((o) => o.id === action.sourceId);
      if (obj) {
        if (action.enabled !== undefined) obj.enabled = action.enabled;
        if (action.rateUgMin !== undefined) obj.emissionRateUgMin = action.rateUgMin;
        if (action.schedule !== undefined) obj.sourceSchedule = action.schedule;
        return;
      }
      const src = room.params.pm25Sources?.find((s) => s.id === action.sourceId);
      if (!src) return;
      // Room-level sources have no on/off flag: off = no emission
      if (action.enabled === false) src.emissionRateUgMin = 0;
      if (action.rateUgMin !== undefined) src.emissionRateUgMin = action.rateUgMin;
      if (action.schedule !== undefined) src.schedule = action.schedule;
      return;
    }
    case 'setDeviceParam': {
      const obj = roomOfObject(rooms, action.objectId)?.objects.find((o) => o.id === action.objectId);
      if (obj) obj[action.param] = action.value;
      return;
    }
  }
}

/** The design with the actions applied in order. Never mutates `design`. */
export function applyActions(design: Design, actions: readonly ScenarioAction[]): Room[] {
  if (actions.length === 0) return [...design];
  return produce([...design] as Room[], (draft) => {
    for (const a of actions) applyOne(draft as Room[], a);
  });
}

/** applyScenario(design, scenario) → a new design. Never mutates `design`. */
export function applyScenario(design: Design, scenario: Pick<Scenario, 'actions'>): Room[] {
  return applyActions(design, scenario.actions);
}

// ---------------------------------------------------------------------------
// Plain-language descriptions

/** "Range Hood (Exhaust)" → "range hood": lower case, without parenthesised notes. */
const lower = (s: string) => s.replace(/\s*\([^)]*\)/g, '').trim().toLowerCase();

/** "the east window in Bedroom 1", "the door between Kitchen and Living Room". */
export function describeOpening(rooms: Design, roomId: string, op: Opening): string {
  const room = roomById(rooms, roomId)!;
  const kind = op.type === 'door' ? 'door' : 'window';
  const others = rooms.filter((r) => r.id !== roomId);
  if (interiorOpeningIds(room, others).has(op.id)) {
    const nb = others.find((o) => interiorOpeningIds(room, [o]).has(op.id));
    return `the ${kind} between ${room.name} and ${nb?.name ?? 'the next room'}`;
  }
  const facingOf = (o: Opening) => {
    try {
      return COMPASS[Math.round(xzToBearing(wallSegment(room, o.wallIndex).normal) / 45) % 8]!;
    } catch {
      return '';
    }
  };
  const facing = facingOf(op);
  // Two north windows in a room: "the first north window", "the second north window"
  const twins = room.openings.filter((o) => o.type === op.type && facingOf(o) === facing && !interiorOpeningIds(room, others).has(o.id)).sort((a, b) => a.wallIndex - b.wallIndex || a.offset - b.offset);
  const ordinal = twins.length > 1 ? `${ORDINALS[twins.indexOf(op)] ?? `#${twins.indexOf(op) + 1}`} ` : '';
  return `the ${ordinal}${facing ? `${facing} ` : ''}${kind} in ${room.name}`;
}

function objectLabel(obj: SceneObject | undefined, fallback = 'device'): string {
  if (!obj) return `the ${fallback}`;
  const p = placedSourceParams(obj);
  return `the ${lower(p ? (obj.name || p.label) : obj.name)}`;
}

const pct = (f: number) => `${Math.round(f * 100)}%`;

/**
 * Plain-language text of an action, e.g. "Close the east window in Bedroom 1", "Move the air purifier
 * to Bedroom 2". `design` resolves names; without it ids are used.
 */
export function describeAction(action: ScenarioAction, design: Design = []): string {
  const room = roomById(design, action.roomId);
  const roomName = room?.name ?? action.roomId;
  switch (action.type) {
    case 'setOpening': {
      const op = room?.openings.find((o) => o.id === action.openingId);
      const what = op ? describeOpening(design, action.roomId, op) : `opening ${action.openingId}`;
      if (action.openFraction <= 0) return `Close ${what}`;
      if (action.openFraction >= 0.95) return `Open ${what} fully`;
      if (action.openFraction <= 0.25) return `Leave ${what} ajar (${pct(action.openFraction)})`;
      return `Open ${what} ${pct(action.openFraction)}`;
    }
    case 'toggleDevice': {
      const obj = roomOfObject(design, action.objectId)?.objects.find((o) => o.id === action.objectId);
      return `Turn ${action.enabled ? 'on' : 'off'} ${objectLabel(obj)} in ${roomOfObject(design, action.objectId)?.name ?? roomName}`;
    }
    case 'moveObject': {
      const from = roomOfObject(design, action.objectId);
      const obj = from?.objects.find((o) => o.id === action.objectId);
      const to = roomById(design, action.toRoomId) ?? from;
      if (to && from && to.id !== from.id) return `Move ${objectLabel(obj, 'object')} to ${to.name}`;
      return `Move ${objectLabel(obj, 'object')} within ${from?.name ?? roomName}`;
    }
    case 'addDevice': {
      const a = getCatalogAsset(action.assetId);
      if (action.kind === 'pm25Source') return `Add ${lower(a?.label ?? 'a source')} in ${roomName}`;
      const flow = a?.defaultAirflow ? ` (${a.defaultAirflow} m³/h)` : '';
      return `Add ${/^[aeiou]/i.test(a?.label ?? '') ? 'an' : 'a'} ${lower(a?.label ?? action.kind)}${flow} to ${roomName}`;
    }
    case 'removeObject': {
      const from = roomOfObject(design, action.objectId);
      return `Remove ${objectLabel(from?.objects.find((o) => o.id === action.objectId), 'object')} from ${from?.name ?? roomName}`;
    }
    case 'setSource': {
      const obj = design.flatMap((r) => r.objects).find((o) => o.id === action.sourceId);
      const src = room?.params.pm25Sources?.find((s) => s.id === action.sourceId);
      const what = obj ? objectLabel(obj, 'source') : `the ${lower(src?.label ?? 'source')}`;
      if (action.enabled === false) return `Stop ${what} in ${roomName}`;
      if (action.enabled === true) return `Start ${what} in ${roomName}`;
      if (action.rateUgMin !== undefined) return `Set ${what} to ${Math.round(action.rateUgMin)} µg/min`;
      const w = action.schedule?.[0];
      return w ? `Run ${what} from minute ${w.startMin} for ${w.durationMin} min` : `Run ${what} all the time`;
    }
    case 'setDeviceParam': {
      const obj = roomOfObject(design, action.objectId)?.objects.find((o) => o.id === action.objectId);
      const unit = action.param === 'dischargeVelocityMs' ? 'm/s' : 'm³/h';
      return `Set ${objectLabel(obj)} to ${Math.round(action.value * 10) / 10} ${unit}`;
    }
  }
}

// ---------------------------------------------------------------------------
// Recording: what-if edits as actions

const moved = (a: SceneObject, b: SceneObject) => Math.hypot(a.position[0] - b.position[0], a.position[2] - b.position[2]) > 0.01;
const openFractionOf = (op: Opening) => (isOpeningOpen(op) ? op.openFraction : 0);
const sameSchedule = (a: unknown, b: unknown) => JSON.stringify(a ?? []) === JSON.stringify(b ?? []);

/**
 * The actions that turn `base` into `edited` (what-if mode records edits this way): opening
 * changes, devices switched, objects moved / added (devices and sources) / removed, source and
 * device parameter changes. Other edits (walls, plain furniture added) are not scenario actions.
 */
export function diffDesigns(base: Design, edited: Design): ScenarioAction[] {
  const out: ScenarioAction[] = [];
  const baseObjects = new Map(base.flatMap((r) => r.objects.map((o) => [o.id, { o, roomId: r.id! }] as const)));
  const editedObjects = new Map(edited.flatMap((r) => r.objects.map((o) => [o.id, { o, roomId: r.id! }] as const)));

  for (const room of edited) {
    const before = roomById(base, room.id);
    if (!before || !room.id) continue;
    for (const op of room.openings) {
      const b = before.openings.find((o) => o.id === op.id);
      if (b && Math.abs(openFractionOf(b) - openFractionOf(op)) > 1e-3) out.push({ type: 'setOpening', roomId: room.id, openingId: op.id, openFraction: openFractionOf(op) });
    }
    for (const src of room.params.pm25Sources ?? []) {
      const b = before.params.pm25Sources?.find((s) => s.id === src.id);
      if (!b) continue;
      if (b.emissionRateUgMin !== src.emissionRateUgMin) out.push({ type: 'setSource', roomId: room.id, sourceId: src.id, rateUgMin: src.emissionRateUgMin });
      if (!sameSchedule(b.schedule, src.schedule)) out.push({ type: 'setSource', roomId: room.id, sourceId: src.id, schedule: src.schedule ?? [] });
    }
  }

  for (const [id, { o, roomId }] of editedObjects) {
    const was = baseObjects.get(id);
    if (!was) {
      const kind = deviceKindOf(o);
      if (kind) out.push({ type: 'addDevice', roomId, objectId: id, kind, assetId: o.assetId, position: [o.position[0], o.elevation ?? 0, o.position[2]], ...(o.rotation[1] && { rotationY: o.rotation[1] }) });
      continue;
    }
    if (was.roomId !== roomId || moved(was.o, o)) out.push({ type: 'moveObject', roomId: was.roomId, objectId: id, ...(was.roomId !== roomId && { toRoomId: roomId }), position: [o.position[0], o.position[1], o.position[2]] });
    const source = isPm25SourceObject(o);
    if ((was.o.enabled !== false) !== (o.enabled !== false)) {
      out.push(source ? { type: 'setSource', roomId, sourceId: id, enabled: o.enabled !== false } : { type: 'toggleDevice', roomId, objectId: id, enabled: o.enabled !== false });
    }
    if (source) {
      if (was.o.emissionRateUgMin !== o.emissionRateUgMin && o.emissionRateUgMin !== undefined) out.push({ type: 'setSource', roomId, sourceId: id, rateUgMin: o.emissionRateUgMin });
      if (!sameSchedule(was.o.sourceSchedule, o.sourceSchedule)) out.push({ type: 'setSource', roomId, sourceId: id, schedule: o.sourceSchedule ?? [] });
    } else {
      for (const param of ['cadrM3h', 'exhaustFlowM3h', 'defaultAirflow', 'dischargeVelocityMs'] as const) {
        const v = o[param];
        if (v !== undefined && was.o[param] !== v) out.push({ type: 'setDeviceParam', roomId, objectId: id, param, value: v });
      }
    }
  }
  for (const [id, { roomId }] of baseObjects) if (!editedObjects.has(id)) out.push({ type: 'removeObject', roomId, objectId: id });
  return out;
}

/** Room ids an action touches (for "Δ in each affected room" and conflict checks). */
export function actionTarget(a: ScenarioAction): string {
  switch (a.type) {
    case 'setOpening':
      return `opening:${a.openingId}`;
    case 'setSource':
      return `object:${a.sourceId}`;
    default:
      return `object:${a.objectId}`;
  }
}
