import { describe, expect, it } from 'vitest';
import { createRoomOfType } from '../core/rooms';
import { createLivingRoomSample } from '../core/samples';
import { effectiveOpenArea, floorArea, interiorOpeningIds, openingGeometries, roomVolume } from './geometry';
import { rectRoom, opening } from '../test/simulationFixtures';

describe('room volume', () => {
  it('rectangle: width × depth × height', () => {
    expect(roomVolume(rectRoom(4, 3, 2.5))).toBeCloseTo(30);
  });

  it('L-shaped room: polygon area × height', () => {
    // 6 × 5 rectangle minus a 2 × 2.5 notch = 25 m², × 2.8 m
    const living = createLivingRoomSample();
    expect(floorArea(living)).toBeCloseTo(25);
    expect(roomVolume(living)).toBeCloseTo(70);

    const l = rectRoom(1, 1, 3, {
      outline: [
        [0, 0],
        [4, 0],
        [4, 1],
        [1, 1],
        [1, 3],
        [0, 3],
      ],
    });
    expect(roomVolume(l)).toBeCloseTo((4 * 1 + 1 * 2) * 3);
  });
});

describe('volume with per-wall heights', () => {
  it('uses the perimeter-weighted mean wall height', () => {
    // 4 × 2 room: walls 0 and 2 are 4 m long, walls 1 and 3 are 2 m. Raise wall 0 to 3.5 m.
    const room = rectRoom(4, 2, 2.5, { wallOverrides: { 0: { height: 3.5 } } });
    const mean = (4 * 3.5 + 2 * 2.5 + 4 * 2.5 + 2 * 2.5) / 12;
    expect(roomVolume(room)).toBeCloseTo(8 * mean);
    // Overrides that only change thickness or colour leave the volume alone
    expect(roomVolume(rectRoom(4, 2, 2.5, { wallOverrides: { 1: { thickness: 0.3 } } }))).toBeCloseTo(20);
  });

  it('clips openings to their own wall height', () => {
    const room = rectRoom(4, 2, 2.5, {
      wallOverrides: { 0: { height: 2.2 } },
      openings: [opening('w', 0, { sill: 1.5, height: 1 })],
    });
    expect(openingGeometries(room)[0]!.effectiveArea).toBeCloseTo(0.7);
  });
});

describe('openings', () => {
  it('effective area is width × height × open fraction, 0 when closed', () => {
    expect(effectiveOpenArea(opening('w', 0, { width: 1.2, height: 1.5, openFraction: 0.5 }), 2.7)).toBeCloseTo(0.9);
    expect(effectiveOpenArea(opening('w', 0, { role: 'closed' }), 2.7)).toBe(0);
    expect(effectiveOpenArea(opening('w', 0, { openFraction: 0 }), 2.7)).toBe(0);
    // Clipped at the ceiling
    expect(effectiveOpenArea(opening('w', 0, { sill: 2, height: 1 }), 2.5)).toBeCloseTo(0.5);
  });

  it('normal points out of the room and centre sits on the wall', () => {
    const room = rectRoom(4, 3, 2.5, { openings: [opening('s', 0), opening('e', 1), opening('n', 2), opening('w', 3)] });
    const g = Object.fromEntries(openingGeometries(room).map((o) => [o.id, o]));
    expect(g.s!.normal[0]).toBeCloseTo(0);
    expect(g.s!.normal[1]).toBeCloseTo(-1);
    expect(g.e!.normal[0]).toBeCloseTo(1);
    expect(g.n!.normal[1]).toBeCloseTo(1);
    expect(g.w!.normal[0]).toBeCloseTo(-1);
    expect(g.s!.center).toEqual([1, 1.5, 0]);
    expect(g.s!.wallIndex).toBe(0);
  });

  it('flags openings on a wall shared with a neighbouring room as interior', () => {
    const main = rectRoom(4, 3, 2.7);
    const bath = createRoomOfType('bathroom', [main], main); // placed to the +X side
    const withDoor = { ...main, openings: [opening('door', 1, { offset: 0.5, type: 'door', sill: 0, height: 2 }), opening('win', 0)] };
    expect([...interiorOpeningIds(withDoor, [bath])]).toEqual(['door']);
  });
});
