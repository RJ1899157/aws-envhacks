import * as THREE from 'three';
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib';
import { polygonBounds } from '../../core/parser';
import type { Room } from '../../core/schema';
import { cameraController } from '../cameraController';

/**
 * Camera framing for the simulation view: fits a set of rooms so they fill a share of the part of
 * the canvas that no panel covers (Asset Library, Inspector, legend, Insights), keeping the
 * current view (top-down in 2D, ~55° down from the south-east in 3D).
 */

export interface ScreenRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Event asking the simulation view to select a room and frame it (room chips, Insights rows). */
export const FOCUS_ROOM_EVENT = 'airforce:sim-focus-room';

export function focusSimulationRoom(roomId: string): void {
  window.dispatchEvent(new CustomEvent(FOCUS_ROOM_EVENT, { detail: roomId }));
}

/** Share of the free viewport the house should fill. */
export const HOUSE_FILL = 0.85;
/** Share a single focused room fills. */
export const ROOM_FILL = 0.5;

const TOP_BAR_PX = 56;
const BOTTOM_BAR_PX = 60;
const PAD_PX = 12;

function visibleRect(sel: string, container: DOMRect): DOMRect | null {
  const el = document.querySelector(sel);
  if (!el) return null;
  const r = el.getBoundingClientRect();
  if (r.width < 1 || r.height < 1 || r.right < container.left || r.left > container.right) return null;
  return r;
}

/** The canvas area free of side panels, and the floating cards (legend) inside it to keep clear of. */
export interface FreeViewport {
  full: ScreenRect;
  avoid: ScreenRect[];
}

/** The part of the canvas no side panel covers, in canvas pixels, and the legend to keep clear of. */
export function freeViewport(canvas: HTMLElement): FreeViewport {
  const c = canvas.getBoundingClientRect();
  let left = PAD_PX;
  let right = c.width - PAD_PX;
  const top = TOP_BAR_PX;
  const bottom = c.height - BOTTOM_BAR_PX;
  const lib = visibleRect('[data-testid="asset-library-sidebar"]', c);
  if (lib && lib.left - c.left < c.width / 2) left = Math.max(left, lib.right - c.left + PAD_PX);
  for (const sel of ['[data-testid="inspector-panel"]', '[data-testid="sim-insights-floating"]']) {
    const r = visibleRect(sel, c);
    if (r && r.left - c.left > c.width / 2) right = Math.min(right, r.left - c.left - PAD_PX);
  }
  const full: ScreenRect = { x: left, y: top, w: Math.max(80, right - left), h: Math.max(80, bottom - top) };
  const legend = visibleRect('[data-testid="simulation-legend"]', c);
  const avoid = legend ? [{ x: legend.left - c.left - PAD_PX, y: legend.top - c.top - PAD_PX, w: legend.width + 2 * PAD_PX, h: legend.height + 2 * PAD_PX }] : [];
  return { full, avoid };
}

type P2 = [number, number];

/** Convex hull (monotone chain), counter-clockwise. */
function convexHull(points: readonly P2[]): P2[] {
  const p = [...points].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  if (p.length < 3) return p;
  const cross = (o: P2, a: P2, b: P2) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lower: P2[] = [];
  for (const q of p) {
    while (lower.length >= 2 && cross(lower[lower.length - 2]!, lower[lower.length - 1]!, q) <= 0) lower.pop();
    lower.push(q);
  }
  const upper: P2[] = [];
  for (let i = p.length - 1; i >= 0; i--) {
    const q = p[i]!;
    while (upper.length >= 2 && cross(upper[upper.length - 2]!, upper[upper.length - 1]!, q) <= 0) upper.pop();
    upper.push(q);
  }
  return [...lower.slice(0, -1), ...upper.slice(0, -1)];
}

