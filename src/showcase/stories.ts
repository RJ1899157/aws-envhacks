import { z } from 'zod';
import { Pm25ScheduleWindowSchema, ScenarioSchema, type Room } from '../core/schema';
import { SC, SHOWCASE_ROOM_IDS as R, createShowcaseHouse } from './house';

/**
 * The four showcase stories: pure data over the showcase house. A story fixes the conditions
 * (outdoor PM2.5, never live; wind; temperatures), which sources run and when, the openings and
 * devices, what the view shows, and a "fix" scenario for the compare view.
 */

export const StoryPresetSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  subtitle: z.string().min(1),
  /** One line under the title in the story bar */
  shows: z.string().min(1),
  outdoorPm25: z.number().nonnegative(),
  wind: z.object({ speedMs: z.number().nonnegative(), fromDeg: z.number().min(0).max(360) }),
  temperatures: z.object({ indoorC: z.number(), outdoorC: z.number() }),
  /** Simulated duration (s) */
  durationS: z.number().positive(),
  /** Every PM2.5 source of the house: on/off and its schedule (absent = always on) */
  sources: z.array(z.object({ objectId: z.string(), enabled: z.boolean(), schedule: z.array(Pm25ScheduleWindowSchema).optional() })),
  /** Open fraction per opening id (0 = closed) */
  openings: z.record(z.string(), z.number().min(0).max(1)),
  /** On/off per device object id */
  devices: z.record(z.string(), z.boolean()),
  view: z.object({
    mode: z.enum(['pollution', 'ventilation', 'airflow']),
    camera: z.enum(['house', 'focus']),
    focusRoomId: z.string(),
    /** Play the PM2.5 timeline when the story opens */
    autoplay: z.boolean().default(false),
    compareView: z.enum(['a', 'b', 'swipe', 'diff']),
  }),
  fix: ScenarioSchema,
});
export type StoryPreset = z.infer<typeof StoryPresetSchema>;

/** Inlet/outlet tag of every opening of the showcase house as built. */
const HOUSE_ROLES = new Map(createShowcaseHouse().flatMap((r) => r.openings.map((o) => [o.id, o.role] as const)));

const ALL_WINDOWS = [SC.b1WindowWest, SC.b1WindowNorth, SC.b2Window, SC.kitchenWindow, SC.balconyDoor, SC.livingWindow] as const;

/** Everyday openings: windows half open, inner doors open, bathroom door nearly shut. */
const EVERYDAY: Record<string, number> = {
  [SC.b1WindowWest]: 0.6,
  [SC.b1WindowNorth]: 0.6,
  [SC.b2Window]: 0.8,
  [SC.kitchenWindow]: 0.8,
  [SC.balconyDoor]: 0.3,
  [SC.livingWindow]: 0.5,
  [SC.b1Door]: 1,
  [SC.b2Door]: 1,
  [SC.kitchenDoor]: 1,
  [SC.bathDoor]: 0.1,
};

const NO_SOURCES = [
  { objectId: SC.frying, enabled: false },
  { objectId: SC.incense, enabled: false },
];

const DEVICES_OFF: Record<string, boolean> = { [SC.hood]: false, [SC.bathExhaust]: false, [SC.ceilingFan]: false, [SC.purifier]: true };

