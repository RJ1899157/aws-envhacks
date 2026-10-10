import { getCatalogAsset } from '../core/catalog';
import { RoomSchema, type Opening, type Room, type RoomParams, type SceneObject } from '../core/schema';

/**
 * The showcase flat: a Delhi-style 2BHK of ~72 m² net (2.95 m ceilings), built to make each
 * simulation story visible. Plan north is −Z, east +X (src/core/wind.ts); rooms sit one wall
 * thickness apart so shared walls (and the doors in them) are detected.
 *
 *                       north (−Z)
 *   x 0          3.8 3.95                8.2         10
 *   ┌── Bedroom 1 ──┐┌────── Bedroom 2 ──────┐            z 0
 *   │ W + N windows ││ N window (single-sided)│└──────┐ z 1.6
 *   │               ││          wardrobe ▌    │ study nook │
 *   │               ││                    ┘ opening      │ z 2.9
 *   └──────┬door────┘└─────────door──┬─────────┴────────┘ z 3.8
 *   ┌ Bath ┐┌──────── Living Room ──────────┐┌ Kitchen ─┐ z 3.95
 *   │ no   ││ puja (incense)                ││ stove +  │
 *   │window││ sofa, purifier behind it      door hood, E │
 *   └──────┘│ ceiling fan, dining table     ││ window   │ z 6.35 / 7.2
 *           └──────── balcony door ─────────┘└──────────┘ z 8.6
 *
 * Default wind: 3 m/s from the north-east, so Bedroom 1's north window is windward and its west
 * window sits on the sheltered side: a clean cross-flow through the room. Bedroom 2's single window
 * and the kitchen window also face the wind; the balcony door and the small living-room window on
 * the west wall let the air out.
 */

export const SHOWCASE_WALL_HEIGHT = 2.95;
const T = 0.15;

export const SHOWCASE_ROOM_IDS = {
  bedroom1: 'sc-bedroom-1',
  bedroom2: 'sc-bedroom-2',
  bathroom: 'sc-bathroom',
  living: 'sc-living',
  kitchen: 'sc-kitchen',
} as const;

/** Ids of the openings and objects the stories switch. */
export const SC = {
  b1WindowWest: 'sc-b1-window-west',
  b1WindowNorth: 'sc-b1-window-north',
  b1Door: 'sc-b1-door',
  b2Window: 'sc-b2-window-north',
  b2Door: 'sc-b2-door',
  bathDoor: 'sc-bath-door',
  bathExhaust: 'sc-bath-exhaust',
  balconyDoor: 'sc-balcony-door',
  livingWindow: 'sc-living-window-west',
  kitchenWindow: 'sc-kitchen-window-east',
  kitchenDoor: 'sc-kitchen-door',
  frying: 'sc-frying',
  hood: 'sc-range-hood',
  incense: 'sc-incense',
  ceilingFan: 'sc-ceiling-fan',
  purifier: 'sc-purifier',
} as const;

const rect = (x0: number, z0: number, x1: number, z1: number): [number, number][] => [
  [x0, z0],
  [x1, z0],
  [x1, z1],
  [x0, z1],
];

const win = (id: string, wallIndex: number, offset: number, width: number, openFraction = 0.5, tag: 'inlet' | 'outlet' = 'inlet'): Opening => ({
  id,
  wallIndex,
  type: 'window',
  subType: 'window',
  offset,
  width,
  height: 1.3,
  sill: 0.9,
  role: openFraction > 0 ? tag : 'closed',
  openFraction,
});

const door = (id: string, wallIndex: number, offset: number, width: number, openFraction: number, subType: Opening['subType'] = 'single-door', tag: 'inlet' | 'outlet' = 'outlet'): Opening => ({
  id,
  wallIndex,
  type: 'door',
  subType,
  offset,
  width,
  height: 2.1,
  sill: 0,
  role: openFraction > 0 ? tag : 'closed',
  openFraction,
});

/** A catalogue object (catalogue size, height, role and airflow), rotated about Y by `ry` rad. */
function item(id: string, assetId: string, x: number, z: number, ry = 0, extra: Partial<SceneObject> = {}): SceneObject {
  const a = getCatalogAsset(assetId);
  if (!a) throw new Error(`Unknown catalogue asset ${assetId}`);
  return {
    id,
    assetId,
    name: a.label,
    position: [x, 0, z],
    rotation: [0, ry, 0],
    size: [...a.size] as [number, number, number],
    elevation: a.elevation,
    role: a.role,
    wallMounted: a.wallMounted ?? false,
    ...(a.color && { color: a.color }),
    ...(a.defaultAirflow !== undefined && { defaultAirflow: a.defaultAirflow }),
    ...extra,
  };
}

/** Shared environment (the stories override outdoor PM2.5, wind and temperatures). */
export const SHOWCASE_PARAMS: RoomParams = {
  windSpeed: 3,
  windDirDeg: 45,
  pressurePa: 101325,
  indoorTempC: 26,
  outdoorTempC: 26,
  humidity: 50,
  datetime: '2026-11-10T19:00:00Z',
  outdoorPm25: { valueUgM3: 60, source: 'manual' },
  exposure: 'urbanDense',
  location: { lat: 28.61, lon: 77.21 },
};

const HALF_PI = Math.PI / 2;

