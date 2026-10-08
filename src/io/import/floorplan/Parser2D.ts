import DxfParser from 'dxf-parser';
import { type Vec2 } from '../../../core/schema';

// Helper to extract lines from a DXF string and try to connect them into a continuous polygon
export function parseDxfFloorPlan(dxfString: string): Vec2[] {
  const parser = new DxfParser();
  const dxf = parser.parseSync(dxfString);
  const lines: { start: Vec2, end: Vec2 }[] = [];

  // Very naive extraction of LINE and LWPOLYLINE entities
  if (dxf && dxf.entities) {
    for (const entity of dxf.entities) {
      if (entity.type === 'LINE') {
        const line = entity as any;
        lines.push({
          start: [line.vertices[0].x, line.vertices[0].y],
          end: [line.vertices[1].x, line.vertices[1].y],
        });
      } else if (entity.type === 'LWPOLYLINE' || entity.type === 'POLYLINE') {
        const poly = entity as any;
        for (let i = 0; i < poly.vertices.length - 1; i++) {
          lines.push({
            start: [poly.vertices[i].x, poly.vertices[i].y],
            end: [poly.vertices[i + 1].x, poly.vertices[i + 1].y],
          });
        }
        if (poly.shape || poly.closed) {
           lines.push({
            start: [poly.vertices[poly.vertices.length - 1].x, poly.vertices[poly.vertices.length - 1].y],
            end: [poly.vertices[0].x, poly.vertices[0].y],
          });
        }
      }
    }
  }

  return assembleLinesIntoPolygon(lines);
}

export function parseSvgFloorPlan(svgString: string): Vec2[] {
  const parser = new DOMParser();
  const doc = parser.parseFromString(svgString, 'image/svg+xml');
  const lines: { start: Vec2, end: Vec2 }[] = [];

  // Parse lines
  const svgLines = doc.querySelectorAll('line');
  svgLines.forEach(l => {
    lines.push({
      start: [parseFloat(l.getAttribute('x1') || '0'), parseFloat(l.getAttribute('y1') || '0')],
      end: [parseFloat(l.getAttribute('x2') || '0'), parseFloat(l.getAttribute('y2') || '0')]
    });
  });

  // Parse polygons and polylines
  const polys = doc.querySelectorAll('polygon, polyline');
  polys.forEach(poly => {
    const pointsAttr = poly.getAttribute('points');
    if (pointsAttr) {
      const coords = pointsAttr.trim().split(/\s+|,/).map(parseFloat).filter(n => !isNaN(n));
      for (let i = 0; i < coords.length - 3; i += 2) {
        lines.push({
          start: [coords[i] as number, coords[i + 1] as number],
          end: [coords[i + 2] as number, coords[i + 3] as number],
        });
      }
      if (poly.tagName.toLowerCase() === 'polygon' && coords.length >= 4) {
         lines.push({
          start: [coords[coords.length - 2] as number, coords[coords.length - 1] as number],
          end: [coords[0] as number, coords[1] as number],
        });
      }
    }
  });

  return assembleLinesIntoPolygon(lines);
}

// Very basic topological sort to form a closed loop
function assembleLinesIntoPolygon(lines: { start: Vec2, end: Vec2 }[]): Vec2[] {
  if (lines.length === 0) return [];
  const polygon: Vec2[] = [];
  let current = lines[0]!.start;
  polygon.push(current);

  const used = new Set<number>();
  

  for (let step = 0; step < lines.length; step++) {
    let bestDist = Infinity;
    let bestPt: Vec2 | null = null;
    let bestLineIndex = -1;

    for (let i = 0; i < lines.length; i++) {
      if (used.has(i)) continue;
      
      const l = lines[i];
      const dStart = dist(current, l!.start);
      const dEnd = dist(current, l!.end);

      if (dStart < bestDist) {
        bestDist = dStart;
        bestPt = l!.end;
        bestLineIndex = i;
      }
      if (dEnd < bestDist) {
        bestDist = dEnd;
        bestPt = l!.start;
        bestLineIndex = i;
      }
    }

    if (bestPt && bestLineIndex !== -1) {
      polygon.push(bestPt);
      used.add(bestLineIndex);
      current = bestPt;
    } else {
      break;
    }
  }

  // close loop if needed
  // polygon usually ends close to the start if closed shape
  return polygon;
}

function dist(a: Vec2, b: Vec2) {
  return Math.hypot(a[0] - b[0], a[1] - b[1]);
}
