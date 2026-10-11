import React, { useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, Pause, Play } from 'lucide-react';
import { useSimulationStore, type SimViewMode } from '../../store/simulationStore';
import { useSceneStore } from '../../store/sceneStore';
import { sourceEvents } from '../../simulation/sources';
import { achPosition, AQI_PM25_BANDS, AQI_SCALE_MAX, motionTimeScale, rampCss, scalePosition } from '../../simulation/viz/colormap';
import { ACH_BANDS, AGE_BANDS } from '../../simulation/viz/insights';
import { ModeSwitch } from '../../ui/simulation/ModeSwitch';
import { useDisplayedField } from './useDisplayedField';
import { useStaleZones } from './useStaleZones';
import { STALE_COLOR } from './FloorHeatmap';
import { useCompareFields, type CompareFields } from './CompareLayer';
import { useScenarioStore, type CompareView } from '../../store/scenarioStore';

const fmtClock = (s: number) => `${Math.floor(s / 3600)}:${String(Math.floor((s % 3600) / 60)).padStart(2, '0')}`;
const fmtNum = (v: number) => (v >= 100 ? v.toFixed(0) : v >= 10 ? v.toFixed(0) : v.toFixed(1));

/** Bottom-left status bar height the legend stays above when it sits in the left column. */
const STATUS_BAR_CLEARANCE = 52;

/**
 * Where the legend goes: in the left column under the Asset Library (above the status bar) when
 * it fits there, otherwise beside the library.
 */
function useLibraryClearance(legend: React.RefObject<HTMLDivElement | null>, active: boolean): { left: number; bottom: number } {
  const [pos, setPos] = useState({ left: 12, bottom: STATUS_BAR_CLEARANCE });
  useEffect(() => {
    if (!active) return;
    const lib = document.querySelector('[data-testid="asset-library-sidebar"], [data-viewport-left]');
    const update = () => {
      const r = lib?.getBoundingClientRect();
      const h = legend.current?.offsetHeight ?? 320;
      const beside = r && r.width > 0 && r.bottom > window.innerHeight - h - STATUS_BAR_CLEARANCE - 12;
      const next = beside ? { left: Math.round(r.right + 12), bottom: 12 } : { left: 12, bottom: STATUS_BAR_CLEARANCE };
      setPos((p) => (p.left === next.left && p.bottom === next.bottom ? p : next));
    };
    update();
    const ro = new ResizeObserver(update);
    if (lib) ro.observe(lib);
    if (legend.current) ro.observe(legend.current);
    window.addEventListener('resize', update);
    return () => {
      ro.disconnect();
      window.removeEventListener('resize', update);
    };
  }, [legend, active]);
  return pos;
}

const Swatch: React.FC<{ color: string; dashed?: boolean }> = ({ color, dashed }) => (
  <span className="inline-block w-3.5 align-middle" style={{ borderTop: `2px ${dashed ? 'dashed' : 'solid'} ${color}` }} />
);

/** Compare view: the shared A/B scale, or the diverging difference scale in µg/m³ (or min) and %. */
const CompareLegend: React.FC<{ fields: CompareFields; view: CompareView; mode: SimViewMode }> = ({ fields, view, mode }) => {
  const what = mode === 'pollution' ? 'PM2.5' : 'air age';
  if (view === 'diff') {
    const m = fields.diffScale.domain[1];
    const pctOf = (x: number) => Math.round((100 * x) / Math.max(1e-9, fields.reference));
    return (
      <div data-testid="sim-legend-diff">
        <div className="text-[10px] text-neutral-300 mb-0.5">Colour = change in {what}</div>
        <div className="h-2.5 rounded-sm" style={{ background: rampCss('diff') }} />
        <div className="flex justify-between text-[8.5px] text-neutral-300 tabular-nums">
          <span>−{fmtNum(m)} {fields.unit}</span>
          <span>0</span>
          <span>+{fmtNum(m)} {fields.unit}</span>
        </div>
        <div className="flex justify-between text-[8.5px] text-neutral-400 tabular-nums">
          <span>−{pctOf(m)}%</span>
          <span>no change</span>
          <span>+{pctOf(m)}%</span>
        </div>
        <div className="text-[9px] text-neutral-500">Green = better, red = worse; % of A's house average ({fmtNum(fields.reference)} {fields.unit}){fields.voxel ? '' : ' · room averages (network model)'}</div>
      </div>
    );
  }
  return (
    <div data-testid="sim-legend-compare">
      <div className="h-2.5 rounded-sm" style={{ background: rampCss(mode === 'pollution' ? 'pm25' : 'age') }} />
      <div className="flex justify-between text-[8.5px] text-neutral-400 tabular-nums">
        <span>{fmtNum(fields.scale.domain[0])}</span>
        <span>{fields.scale.log ? 'log scale' : ''}</span>
        <span>
          {fmtNum(fields.scale.domain[1])}
          {mode === 'pollution' ? '+' : ''} {fields.unit}
        </span>
      </div>
      {mode === 'pollution' && (
        <div className="flex flex-wrap gap-x-2 text-[9px] text-neutral-300">
          {AQI_PM25_BANDS.map((b) => (
            <span key={b.label} className="flex items-center gap-1">
              <span className="inline-block w-2 h-2 rounded-sm" style={{ background: b.color }} />
              {b.label}
            </span>
          ))}
        </div>
      )}
      <div className="text-[9px] text-neutral-500">Same colour scale for A and B{fields.voxel ? '' : ' · room averages (network model)'}</div>
    </div>
  );
};

