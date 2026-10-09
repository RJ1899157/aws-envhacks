import { describe, expect, it } from 'vitest';
import { createDefaultRoom } from './defaultRoom';
import { polygonBounds } from './parser';
import { createRoomOfType, sharedWallOpenings, snapRoomMove, snapWallMove } from './rooms';
import type { Room } from './schema';

describe('createRoomOfType', () => {
  it('creates a typed room one wall thickness to the right of existing rooms', () => {
    const main = createDefaultRoom(); // x from -2 to 2
    const bath = createRoomOfType('bathroom', [main], main);
    const b = polygonBounds(bath.outline);

    expect(bath.type).toBe('bathroom');
    expect(bath.name).toBe('Bathroom');
    expect(bath.id).toBeTruthy();
    expect(b.min[0]).toBeCloseTo(2 + main.wallThickness);
    expect(b.width).toBeCloseTo(2.4);
    expect(b.depth).toBeCloseTo(2);
    expect(b.min[1]).toBeCloseTo(-1.5);
  });

  it('numbers duplicate room names', () => {
    const main = createDefaultRoom();
    const k1 = createRoomOfType('kitchen', [main]);
    const k2 = createRoomOfType('kitchen', [main, k1]);
    expect(k2.name).toBe('Kitchen 2');
  });
});

describe('sharedWallOpenings', () => {
  it('maps a door on the neighbour’s shared wall onto this room’s wall', () => {
    const main = createDefaultRoom(); // wall 1 runs (2,-1.5) -> (2,1.5)
    const bath: Room = {
      ...createRoomOfType('bathroom', [main], main), // x from 2.15; wall 3 runs (2.15,0.5) -> (2.15,-1.5)
      openings: [
        { id: 'door', wallIndex: 3, type: 'door', offset: 0.5, width: 0.9, height: 2.1, sill: 0, role: 'closed', openFraction: 0 },
      ],
    };

    const shared = sharedWallOpenings(main, 1, [bath]);
    expect(shared).toHaveLength(1);
    // Bath wall 3 starts at z=0.5 heading -Z: door spans z in [-0.9, 0]. Main wall 1 starts at z=-1.5 heading +Z.
    expect(shared[0]!.offset).toBeCloseTo(0.6);
    expect(shared[0]!.width).toBeCloseTo(0.9);
    expect(shared[0]!.height).toBeCloseTo(2.1);

    expect(sharedWallOpenings(main, 0, [bath])).toHaveLength(0);
  });
});

describe('snapRoomMove', () => {
  it('pulls a nearby room flush against a neighbour, one wall thickness apart', () => {
    const main = createDefaultRoom();
    const moving = createRoomOfType('kitchen', [main]); // starts flush at x = 2.15
    // Drag it 0.2 m further right: should snap back to flush
    const snapped = snapRoomMove(moving.outline, [0.2, 0], [main], 0.15);
    expect(snapped[0]).toBeCloseTo(0);
  });

  it('leaves the delta alone when no neighbour is close', () => {
    const main = createDefaultRoom();
    const moving = createRoomOfType('kitchen', [main]);
    const snapped = snapRoomMove(moving.outline, [3, 0], [main], 0.15);
    expect(snapped[0]).toBeCloseTo(3);
  });
});

describe('snapWallMove', () => {
  it('snaps a stretched wall flush to the neighbour and never pushes into it', () => {
    const main = createDefaultRoom(); // wall 1 at x = 2, outward +X
    const bath = createRoomOfType('bathroom', [main], main);
    // Move the bathroom away so there is a 1 m gap: bath left wall at x = 3.15
    const shifted: Room = { ...bath, outline: bath.outline.map(([x, z]) => [x + 1, z] as [number, number]) };

    expect(snapWallMove(main.outline, 1, 0.5, [shifted], 0.15)).toBeCloseTo(0.5); // free
    expect(snapWallMove(main.outline, 1, 0.85, [shifted], 0.15)).toBeCloseTo(1.0); // snaps flush
    expect(snapWallMove(main.outline, 1, 2.0, [shifted], 0.15)).toBeCloseTo(1.0); // blocked
    expect(snapWallMove(main.outline, 1, -0.5, [shifted], 0.15)).toBeCloseTo(-0.5); // shrinking is free
  });
});