/** Separating-axis test between a convex polygon and an axis-aligned rect. */
export function hullOverlapsRect(hull: readonly P2[], r: ScreenRect): boolean {
  if (hull.length === 0) return false;
  const rect: P2[] = [
    [r.x, r.y],
    [r.x + r.w, r.y],
    [r.x + r.w, r.y + r.h],
    [r.x, r.y + r.h],
  ];
  const axes: P2[] = [
    [1, 0],
    [0, 1],
  ];
  for (let i = 0; i < hull.length; i++) {
    const a = hull[i]!;
    const b = hull[(i + 1) % hull.length]!;
    axes.push([a[1] - b[1], b[0] - a[0]]);
  }
  for (const [ax, ay] of axes) {
    let h0 = Infinity;
    let h1 = -Infinity;
    for (const [x, y] of hull) {
      const d = x * ax + y * ay;
      h0 = Math.min(h0, d);
      h1 = Math.max(h1, d);
    }
    let r0 = Infinity;
    let r1 = -Infinity;
    for (const [x, y] of rect) {
      const d = x * ax + y * ay;
      r0 = Math.min(r0, d);
      r1 = Math.max(r1, d);
    }
    if (h1 <= r0 || r1 <= h0) return false;
  }
  return true;
}

export function roomsBounds(rooms: readonly Room[]): { min: [number, number]; max: [number, number] } | null {
  let minX = Infinity;
  let minZ = Infinity;
  let maxX = -Infinity;
  let maxZ = -Infinity;
  for (const r of rooms) {
    if (r.outline.length < 3) continue;
    const b = polygonBounds(r.outline);
    minX = Math.min(minX, b.min[0]);
    minZ = Math.min(minZ, b.min[1]);
    maxX = Math.max(maxX, b.max[0]);
    maxZ = Math.max(maxZ, b.max[1]);
  }
  return Number.isFinite(minX) ? { min: [minX, minZ], max: [maxX, maxZ] } : null;
}

const ELEVATION = THREE.MathUtils.degToRad(55);
const AZIMUTH = THREE.MathUtils.degToRad(35);

interface FitOptions {
  fill?: number;
  topDown?: boolean;
  height?: number;
  duration?: number;
}

/**
 * Fits the rooms (floor to `height`) into the free viewport, as large as possible up to `fill` of
 * it, without the house outline running under the legend: tries the whole free area at shrinking
 * fills, then the areas above and beside the legend, and keeps the largest clear fit. Animates
 * through the shared camera controller.
 */
export function fitRoomsToRect(
  rooms: readonly Room[],
  camera: THREE.Camera,
  controls: OrbitControlsImpl | null,
  size: { width: number; height: number },
  viewport: FreeViewport,
  opts: FitOptions = {}
): void {
  const b = roomsBounds(rooms);
  if (!b || size.width < 10 || size.height < 10) return;
  const height = opts.height ?? 1;
  const points: THREE.Vector3[] = [];
  for (const r of rooms) for (const [x, z] of r.outline) points.push(new THREE.Vector3(x, 0, z), new THREE.Vector3(x, height, z));
  const fill = opts.fill ?? HOUSE_FILL;
  const { full, avoid } = viewport;
  const tries: { rect: ScreenRect; fill: number }[] = [];
  for (let f = fill; f >= 0.55; f -= 0.05) tries.push({ rect: full, fill: f });
  for (const a of avoid) {
    if (a.x + a.w > full.x && a.y < full.y + full.h) {
      tries.push({ rect: { ...full, h: Math.max(80, a.y - full.y) }, fill });
      tries.push({ rect: { ...full, x: a.x + a.w, w: Math.max(80, full.x + full.w - a.x - a.w) }, fill });
    }
  }
  const fits = tries.map((t) => solveFit(points, camera, size, t.rect, { ...opts, fill: t.fill }));
  const clear = fits.filter((f) => !avoid.some((a) => hullOverlapsRect(convexHull(f.screen), a)));
  // Larger on screen: nearer (perspective) or more zoomed in (orthographic)
  const pool = clear.length > 0 ? clear : fits;
  const best = pool.reduce((a, f) => (f.zoom / f.distance > a.zoom / a.distance ? f : a));
  if (best.ortho) {
    (camera as THREE.OrthographicCamera).zoom = best.zoom;
    (camera as THREE.OrthographicCamera).updateProjectionMatrix();
  }
  cameraController.animateTo(camera, controls, best.position, best.target, { duration: opts.duration ?? 650 });
}

/**
 * Perspective: solves the distance and a ground-plane pan by a few fixed-point steps;
 * orthographic: the zoom and the pan.
 */