export const STORIES: readonly StoryPreset[] = [
  StoryPresetSchema.parse({
    id: 'smog-day',
    title: 'Smog day: keep the windows shut',
    subtitle: 'Outdoor PM2.5 is 250 and every window is open.',
    shows: 'Open windows bring smog straight in; shut them and run the purifier where you sleep.',
    outdoorPm25: 250,
    wind: { speedMs: 3, fromDeg: 45 },
    temperatures: { indoorC: 20, outdoorC: 14 },
    durationS: 2 * 3600,
    sources: NO_SOURCES,
    openings: { ...EVERYDAY, ...Object.fromEntries(ALL_WINDOWS.map((id) => [id, 0.8])) },
    devices: DEVICES_OFF,
    view: { mode: 'pollution', camera: 'house', focusRoomId: R.bedroom1, autoplay: false, compareView: 'swipe' },
    fix: {
      id: 'fix-smog-day',
      name: 'Windows shut, purifier in Bedroom 1',
      actions: [
        ...ALL_WINDOWS.map((openingId) => ({ type: 'setOpening' as const, roomId: openingId === SC.balconyDoor || openingId === SC.livingWindow ? R.living : openingId === SC.kitchenWindow ? R.kitchen : openingId === SC.b2Window ? R.bedroom2 : R.bedroom1, openingId, openFraction: 0 })),
        { type: 'moveObject', roomId: R.living, objectId: SC.purifier, toRoomId: R.bedroom1, position: [2.6, 0, 0.7] },
      ],
    },
  }),
  StoryPresetSchema.parse({
    id: 'dinner-time',
    title: 'Dinner time',
    subtitle: 'Frying on the gas stove for half an hour, hood off, kitchen door open.',
    shows: 'Cooking smoke drifts from the kitchen into the living room; the hood and a shut door keep it in the kitchen.',
    outdoorPm25: 60,
    wind: { speedMs: 2, fromDeg: 45 },
    temperatures: { indoorC: 28, outdoorC: 28 },
    durationS: 2 * 3600,
    sources: [
      { objectId: SC.frying, enabled: true, schedule: [{ startMin: 2, durationMin: 30 }] },
      { objectId: SC.incense, enabled: false },
    ],
    // The kitchen window faces the wind and pushes the smoke through the open door
    openings: { ...EVERYDAY, [SC.kitchenWindow]: 0.5 },
    devices: DEVICES_OFF,
    view: { mode: 'pollution', camera: 'house', focusRoomId: R.living, autoplay: true, compareView: 'swipe' },
    fix: {
      id: 'fix-dinner-time',
      name: 'Hood on, kitchen door shut',
      actions: [
        { type: 'toggleDevice', roomId: R.kitchen, objectId: SC.hood, enabled: true },
        { type: 'setOpening', roomId: R.kitchen, openingId: SC.kitchenDoor, openFraction: 0 },
      ],
    },
  }),
  StoryPresetSchema.parse({
    id: 'forgotten-rooms',
    title: 'The forgotten rooms',
    subtitle: 'An ordinary day: windows open, yet two corners barely get fresh air.',
    shows: 'The windowless bathroom and the study nook behind the wardrobe keep stale air.',
    outdoorPm25: 60,
    wind: { speedMs: 3, fromDeg: 45 },
    temperatures: { indoorC: 27, outdoorC: 27 },
    durationS: 2 * 3600,
    sources: NO_SOURCES,
    openings: EVERYDAY,
    devices: DEVICES_OFF,
    view: { mode: 'ventilation', camera: 'house', focusRoomId: R.bedroom2, autoplay: false, compareView: 'swipe' },
    fix: {
      id: 'fix-forgotten-rooms',
      name: 'Bathroom exhaust on, fan out of the nook',
      actions: [
        { type: 'toggleDevice', roomId: R.bathroom, objectId: SC.bathExhaust, enabled: true },
        { type: 'addDevice', roomId: R.bedroom2, objectId: 'sc-nook-fan', kind: 'pedestalFan', assetId: 'pedestal-fan', position: [9.1, 0, 3.4], rotationY: Math.atan2(-3.1, -1.6) },
      ],
    },
  }),
  StoryPresetSchema.parse({
    id: 'purifier-placement',
    title: 'Where should the purifier go?',
    subtitle: 'Outdoor PM2.5 is 150, windows shut, the purifier tucked behind the sofa.',
    shows: 'The same purifier cleans far more of the room in the open than wedged behind furniture.',
    outdoorPm25: 150,
    wind: { speedMs: 3, fromDeg: 45 },
    temperatures: { indoorC: 20, outdoorC: 15 },
    durationS: 2 * 3600,
    sources: NO_SOURCES,
    // Windows and inner doors shut: the living room keeps its own air, so placement shows
    openings: { ...EVERYDAY, ...Object.fromEntries(ALL_WINDOWS.map((id) => [id, 0])), [SC.b1Door]: 0, [SC.b2Door]: 0, [SC.kitchenDoor]: 0 },
    devices: DEVICES_OFF,
    view: { mode: 'pollution', camera: 'focus', focusRoomId: R.living, autoplay: false, compareView: 'diff' },
    fix: {
      id: 'fix-purifier-placement',
      name: 'Purifier in the middle of the room',
      actions: [{ type: 'moveObject', roomId: R.living, objectId: SC.purifier, position: [4.95, 0, 6.3] }],
    },
  }),
];

export function storyById(id: string): StoryPreset | undefined {
  return STORIES.find((s) => s.id === id);
}

/** Simulation settings a story runs at (and its precomputed results were built with). */
export function storySettings(story: StoryPreset): { durationS: number; resolution: 'live' } {
  return { durationS: story.durationS, resolution: 'live' };
}

/**
 * The house set up for a story: conditions on every room (house-wide), openings, devices and
 * sources as the story says, and the fix saved as the design's one scenario. Pure.
 */
export function applyStory(house: readonly Room[], story: StoryPreset): Room[] {
  const sources = new Map(story.sources.map((s) => [s.objectId, s]));
  return house.map((room, i) => ({
    ...room,
    params: {
      ...room.params,
      outdoorPm25: { valueUgM3: story.outdoorPm25, source: 'manual' as const },
      windSpeed: story.wind.speedMs,
      windDirDeg: story.wind.fromDeg,
      indoorTempC: story.temperatures.indoorC,
      outdoorTempC: story.temperatures.outdoorC,
    },
    openings: room.openings.map((op) => {
      const f = story.openings[op.id];
      if (f === undefined) return op;
      // Keep the house's inlet/outlet tag; a tag-less closed opening that opens counts as an inlet
      const house = HOUSE_ROLES.get(op.id);
      return { ...op, openFraction: f, role: f > 0 ? (house && house !== 'closed' ? house : 'inlet') : 'closed' };
    }),
    objects: room.objects.map((o) => {
      const src = sources.get(o.id);
      if (src) {
        const { sourceSchedule: _old, ...rest } = o;
        void _old;
        return { ...rest, enabled: src.enabled, ...(src.schedule && { sourceSchedule: src.schedule }) };
      }
      const dev = story.devices[o.id];
      return dev === undefined ? o : { ...o, enabled: dev };
    }),
    ...(i === 0 && { scenarios: [story.fix] }),
  }));
}
