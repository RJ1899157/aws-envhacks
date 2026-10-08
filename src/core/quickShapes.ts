import type { Vec2 } from './schema';
import { signedArea } from './parser';

export type QuickShapeType = 'rectangle' | 'l-shape' | 'u-shape' | 't-shape';

export interface QuickShapeDimensions {
  width: number;
  depth: number;
  cutWidth?: number;
  cutDepth?: number;
  recessWidth?: number;
  recessDepth?: number;
  stemWidth?: number;
  stemDepth?: number;
}

/**
 * Ensures vertices have Counter-Clockwise (CCW) winding.
 */
function ensureCCW(pts: Vec2[]): Vec2[] {
  if (signedArea(pts) < 0) {
    return pts.reverse();
  }
  return pts;
}

/**
 * Generates a rectangular room outline: [width x depth]
 */
export function createRectangleShape(width = 4.0, depth = 3.0): Vec2[] {
  const w = Math.max(1.5, width);
  const d = Math.max(1.5, depth);
  return ensureCCW([
    [0, 0],
    [w, 0],
    [w, d],
    [0, d],
  ]);
}

/**
 * Generates an L-shaped room outline with a corner cut
 */
export function createLShape(width = 5.0, depth = 4.0, cutWidth = 2.5, cutDepth = 2.0): Vec2[] {
  const w = Math.max(2.0, width);
  const d = Math.max(2.0, depth);
  const cw = Math.min(w - 1.0, Math.max(0.5, cutWidth));
  const cd = Math.min(d - 1.0, Math.max(0.5, cutDepth));

  return ensureCCW([
    [0, 0],
    [w, 0],
    [w, d - cd],
    [w - cw, d - cd],
    [w - cw, d],
    [0, d],
  ]);
}

/**
 * Generates a U-shaped room outline with a central recess
 */
export function createUShape(
  width = 6.0,
  depth = 4.5,
  recessWidth = 2.0,
  recessDepth = 2.25
): Vec2[] {
  const w = Math.max(3.0, width);
  const d = Math.max(2.0, depth);
  const rw = Math.min(w - 1.5, Math.max(1.0, recessWidth));
  const rd = Math.min(d - 1.0, Math.max(0.5, recessDepth));
  const x1 = Number(((w - rw) / 2).toFixed(3));
  const x2 = Number((x1 + rw).toFixed(3));

  return ensureCCW([
    [0, 0],
    [w, 0],
    [w, d],
    [x2, d],
    [x2, d - rd],
    [x1, d - rd],
    [x1, d],
    [0, d],
  ]);
}

/**
 * Generates a T-shaped room outline with a crossbar and stem
 */
export function createTShape(width = 5.0, depth = 5.0, stemWidth = 2.0, stemDepth = 2.5): Vec2[] {
  const w = Math.max(3.0, width);
  const d = Math.max(2.5, depth);
  const sw = Math.min(w - 1.0, Math.max(1.0, stemWidth));
  const sd = Math.min(d - 1.0, Math.max(1.0, stemDepth));
  const x1 = Number(((w - sw) / 2).toFixed(3));
  const x2 = Number((x1 + sw).toFixed(3));

  return ensureCCW([
    [x1, 0],
    [x2, 0],
    [x2, sd],
    [w, sd],
    [w, d],
    [0, d],
    [0, sd],
    [x1, sd],
  ]);
}

/**
 * Helper to generate any quick shape by name
 */
export function generateQuickShape(type: QuickShapeType, dim: QuickShapeDimensions): Vec2[] {
  switch (type) {
    case 'rectangle':
      return createRectangleShape(dim.width, dim.depth);
    case 'l-shape':
      return createLShape(dim.width, dim.depth, dim.cutWidth, dim.cutDepth);
    case 'u-shape':
      return createUShape(dim.width, dim.depth, dim.recessWidth, dim.recessDepth);
    case 't-shape':
      return createTShape(dim.width, dim.depth, dim.stemWidth, dim.stemDepth);
  }
}
