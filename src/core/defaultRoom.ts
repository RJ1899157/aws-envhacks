import { RoomSchema, type Room } from './schema';

/**
 * Creates the empty starting room: a 4m x 3m floor, four 2.7m walls and a ceiling,
 * with no openings or objects.
 */
export function createDefaultRoom(): Room {
  const roomData = {
    version: 1 as const,
    id: 'room-1',
    type: 'basic' as const,
    name: 'Default Room (4x3m)',
    wallHeight: 2.7,
    wallThickness: 0.15,
    outline: [
      [-2, -1.5],
      [2, -1.5],
      [2, 1.5],
      [-2, 1.5],
    ] as [number, number][],
    openings: [],
    objects: [],
    params: {
      windSpeed: 2.5,
      windDirDeg: 0,
      pressurePa: 101325,
      indoorTempC: 22.0,
      outdoorTempC: 25.0,
      humidity: 50.0,
      datetime: '2026-10-05T12:00:00Z',
    },
  };

  return RoomSchema.parse(roomData);
}