const TITLES: Record<SimViewMode, string> = {
  pollution: 'Colour = PM2.5 while every source is on',
  ventilation: 'Colour = how old / stale the air is',
  airflow: 'Lines = where air flows',
};

/** Band boundaries drawn on a bar: tick marks at `at` (0–1) with the band words centred between them. */
const BandScale: React.FC<{ ticks: { at: number; label: string }[]; words: string[] }> = ({ ticks, words }) => {
  const edges = [0, ...ticks.map((t) => t.at), 1];
  return (
    <>
      <div className="relative h-2.5 text-[8.5px] text-neutral-400">
        {ticks.map((t) => (
          <span key={t.label} className="absolute top-0 -translate-x-1/2 tabular-nums" style={{ left: `${t.at * 100}%` }}>
            {t.label}
          </span>
        ))}
      </div>
      <div className="relative h-3 text-[8.5px] text-neutral-300">
        {words.map((w, i) => {
          const a = edges[i]!;
          const b = edges[i + 1]!;
          return b - a < 0.06 ? null : (
            <span key={w} className="absolute top-0 -translate-x-1/2 whitespace-nowrap" style={{ left: `${((a + b) / 2) * 100}%` }}>
              {w}
            </span>
          );
        })}
      </div>
    </>
  );
};

const Ticks: React.FC<{ at: number[] }> = ({ at }) => (
  <>
    {at.map((t) => (
      <span key={t} className="absolute top-0 bottom-0 w-px bg-black/60" style={{ left: `${t * 100}%` }} />
    ))}
  </>
);

/**
 * The one floating legend (bottom-left, kept clear of the Asset Library): a plain-language title
 * for the view mode, its colour bar with units and band names, the flow time-scale (Airflow), the
 * playback timeline (Pollution) and the "simulated estimate" note.
 */
