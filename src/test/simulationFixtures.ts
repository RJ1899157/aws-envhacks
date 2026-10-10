import { RoomSchema, type Opening, type Room, type SceneObject } from '../core/schema';

/**
 * Test helpers: rectangular rooms with chosen openings/objects. Not imported by app code.
 * Wall 0 runs along z = 0 and faces north (−Z); default wind is from the north, so wall 0 is windward.
 */
export function rectRoom(width: number, depth: number, height: number, extra: Partial<Room> = {}): Room {
  return RoomSchema.parse({
    name: 'Test room',
    wallHeight: height,
    outline: [
      [0, 0],
      [width, 0],
      [width, depth],
      [0, depth],
    ],
    ...extra,
    params: { windSpeed: 2, windDirDeg: 0, indoorTempC: 25, outdoorTempC: 25, ...extra.params },
  });
}

export function opening(id: string, wallIndex: number, overrides: Partial<Opening> = {}): Opening {
  return { id, wallIndex, type: 'window', offset: 0.5, width: 1, height: 1, sill: 1, role: 'inlet', openFraction: 1, ...overrides };
}

export function device(id: string, assetId: string, overrides: Partial<SceneObject> = {}): SceneObject {
  return {
    id,
    assetId,
    name: assetId,
    position: [1, 0, 1],
    rotation: [0, 0, 0],
    size: [0.4, 0.6, 0.4],
    elevation: 0,
    role: 'source',
    wallMounted: false,
    ...overrides,
  };
}
