import React, { useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { useSimulationStore } from '../../store/simulationStore';
import { useSceneStore } from '../../store/sceneStore';
import { fmtMinutes } from '../../simulation/viz/insights';
import { pointInPolygon, rectInsidePolygon, resolveOverlaps, type Pt, type Rect } from '../../simulation/viz/layout';
import { bridge } from './cameraBridge';
import { STALE_COLOR } from './FloorHeatmap';
import { focusSimulationRoom } from './simulationCamera';
import { useRoomInsights } from './useRoomInsights';
import { useStaleZones } from './useStaleZones';
import { useCompareSides } from './useScenarios';
import { compareRooms } from '../../simulation/scenarios/compare';

/** Below this many screen pixels per metre chips collapse to dots (zoomed far out). */
export const CHIP_LOD_PX_PER_M = 20;
/** A chip displaced further than this from its anchor gets a leader line (px). */
const LEADER_MIN_PX = 6;
/** Side panels over the canvas. */
const PANELS = ['[data-testid="asset-library-sidebar"]', '[data-testid="inspector-panel"]'];
/** Floating cards chips must keep clear of. */
const OBSTACLES = ['[data-testid="simulation-legend"]', '[data-testid="sim-insights-floating"]', '[data-testid="sim-first-use"]', '[data-testid="sim-run-progress"]', '[data-testid="sim-opening-arrow-label"]'];

/** Detail levels, most first: name + "value · word"; name, value and word stacked; value and word; a dot. */
type Level = 'full' | 'tall' | 'compact' | 'dot';
type ChipLevel = Exclude<Level, 'dot'>;
const CHIP_LEVELS: ChipLevel[] = ['full', 'tall', 'compact'];

interface Item {
  key: string;
  /** Room to select and frame on click */
  roomId: string | null;
  kind: 'room' | 'stale';
  anchor: [number, number];
  /** Floor outline the label must stay inside (world XZ) */
  outline: readonly (readonly [number, number])[];
  title: string;
  value: string;
  /** Narrower value for the compact level */
  short: string;
  word: string;
  color: string;
}

const LEVELS: Level[] = ['full', 'tall', 'compact', 'dot'];

/** Shows the parts of a chip for a level (name row; band word inline or on its own row). */
function applyLevel(parts: ChipParts | undefined, level: ChipLevel): void {
  if (!parts) return;
  if (parts.name) parts.name.style.display = level === 'compact' ? 'none' : '';
  if (parts.inline) parts.inline.style.display = level === 'full' ? '' : 'none';
  if (parts.stacked) parts.stacked.style.display = level === 'full' ? 'none' : '';
  if (parts.long) parts.long.style.display = level === 'compact' ? 'none' : '';
  if (parts.short) parts.short.style.display = level === 'compact' ? '' : 'none';
}

interface ChipParts {
  name: HTMLElement | null;
  inline: HTMLElement | null;
  stacked: HTMLElement | null;
  long: HTMLElement | null;
  short: HTMLElement | null;
}

const noParts = (): ChipParts => ({ name: null, inline: null, stacked: null, long: null, short: null });

/**
 * One compact chip per room in the metric of the current view mode (PM2.5 · AQI band, air age ·
 * Fresh/Stale, air changes per hour), its dot coloured exactly like the floor. Chips sit at each
 * room's pole of inaccessibility and must stay inside the room: they drop the name, then collapse
 * to a dot (value on hover) when they don't fit or the view is zoomed far out. Overlapping chips
 * are pushed apart with a short leader line back to the anchor, and kept off the legend and
 * panels. Stalest-zone labels ("Stale air · 38 min") take part in the same layout. Clicking a
 * chip selects the room and frames it.
 */
export const RoomChips: React.FC = () => {
  const show = useSimulationStore((s) => s.viz.show && s.viz.roomLabels);
  const result = useSimulationStore((s) => s.result);
  const insights = useRoomInsights();
  const staleZones = useStaleZones();
  const sides = useCompareSides();
  const rooms = useSceneStore((s) => s.room);
  const otherRooms = useSceneStore((s) => s.otherRooms);
  const active = show && result !== null && insights !== null;

  const items = useMemo((): Item[] => {
    if (!insights) return [];
    if (sides) {
      // Comparing: each room's A → B for the view's metric, dot green (better) / red (worse) / grey
      const metric = insights.mode === 'pollution' ? 'pm25' : insights.mode === 'ventilation' ? 'age' : 'ach';
      const unit = metric === 'pm25' ? ' µg/m³' : metric === 'age' ? ' min' : '/h';
      const d = metric === 'ach' ? 1 : 0;
      const cmp = compareRooms(sides.a.metrics, sides.b.metrics, metric);
      return insights.rows.flatMap((r): Item[] => {
        const c = cmp.find((x) => x.roomId === r.roomId);
        if (!c) return [];
        const pctTxt = `${c.fraction > 0 ? '+' : c.fraction < 0 ? '−' : '±'}${Math.abs(Math.round(c.fraction * 100))}%`;
        return [
          {
            key: `cmp-${r.roomId}`,
            roomId: r.roomId,
            kind: 'room',
            anchor: r.anchor,
            outline: r.outline,
            title: r.shortName,
            value: `${c.a.toFixed(d)} → ${c.b.toFixed(d)}${unit}`,
            short: `${c.b.toFixed(d)}${unit}`,
            word: pctTxt,
            color: c.better === null ? '#9ca3af' : c.better ? '#22c55e' : '#ef4444',
          },
        ];
      });
    }
    const out: Item[] = insights.rows.map((r) => ({
      key: `room-${r.roomId}`,
      roomId: r.roomId,
      kind: 'room',
      anchor: r.anchor,
      outline: r.outline,
      title: r.shortName,
      value: r.formatted.value,
      short: r.formatted.short,
      word: r.formatted.word,
      color: r.color,
    }));
    const all = [rooms, ...otherRooms];
    staleZones.forEach((z, i) => {
      const room = all.find((r) => pointInPolygon(z.anchor, r.outline));
      out.push({
        key: `stale-${i}`,
        roomId: room?.id ?? null,
        kind: 'stale',
        anchor: z.anchor,
        // Not held inside a room: a leader line ties the label to its zone
        outline: [],
        title: 'Stale air',
        value: `${fmtMinutes(z.meanAgeMinutes)} min`,
        short: `${fmtMinutes(z.meanAgeMinutes)} min`,
        word: '',
        color: STALE_COLOR,
      });
    });
    return out;
  }, [insights, staleZones, rooms, otherRooms, sides]);

  const rootRef = useRef<HTMLDivElement>(null);
  const chipRefs = useRef<(HTMLDivElement | null)[]>([]);
  const dotRefs = useRef<(HTMLDivElement | null)[]>([]);
  const partRefs = useRef<ChipParts[]>([]);
  const svgRef = useRef<SVGSVGElement>(null);
  const sizes = useRef<Record<ChipLevel, [number, number]>[]>([]);
  const hovered = useRef<number | null>(null);

  // Measure each chip at every detail level whenever the content changes
  useLayoutEffect(() => {
    sizes.current = items.map((_, i) => {
      const el = chipRefs.current[i];
      const out = { full: [0, 0], tall: [0, 0], compact: [0, 0] } as Record<ChipLevel, [number, number]>;
      if (!el) return out;
      for (const l of CHIP_LEVELS) {
        applyLevel(partRefs.current[i], l);
        out[l] = [el.offsetWidth, el.offsetHeight];
      }
      applyLevel(partRefs.current[i], 'full');
      return out;
    });
  }, [items, active]);

  useEffect(() => {
    if (!active) return;
    const v = new THREE.Vector3();
    const project = (x: number, z: number): [number, number, boolean] => {
      v.set(x, 0.05, z).project(bridge.camera!);
      return [((v.x + 1) / 2) * bridge.width, ((1 - v.y) / 2) * bridge.height, v.z >= -1 && v.z <= 1];
    };
    let raf = 0;
    const tick = () => {
      raf = requestAnimationFrame(tick);
      const { camera, width, height } = bridge;
      const root = rootRef.current;
      if (!camera || width === 0 || !root) return;
      const rootRect = root.getBoundingClientRect();
      const obstacles: Rect[] = [];
      for (const el of document.querySelectorAll(OBSTACLES.join(','))) {
        const r = el.getBoundingClientRect();
        if (r.width > 0) obstacles.push([r.left - rootRect.left, r.top - rootRect.top, r.width, r.height]);
      }
      // Side panels: a room whose anchor is under one gets no label; the others keep off them
      const panels: Rect[] = [];
      for (const el of document.querySelectorAll(PANELS.join(','))) {
        const r = el.getBoundingClientRect();
        if (r.width > 0 && r.left < window.innerWidth - 8 && getComputedStyle(el).opacity !== '0') panels.push([r.left - rootRect.left, r.top - rootRect.top, r.width, r.height]);
      }
      obstacles.push(...panels);
      const underPanel = (x: number, y: number) => panels.some(([px, py, pw, ph]) => x >= px && x <= px + pw && y >= py && y <= py + ph);

      const n = items.length;
      const anchors: [number, number][] = [];
      const polys: Pt[][] = [];
      const level: Level[] = [];
      const onScreen: boolean[] = [];
      for (let i = 0; i < n; i++) {
        const it = items[i]!;
        const [sx, sy, front] = project(it.anchor[0], it.anchor[1]);
        anchors.push([sx, sy]);
        onScreen.push(front && sx >= 0 && sy >= 0 && sx <= width && sy <= height && !underPanel(sx, sy));
        polys.push(it.outline.map(([x, z]) => project(x, z).slice(0, 2) as [number, number]));
        const [ex, ey] = project(it.anchor[0] + 1, it.anchor[1]);
        const [fx, fy] = project(it.anchor[0], it.anchor[1] + 1);
        const pxPerM = Math.max(Math.hypot(ex - sx, ey - sy), Math.hypot(fx - sx, fy - sy));
        const sz = sizes.current[i];
        let lv: Level = 'dot';
        if (sz && pxPerM >= CHIP_LOD_PX_PER_M) {
          for (const l of CHIP_LEVELS) {
            const [w, h] = sz[l];
            if (w > 0 && (polys[i]!.length < 3 || rectInsidePolygon([sx - w / 2, sy - h / 2, w, h], polys[i]!))) {
              lv = l;
              break;
            }
          }
        }
        level.push(lv);
      }

      // Push chips apart; any chip pushed out of its room drops a level, and the layout reruns
      let pos: [number, number][] = [];
      let placed: number[] = [];
      for (let round = 0; round < 4; round++) {
        placed = [];
        const rects: Rect[] = [];
        for (let i = 0; i < n; i++) {
          if (!onScreen[i] || level[i] === 'dot') continue;
          const [w, h] = sizes.current[i]![level[i] as ChipLevel];
          rects.push([anchors[i]![0] - w / 2, anchors[i]![1] - h / 2, w, h]);
          placed.push(i);
        }
        pos = resolveOverlaps(rects, 60, obstacles);
        let changed = false;
        placed.forEach((i, k) => {
          const [, , w, h] = rects[k]!;
          const r: Rect = [pos[k]![0], pos[k]![1], w, h];
          const outside = polys[i]!.length >= 3 && !rectInsidePolygon(r, polys[i]!);
          const offCanvas = r[0] < 0 || r[1] < 0 || r[0] + w > width || r[1] + h > height;
          if (outside || offCanvas) {
            level[i] = LEVELS[LEVELS.indexOf(level[i]!) + 1]!;
            changed = true;
          }
        });
        if (!changed) break;
      }

      const lines: string[] = [];
      const placedAt = new Map(placed.map((i, k) => [i, pos[k]!]));
      for (let i = 0; i < n; i++) {
        const chip = chipRefs.current[i];
        const dot = dotRefs.current[i];
        const parts = partRefs.current[i];
        if (!chip || !dot) continue;
        const [ax, ay] = anchors[i]!;
        if (!onScreen[i]) {
          chip.style.visibility = 'hidden';
          dot.style.visibility = 'hidden';
          continue;
        }
        const lv = level[i]!;
        const p = placedAt.get(i);
        if (lv !== 'dot' && p) {
          applyLevel(parts, lv);
          const [w, h] = sizes.current[i]![lv];
          chip.style.visibility = 'visible';
          chip.style.zIndex = '1';
          chip.style.transform = `translate(${Math.round(p[0])}px, ${Math.round(p[1])}px)`;
          dot.style.visibility = 'hidden';
          // Leader line from the anchor to the nearest point of the displaced chip
          const cx = Math.min(p[0] + w, Math.max(p[0], ax));
          const cy = Math.min(p[1] + h, Math.max(p[1], ay));
          if (Math.hypot(cx - ax, cy - ay) > LEADER_MIN_PX) lines.push(`M${ax.toFixed(1)} ${ay.toFixed(1)}L${cx.toFixed(1)} ${cy.toFixed(1)}`);
          chip.dataset.level = lv;
        } else {
          dot.style.visibility = 'visible';
          dot.style.transform = `translate(${Math.round(ax - 7)}px, ${Math.round(ay - 7)}px)`;
          chip.dataset.level = 'dot';
          if (hovered.current === i && sizes.current[i]) {
            // Hovered dot: show the full chip just above it
            applyLevel(parts, 'full');
            const [w, h] = sizes.current[i]!.full;
            chip.style.visibility = 'visible';
            chip.style.zIndex = '3';
            chip.style.transform = `translate(${Math.round(Math.min(width - w, Math.max(0, ax - w / 2)))}px, ${Math.round(Math.max(0, ay - h - 10))}px)`;
          } else chip.style.visibility = 'hidden';
        }
      }
      svgRef.current?.querySelector('path')?.setAttribute('d', lines.join(''));
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [active, items]);

  if (!active) return null;
  return (
    <div ref={rootRef} className="absolute inset-0 pointer-events-none overflow-hidden z-[6]" data-testid="sim-room-chips">
      <svg ref={svgRef} className="absolute inset-0 w-full h-full" aria-hidden>
        <path d="" stroke="#e5e7eb" strokeOpacity={0.7} strokeWidth={1} fill="none" />
      </svg>
      {items.map((it, i) => {
        const select = (e: React.MouseEvent) => {
          e.stopPropagation();
          if (it.roomId) focusSimulationRoom(it.roomId);
        };
        const label = `${it.title}: ${it.value}${it.word ? ` · ${it.word}` : ''}`;
        return (
          <React.Fragment key={it.key}>
            <div
              ref={(el) => {
                chipRefs.current[i] = el;
              }}
              data-testid={it.kind === 'room' ? 'sim-room-chip' : 'sim-stale-label'}
              data-room={it.title}
              role="button"
              aria-label={label}
              className={`absolute left-0 top-0 pointer-events-auto cursor-pointer select-none rounded-[6px] px-1.5 py-[2px] bg-neutral-950/85 border shadow-md text-neutral-100 whitespace-nowrap leading-tight backdrop-blur-sm hover:bg-neutral-900 ${
                it.kind === 'stale' ? 'border-red-500/90' : 'border-white/15'
              }`}
              style={{ visibility: 'hidden', willChange: 'transform' }}
              onClick={select}
              onPointerEnter={() => (hovered.current = i)}
              onPointerLeave={() => (hovered.current = hovered.current === i ? null : hovered.current)}
            >
              {it.kind === 'room' && (
                <div
                  ref={(el) => {
                    (partRefs.current[i] ??= noParts()).name = el;
                  }}
                  className="text-[9px] font-semibold text-neutral-300"
                >
                  {it.title}
                </div>
              )}
              <div className="flex items-center gap-1 text-[10px] tabular-nums">
                <span className="inline-block w-2 h-2 rounded-full shrink-0 ring-1 ring-white/60" style={{ background: it.color }} />
                {it.kind === 'stale' && <span className="font-semibold text-red-300">Stale air ·</span>}
                <span
                  ref={(el) => {
                    (partRefs.current[i] ??= noParts()).long = el;
                  }}
                  className="font-semibold"
                >
                  {it.value}
                </span>
                <span
                  ref={(el) => {
                    (partRefs.current[i] ??= noParts()).short = el;
                  }}
                  className="font-semibold"
                  style={{ display: 'none' }}
                >
                  {it.short}
                </span>
                {it.word && (
                  <span
                    ref={(el) => {
                      (partRefs.current[i] ??= noParts()).inline = el;
                    }}
                    className="text-neutral-400"
                  >
                    · {it.word}
                  </span>
                )}
              </div>
              {it.word && (
                <div
                  ref={(el) => {
                    (partRefs.current[i] ??= noParts()).stacked = el;
                  }}
                  className="pl-3 text-[9.5px] text-neutral-400"
                  style={{ display: 'none' }}
                >
                  {it.word}
                </div>
              )}
            </div>
            <div
              ref={(el) => {
                dotRefs.current[i] = el;
              }}
              data-testid="sim-room-dot"
              role="button"
              aria-label={label}
              className="absolute left-0 top-0 w-3.5 h-3.5 rounded-full pointer-events-auto cursor-pointer border-2 border-white/90 shadow-[0_0_0_1.5px_rgba(0,0,0,0.7)]"
              style={{ background: it.color, visibility: 'hidden' }}
              onClick={select}
              onPointerEnter={() => (hovered.current = i)}
              onPointerLeave={() => (hovered.current = hovered.current === i ? null : hovered.current)}
            />
          </React.Fragment>
        );
      })}
    </div>
  );
};
