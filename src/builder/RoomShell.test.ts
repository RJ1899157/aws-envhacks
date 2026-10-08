import { describe, expect, it } from 'vitest';
import { computeWallPieces, RoomShell } from './RoomShell';
import { FloorPlanEditor } from './FloorPlanEditor';

describe('RoomShell & computeWallPieces (CSG-free cutouts)', () => {
  it('exports RoomShell and FloorPlanEditor components', () => {
    expect(RoomShell).toBeDefined();
    expect(FloorPlanEditor).toBeDefined();
  });

  it('returns empty array for non-positive dimensions', () => {
    expect(computeWallPieces(0, 2.7, [])).toEqual([]);
    expect(computeWallPieces(-5, 2.7, [])).toEqual([]);
    expect(computeWallPieces(4, 0, [])).toEqual([]);
  });

  it('returns a single full piece for a wall without openings', () => {
    const pieces = computeWallPieces(4.0, 2.7, []);
    expect(pieces).toHaveLength(1);
    expect(pieces[0]).toEqual({
      uStart: 0,
      uEnd: 4.0,
      vStart: 0,
      vEnd: 2.7,
      width: 4.0,
      height: 2.7,
      type: 'full',
    });
  });

  it('splits wall around a window with sill and lintel', () => {
    const wallLength = 4.0;
    const wallHeight = 2.7;
    const windowOpening = {
      offset: 1.0,
      width: 1.2,
      sill: 0.9,
      height: 1.2, // reaches 0.9 + 1.2 = 2.1m (lintel is 2.1 to 2.7m)
    };

    const pieces = computeWallPieces(wallLength, wallHeight, [windowOpening]);
    expect(pieces).toHaveLength(4);

    // 1. Left full-height segment
    expect(pieces[0]).toMatchObject({
      uStart: 0,
      uEnd: 1.0,
      vStart: 0,
      vEnd: 2.7,
      width: 1.0,
      height: 2.7,
      type: 'full',
    });

    // 2. Sill piece below window
    expect(pieces[1]).toMatchObject({
      uStart: 1.0,
      uEnd: 2.2,
      vStart: 0,
      vEnd: 0.9,
      width: 1.2,
      height: 0.9,
      type: 'sill',
    });

    // 3. Lintel piece above window
    expect(pieces[2]).toMatchObject({
      uStart: 1.0,
      uEnd: 2.2,
      vStart: 2.1,
      vEnd: 2.7,
      width: 1.2,
      height: 0.6,
      type: 'lintel',
    });

    // 4. Right full-height segment
    expect(pieces[3]).toMatchObject({
      uStart: 2.2,
      uEnd: 4.0,
      vStart: 0,
      vEnd: 2.7,
      width: 1.8,
      height: 2.7,
      type: 'full',
    });

    // Verify exact surface area matches wall area minus cutout
    const totalSolidArea = pieces.reduce((sum, p) => sum + p.width * p.height, 0);
    const expectedArea = wallLength * wallHeight - windowOpening.width * windowOpening.height;
    expect(totalSolidArea).toBeCloseTo(expectedArea, 6);
  });

  it('splits wall around a door with sill = 0', () => {
    const wallLength = 3.0;
    const wallHeight = 2.7;
    const doorOpening = {
      offset: 0.8,
      width: 0.9,
      sill: 0.0,
      height: 2.1,
    };

    const pieces = computeWallPieces(wallLength, wallHeight, [doorOpening]);
    expect(pieces).toHaveLength(3);

    // 1. Left full segment
    expect(pieces[0]!.type).toBe('full');
    expect(pieces[0]!.width).toBeCloseTo(0.8);

    // 2. Lintel above door (no sill because sill is 0)
    expect(pieces[1]!.type).toBe('lintel');
    expect(pieces[1]!.vStart).toBeCloseTo(2.1);
    expect(pieces[1]!.vEnd).toBeCloseTo(2.7);

    // 3. Right full segment
    expect(pieces[2]!.type).toBe('full');
    expect(pieces[2]!.width).toBeCloseTo(1.3);

    const totalSolidArea = pieces.reduce((sum, p) => sum + p.width * p.height, 0);
    const expectedArea = wallLength * wallHeight - doorOpening.width * doorOpening.height;
    expect(totalSolidArea).toBeCloseTo(expectedArea, 6);
  });

  it('correctly handles multiple openings on a single wall', () => {
    const wallLength = 6.0;
    const wallHeight = 3.0;
    const openings = [
      { offset: 1.0, width: 1.0, sill: 1.0, height: 1.0 },
      { offset: 3.5, width: 1.2, sill: 0.0, height: 2.2 },
    ];

    const pieces = computeWallPieces(wallLength, wallHeight, openings);

    // Should include:
    // - Full segment [0, 1.0]
    // - Window 1 sill [1.0, 2.0]
    // - Window 1 lintel [1.0, 2.0]
    // - Wall between openings [2.0, 3.5]
    // - Door lintel [3.5, 4.7]
    // - Full segment [4.7, 6.0]
    expect(pieces).toHaveLength(6);

    const totalSolidArea = pieces.reduce((sum, p) => sum + p.width * p.height, 0);
    const cutoutsArea = 1.0 * 1.0 + 1.2 * 2.2;
    expect(totalSolidArea).toBeCloseTo(wallLength * wallHeight - cutoutsArea, 6);
  });
});
