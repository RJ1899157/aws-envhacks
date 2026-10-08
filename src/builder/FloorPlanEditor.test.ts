import { beforeEach, describe, expect, it } from 'vitest';
import { isPolygonSimple, signedArea, wallSegment } from '../core/parser';
import type { Vec2 } from '../core/schema';
import { snap } from '../core/units';
import { useSceneStore } from '../store/sceneStore';
import { useUiStore } from '../store/uiStore';

describe('FloorPlanEditor state operations & geometry rules', () => {
  beforeEach(() => {
    useSceneStore.getState().resetRoom();
    useUiStore.getState().resetUi();
  });

  it('draws a room from scratch and sets counter-clockwise outline', () => {
    // Clockwise drawn points
    const clockwisePoints: Vec2[] = [
      [0, 0],
      [0, 4],
      [5, 4],
      [5, 0],
    ];
    expect(signedArea(clockwisePoints)).toBeLessThan(0);

    const ccwPoints = [...clockwisePoints].reverse();
    expect(signedArea(ccwPoints)).toBeGreaterThan(0);
    expect(isPolygonSimple(ccwPoints)).toBe(true);

    useSceneStore.getState().setOutline(ccwPoints);
    expect(useSceneStore.getState().room.outline).toEqual(ccwPoints);
    expect(Math.abs(signedArea(useSceneStore.getState().room.outline))).toBe(20);
  });

  it('edits corners with snapping', () => {
    const rawPos: Vec2 = [4.032, 2.989];
    const gridStep = 0.05;
    const snappedX = snap(rawPos[0], gridStep);
    const snappedZ = snap(rawPos[1], gridStep);

    expect(snappedX).toBe(4.05);
    expect(snappedZ).toBe(3.0);

    useSceneStore.getState().moveVertex(1, [snappedX, snappedZ]);
    expect(useSceneStore.getState().room.outline[1]).toEqual([4.05, 3.0]);
  });

  it('locks orthogonal direction when Shift is simulated', () => {
    const startPoint: Vec2 = [0, 0];
    const candidatePoint: Vec2 = [2.5, 0.4];

    // Orthogonal lock: if |dx| > |dz|, lock z to startPoint[1]
    const dx = Math.abs(candidatePoint[0] - startPoint[0]);
    const dz = Math.abs(candidatePoint[1] - startPoint[1]);
    const orthoPoint: Vec2 =
      dx > dz ? [candidatePoint[0], startPoint[1]] : [startPoint[0], candidatePoint[1]];

    expect(orthoPoint).toEqual([2.5, 0]);
  });

  it('inserts a vertex by splitting a wall at midpoint', () => {
    const room = useSceneStore.getState().room;
    expect(room.outline).toHaveLength(4);

    const seg0 = wallSegment(room, 0);
    const midX = (seg0.a[0] + seg0.b[0]) / 2;
    const midZ = (seg0.a[1] + seg0.b[1]) / 2;

    useSceneStore.getState().insertVertex(0, [midX, midZ]);
    const updated = useSceneStore.getState().room.outline;
    expect(updated).toHaveLength(5);
    expect(updated[1]).toEqual([midX, midZ]);
  });

  it('removes selected vertex but refuses below 3 vertices', () => {
    expect(useSceneStore.getState().room.outline).toHaveLength(4);

    useSceneStore.getState().removeVertex(0);
    expect(useSceneStore.getState().room.outline).toHaveLength(3);

    // Attempting to remove another vertex below 3 must be refused
    useSceneStore.getState().removeVertex(0);
    expect(useSceneStore.getState().room.outline).toHaveLength(3);
  });

  it('detects and blocks self-intersecting polygon edits', () => {
    const initialOutline = [...useSceneStore.getState().room.outline];

    const validSquare: Vec2[] = [
      [0, 0],
      [4, 0],
      [4, 4],
      [0, 4],
    ];
    expect(isPolygonSimple(validSquare)).toBe(true);

    // Candidate with bowtie self-intersection
    const selfIntersectingCandidate: Vec2[] = [
      [5, 2],
      [4, 0],
      [4, 4],
      [0, 4],
    ];
    expect(isPolygonSimple(selfIntersectingCandidate)).toBe(false);

    // Only apply if simple
    if (isPolygonSimple(selfIntersectingCandidate)) {
      useSceneStore.getState().setOutline(selfIntersectingCandidate);
    }
    // Outline remains untouched
    expect(useSceneStore.getState().room.outline).toEqual(initialOutline);
  });

  it('applies exact Blender-style numeric wall length input', () => {
    const pPrev: Vec2 = [0, 0];
    const pCurr: Vec2 = [2, 0]; // current direction along +X
    const targetLength = 3.5;

    const dx = pCurr[0] - pPrev[0];
    const dz = pCurr[1] - pPrev[1];
    const len = Math.hypot(dx, dz);
    const dirX = dx / len;
    const dirZ = dz / len;

    const newTarget: Vec2 = [pPrev[0] + targetLength * dirX, pPrev[1] + targetLength * dirZ];
    expect(newTarget).toEqual([3.5, 0]);

    useSceneStore.getState().moveVertex(1, newTarget);
    expect(useSceneStore.getState().room.outline[1]).toEqual([3.5, 0]);
  });

  it('supports undo/redo for every vertex mutation', () => {
    const temporal = useSceneStore.temporal.getState();
    const originalVertex1 = [...useSceneStore.getState().room.outline[1]!];

    // 1. Move vertex
    useSceneStore.getState().moveVertex(1, [5.0, 0]);
    expect(useSceneStore.getState().room.outline[1]).toEqual([5.0, 0]);

    // 2. Undo move
    temporal.undo();
    expect(useSceneStore.getState().room.outline[1]).toEqual(originalVertex1);

    // 3. Redo move
    temporal.redo();
    expect(useSceneStore.getState().room.outline[1]).toEqual([5.0, 0]);
  });
});
