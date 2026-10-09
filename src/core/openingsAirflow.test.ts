import { describe, expect, it } from 'vitest';
import { createDefaultRoom } from './defaultRoom';
import { createRoomOfType } from './rooms';
import { CellType, voxelize } from './voxelizer';
import { openingSubTypeFor, placeOnNearestWall } from './openingPresets';
import type { Opening, Room } from './schema';

const countCells = (room: Room, type: number, neighbours: Room[] = []) =>
  Array.from(voxelize(room, 0.1, neighbours).cells).filter((c) => c === type).length;

const door = (overrides: Partial<Opening> = {}): Opening => ({
  id: 'door', wallIndex: 3, type: 'door', offset: 0.5, width: 0.9, height: 2.1, sill: 0,
  role: 'outlet', openFraction: 0.5, ...overrides,
});

describe('openings let air through', () => {
  it('a door on a shared wall opens the airflow domain of both rooms', () => {
    const main = createDefaultRoom();
    const bath: Room = { ...createRoomOfType('bathroom', [main], main), openings: [door()] };

    expect(countCells(main, CellType.OUTLET)).toBe(0);
    expect(countCells(main, CellType.INLET)).toBe(0);
    // Air leaving the bathroom through the door enters the main room
    expect(countCells(main, CellType.INLET, [bath])).toBeGreaterThan(0);
    expect(countCells(bath, CellType.OUTLET, [main])).toBeGreaterThan(0);
  });

  it('a closed or 0% open opening stays solid', () => {
    const main = createDefaultRoom();
    expect(countCells({ ...main, openings: [door({ wallIndex: 0, role: 'closed' })] }, CellType.OUTLET)).toBe(0);
    expect(countCells({ ...main, openings: [door({ wallIndex: 0, openFraction: 0 })] }, CellType.OUTLET)).toBe(0);
  });
});

describe('wall-mounted assets', () => {
  it('only doors, windows, vents and passages are openings', () => {
    for (const id of ['single-door', 'window', 'vent', 'archway', 'open-wall', 'door']) expect(openingSubTypeFor(id)).not.toBeNull();
    for (const id of ['ac-split', 'exhaust-fan', 'curtains']) expect(openingSubTypeFor(id)).toBeNull();
  });

  it('hangs an appliance flush on the nearest wall, facing into the room', () => {
    const room = createDefaultRoom(); // right wall at x = 2
    const placed = placeOnNearestWall(1.8, 0.2, room, [0.9, 0.3, 0.25])!;
    expect(placed.position[0]).toBeCloseTo(2 - 0.125);
    expect(placed.position[2]).toBeCloseTo(0.2);
    // Front (+Z) turned to face -X, into the room
    expect(Math.sin(placed.rotY)).toBeCloseTo(-1);
  });
});