function room(id: string, type: Room['type'], name: string, outline: [number, number][], openings: Opening[], objects: SceneObject[]): Room {
  return RoomSchema.parse({ version: 1, id, type, name, wallHeight: SHOWCASE_WALL_HEIGHT, wallThickness: T, outline, openings, objects, params: SHOWCASE_PARAMS });
}

/**
 * The flat in its everyday state: windows half open, bedroom and kitchen doors open, bathroom door
 * nearly shut, every fan, hood and source off, the purifier on behind the sofa. Openings carry
 * inlet/outlet tags that match the default wind (the solver finds the real directions). Every room
 * shares the same environment; Bedroom 1 comes first.
 */
export function createShowcaseHouse(): Room[] {
  const R = SHOWCASE_ROOM_IDS;
  const living = room(
    R.living,
    'living',
    'Living Room',
    rect(2.15, 3.95, 7.4, 8.6),
    // Wall 2 is the south wall, measured from its east end; wall 3 the west wall, from its south end
    [door(SC.balconyDoor, 2, 2.0, 1.5, 0.5, 'sliding-door'), win(SC.livingWindow, 3, 0.4, 1.2, 0.5, 'outlet')],
    [
      item('sc-sofa', 'sofa-3-seater', 3.1, 6.4, HALF_PI),
      item(SC.purifier, 'air-purifier', 2.4, 6.4),
      item('sc-coffee-table', 'coffee-table', 4.2, 6.4, HALF_PI),
      item('sc-tv-unit', 'tv-unit', 5.6, 6.4, -HALF_PI),
      item('sc-dining-table', 'dining-table', 6.35, 7.75),
      item('sc-puja-shelf', 'sideboard', 4.6, 4.2),
      item(SC.incense, 'pm25-incense', 4.6, 4.2, 0, { elevation: 0.8, enabled: false }),
      item(SC.ceilingFan, 'ceiling-fan', 4.75, 6.3, 0, { elevation: 2.55, enabled: false }),
      item('sc-plant', 'plant', 7.0, 4.35),
    ]
  );
  const bedroom1 = room(
    R.bedroom1,
    'bedroom',
    'Bedroom 1',
    rect(0, 0, 3.8, 3.8),
    [
      win(SC.b1WindowNorth, 0, 1.2, 1.4),
      // Wall 3 is the west wall, measured from its south end
      win(SC.b1WindowWest, 3, 1.2, 1.4, 0.5, 'outlet'),
      door(SC.b1Door, 2, 0.3, 0.9, 1),
    ],
    [
      item('sc-b1-bed', 'double-bed', 1.75, 2.55),
      item('sc-b1-nightstand', 'nightstand', 0.6, 3.5),
      item('sc-b1-wardrobe', 'wardrobe', 3.45, 1.0, -HALF_PI),
    ]
  );
  const bedroom2 = room(
    R.bedroom2,
    'bedroom',
    'Bedroom 2',
    // The study nook (x 8.5–10, z 1.6–3.8) is an alcove behind a short wall, reached through a
    // 0.9 m opening at its south end
    [
      [3.95, 0],
      [8.2, 0],
      [8.2, 2.9],
      [8.5, 2.9],
      [8.5, 1.6],
      [10, 1.6],
      [10, 3.8],
      [3.95, 3.8],
    ],
    [
      win(SC.b2Window, 0, 0.4, 3.2),
      // Wall 6 is the south wall, measured from its east end (x = 10)
      door(SC.b2Door, 6, 3.5, 0.9, 1),
    ],
    [
      item('sc-b2-bed', 'double-bed', 5.3, 2.75),
      item('sc-b2-nightstand', 'nightstand', 4.3, 3.5),
      // The wardrobe stands against the nook's wall, hiding it from the window
      item('sc-b2-wardrobe', 'wardrobe', 7.85, 1.3, HALF_PI),
      item('sc-b2-desk', 'desk', 9.6, 2.5, -HALF_PI),
      item('sc-b2-chair', 'office-chair', 9.0, 2.4),
    ]
  );
  const bathroom = room(
    R.bathroom,
    'bathroom',
    'Bathroom',
    rect(0, 3.95, 2.0, 6.35),
    // Wall 1 is the east wall (to the living room), measured from its north end
    [door(SC.bathDoor, 1, 0.8, 0.75, 0.1, 'single-door', 'inlet')],
    [
      item('sc-toilet', 'toilet', 0.4, 5.9),
      item('sc-vanity', 'sink-vanity', 1.0, 4.25),
      item(SC.bathExhaust, 'exhaust-fan', 0.1, 5.1, HALF_PI, { enabled: false }),
    ]
  );
  const kitchen = room(
    R.kitchen,
    'kitchen',
    'Kitchen',
    rect(7.55, 3.95, 10, 7.2),
    [
      // Wall 1 is the east wall, measured from its north end; wall 3 the west wall, from its south end
      win(SC.kitchenWindow, 1, 1.0, 1.2),
      door(SC.kitchenDoor, 3, 0.4, 0.9, 1),
    ],
    [
      item('sc-counter', 'kitchen-counter', 9.7, 5.95, HALF_PI),
      item('sc-stove', 'oven', 9.7, 4.4, -HALF_PI),
      item(SC.frying, 'pm25-stove-frying', 9.7, 4.4, 0, { enabled: false }),
      item(SC.hood, 'range-hood', 9.75, 4.4, -HALF_PI, { enabled: false }),
      item('sc-fridge', 'fridge', 8.0, 4.35),
    ]
  );
  return [bedroom1, living, bedroom2, bathroom, kitchen];
}
