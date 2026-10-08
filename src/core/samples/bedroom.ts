import { RoomSchema, type Room } from '../schema';

/**
 * Sample 2: Master Bedroom with Two Windows (4.0m x 3.5m)
 * Features cross-ventilation via opposing north/south windows, double bed, wardrobe, ceiling fan, and nightstand.
 */
export function createBedroomSample(): Room {
  const roomData = {
    version: 1 as const,
    name: 'Bedroom with Two Windows (4x3.5m)',
    wallHeight: 2.7,
    wallThickness: 0.15,
    outline: [
      [-2.0, -1.75],
      [2.0, -1.75],
      [2.0, 1.75],
      [-2.0, 1.75],
    ] as [number, number][],
    openings: [
      {
        id: 'bed-window-south',
        wallIndex: 0,
        type: 'window' as const,
        offset: 1.25,
        width: 1.5,
        height: 1.2,
        sill: 0.9,
        role: 'inlet' as const,
        openFraction: 0.8,
      },
      {
        id: 'bed-window-north',
        wallIndex: 2,
        type: 'window' as const,
        offset: 1.4,
        width: 1.2,
        height: 1.2,
        sill: 0.9,
        role: 'outlet' as const,
        openFraction: 0.8,
      },
      {
        id: 'bed-door-west',
        wallIndex: 3,
        type: 'door' as const,
        offset: 0.7,
        width: 0.9,
        height: 2.1,
        sill: 0.0,
        role: 'closed' as const,
        openFraction: 0,
      },
    ],
    objects: [
      {
        id: 'bed-double',
        assetId: 'double-bed',
        name: 'Queen Bed',
        position: [0, 0, -0.5] as [number, number, number],
        rotation: [0, 0, 0] as [number, number, number],
        size: [1.5, 0.55, 2.0] as [number, number, number],
        elevation: 0,
        role: 'solid' as const,
        wallMounted: false,
        color: '#4338ca',
      },
      {
        id: 'bed-wardrobe',
        assetId: 'wardrobe',
        name: 'Wardrobe',
        position: [-1.2, 0, 1.2] as [number, number, number],
        rotation: [0, 0, 0] as [number, number, number],
        size: [1.2, 2.0, 0.6] as [number, number, number],
        elevation: 0,
        role: 'solid' as const,
        wallMounted: false,
        color: '#78350f',
      },
      {
        id: 'bed-ceiling-fan',
        assetId: 'ceiling-fan',
        name: 'Ceiling Fan',
        position: [0, 2.4, 0] as [number, number, number],
        rotation: [0, 0, 0] as [number, number, number],
        size: [1.2, 0.35, 1.2] as [number, number, number],
        elevation: 2.4,
        role: 'source' as const,
        wallMounted: false,
        color: '#0369a1',
        defaultAirflow: 650,
      },
      {
        id: 'bed-side-table',
        assetId: 'coffee-table',
        name: 'Nightstand Table',
        position: [1.2, 0, 1.1] as [number, number, number],
        rotation: [0, 0, 0] as [number, number, number],
        size: [1.0, 0.45, 0.6] as [number, number, number],
        elevation: 0,
        role: 'solid' as const,
        wallMounted: false,
        color: '#b45309',
      },
    ],
    params: {
      windSpeed: 3.5,
      windDirDeg: 180,
      pressurePa: 101325,
      indoorTempC: 21.0,
      outdoorTempC: 26.0,
      humidity: 52.0,
      datetime: '2026-10-05T22:00:00Z',
    },
  };

  return RoomSchema.parse(roomData);
}
