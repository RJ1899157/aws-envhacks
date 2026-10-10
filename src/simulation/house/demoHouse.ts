import { RoomSchema, type Opening, type Room, type RoomParams, type SceneObject } from '../../core/schema';
import { getCatalogAsset } from '../../core/catalog';
import { PM25_SOURCE_PRESETS, type Pm25SourcePresetId } from '../constants';

/**
 * Stand-in multi-room house built around "Bedroom 2" from test-designs/house.json (that file only
 * holds one room because the old JSON export dropped the others). Rooms sit one wall thickness
 * apart so shared walls are detected:
 *
 *            north (−Z)
 *   ┌──────────── Living room ─────────────┐   x −3 … 3.15, z −3.5 … 1.5
 *   ├──── Bedroom 2 ─────┬──── Kitchen ────┤   z 1.65 … 4.85 (split at x 0.6 / 0.75)
 *   ├── Bathroom ─┬─── Bedroom 1 ──────────┤   z 5.0 … 7.4 / 8.2 (split at x −0.6 / −0.45)
 *   └─────────────┘                        ┘
 */

const T = 0.15;
const H = 2.7;

const rect = (x0: number, z0: number, x1: number, z1: number): [number, number][] => [
  [x0, z0],
  [x1, z0],
  [x1, z1],
  [x0, z1],
];

let counter = 0;
const win = (id: string, wallIndex: number, offset: number, width: number, extra: Partial<Opening> = {}): Opening => ({
  id,
  wallIndex,
  type: 'window',
  subType: 'window',
  offset,
  width,
  height: 1.2,
  sill: 0.9,
  role: 'closed',
  openFraction: 0,
  ...extra,
});
const door = (id: string, wallIndex: number, offset: number, width = 0.9, extra: Partial<Opening> = {}): Opening => ({
  id,
  wallIndex,
  type: 'door',
  subType: 'single-door',
  offset,
  width,
  height: 2.1,
  sill: 0,
  role: 'closed',
  openFraction: 0,
  ...extra,
});
const obj = (assetId: string, name: string, position: [number, number, number], size: [number, number, number], extra: Partial<SceneObject> = {}): SceneObject => ({
  id: `${assetId}-demo-${counter++}`,
  assetId,
  name,
  position,
  rotation: [0, 0, 0],
  size,
  elevation: 0,
  role: 'solid',
  wallMounted: false,
  ...extra,
});

function room(base: Partial<Room> & Pick<Room, 'id' | 'name' | 'outline'>, params: RoomParams): Room {
  return RoomSchema.parse({ version: 1, wallHeight: H, wallThickness: T, openings: [], objects: [], ...base, params });
}

/** The stand-in house in its neutral state (windows and doors shut), primary room first. */
export function createStandinHouse(bedroom2: Room): Room[] {
  counter = 0;
  const params = bedroom2.params;
  const b2: Room = RoomSchema.parse({
    ...bedroom2,
    openings: [win('b2-window-west', 3, 1.0, 1.2), door('b2-door-living', 0, 2.4), door('b2-door-bath', 2, 1.8, 0.8)],
  });
  const living = room(
    {
      id: 'room-living',
      type: 'living',
      name: 'Living Room',
      outline: rect(-3, -3.5, 3.15, 1.5),
      openings: [win('living-window-n1', 0, 1.0, 1.6), win('living-window-n2', 0, 3.6, 1.6), win('living-window-east', 1, 1.6, 1.4), win('living-window-west', 3, 1.6, 1.4)],
      objects: [
        obj('sofa-3-seater', 'Sofa', [-1.4, 0, -2.6], [2.1, 0.85, 0.9]),
        obj('coffee-table', 'Coffee Table', [-1.4, 0, -1.5], [1.0, 0.45, 0.6]),
        obj('dining-table', 'Dining Table', [1.8, 0, 0.4], [1.6, 0.76, 0.9]),
        obj('tv-unit', 'TV Unit', [-1.4, 0, 1.25], [1.5, 0.45, 0.4]),
      ],
    },
    params
  );
  const kitchen = room(
    {
      id: 'room-kitchen',
      type: 'kitchen',
      name: 'Kitchen',
      outline: rect(0.75, 1.65, 3.15, 4.85),
      openings: [win('kitchen-window-east', 1, 1.0, 1.2), door('kitchen-door-living', 0, 0.6, 0.9)],
      objects: [
        obj('kitchen-counter', 'Counter', [2.3, 0, 4.55], [1.6, 0.9, 0.6]),
        obj('oven', 'Gas Stove', [2.85, 0, 2.3], [0.6, 0.9, 0.6]),
        obj('fridge', 'Refrigerator', [1.1, 0, 4.45], [0.7, 1.8, 0.7]),
      ],
    },
    params
  );
  const bath = room(
    {
      id: 'room-bath',
      type: 'bathroom',
      name: 'Bathroom',
      outline: rect(-3, 5.0, -0.6, 7.4),
      openings: [win('bath-window-south', 2, 0.8, 0.6, { sill: 1.6, height: 0.6 })],
      objects: [obj('toilet', 'Toilet', [-2.6, 0, 6.9], [0.4, 0.8, 0.7]), obj('sink-vanity', 'Vanity', [-1.4, 0, 5.3], [0.9, 0.85, 0.5])],
    },
    params
  );
  const b1 = room(
    {
      id: 'room-bedroom-1',
      type: 'bedroom',
      name: 'Bedroom 1',
      outline: rect(-0.45, 5.0, 3.15, 8.2),
      openings: [win('b1-window-east', 1, 1.0, 1.4), win('b1-window-south', 2, 1.1, 1.4), door('b1-door-kitchen', 0, 1.7, 0.9)],
      objects: [obj('double-bed', 'Double Bed', [1.6, 0, 7.1], [1.5, 0.55, 2.0]), obj('wardrobe', 'Wardrobe', [0.1, 0, 6.6], [0.6, 2.0, 1.2])],
    },
    params
  );
  return [living, b2, kitchen, bath, b1];
}

