/** Gap kept between labels (px). */
export const LABEL_GAP_PX = 4;

/**
 * Screen-space collision avoidance: chips start centred on their anchors and are pushed apart
 * (mostly vertically, the cheaper direction for wide chips) until no two overlap, and off any
 * fixed `obstacles` (legend, panels). Rects are [x, y, w, h] in px; returns the adjusted top-left
 * corners.
 */
export function resolveOverlaps(rects: readonly [number, number, number, number][], iterations = 40, obstacles: readonly [number, number, number, number][] = []): [number, number][] {
  const pos = rects.map(([x, y]) => [x, y] as [number, number]);
  for (let it = 0; it < iterations; it++) {
    let moved = false;
    // Fixed obstacles (legend, panels) push labels off them without moving themselves
    for (let a = 0; a < rects.length; a++)
      for (const [ox0, oy0, ow, oh] of obstacles) {
        const [, , wa, ha] = rects[a]!;
        const pa = pos[a]!;
        const ox = Math.min(pa[0] + wa, ox0 + ow) - Math.max(pa[0], ox0) + LABEL_GAP_PX;
        const oy = Math.min(pa[1] + ha, oy0 + oh) - Math.max(pa[1], oy0) + LABEL_GAP_PX;
        if (ox <= 0 || oy <= 0) continue;
        moved = true;
        if (oy <= ox) pa[1] += pa[1] + ha / 2 <= oy0 + oh / 2 ? -oy : oy;
        else pa[0] += pa[0] + wa / 2 <= ox0 + ow / 2 ? -ox : ox;
      }
    for (let a = 0; a < rects.length; a++)
      for (let b = a + 1; b < rects.length; b++) {
        const [, , wa, ha] = rects[a]!;
        const [, , wb, hb] = rects[b]!;
        const pa = pos[a]!;
        const pb = pos[b]!;
        const ox = Math.min(pa[0] + wa, pb[0] + wb) - Math.max(pa[0], pb[0]) + LABEL_GAP_PX;
        const oy = Math.min(pa[1] + ha, pb[1] + hb) - Math.max(pa[1], pb[1]) + LABEL_GAP_PX;
        if (ox <= 0 || oy <= 0) continue;
        moved = true;
        if (oy <= ox * 1.5) {
          const s = pa[1] + ha / 2 <= pb[1] + hb / 2 ? -1 : 1;
          pa[1] += (s * oy) / 2;
          pb[1] -= (s * oy) / 2;
        } else {
          const s = pa[0] + wa / 2 <= pb[0] + wb / 2 ? -1 : 1;
          pa[0] += (s * ox) / 2;
          pb[0] -= (s * ox) / 2;
        }
      }
    if (!moved) break;
  }
  return pos;
}

export type Pt = readonly [number, number];
export type Rect = [number, number, number, number];

/** Ray-casting point-in-polygon test (polygon as [x, y] vertices, either winding). */
export function pointInPolygon(p: Pt, poly: readonly Pt[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i]!;
    const [xj, yj] = poly[j]!;
    if (yi > p[1] !== yj > p[1] && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** Distance from p to the polygon's boundary, signed: positive inside. */
export function signedEdgeDistance(p: Pt, poly: readonly Pt[]): number {
  let best = Infinity;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [ax, ay] = poly[j]!;
    const [bx, by] = poly[i]!;
    const dx = bx - ax;
    const dy = by - ay;
    const l2 = dx * dx + dy * dy;
    const t = l2 > 0 ? Math.max(0, Math.min(1, ((p[0] - ax) * dx + (p[1] - ay) * dy) / l2)) : 0;
    best = Math.min(best, Math.hypot(p[0] - ax - t * dx, p[1] - ay - t * dy));
  }
  return pointInPolygon(p, poly) ? best : -best;
}

/**
 * Pole of inaccessibility (the "visual centre"): the interior point farthest from the outline,
 * found by quadtree refinement (Mapbox polylabel). Unlike the centroid it is always inside, even
 * for L- or U-shaped rooms. Returns the point and its distance to the nearest wall.
 */
export function poleOfInaccessibility(poly: readonly Pt[], precision = 0.02): { point: [number, number]; distance: number } {
  if (poly.length < 3) return { point: [poly[0]?.[0] ?? 0, poly[0]?.[1] ?? 0], distance: 0 };
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const [x, y] of poly) {
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  }
  const size = Math.min(maxX - minX, maxY - minY);
  if (size <= 0) return { point: [minX, minY], distance: 0 };
  type Cell = { x: number; y: number; h: number; d: number; max: number };
  const cell = (x: number, y: number, h: number): Cell => {
    const d = signedEdgeDistance([x, y], poly);
    return { x, y, h, d, max: d + h * Math.SQRT2 };
  };
  const queue: Cell[] = [];
  const h0 = size / 2;
  for (let x = minX; x < maxX; x += size) for (let y = minY; y < maxY; y += size) queue.push(cell(x + h0, y + h0, h0));
  // Start from the area centroid (good for convex rooms), falling back to the bbox centre
  let a = 0;
  let cx = 0;
  let cy = 0;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const f = poly[j]![0] * poly[i]![1] - poly[i]![0] * poly[j]![1];
    a += f;
    cx += (poly[j]![0] + poly[i]![0]) * f;
    cy += (poly[j]![1] + poly[i]![1]) * f;
  }
  let best = a !== 0 ? cell(cx / (3 * a), cy / (3 * a), 0) : cell((minX + maxX) / 2, (minY + maxY) / 2, 0);
  const bboxCell = cell((minX + maxX) / 2, (minY + maxY) / 2, 0);
  if (bboxCell.d > best.d) best = bboxCell;
  while (queue.length) {
    // Most promising cell first
    let k = 0;
    for (let i = 1; i < queue.length; i++) if (queue[i]!.max > queue[k]!.max) k = i;
    const c = queue.splice(k, 1)[0]!;
    if (c.d > best.d) best = c;
    if (c.max - best.d <= precision) continue;
    const h = c.h / 2;
    queue.push(cell(c.x - h, c.y - h, h), cell(c.x + h, c.y - h, h), cell(c.x - h, c.y + h, h), cell(c.x + h, c.y + h, h));
  }
  return { point: [best.x, best.y], distance: best.d };
}

/** Whether rect [x, y, w, h] lies entirely inside the polygon (corners and edge midpoints). */
export function rectInsidePolygon([x, y, w, h]: Rect, poly: readonly Pt[]): boolean {
  const pts: Pt[] = [
    [x, y],
    [x + w, y],
    [x, y + h],
    [x + w, y + h],
    [x + w / 2, y],
    [x + w / 2, y + h],
    [x, y + h / 2],
    [x + w, y + h / 2],
  ];
  return pts.every((p) => pointInPolygon(p, poly));
}

/** Room name for a chip: drops a trailing size note such as "(4×3m)" and caps the length. */
export function shortRoomName(name: string, max = 16): string {
  const base = name.replace(/\s*\([^)]*\d[^)]*\)\s*$/, '').trim() || name.trim();
  return base.length > max ? `${base.slice(0, max - 1).trimEnd()}…` : base;
}

/** Whether two rects [x, y, w, h] overlap (touching edges do not count). */
export function rectsOverlap(a: Rect, b: Rect): boolean {
  return a[0] < b[0] + b[2] && b[0] < a[0] + a[2] && a[1] < b[1] + b[3] && b[1] < a[1] + a[3];
}