function solveFit(
  corners: readonly THREE.Vector3[],
  camera: THREE.Camera,
  size: { width: number; height: number },
  rect: ScreenRect,
  opts: FitOptions
): { position: THREE.Vector3; target: THREE.Vector3; zoom: number; distance: number; ortho: boolean; screen: P2[] } {
  const fill = opts.fill ?? HOUSE_FILL;
  const bb = new THREE.Box3().setFromPoints(corners as THREE.Vector3[]);
  const b = { min: [bb.min.x, bb.min.z], max: [bb.max.x, bb.max.z] };
  const center = new THREE.Vector3((b.min[0]! + b.max[0]!) / 2, 0, (b.min[1]! + b.max[1]!) / 2);
  const rcx = rect.x + rect.w / 2;
  const rcy = rect.y + rect.h / 2;
  const span = Math.max(b.max[0]! - b.min[0]!, b.max[1]! - b.min[1]!, 2);

  // View direction (target → camera)
  const dir = opts.topDown
    ? new THREE.Vector3(0, 1, 0.0001).normalize()
    : new THREE.Vector3(Math.cos(ELEVATION) * Math.sin(AZIMUTH), Math.sin(ELEVATION), Math.cos(ELEVATION) * Math.cos(AZIMUTH));
  const right = new THREE.Vector3(dir.z, 0, -dir.x).normalize();
  if (opts.topDown) right.set(1, 0, 0);
  // Ground direction that moves "up" the screen (away from the camera)
  const fwd = opts.topDown ? new THREE.Vector3(0, 0, -1) : new THREE.Vector3(-dir.x, 0, -dir.z).normalize();

  const probe = camera.clone() as THREE.PerspectiveCamera | THREE.OrthographicCamera;
  const isPersp = (probe as THREE.PerspectiveCamera).isPerspectiveCamera === true;
  if (isPersp) (probe as THREE.PerspectiveCamera).aspect = size.width / size.height;
  const fov = isPersp ? THREE.MathUtils.degToRad((probe as THREE.PerspectiveCamera).fov) : Math.PI / 4;
  let distance = isPersp ? (span * 0.8) / Math.tan(fov / 2) : Math.max(20, span * 3);
  let zoom = isPersp ? 1 : (probe as THREE.OrthographicCamera).zoom;
  const offset = new THREE.Vector3();
  const v = new THREE.Vector3();

  const place = () => {
    const target = center.clone().add(offset);
    probe.position.copy(target).addScaledVector(dir, distance);
    probe.up.set(0, 1, 0);
    probe.lookAt(target);
    if (!isPersp) (probe as THREE.OrthographicCamera).zoom = zoom;
    probe.updateMatrixWorld(true);
    probe.updateProjectionMatrix();
    let x0 = Infinity;
    let y0 = Infinity;
    let x1 = -Infinity;
    let y1 = -Infinity;
    const screen: P2[] = [];
    for (const p of corners) {
      v.copy(p).project(probe);
      const sx = ((v.x + 1) / 2) * size.width;
      const sy = ((1 - v.y) / 2) * size.height;
      screen.push([sx, sy]);
      x0 = Math.min(x0, sx);
      y0 = Math.min(y0, sy);
      x1 = Math.max(x1, sx);
      y1 = Math.max(y1, sy);
    }
    return { x0, y0, x1, y1, target, screen };
  };

  for (let it = 0; it < 8; it++) {
    const p = place();
    const scale = Math.max((p.x1 - p.x0) / (fill * rect.w), (p.y1 - p.y0) / (fill * rect.h));
    if (isPersp) distance *= scale;
    else zoom /= scale;
    const q = place();
    // World units per pixel at the target
    const wpp = isPersp ? (2 * distance * Math.tan(fov / 2)) / size.height : 1 / zoom;
    const dx = rcx - (q.x0 + q.x1) / 2;
    const dy = rcy - (q.y0 + q.y1) / 2;
    offset.addScaledVector(right, -dx * wpp);
    // Stepping forward moves the image down; a ground step shows as sin(elevation) of it on screen
    offset.addScaledVector(fwd, (dy * wpp) / (opts.topDown ? 1 : Math.sin(ELEVATION)));
  }
  const final = place();
  return { position: probe.position.clone(), target: final.target, zoom, distance, ortho: !isPersp, screen: final.screen };
}
