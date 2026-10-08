import { RoomSchema, type Room } from './schema';

/**
 * Creates a default simulation-ready room:
 * - 4m x 3m rectangular counter-clockwise floor polygon on the XZ plane
 * - 2.7m wall height
 * - 0.15m wall thickness
 * - One standard window (1.2m x 1.2m, sill 0.9m) on Wall 0
 * - One standard door (0.9m x 2.1m, sill 0m) on Wall 2
 * - Standard environmental simulation parameters
 */
export function createDefaultRoom(): Room {
  const roomData = {
    version: 1 as const,
    name: 'Default Room (4x3m)',
    wallHeight: 2.7,
    wallThickness: 0.15,
    outline: [
      [-2, -1.5],
      [2, -1.5],
      [2, 1.5],
      [-2, 1.5],
    ] as [number, number][],
    openings: [
      {
        id: 'default-window-1',
        wallIndex: 0,
        type: 'window' as const,
        offset: 1.4, // centered along 4m wall: (4 - 1.2) / 2 = 1.4m
        width: 1.2,
        height: 1.2,
        sill: 0.9,
        role: 'inlet' as const,
        openFraction: 0.5,
      },
      {
        id: 'default-door-1',
        wallIndex: 2,
        type: 'door' as const,
        offset: 0.5,
        width: 0.9,
        height: 2.1,
        sill: 0.0,
        role: 'outlet' as const,
        openFraction: 0.5,
      },
    ],
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
