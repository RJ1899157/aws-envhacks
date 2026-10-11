import React from 'react';
import { ArrowDown, ArrowLeft, ArrowUp, Cpu, Loader2, Minus, Save, Wand2, X } from 'lucide-react';
import {
  houseScenarios,
  newScenarioId,
  useScenarioStore,
  type CompareView,
  type ScenarioRef,
} from '../../store/scenarioStore';
import { getVoxelQueue, useSimulationStore } from '../../store/simulationStore';
import { INDIA_NAAQS_PM25_24H, WHO_2021_PM25_24H } from '../../simulation/constants';
import { SERIES_COLORS } from '../../simulation/viz/colormap';
import { compareRooms, verdict, type CompareMetric } from '../../simulation/scenarios/compare';
import type { HouseMetrics } from '../../simulation/scenarios/metrics';
import {
  runVoxelFor,
  useCompareSides,
  useDesign,
  useVoxelQueueState,
} from '../../builder/simulation/useScenarios';
import { TimeSeriesChart } from './TimeSeriesChart';

const VIEWS: { id: CompareView; label: string }[] = [
  { id: 'a', label: 'A' },
  { id: 'b', label: 'B' },
  { id: 'swipe', label: 'Swipe' },
  { id: 'diff', label: 'Difference' },
];

const refValue = (r: ScenarioRef) => (r.kind === 'saved' ? `saved:${r.id}` : r.kind);
const parseRef = (v: string): ScenarioRef =>
  v.startsWith('saved:')
    ? { kind: 'saved', id: v.slice(6) }
    : v === 'preview'
      ? { kind: 'preview' }
      : { kind: 'baseline' };

const LABEL_HINT: Record<string, string> = {
  'Weighted PM2.5': 'House PM2.5, weighted by how much time people spend in each room (µg/m³)',
  'Volume > 60': "Share of the house's air above India's 24-h limit, 60 µg/m³",
  'Volume > 15': "Share of the house's air above the WHO 24-h guideline, 15 µg/m³",
};

const fmt = (v: number, d = 0) => (Number.isFinite(v) ? v.toFixed(d) : '—');
const fmtTime = (s: number | null) =>
  s === null ? 'not reached' : s === 0 ? 'already' : `${Math.round(s / 60)} min`;

/** Arrow + colour for a change; `better` null = no real change. */
const Delta: React.FC<{
  delta: number;
  fraction: number;
  better: boolean | null;
  unit?: string;
  digits?: number;
}> = ({ delta, fraction, better, unit = '', digits = 0 }) => {
  const color = better === null ? 'text-neutral-400' : better ? 'text-emerald-300' : 'text-red-300';
  const Icon = better === null ? Minus : delta < 0 ? ArrowDown : ArrowUp;
  return (
    <span className={`flex items-center justify-end gap-0.5 tabular-nums ${color}`}>
      <Icon size={10} />
      {delta > 0 ? '+' : delta < 0 ? '−' : ''}
      {fmt(Math.abs(delta), digits)}
      {unit}
      <span className="text-[9px] opacity-80">
        ({fraction > 0 ? '+' : fraction < 0 ? '−' : ''}
        {Math.abs(Math.round(fraction * 100))}%)
      </span>
    </span>
  );
};

function metricsRows(a: HouseMetrics, b: HouseMetrics) {
  const rel = (x: number, y: number) => (x !== 0 ? (y - x) / Math.abs(x) : 0);
  const row = (
    label: string,
    va: number,
    vb: number,
    unit: string,
    digits: number,
    lowerBetter = true
  ) => {
    const f = rel(va, vb);
    return {
      label,
      a: `${fmt(va, digits)}${unit}`,
      b: `${fmt(vb, digits)}${unit}`,
      delta: vb - va,
      fraction: f,
      better: Math.abs(f) < 0.01 ? null : lowerBetter ? vb < va : vb > va,
      unit,
      digits,
    };
  };
  return [
    row('Weighted PM2.5', a.weightedPm25, b.weightedPm25, ' µg/m³', 0),
    row('Volume > 60', a.fracAboveNaaqs * 100, b.fracAboveNaaqs * 100, '%', 0),
    row('Volume > 15', a.fracAboveWho * 100, b.fracAboveWho * 100, '%', 0),
    row('Mean air age', a.meanAgeMinutes, b.meanAgeMinutes, ' min', 0),
  ];
}

