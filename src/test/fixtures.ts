import { createDefaultRoom } from '../core/defaultRoom';
import { RoomSchema, type Room } from '../core/schema';

/** Default 4x3m room plus a window inlet on wall 0 and a door outlet on wall 2. */
export function createVentilatedRoom(): Room {
  return RoomSchema.parse({
    ...createDefaultRoom(),
    openings: [
      {
        id: 'default-window-1',
        wallIndex: 0,
        type: 'window',
        offset: 1.4,
        width: 1.2,
        height: 1.2,
        sill: 0.9,
        role: 'inlet',
        openFraction: 0.5,
      },
      {
        id: 'default-door-1',
        wallIndex: 2,
        type: 'door',
        offset: 0.5,
        width: 0.9,
        height: 2.1,
        sill: 0.0,
        role: 'outlet',
        openFraction: 0.5,
      },
    ],
  });
}