/** Opens an opening; the role tag is only a label (the physics decides), but keep it truthful. */
const setOpening = (r: Room, id: string, openFraction: number, role: 'inlet' | 'outlet'): Room => ({
  ...r,
  openings: r.openings.map((o) => (o.id === id ? { ...o, openFraction, role } : o)),
});

/** A placed PM2.5 source marker (catalog size and elevation), as the Asset Library would drop it. */
const placedSource = (id: string, preset: Pm25SourcePresetId, name: string, position: [number, number, number], extra: Partial<SceneObject> = {}): SceneObject => {
  const def = PM25_SOURCE_PRESETS[preset];
  const asset = getCatalogAsset(def.assetId)!;
  return { id, assetId: asset.id, name, position, rotation: [0, 0, 0], size: [...asset.size], elevation: asset.elevation, role: 'none', wallMounted: false, color: asset.color, ...extra };
};

/**
 * Demo scenario on the stand-in house: wind 2 m/s from the east, a typical day outdoors (60 µg/m³,
 * low enough that indoor plumes stand out), someone frying in the kitchen from minute 10, an
 * incense stick burning in the living room, a purifier in the shut Bedroom 1.
 * - living-room east and west windows open → a flushed east → west path through the living room
 * - kitchen east window and kitchen → living door open → the frying plume is pushed into the
 *   living room
 * - incense in the living room's north half, away from the window path, where air is slow
 * - Bedroom 2, bathroom and Bedroom 1 doors shut (undercuts only): their air goes stale
 */
export function createDemoScenario(standin: readonly Room[]): Room[] {
  const params: RoomParams = {
    ...standin[0]!.params,
    windSpeed: 2,
    windDirDeg: 90,
    indoorTempC: 25,
    outdoorTempC: 30,
    exposure: 'urbanDense',
    outdoorPm25: { valueUgM3: 60, source: 'manual' },
  };
  return standin.map((r) => {
    let next: Room = { ...r, params: { ...params, pm25Sources: undefined } };
    if (r.id === 'room-living') {
      next = setOpening(setOpening(next, 'living-window-east', 0.8, 'inlet'), 'living-window-west', 0.8, 'outlet');
      next = { ...next, objects: [...next.objects, placedSource('demo-incense', 'incense', 'Incense', [0.4, 0, -3.0])] };
    }
    if (r.id === 'room-kitchen') {
      next = setOpening(setOpening(next, 'kitchen-window-east', 0.5, 'inlet'), 'kitchen-door-living', 1, 'outlet');
      const stove = next.objects.find((o) => o.assetId === 'oven')!;
      next = {
        ...next,
        objects: [...next.objects, placedSource('demo-frying', 'gas-stove-frying', 'Frying', [stove.position[0], 0, stove.position[2]], { sourceSchedule: [{ startMin: 10, durationMin: 45 }] })],
      };
    }
    if (r.id === 'room-bedroom-1') {
      next = {
        ...next,
        objects: [...next.objects, { id: 'demo-purifier', assetId: 'air-purifier', name: 'Air Purifier', position: [2.6, 0, 5.6], rotation: [0, 0, 0], size: [0.38, 0.6, 0.38], elevation: 0, role: 'source', wallMounted: false, defaultAirflow: 300 }],
      };
    }
    return RoomSchema.parse(next);
  });
}

/** App export format: the primary room with the others under `otherRooms`. */
export function toExportJson(rooms: readonly Room[]): string {
  const [first, ...others] = rooms;
  return JSON.stringify({ ...first, otherRooms: others }, null, 2);
}
