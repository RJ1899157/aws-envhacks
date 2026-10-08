import { describe, expect, it } from 'vitest';
import { computeSmartSnap } from './smartSnap';
import type { Room, SceneObject } from './schema';
import { degToRad } from './units';

describe('computeSmartSnap', () => {
  const sampleRoom: Room = {
    version: 1,
    name: 'Test Room',
    outline: [
      [0, 0],
      [4, 0],
      [4, 3],
      [0, 3],
    ],
    wallHeight: 2.8,
    wallThickness: 0.15,
    openings: [],
    objects: [],
    floorMaterial: "wood", wallMaterial: "paint", params: {
      windSpeed: 2.5,
      windDirDeg: 45,
      indoorTempC: 22,
      outdoorTempC: 28,
      humidity: 50,
      pressurePa: 101325,
      datetime: '2026-05-15T14:00:00Z',
    },
  };

  it('snaps coordinates to grid step when isolated and snapping enabled', () => {
    const res = computeSmartSnap({
      candidatePos: [1.03, 0, 1.48],
      candidateRotY: 0,
      objectSize: [0.8, 1.0, 0.8],
      startPos: [1.0, 0, 1.5],
      room: sampleRoom,
      gridStep: 0.05,
      snapEnabled: true,
    });

    expect(res.snappedPos[0]).toBeCloseTo(1.05);
    expect(res.snappedPos[2]).toBeCloseTo(1.5);
    expect(res.alignmentGuides).toHaveLength(0);
  });

  it('disables all snapping when ctrlKey is true', () => {
    const res = computeSmartSnap({
      candidatePos: [1.034, 0.123, 1.487],
      candidateRotY: 0.12,
      objectSize: [0.8, 1.0, 0.8],
      startPos: [1.0, 0, 1.5],
      room: sampleRoom,
      gridStep: 0.05,
      snapEnabled: true,
      ctrlKey: true,
    });

    expect(res.snappedPos[0]).toBe(1.034);
    expect(res.snappedPos[1]).toBe(0.123);
    expect(res.snappedPos[2]).toBe(1.487);
    expect(res.snappedRotY).toBe(0.12);
    expect(res.alignmentGuides).toHaveLength(0);
  });

  it('constrains to dominant axis when shiftKey is true', () => {
    // Moved mostly in X (dx = 0.8, dz = 0.1)
    const resX = computeSmartSnap({
      candidatePos: [1.8, 0, 1.1],
      candidateRotY: 0,
      objectSize: [0.8, 1.0, 0.8],
      startPos: [1.0, 0, 1.0],
      room: sampleRoom,
      gridStep: 0.05,
      snapEnabled: true,
      shiftKey: true,
    });

    // Z should be locked to startPos[2] = 1.0
    expect(resX.snappedPos[2]).toBeCloseTo(1.0);
    expect(resX.snappedPos[0]).toBeCloseTo(1.8);

    // Moved mostly in Z (dx = 0.1, dz = 0.9)
    const resZ = computeSmartSnap({
      candidatePos: [1.1, 0, 1.9],
      candidateRotY: 0,
      objectSize: [0.8, 1.0, 0.8],
      startPos: [1.0, 0, 1.0],
      room: sampleRoom,
      gridStep: 0.05,
      snapEnabled: true,
      shiftKey: true,
    });

    // X should be locked to startPos[0] = 1.0
    expect(resZ.snappedPos[0]).toBeCloseTo(1.0);
    expect(resZ.snappedPos[2]).toBeCloseTo(1.9);
  });

  it('snaps object edge flush to wall face within 0.15m', () => {
    // Wall 0 goes from [0,0] to [4,0] along Z=0.
    // Object depth is 1.0m (hd = 0.5m). Back edge is at Z - 0.5.
    // Candidate Z = 0.58m => back edge is at 0.08m from wall (<= 0.15m)
    const res = computeSmartSnap({
      candidatePos: [2.0, 0, 0.58],
      candidateRotY: 0,
      objectSize: [1.0, 1.0, 1.0],
      startPos: [2.0, 0, 1.0],
      room: sampleRoom,
      gridStep: 0.05,
      snapEnabled: true,
      autoOrientToWall: false,
    });

    expect(res.isWallSnapped).toBe(true);
    // Center Z should snap so back is flush at Z=0 (center Z = 0.5)
    expect(res.snappedPos[2]).toBeCloseTo(0.5);
    expect(res.alignmentGuides.some((g) => g.type === 'wall')).toBe(true);
  });

  it('auto-orients to face away from wall when autoOrientToWall is true', () => {
    // Wall 0 along Z=0 has outward normal [0, -1] and inward normal [0, 1] (+Z)
    // Object should face +Z (angle PI)
    const res = computeSmartSnap({
      candidatePos: [2.0, 0, 0.56],
      candidateRotY: 0,
      objectSize: [1.0, 1.0, 1.0],
      startPos: [2.0, 0, 1.0],
      room: sampleRoom,
      gridStep: 0.05,
      snapEnabled: true,
      autoOrientToWall: true,
    });

    expect(res.isWallSnapped).toBe(true);
    expect(Math.abs(res.snappedRotY)).toBeCloseTo(Math.PI);
  });

  it('snaps to other object center and edges within 0.1m and generates guides', () => {
    const existingDesk: SceneObject = {
      id: 'desk-1',
      assetId: 'office-desk',
      name: 'Desk',
      position: [2.0, 0, 2.0],
      rotation: [0, 0, 0],
      size: [1.2, 0.75, 0.6], // hw = 0.6, hd = 0.3
      elevation: 0,
      role: 'solid',
      wallMounted: false,
    };

    const roomWithDesk: Room = {
      ...sampleRoom,
      objects: [existingDesk],
    };

    // Candidate chair with W = 0.6 (hw = 0.3), D = 0.6 (hd = 0.3)
    // Candidate X is 2.04 (within 0.1m of desk center X = 2.0)
    const res = computeSmartSnap({
      candidatePos: [2.04, 0, 1.0],
      candidateRotY: 0,
      objectSize: [0.6, 0.9, 0.6],
      startPos: [1.5, 0, 1.0],
      room: roomWithDesk,
      objectId: 'chair-1',
      gridStep: 0.05,
      snapEnabled: true,
    });

    expect(res.isObjectSnapped).toBe(true);
    expect(res.snappedPos[0]).toBeCloseTo(2.0); // snapped to desk center X
    expect(res.alignmentGuides.some((g) => g.type === 'object')).toBe(true);
  });

  it('snaps elevation Y to 0.05m when transformY is active and clamps to wallHeight', () => {
    const res = computeSmartSnap({
      candidatePos: [2.0, 1.43, 2.0],
      candidateRotY: 0,
      objectSize: [0.5, 0.5, 0.5],
      startPos: [2.0, 0, 2.0],
      room: sampleRoom,
      gridStep: 0.05,
      snapEnabled: true,
      transformY: true,
    });

    expect(res.snappedPos[1]).toBeCloseTo(1.45);

    // Over ceiling test
    const resHigh = computeSmartSnap({
      candidatePos: [2.0, 4.5, 2.0],
      candidateRotY: 0,
      objectSize: [0.5, 0.5, 0.5],
      startPos: [2.0, 0, 2.0],
      room: sampleRoom,
      gridStep: 0.05,
      snapEnabled: true,
      transformY: true,
    });

    expect(resHigh.snappedPos[1]).toBeCloseTo(sampleRoom.wallHeight);
  });

  it('snaps rotation in 15 degree steps', () => {
    // 16 degrees in radians = 16 * PI / 180 = 0.27925 rad
    // should snap to 15 degrees = 0.2618 rad
    const res = computeSmartSnap({
      candidatePos: [2.0, 0, 2.0],
      candidateRotY: degToRad(16),
      objectSize: [0.5, 0.5, 0.5],
      startPos: [2.0, 0, 2.0],
      room: sampleRoom,
      gridStep: 0.05,
      snapEnabled: true,
    });

    expect(res.snappedRotY).toBeCloseTo(degToRad(15), 3);
  });
});
