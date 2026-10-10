import { RoomSchema, type Room } from '../schema';

/**
 * Sample 1: Compact Studio Apartment (3.5m x 4.0m)
 * Features single bed, work desk, chair, bookshelf, and air purifier with a north inlet window and a
 * south outlet door; the wind blows from the north.
 */
export function createStudioSample(): Room {
  const roomData = {
    version: 1 as const,
    name: 'Studio Apartment (3.5x4m)',
    wallHeight: 2.6,
    wallThickness: 0.15,
    outline: [
      [-1.75, -2.0],
      [1.75, -2.0],
      [1.75, 2.0],
      [-1.75, 2.0],
    ] as [number, number][],
    openings: [
      {
        id: 'studio-window',
        wallIndex: 0,
        type: 'window' as const,
        offset: 1.15,
        width: 1.2,
        height: 1.2,
        sill: 0.9,
        role: 'inlet' as const,
        openFraction: 0.7,
      },
      {
        id: 'studio-door',
        wallIndex: 2,
        type: 'door' as const,
        offset: 1.3,
        width: 0.9,
        height: 2.1,
        sill: 0.0,
        role: 'outlet' as const,
        openFraction: 0.5,
      },
    ],
    objects: [
      {
        id: 'studio-bed',
        assetId: 'single-bed',
        name: 'Single Bed',
        position: [-1.1, 0, -0.8] as [number, number, number],
        rotation: [0, 0, 0] as [number, number, number],
        size: [1.0, 0.5, 2.0] as [number, number, number],
        elevation: 0,
        role: 'solid' as const,
        wallMounted: false,
        color: '#4f46e5',
      },
      {
        id: 'studio-desk',
        assetId: 'desk',
        name: 'Work Desk',
        position: [0.9, 0, 1.3] as [number, number, number],
        rotation: [0, Math.PI, 0] as [number, number, number],
        size: [1.4, 0.75, 0.7] as [number, number, number],
        elevation: 0,
        role: 'solid' as const,
        wallMounted: false,
        color: '#92400e',
      },
      {
        id: 'studio-chair',
        assetId: 'office-chair',
        name: 'Office Chair',
        position: [0.9, 0, 0.6] as [number, number, number],
        rotation: [0, 0, 0] as [number, number, number],
        size: [0.65, 0.95, 0.65] as [number, number, number],
        elevation: 0,
        role: 'porous' as const,
        wallMounted: false,
        color: '#1f2937',
      },
      {
        id: 'studio-bookshelf',
        assetId: 'bookshelf',
        name: 'Bookshelf',
        position: [-1.2, 0, 1.4] as [number, number, number],
        rotation: [0, Math.PI / 2, 0] as [number, number, number],
        size: [0.8, 1.8, 0.35] as [number, number, number],
        elevation: 0,
        role: 'porous' as const,
        wallMounted: false,
        color: '#854d0e',
      },
      {
        id: 'studio-purifier',
        assetId: 'air-purifier',
        name: 'Air Purifier',
        position: [1.1, 0, -1.4] as [number, number, number],
        rotation: [0, 0, 0] as [number, number, number],
        size: [0.38, 0.6, 0.38] as [number, number, number],
        elevation: 0,
        role: 'source' as const,
        wallMounted: false,
        color: '#0891b2',
        defaultAirflow: 250,
      },
    ],
    params: {
      windSpeed: 2.2,
      windDirDeg: 0,
      pressurePa: 101325,
      indoorTempC: 22.5,
      outdoorTempC: 24.0,
      humidity: 48.0,
      datetime: '2026-10-05T10:00:00Z',
    },
  };

  return RoomSchema.parse(roomData);
}