export const SimulationLegend: React.FC = () => {
  const displayed = useDisplayedField();
  const viz = useSimulationStore((s) => s.viz);
  const setViz = useSimulationStore((s) => s.setViz);
  const durationS = useSimulationStore((s) => s.settings.durationS);
  const room = useSceneStore((s) => s.room);
  const otherRooms = useSceneStore((s) => s.otherRooms);
  const staleZones = useStaleZones();
  const docked = useSimulationStore((s) => s.insightsDocked);
  const compareView = useScenarioStore((s) => s.compare?.view ?? null);
  const compareFields = useCompareFields(useMemo(() => [room, ...otherRooms], [room, otherRooms]));
  const legendRef = useRef<HTMLDivElement>(null);
  const { left, bottom } = useLibraryClearance(legendRef, viz.show && displayed !== null);
  const snapshots = displayed?.result.pm25.snapshots ?? [];
  const events = useMemo(() => sourceEvents([room, ...otherRooms], durationS), [room, otherRooms, durationS]);

  // Play: step through the snapshots, then return to the steady state
  useEffect(() => {
    if (!viz.playing || snapshots.length === 0) return;
    const id = setInterval(() => {
      const st = useSimulationStore.getState();
      const next = st.viz.snapshotIndex === null ? 0 : st.viz.snapshotIndex + 1;
      if (next >= snapshots.length) st.setViz({ snapshotIndex: null, playing: false });
      else st.setViz({ snapshotIndex: next });
    }, 900);
    return () => clearInterval(id);
  }, [viz.playing, snapshots.length]);

  if (!viz.show || !displayed) return null;
  const { scale, stale, timeS, result, speedRef } = displayed;
  const mode = viz.mode;
  const total = snapshots.length > 0 ? snapshots[snapshots.length - 1]!.tS : durationS;
  const moving = result.velocity.maxSpeed > 1e-4;
  const showSpeed = moving && (mode === 'airflow' || (mode === 'ventilation' && viz.streamlines));

  const pickTime = (t: number) => {
    let best = 0;
    snapshots.forEach((sn, i) => {
      if (Math.abs(sn.tS - t) < Math.abs(snapshots[best]!.tS - t)) best = i;
    });
    setViz({ snapshotIndex: best, playing: false });
  };

  const ageTicks =
    mode === 'ventilation' && scale
      ? AGE_BANDS.slice(0, -1)
          .map((b) => ({ at: scalePosition(scale, b.limit), label: `${b.limit}` }))
          .filter((t) => t.at > 0.02 && t.at < 0.98)
      : [];
  const ageWords = AGE_BANDS.filter((b, i) => {
    if (!scale) return false;
    const lo = i === 0 ? -Infinity : AGE_BANDS[i - 1]!.limit;
    return b.limit > scale.domain[0] && lo < scale.domain[1];
  }).map((b) => b.label);
  const achTicks = [...ACH_BANDS]
    .reverse()
    .slice(1)
    .map((b) => ({ at: achPosition(b.limit), label: `${b.limit}` }));

  return (
    <div
      ref={legendRef}
      data-testid="simulation-legend"
      className="pointer-events-auto absolute z-[12] w-[252px] px-2.5 py-2 rounded-[10px] bg-neutral-900/95 border border-white/10 shadow-xl text-[10px] text-neutral-300 flex flex-col gap-1.5 select-none"
      style={{ left, bottom }}
    >
      <div className="flex items-start justify-between gap-2">
        <span className="font-semibold text-[11px] leading-tight text-white" data-testid="sim-legend-title">
          {compareFields ? (compareView === 'diff' ? 'Compare: what changes from A to B' : `Compare A and B · ${TITLES[mode].replace('Colour = ', 'colour = ')}`) : TITLES[mode]}
        </span>
        {stale && (
          <span className="flex items-center gap-1 text-amber-300 text-[9.5px] shrink-0">
            <AlertTriangle size={10} /> out of date
          </span>
        )}
      </div>
      {/* The Simulation tab has its own switch; the legend carries one when that tab is closed */}
      {!docked && <ModeSwitch compact testId="sim-legend-mode" />}

      {compareFields && <CompareLegend fields={compareFields} view={compareView!} mode={mode} />}
      {!compareFields && (
        <>
        {mode === 'pollution' && scale && !scale.relative && (
          <div data-testid="sim-legend-aqi">
            <div className="relative h-2.5 rounded-sm overflow-hidden" style={{ background: rampCss('pm25') }} />
            <div className="relative h-2.5 text-[8.5px] text-neutral-400 tabular-nums">
              {[30, 60, 90, 120, 250].map((t) => (
                <span key={t} className="absolute top-0 -translate-x-1/2" style={{ left: `${(100 * t) / AQI_SCALE_MAX}%` }}>
                  {t}
                </span>
              ))}
              <span className="absolute right-0">{AQI_SCALE_MAX}+</span>
            </div>
            <div className="mt-0.5 flex flex-wrap gap-x-2 gap-y-0 text-[9px] text-neutral-300">
              {AQI_PM25_BANDS.map((b) => (
                <span key={b.label} className="flex items-center gap-1">
                  <span className="inline-block w-2 h-2 rounded-sm" style={{ background: b.color }} />
                  {b.label}
                </span>
              ))}
            </div>
            <div className="text-[9px] text-neutral-500">PM2.5 in µg/m³ at {viz.sliceHeight.toFixed(1)} m · India AQI bands · limit 60</div>
          </div>
        )}
        {mode === 'pollution' && scale?.relative && (
          <div data-testid="sim-legend-relative">
            <div className="h-2.5 rounded-sm" style={{ background: rampCss('pm25-relative') }} />
            <div className="flex justify-between text-[9px] text-neutral-400 tabular-nums">
              <span>{fmtNum(scale.domain[0])} µg/m³</span>
              <span>{fmtNum(scale.domain[1])} µg/m³</span>
            </div>
            <div className="text-[9px] text-amber-200/90">Relative colours stretched to this view, not AQI bands</div>
          </div>
        )}
        {mode === 'ventilation' && scale && (
          <div data-testid="sim-legend-age">
            <div className="relative h-2.5 rounded-sm overflow-hidden" style={{ background: rampCss('age') }}>
              <Ticks at={ageTicks.map((t) => t.at)} />
            </div>
            <div className="relative h-2.5 text-[8.5px] text-neutral-400 tabular-nums">
              <span className="absolute left-0">{fmtNum(scale.domain[0])}</span>
              {ageTicks.map((t) => (
                <span key={t.label} className="absolute -translate-x-1/2" style={{ left: `${t.at * 100}%` }}>
                  {t.label}
                </span>
              ))}
              <span className="absolute right-0">{fmtNum(scale.domain[1])}</span>
            </div>
            <div className="flex justify-between text-[8.5px] text-neutral-300">
              {ageWords.map((w) => (
                <span key={w}>{w}</span>
              ))}
            </div>
            <div className="text-[9px] text-neutral-500">Minutes since the air came in from outdoors{scale.log ? ' · log scale' : ''}</div>
            {staleZones.length > 0 && (
              <div className="mt-0.5 text-[9.5px] text-neutral-300">
                <Swatch color={STALE_COLOR} /> stalest {staleZones.length === 1 ? 'zone' : `${staleZones.length} zones`} of the house
              </div>
            )}
          </div>
        )}
        </>
      )}
      {showSpeed && (
        <div data-testid="sim-legend-speed">
          <div className="h-1.5 rounded-sm" style={{ background: rampCss('speed-lines') }} />
          <div className="flex justify-between text-[8.5px] text-neutral-400 tabular-nums">
            <span>still</span>
            <span>{mode === 'airflow' ? 'line colour = air speed' : 'faint lines = airflow'}</span>
            <span>{speedRef.toFixed(2)} m/s</span>
          </div>
        </div>
      )}
      {mode === 'airflow' && (
        <>
          <div data-testid="sim-legend-ach">
            <div className="relative h-2 rounded-sm overflow-hidden" style={{ background: rampCss('ach') }}>
              <Ticks at={achTicks.map((t) => t.at)} />
            </div>
            <BandScale ticks={achTicks} words={[...ACH_BANDS].reverse().map((b) => b.label)} />
            <div className="text-[9px] text-neutral-500">Floor = outdoor-air changes per hour</div>
          </div>
          <div className="flex flex-wrap gap-x-2.5 gap-y-0 text-[9.5px] text-neutral-400" data-testid="sim-legend-arrows">
            <span>
              <Swatch color="#38bdf8" /> in
            </span>
            <span>
              <Swatch color="#fb923c" /> out
            </span>
            <span>
              <Swatch color="#e5e7eb" /> room → room (m³/h)
            </span>
          </div>
        </>
      )}
      {moving && mode === 'airflow' && viz.streamlines && (
        <div className="text-[9.5px] text-neutral-400" data-testid="sim-legend-timescale">
          {(() => {
            const ts = motionTimeScale(displayed?.result.velocity.maxSpeed ?? 0, viz.timeScale);
            return ts <= 1.05 ? 'Motion shown at real speed' : `Motion shown ${ts >= 10 ? Math.round(ts) : ts.toFixed(1)}× faster than real time`;
          })()}
        </div>
      )}

      {/* Playback timeline (PM2.5 and smoke) */}
      {snapshots.length > 0 && mode === 'pollution' && (
        <div className="flex flex-col gap-0.5" data-testid="sim-timeline">
          <div className="flex items-center gap-1.5">
            <button type="button" aria-label={viz.playing ? 'Pause' : 'Play'} onClick={() => setViz({ playing: !viz.playing, ...(viz.snapshotIndex === null && { snapshotIndex: 0 }) })} className="p-0.5 rounded bg-white/10 hover:bg-white/15">
              {viz.playing ? <Pause size={11} /> : <Play size={11} />}
            </button>
            <button
              type="button"
              onClick={() => setViz({ snapshotIndex: null, playing: false })}
              className={`px-1.5 py-px rounded text-[9.5px] border ${timeS === null ? 'bg-indigo-600 border-indigo-400 text-white' : 'bg-white/5 border-white/10 text-neutral-300'}`}
            >
              Steady
            </button>
            <span className="ml-auto text-neutral-200 tabular-nums text-[9.5px]" data-testid="sim-playback-time">
              {timeS === null ? 'While every source is on' : `t = ${fmtClock(timeS)}`}
            </span>
          </div>
          <div
            className="relative h-3.5 cursor-pointer"
            onPointerDown={(e) => {
              const r = e.currentTarget.getBoundingClientRect();
              pickTime(((e.clientX - r.left) / r.width) * total);
            }}
          >
            <div className="absolute left-0 right-0 top-1.5 h-1 rounded bg-white/15" />
            {events.map((ev, i) => (
              <span
                key={i}
                data-testid="sim-timeline-event"
                title={`${ev.label} ${fmtClock(ev.tS)}`}
                className="absolute top-0 -translate-x-1/2 w-0 h-0 border-l-[4px] border-r-[4px] border-t-[6px] border-l-transparent border-r-transparent"
                style={{ left: `${(100 * ev.tS) / total}%`, borderTopColor: ev.kind === 'start' ? '#fb923c' : '#94a3b8' }}
              />
            ))}
            {timeS !== null && <span className="absolute top-0.5 w-2.5 h-2.5 -translate-x-1/2 rounded-full bg-indigo-400 border border-white" style={{ left: `${(100 * timeS) / total}%` }} />}
          </div>
        </div>
      )}
      <div className="text-[9px] italic text-neutral-500">Simulated estimate from a simplified model, not a measurement.</div>
    </div>
  );
};
