import { describe, expect, it } from 'vitest';
import { LABEL_GAP_PX, resolveOverlaps } from './layout';

const overlap = (a: number[], b: number[]) => a[0]! < b[0]! + b[2]! && b[0]! < a[0]! + a[2]! && a[1]! < b[1]! + b[3]! && b[1]! < a[1]! + a[3]!;

describe('room chip layout', () => {
  it('pushes overlapping chips apart until none overlap, moving them as little as needed', () => {
    // Five chips piled near one spot (rooms whose centres project close together)
    const rects: [number, number, number, number][] = [
      [100, 100, 120, 22],
      [110, 105, 90, 22],
      [95, 112, 130, 22],
      [400, 300, 100, 22],
      [104, 98, 80, 22],
    ];
    const pos = resolveOverlaps(rects);
    const placed = rects.map(([, , w, h], i) => [pos[i]![0], pos[i]![1], w, h]);
    for (let a = 0; a < placed.length; a++) for (let b = a + 1; b < placed.length; b++) expect(overlap(placed[a]!, placed[b]!)).toBe(false);
    // A chip that overlapped nothing stays put
    expect(pos[3]).toEqual([400, 300]);
    // Wide chips separate vertically (stacked), not sideways
    expect(new Set(pos.slice(0, 3).map((p) => Math.round(p[1]))).size).toBe(3);
    expect(LABEL_GAP_PX).toBeGreaterThan(0);
  });
});

describe('chip anchoring', () => {
  it('puts the label anchor at the visual centre of an L-shaped room, inside it', async () => {
    const { poleOfInaccessibility, pointInPolygon } = await import('./layout');
    const L: [number, number][] = [[0, 0], [6, 0], [6, 2], [2, 2], [2, 6], [0, 6]];
    const { point, distance } = poleOfInaccessibility(L);
    expect(pointInPolygon(point, L)).toBe(true);
    expect(distance).toBeGreaterThan(0.9); // the arms are 2 m wide
    // The centroid of this L (≈ 2.07, 2.07) is at the inner corner; the pole is not
    const rect: [number, number][] = [[0, 0], [4, 0], [4, 3], [0, 3]];
    const r = poleOfInaccessibility(rect);
    expect(r.point[0]).toBeCloseTo(2, 1);
    expect(r.point[1]).toBeCloseTo(1.5, 1);
  });

  it('tests rects against room outlines and keeps labels off fixed panels', async () => {
    const { rectInsidePolygon, rectsOverlap } = await import('./layout');
    const room: [number, number][] = [[0, 0], [200, 0], [200, 100], [0, 100]];
    expect(rectInsidePolygon([10, 10, 50, 20], room)).toBe(true);
    expect(rectInsidePolygon([180, 10, 50, 20], room)).toBe(false);
    const legend: [number, number, number, number] = [0, 200, 240, 160];
    const pos = resolveOverlaps([[100, 250, 90, 30]], 40, [legend]);
    expect(rectsOverlap([pos[0]![0], pos[0]![1], 90, 30], legend)).toBe(false);
  });

  it('shortens room names for chips', async () => {
    const { shortRoomName } = await import('./layout');
    expect(shortRoomName('Default Room (4×3m)')).toBe('Default Room');
    expect(shortRoomName('Kitchen')).toBe('Kitchen');
    expect(shortRoomName('A very long master bedroom name')).toBe('A very long mas…');
  });
});