/**
 * Compare two designs (baseline, saved scenarios or a previewed action): A/B/swipe/difference on
 * the canvas, a verdict, house metrics, the per-room table for the view's metric and a time-series
 * overlay for one room. Numbers come from the voxel solver when both sides have a voxel run,
 * otherwise from the network model.
 */
export const ComparePanel: React.FC<{ variant: 'docked' | 'floating' }> = ({ variant }) => {
  const compare = useScenarioStore((s) => s.compare);
  const preview = useScenarioStore((s) => s.preview);
  const objective = useScenarioStore((s) => s.objective);
  const mode = useSimulationStore((s) => s.viz.mode);
  const durationS = useSimulationStore((s) => s.settings.durationS);
  const rooms = useDesign();
  const sides = useCompareSides();
  const queue = useVoxelQueueState();
  const st = useScenarioStore.getState;
  if (!compare) return null;
  const floating = variant === 'floating';
  const options = [
    { v: 'baseline', label: 'Baseline (your design)' },
    ...houseScenarios(rooms).map((s) => ({ v: `saved:${s.id}`, label: s.name })),
    ...(preview ? [{ v: 'preview', label: `Preview: ${preview.name}` }] : []),
  ];
  const metric: CompareMetric =
    mode === 'pollution' ? 'pm25' : mode === 'ventilation' ? 'age' : 'ach';
  const unit = metric === 'pm25' ? ' µg/m³' : metric === 'age' ? ' min' : '/h';
  const digits = metric === 'ach' ? 1 : 0;

  const body = sides ? (
    (() => {
      const { a, b } = sides;
      const both = !!a.voxel && !!b.voxel;
      const pending = [a, b].filter((s) => !s.voxel).map((s) => s.key);
      const running = queue.running && pending.includes(queue.running.key) ? queue.running : null;
      const queued = pending.some((k) => queue.queued.some((q) => q.key === k));
      const table = compareRooms(a.metrics, b.metrics, metric);
      const chartRoom =
        compare.roomId ??
        (objective.kind === 'room'
          ? objective.roomId
          : [...table].sort((x, y) => Math.abs(y.delta) - Math.abs(x.delta))[0]?.roomId) ??
        null;
      const za = a.evaluation.network.zones.find((z) => z.roomId === chartRoom);
      const zb = b.evaluation.network.zones.find((z) => z.roomId === chartRoom);
      return (
        <>
          <p
            className="text-[11.5px] font-semibold text-white leading-snug"
            data-testid="sim-compare-verdict"
          >
            {verdict(
              b.texts.length > 0 ? b.texts : a.texts,
              a.metrics,
              b.metrics,
              objective,
              b.ref.kind === 'baseline' ? a.name : b.name,
              metric === 'age' ? 'age' : 'pm25'
            )}
          </p>
          <div className="flex items-center gap-1.5 text-[10px] text-neutral-400">
            <Cpu size={11} />
            {both ? (
              <span>Voxel solver, both sides</span>
            ) : (
              <span>
                Network model (room averages)
                {running ? '' : ' · run the voxel solver for local detail'}
              </span>
            )}
            {!both && !running && !queued && (
              <button
                type="button"
                onClick={() => runVoxelFor([a, b].filter((s) => !s.voxel))}
                className="ml-auto px-1.5 py-0.5 rounded bg-white/10 hover:bg-white/15 text-neutral-200"
                data-testid="sim-compare-run-voxel"
              >
                Run voxel
              </button>
            )}
            {(running || queued) && (
              <span className="ml-auto flex items-center gap-1 text-neutral-300">
                <Loader2 size={11} className="animate-spin" />{' '}
                {running ? `${Math.round((running.progress?.fraction ?? 0) * 100)}%` : 'queued'}
                <button
                  type="button"
                  onClick={() => pending.forEach((k) => getVoxelQueue().cancel(k))}
                  className="px-1 rounded bg-white/10 hover:bg-white/15"
                >
                  Cancel
                </button>
              </span>
            )}
          </div>

          {/* House metrics strip */}
          <div
            className="grid grid-cols-[1fr_auto_auto_auto] gap-x-2 gap-y-0.5 text-[10px] items-center"
            data-testid="sim-compare-metrics"
          >
            <span className="text-[9px] uppercase text-neutral-500">House</span>
            <span className="text-[9px] uppercase text-neutral-500 text-right">A</span>
            <span className="text-[9px] uppercase text-neutral-500 text-right">B</span>
            <span className="text-[9px] uppercase text-neutral-500 text-right">Δ</span>
            {metricsRows(a.metrics, b.metrics).map((r) => (
              <React.Fragment key={r.label}>
                <span className="text-neutral-300 truncate" title={LABEL_HINT[r.label] ?? r.label}>
                  {r.label}
                </span>
                <span className="text-right tabular-nums text-neutral-300">{r.a}</span>
                <span className="text-right tabular-nums text-white">{r.b}</span>
                <Delta delta={r.delta} fraction={r.fraction} better={r.better} digits={r.digits} />
              </React.Fragment>
            ))}
            <span className="text-neutral-300">Worst room</span>
            <span className="text-right text-neutral-300 truncate">
              {a.metrics.worstRoom.name} {fmt(a.metrics.worstRoom.pm25)}
            </span>
            <span className="text-right text-white truncate">
              {b.metrics.worstRoom.name} {fmt(b.metrics.worstRoom.pm25)}
            </span>
            <span />
            <span
              className="text-neutral-300"
              title="Time until every occupied room is below 60 µg/m³"
            >
              Below 60 by
            </span>
            <span className="text-right text-neutral-300">
              {fmtTime(a.metrics.timeBelowNaaqsS)}
            </span>
            <span className="text-right text-white">{fmtTime(b.metrics.timeBelowNaaqsS)}</span>
            <span />
          </div>

          {/* Per-room table */}
          <div className="flex flex-col gap-0.5 text-[10.5px]" data-testid="sim-compare-rooms">
            <div className="grid grid-cols-[1fr_auto_auto_auto] gap-x-2 text-[9px] uppercase text-neutral-500">
              <span>
                {metric === 'pm25'
                  ? 'PM2.5 by room'
                  : metric === 'age'
                    ? 'Air age by room'
                    : 'Air changes by room'}
              </span>
              <span className="text-right">A</span>
              <span className="text-right">B</span>
              <span className="text-right">Δ</span>
            </div>
            {table.map((r) => (
              <button
                key={r.roomId}
                type="button"
                onClick={() => st().setCompare({ roomId: r.roomId })}
                className={`grid grid-cols-[1fr_auto_auto_auto] gap-x-2 items-center text-left rounded px-0.5 hover:bg-white/5 ${r.roomId === chartRoom ? 'bg-white/10' : ''}`}
              >
                <span className="truncate text-neutral-200">{r.name}</span>
                <span className="text-right tabular-nums text-neutral-400">{fmt(r.a, digits)}</span>
                <span className="text-right tabular-nums text-white">{fmt(r.b, digits)}</span>
                <Delta delta={r.delta} fraction={r.fraction} better={r.better} digits={digits} />
              </button>
            ))}
            <span className="text-[9px] text-neutral-500">
              {unit.trim()} · {metric === 'ach' ? 'higher is better' : 'lower is better'} · click a
              room to chart it
            </span>
          </div>

          {/* Time-series overlay */}
          {za && zb && (
            <div data-testid="sim-compare-chart">
              <span className="text-[10px] text-neutral-400">
                {za.name}: PM2.5 over time (network model)
              </span>
              <TimeSeriesChart
                series={[
                  {
                    id: 'a',
                    label: `A: ${a.name}`,
                    color: SERIES_COLORS.boxModel,
                    points: za.series.map((p) => [p.tS, p.c] as [number, number]),
                  },
                  {
                    id: 'b',
                    label: `B: ${b.name}`,
                    color: SERIES_COLORS.voxel,
                    points: zb.series.map((p) => [p.tS, p.c] as [number, number]),
                  },
                ]}
                durationS={durationS}
                unit="µg/m³"
                width={floating ? 240 : 270}
                thresholds={[
                  { value: WHO_2021_PM25_24H, label: 'WHO 15' },
                  { value: INDIA_NAAQS_PM25_24H, label: 'NAAQS 60' },
                ]}
              />
            </div>
          )}

          <div className="flex flex-wrap gap-1.5">
            <button
              type="button"
              onClick={() => st().closeCompare()}
              className="w-full px-2 py-1 rounded bg-white/10 hover:bg-white/15 text-[10.5px] text-white flex items-center justify-center gap-1"
              data-testid="sim-compare-back"
            >
              <ArrowLeft size={11} /> Back to my simulation (don't apply)
            </button>
            {b.ref.kind !== 'baseline' && (
              <button
                type="button"
                onClick={() => st().applyToDesign(b.scenario)}
                className="flex-1 px-2 py-1 rounded bg-indigo-600 hover:bg-indigo-500 text-white text-[10.5px] font-semibold flex items-center justify-center gap-1"
                data-testid="sim-compare-apply"
              >
                <Wand2 size={11} /> Apply B to my design
              </button>
            )}
            {b.ref.kind === 'preview' && preview && (
              <button
                type="button"
                onClick={() => {
                  const id = newScenarioId();
                  st().saveScenario({ ...preview, id });
                  st().setCompare({ b: { kind: 'saved', id } });
                }}
                className="px-2 py-1 rounded bg-white/10 hover:bg-white/15 text-[10.5px] flex items-center gap-1"
              >
                <Save size={11} /> Save as scenario
              </button>
            )}
          </div>
        </>
      );
    })()
  ) : (
    <span className="text-[10px] text-neutral-400">Pick two designs to compare.</span>
  );

  return (
    <section
      data-testid={floating ? 'sim-compare-floating' : 'sim-compare'}
      aria-label="Compare scenarios"
      className={`flex flex-col gap-2 text-[11px] text-neutral-200 ${floating ? 'w-[300px] max-h-full overflow-y-auto px-2.5 py-2 rounded-[10px] bg-neutral-900/95 border border-white/10 shadow-xl backdrop-blur-md' : 'p-2.5 rounded-[8px] bg-black/20 border border-indigo-500/40'}`}
    >
      <div className="flex items-center gap-1.5">
        <span className="text-[10px] uppercase tracking-wider font-semibold text-indigo-300">
          Compare
        </span>
        <button
          type="button"
          aria-label="Close compare"
          onClick={() => st().closeCompare()}
          className="ml-auto p-0.5 rounded hover:bg-white/10 text-neutral-400"
          data-testid="sim-compare-close"
        >
          <X size={13} />
        </button>
      </div>
      <div className="grid grid-cols-[auto_1fr] gap-x-1.5 gap-y-1 items-center text-[10.5px]">
        {(['a', 'b'] as const).map((side) => (
          <React.Fragment key={side}>
            <span
              className={`w-4 h-4 rounded-full text-[9.5px] font-bold flex items-center justify-center ${side === 'a' ? 'bg-sky-600' : 'bg-orange-600'} text-white`}
            >
              {side.toUpperCase()}
            </span>
            <select
              aria-label={`Side ${side.toUpperCase()}`}
              data-testid={`sim-compare-${side}`}
              value={refValue(compare[side])}
              onChange={(e) => st().setCompare({ [side]: parseRef(e.target.value) })}
              className="min-w-0 bg-black/30 border border-white/10 rounded px-1 py-0.5 text-[10.5px] text-neutral-100"
            >
              {options.map((o) => (
                <option key={o.v} value={o.v}>
                  {o.label}
                </option>
              ))}
            </select>
          </React.Fragment>
        ))}
      </div>
      <div
        role="radiogroup"
        aria-label="Compare view"
        className="flex p-0.5 rounded-[7px] bg-black/30 border border-white/10"
        data-testid="sim-compare-views"
      >
        {VIEWS.map((v) => (
          <button
            key={v.id}
            type="button"
            role="radio"
            aria-checked={compare.view === v.id}
            data-view={v.id}
            onClick={() => st().setCompare({ view: v.id })}
            className={`flex-1 rounded-[5px] px-1.5 py-0.5 text-[10.5px] font-medium ${compare.view === v.id ? 'bg-indigo-600 text-white' : 'text-neutral-300 hover:bg-white/10'}`}
          >
            {v.label}
          </button>
        ))}
      </div>
      {body}
    </section>
  );
};
