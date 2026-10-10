import React, { useEffect, useMemo } from 'react';
import { AlertTriangle, Camera, CheckCircle2, CircleAlert, Play, Plus, RefreshCw, Square, Trash2 } from 'lucide-react';
import type { Pm25Source, SiteExposure } from '../../core/schema';
import { useSceneStore } from '../../store/sceneStore';
import { DENSITY_RANGE, useSimulationStore } from '../../store/simulationStore';
import {
  DEFAULT_OUTDOOR_PM25,
  DEFAULT_SITE_EXPOSURE,
  INDIA_NAAQS_PM25_24H,
  OUTDOOR_PM25_SCENARIOS,
  PM25_EMISSION_RATES_UG_PER_MIN,
  WHO_2021_PM25_24H,
  type Pm25SourceKind,
} from '../../simulation/constants';
import { createManualProvider, createOpenMeteoProvider, withFallback } from '../../simulation/outdoorAir';
import { aqiBand, pm25Band, SERIES_COLORS } from '../../simulation/viz/colormap';
import { explainRoom } from '../../simulation/viz/explain';
import { isPm25SourceObject, placedSourceParams } from '../../simulation/sources';
import type { ThresholdCrossing } from '../../simulation/house/network';
import { Checkbox, CollapsibleSection, ScrubbableInput, Select, Slider } from '../components';
import { ModeSwitch, requestSimulationView } from './ModeSwitch';
import { TimeSeriesChart } from './TimeSeriesChart';
import { InsightsPanel } from './InsightsPanel';
import { ComparePanel } from './ComparePanel';
import { ScenarioList } from './ScenarioList';
import { useScenarioStore } from '../../store/scenarioStore';
import { useSimulationModel } from '../../store/useSimulationModel';

const KIND_LABELS: Record<Pm25SourceKind, string> = {
  'cooking-frying': 'Frying (gas stove)',
  'cooking-boiling': 'Boiling (gas stove)',
  cigarette: 'Cigarette',
  incense: 'Incense stick',
  'mosquito-coil': 'Mosquito coil',
  candle: 'Candle',
};

const DEVICE_LABELS: Record<string, string> = {
  purifier: 'Purifier',
  exhaustFan: 'Exhaust fan',
  rangeHood: 'Range hood',
  ceilingFan: 'Ceiling fan',
  pedestalFan: 'Pedestal fan',
  ac: 'Split AC',
};

const ROLE_STYLE: Record<string, string> = {
  inlet: 'text-sky-300',
  outlet: 'text-orange-300',
  bidirectional: 'text-violet-300',
  interior: 'text-neutral-400',
  closed: 'text-neutral-500',
};

function thresholdText(th: ThresholdCrossing | undefined): string {
  if (!th) return '—';
  if (th.crossing === 'falls-below') return `${(th.timeS! / 60).toFixed(0)} min`;
  if (th.crossing === 'rises-above') return `exceeded at ${(th.timeS! / 60).toFixed(0)} min`;
  return th.initiallyAbove ? 'not reached' : 'already below';
}

const Tile: React.FC<{ title: string; value: React.ReactNode; detail?: React.ReactNode; testId?: string }> = ({ title, value, detail, testId }) => (
  <div className="p-2 rounded-[8px] bg-black/25 border border-white/10 flex flex-col gap-0.5 min-w-0" data-testid={testId}>
    <span className="text-[10px] text-neutral-400">{title}</span>
    <span className="text-base font-semibold text-white leading-tight">{value}</span>
    {detail && <span className="text-[10px] text-neutral-400 leading-snug">{detail}</span>}
  </div>
);

/** `visible`: the Inspector holding this tab is open (it stays mounted while slid away). */
export const SimulationPanel: React.FC<{ visible?: boolean }> = ({ visible = true }) => {
  const { room, otherRooms, settings, network, zone, devices, result, voxelZone, stale } = useSimulationModel();
  const setParams = useSceneStore((s) => s.setParams);
  const setHouseParams = useSceneStore((s) => s.setHouseParams);
  const setUi = useSimulationStore((s) => s.setUi);
  const comparing = useScenarioStore((s) => s.compare !== null);
  const setOutdoor = useScenarioStore((s) => s.setHouseParamsEverywhere);
  // While this tab is showing, the Insights panel docks here instead of floating on the canvas
  useEffect(() => {
    setUi({ insightsDocked: visible });
    return () => setUi({ insightsDocked: false });
  }, [setUi, visible]);
  const updateObject = useSceneStore((s) => s.updateObject);
  const status = useSimulationStore((s) => s.status);
  const progress = useSimulationStore((s) => s.progress);
  const error = useSimulationStore((s) => s.error);
  const viz = useSimulationStore((s) => s.viz);
  const setViz = useSimulationStore((s) => s.setViz);
  const setSettings = useSimulationStore((s) => s.setSettings);
  const runVoxel = useSimulationStore((s) => s.runVoxel);
  const cancelRun = useSimulationStore((s) => s.cancelRun);
  const outdoorLookup = useSimulationStore((s) => s.outdoorLookup);
  const setOutdoorLookup = useSimulationStore((s) => s.setOutdoorLookup);

  const voxel = result && !stale ? result : null;
  const outdoor = room.params.outdoorPm25;
  const outdoorMode = outdoor?.source ?? 'manual';
  const sources = room.params.pm25Sources ?? [];
  const placed = room.objects.filter(isPm25SourceObject);
  const exposure = room.params.exposure ?? DEFAULT_SITE_EXPOSURE;

  const vz = voxel ? voxelZone : null;
  const roomPm = vz ? vz.voxelPm25Steady : zone.cssUgM3;
  const band = pm25Band(roomPm);
  const BandIcon = band.level === 'good' ? CheckCircle2 : band.level === 'warning' ? CircleAlert : AlertTriangle;
  const meanAge = vz?.voxelAgeMinutes ?? zone.ageMinutes;
  const stagnantAge = voxel && vz ? (voxel.hotspots.stagnant.find((h) => h.zone === vz.index)?.meanAgeMinutes ?? null) : null;
  const explanation = useMemo(() => explainRoom(network, 0, devices, stagnantAge), [network, devices, stagnantAge]);
  // Outdoor-air changes of this room by route
  const ach = useMemo(() => {
    const perH = (q: number) => (q * 3600) / zone.volumeM3;
    let windows = 0;
    let leaks = 0;
    let fromRooms = 0;
    for (const p of network.paths) {
      if (p.to < 0 && p.from === 0) {
        if (p.kind === 'leak') leaks += p.backwardM3s;
        else windows += p.backwardM3s;
      } else if (p.to === 0) fromRooms += p.forwardM3s;
      else if (p.from === 0 && p.to >= 0) fromRooms += p.backwardM3s;
    }
    return { windows: perH(windows), leaks: perH(leaks), infiltration: network.house.env.infiltrationAch, fans: perH(zone.exhaustM3s), fromRooms: perH(fromRooms) };
  }, [network, zone]);

  const setSources = (next: Pm25Source[]) => setParams({ pm25Sources: next });
  const updateSource = (id: string, patch: Partial<Pm25Source>) => setSources(sources.map((s) => (s.id === id ? { ...s, ...patch } : s)));
  const addSource = () => {
    const kind: Pm25SourceKind = 'cooking-frying';
    setSources([
      ...sources,
      { id: `src-${Date.now().toString(36)}`, kind, label: KIND_LABELS[kind], emissionRateUgMin: PM25_EMISSION_RATES_UG_PER_MIN[kind], schedule: [{ startMin: 10, durationMin: 30 }] },
    ]);
  };

  const fetchLive = async () => {
    const location = room.params.location ?? { lat: 28.61, lon: 77.21 };
    if (!room.params.location) setParams({ location });
    setOutdoorLookup({ status: 'loading', reading: outdoorLookup.reading });
    const manualValue = outdoor?.valueUgM3 ?? DEFAULT_OUTDOOR_PM25;
    const provider = withFallback(createOpenMeteoProvider(), createManualProvider(manualValue));
    const reading = await provider.getCurrentPm25(location);
    setOutdoorLookup({ status: 'done', reading });
    setHouseParams({ outdoorPm25: { valueUgM3: reading.pm25UgM3, source: reading.source, ...(reading.observedAt && { observedAt: reading.observedAt }) } });
  };

  const chartSeries = [
    { id: 'network', label: 'Network model', color: SERIES_COLORS.boxModel, points: zone.series.map((p) => [p.tS, p.c] as [number, number]) },
    ...(voxel && vz
      ? [{ id: 'voxel', label: 'Voxel room mean', color: SERIES_COLORS.voxel, markers: true, points: voxel.pm25.snapshots.map((s) => [s.tS, s.zoneMeans[vz.index]!] as [number, number]) }]
      : []),
  ];
  // How each of this room's openings actually carries air (from the network)
  const openingRows = room.openings.map((op) => {
    const paths = network.paths.filter((p) => p.openingId === op.id && p.kind !== 'undercut');
    const p = paths[0];
    if (!p || p.forwardM3s + p.backwardM3s < 1e-6) return { op, label: 'closed', flow: 0, mismatch: false, style: ROLE_STYLE.closed! };
    const sign = p.from === 0 ? 1 : -1; // + = out of this room
    const out = sign > 0 ? p.forwardM3s : p.backwardM3s;
    const inn = sign > 0 ? p.backwardM3s : p.forwardM3s;
    const other = p.to < 0 ? 'outdoors' : network.zones[p.from === 0 ? p.to : p.from]!.name;
    const net = out - inn;
    const twoWay = Math.abs(net) < 0.1 * (out + inn);
    const role = twoWay ? 'bidirectional' : net > 0 ? 'outlet' : 'inlet';
    const label = twoWay ? `two-way with ${other}` : net > 0 ? `out to ${other}` : `in from ${other}`;
    const mismatch = p.to < 0 && ((op.role === 'inlet' && role === 'outlet') || (op.role === 'outlet' && role === 'inlet'));
    return { op, label, flow: Math.max(out, inn), mismatch, style: ROLE_STYLE[role]! };
  });

  const running = status === 'running';
  const ceiling = room.wallHeight;

  return (
    <div className="flex flex-col gap-3" data-testid="simulation-panel">
      {comparing ? <ComparePanel variant="docked" /> : <InsightsPanel variant="docked" />}
      <ScenarioList />
      {/* Run bar */}
      <div className="p-2.5 rounded-[8px] bg-black/20 border border-white/10 flex flex-col gap-2">
        <div className="grid grid-cols-2 gap-2">
          <Select
            label="Resolution"
            value={settings.resolution}
            onChange={(v) => setSettings({ resolution: v as 'live' | 'full' })}
            options={[
              { value: 'live', label: 'Quick 0.2 m' },
              { value: 'full', label: 'Detailed 0.1 m' },
            ]}
          />
          <Select
            label="Duration"
            value={settings.durationS}
            onChange={(v) => setSettings({ durationS: Number(v) })}
            options={[1, 2, 4, 8].map((h) => ({ value: h * 3600, label: `${h} h` }))}
          />
        </div>
        {running ? (
          <div className="flex flex-col gap-1.5" data-testid="sim-progress">
            <div className="h-1.5 rounded bg-white/10 overflow-hidden">
              <div className="h-full bg-indigo-500 transition-[width]" style={{ width: `${Math.round((progress?.fraction ?? 0) * 100)}%` }} />
            </div>
            <div className="flex items-center justify-between gap-2">
              <span className="text-[10px] text-neutral-400 truncate">{progress?.message}</span>
              <button type="button" onClick={cancelRun} className="px-2 py-1 rounded bg-white/10 hover:bg-white/15 text-[11px] flex items-center gap-1">
                <Square size={11} /> Cancel
              </button>
            </div>
          </div>
        ) : (
          <button
            type="button"
            data-testid="run-simulation-btn"
            onClick={() => void runVoxel(room, otherRooms)}
            className="w-full py-1.5 rounded-[6px] bg-indigo-600 hover:bg-indigo-500 text-white font-semibold flex items-center justify-center gap-1.5"
          >
            {stale ? <RefreshCw size={13} /> : <Play size={13} />} {result ? 'Re-run' : 'Run'} whole-house simulation ({otherRooms.length + 1} rooms)
          </button>
        )}
        {stale && !running && (
          <span data-testid="sim-stale-badge" className="self-start px-1.5 py-0.5 rounded text-[10px] font-semibold bg-amber-500/20 text-amber-300 border border-amber-500/40 flex items-center gap-1">
            <AlertTriangle size={11} /> Results out of date — re-run
          </span>
        )}
        {status === 'cancelled' && <span className="text-[10px] text-neutral-400">Run cancelled.</span>}
        {status === 'error' && <span className="text-[10px] text-red-300">Simulation failed: {error}</span>}
        {result && !stale && (
          <span className="text-[10px] text-neutral-400">
            Voxel run: {(result.diagnostics.wallTimeMs.total / 1000).toFixed(1)} s · {result.diagnostics.fluidCells.toLocaleString()} cells at {result.grid.dx} m
          </span>
        )}
      </div>

      {/* View: one story at a time */}
      <div className="flex flex-col gap-1.5">
        <ModeSwitch />
        <button
          type="button"
          data-testid="sim-camera-view-btn"
          onClick={requestSimulationView}
          className="self-start px-2 py-0.5 rounded bg-white/10 hover:bg-white/15 text-[11px] flex items-center gap-1"
        >
          <Camera size={11} /> Simulation view
        </button>
      </div>

      {/* Outdoor scenario chips */}
      <div className="flex flex-col gap-1" data-testid="sim-outdoor-presets">
        <span className="text-[10px] text-neutral-400">
          Outdoor PM2.5 · <span className="italic">illustrative values</span>
        </span>
        <div className="flex flex-wrap gap-1">
          {OUTDOOR_PM25_SCENARIOS.map((sc) => {
            const on = outdoorMode === 'manual' && outdoor?.valueUgM3 === sc.valueUgM3;
            return (
              <button
                key={sc.id}
                type="button"
                data-testid={`sim-outdoor-${sc.id}`}
                onClick={() => setOutdoor({ outdoorPm25: { valueUgM3: sc.valueUgM3, source: 'manual' } })}
                className={`px-1.5 py-0.5 rounded-full text-[10px] border ${on ? 'bg-indigo-600 border-indigo-400 text-white' : 'bg-white/5 border-white/10 text-neutral-300 hover:bg-white/10'}`}
              >
                {sc.label} {sc.valueUgM3}
              </button>
            );
          })}
          <button
            type="button"
            data-testid="sim-outdoor-live"
            onClick={() => void fetchLive()}
            className={`px-1.5 py-0.5 rounded-full text-[10px] border ${outdoorMode === 'live' ? 'bg-indigo-600 border-indigo-400 text-white' : 'bg-white/5 border-white/10 text-neutral-300 hover:bg-white/10'}`}
          >
            Live{outdoorMode === 'live' && outdoor ? ` ${Math.round(outdoor.valueUgM3)}` : ''}
          </button>
        </div>
      </div>

      {/* Headline cards: the active room */}
      <span className="text-[10px] uppercase tracking-wider font-semibold text-neutral-400">{room.name}</span>
      <div className="grid grid-cols-2 gap-2">
        <Tile
          testId="sim-card-pm25"
          title={vz ? 'Room PM2.5 (voxel)' : 'Room PM2.5 (network)'}
          value={
            <span className="flex items-baseline gap-1">
              {roomPm.toFixed(0)} <span className="text-[10px] font-normal text-neutral-400">µg/m³</span>
            </span>
          }
          detail={
            <span className="flex items-center gap-1 text-neutral-200">
              <BandIcon size={11} style={{ color: band.color }} />
              {band.label}
            </span>
          }
        />
        <Tile
          testId="sim-card-ach"
          title="Outdoor-air changes"
          value={
            <span className="flex items-baseline gap-1">
              {zone.achOutdoor.toFixed(1)} <span className="text-[10px] font-normal text-neutral-400">/h</span>
            </span>
          }
          detail={`windows ${ach.windows.toFixed(1)} · leaks ${(ach.leaks + ach.infiltration).toFixed(1)} · fans ${ach.fans.toFixed(1)} · from rooms ${ach.fromRooms.toFixed(1)}`}
        />
        <Tile
          testId="sim-card-time"
          title="Time to fall below"
          value={<span className="text-sm">60: {thresholdText(zone.thresholds.find((t) => t.valueUgM3 === INDIA_NAAQS_PM25_24H))}</span>}
          detail={`15: ${thresholdText(zone.thresholds.find((t) => t.valueUgM3 === WHO_2021_PM25_24H))}`}
        />
        <Tile
          testId="sim-card-age"
          title="Mean age of air"
          value={
            <span className="flex items-baseline gap-1">
              {meanAge === null ? '—' : meanAge.toFixed(meanAge < 10 ? 1 : 0)} <span className="text-[10px] font-normal text-neutral-400">min</span>
            </span>
          }
          detail={vz ? 'voxel room average' : `network (room flushes every ${zone.nominalTauMinutes.toFixed(0)} min)`}
        />
      </div>

      <p className="text-[11px] text-neutral-200 leading-snug" data-testid="sim-explanation">
        {explanation}
      </p>
      <p className="text-[10px] text-neutral-500 italic">Simulated estimate from a simplified model, not a measurement.</p>

      <TimeSeriesChart
        series={chartSeries}
        durationS={settings.durationS}
        unit="µg/m³"
        thresholds={[
          { value: WHO_2021_PM25_24H, label: 'WHO 15' },
          { value: INDIA_NAAQS_PM25_24H, label: 'NAAQS 60' },
        ]}
      />

      {/* Every room of the house */}
      <CollapsibleSection title="All rooms" defaultOpen summary={`${network.zones.length} rooms`}>
        <div className="flex flex-col gap-0.5 text-[11px]" data-testid="sim-rooms">
          <div className="grid grid-cols-[1fr_auto_auto_auto] gap-x-2 text-[9px] uppercase text-neutral-500">
            <span>Room</span>
            <span className="text-right">PM2.5</span>
            <span className="text-right">ACH</span>
            <span className="text-right">Age</span>
          </div>
          {network.zones.map((z) => {
            const v = voxel ? voxel.zones.find((r) => r.roomId === z.roomId) : null;
            const pm = v ? v.voxelPm25Steady : z.cssUgM3;
            const b = aqiBand(pm);
            return (
              <div key={z.roomId} className="grid grid-cols-[1fr_auto_auto_auto] gap-x-2 items-center">
                <span className={`truncate ${z.index === 0 ? 'text-white font-semibold' : 'text-neutral-300'}`}>
                  <span className="inline-block w-2 h-2 rounded-full mr-1.5" style={{ background: b.color }} title={b.label} />
                  {z.name}
                </span>
                <span className="text-right tabular-nums">{pm.toFixed(0)}</span>
                <span className="text-right tabular-nums text-neutral-400">{z.achOutdoor.toFixed(1)}</span>
                <span className="text-right tabular-nums text-neutral-400">{(v?.voxelAgeMinutes ?? z.ageMinutes).toFixed(0)}m</span>
              </div>
            );
          })}
          <span className="text-[9px] text-neutral-500 mt-0.5">PM2.5 µg/m³ ({voxel ? 'voxel' : 'network'}) · outdoor-air changes /h · mean age of air</span>
        </div>
      </CollapsibleSection>

      {/* Openings of this room: how they actually carry air */}
      <CollapsibleSection title="Openings" defaultOpen summary={`${openingRows.filter((o) => o.mismatch).length} mismatch`}>
        <div className="flex flex-col gap-1" data-testid="sim-openings">
          {openingRows.map(({ op, label, flow, mismatch, style }) => (
            <div key={op.id} className="flex items-center justify-between gap-2 text-[11px]">
              <span className="truncate text-neutral-300" title={op.id}>
                {op.id}
              </span>
              <span className="flex items-center gap-1.5 shrink-0">
                <span className={style}>{label}</span>
                {flow > 0 && <span className="text-neutral-500">{(flow * 3600).toFixed(0)} m³/h</span>}
                {mismatch && (
                  <span className="px-1 rounded bg-amber-500/20 text-amber-300 border border-amber-500/40 text-[9px]" title={`Tagged ${op.role}`}>
                    tagged {op.role}
                  </span>
                )}
              </span>
            </div>
          ))}
          {room.openings.length === 0 && <span className="text-[11px] text-neutral-500">No openings.</span>}
        </div>
      </CollapsibleSection>

      {/* Outdoor air */}
      <CollapsibleSection title="Outdoor PM2.5" defaultOpen={false} summary={`${(outdoor?.valueUgM3 ?? DEFAULT_OUTDOOR_PM25).toFixed(0)} µg/m³ · ${outdoorMode}`}>
        <div className="flex flex-col gap-2">
          <div className="flex gap-1">
            {(['manual', 'live'] as const).map((mode) => (
              <button
                key={mode}
                type="button"
                onClick={() => {
                  if (mode === 'live') void fetchLive();
                  else setHouseParams({ outdoorPm25: { valueUgM3: outdoor?.valueUgM3 ?? DEFAULT_OUTDOOR_PM25, source: 'manual' } });
                }}
                className={`flex-1 py-1 rounded text-[11px] border ${outdoorMode === mode ? 'bg-indigo-600 border-indigo-400 text-white' : 'bg-white/5 border-white/10 text-neutral-300'}`}
              >
                {mode === 'manual' ? 'Manual' : 'Live'}
              </button>
            ))}
          </div>
          {outdoorMode === 'manual' ? (
            <ScrubbableInput
              label="PM2.5"
              value={outdoor?.valueUgM3 ?? DEFAULT_OUTDOOR_PM25}
              min={0}
              max={999}
              step={5}
              unit="µg/m³"
              onChange={(v) => setHouseParams({ outdoorPm25: { valueUgM3: Math.max(0, v), source: 'manual' } })}
            />
          ) : (
            <span className="text-[11px] text-neutral-200">
              {outdoor?.valueUgM3.toFixed(1)} µg/m³ {outdoor?.observedAt ? `at ${outdoor.observedAt} (UTC)` : ''} · Open-Meteo (CAMS)
            </span>
          )}
          <div className="grid grid-cols-2 gap-2">
            <ScrubbableInput label="Lat" value={room.params.location?.lat ?? 28.61} step={0.01} min={-90} max={90} precision={2} onChange={(lat) => setParams({ location: { lat, lon: room.params.location?.lon ?? 77.21 } })} />
            <ScrubbableInput label="Lon" value={room.params.location?.lon ?? 77.21} step={0.01} min={-180} max={180} precision={2} onChange={(lon) => setParams({ location: { lat: room.params.location?.lat ?? 28.61, lon } })} />
          </div>
          {outdoorLookup.status === 'loading' && <span className="text-[10px] text-neutral-400">Fetching live PM2.5…</span>}
          {outdoorLookup.reading?.fallbackReason && (
            <span className="text-[10px] text-amber-300 flex gap-1">
              <AlertTriangle size={11} className="shrink-0 mt-px" /> Live lookup failed ({outdoorLookup.reading.fallbackReason}); using the manual value.
            </span>
          )}
          {outdoorMode === 'live' && (
            <button type="button" onClick={() => void fetchLive()} className="self-start px-2 py-0.5 rounded bg-white/10 hover:bg-white/15 text-[11px] flex items-center gap-1">
              <RefreshCw size={11} /> Refresh
            </button>
          )}
        </div>
      </CollapsibleSection>

      <Select
        label="Site exposure"
        value={exposure}
        onChange={(v) => setHouseParams({ exposure: v as SiteExposure })}
        options={[
          { value: 'open', label: 'Open (rural / high floor)' },
          { value: 'suburban', label: 'Suburban' },
          { value: 'urbanDense', label: 'Urban dense' },
        ]}
      />

      {/* PM2.5 sources */}
      <CollapsibleSection title="PM2.5 sources" defaultOpen={false} summary={`${sources.length + placed.length}`} action={<button type="button" onClick={addSource} aria-label="Add source" className="p-0.5 rounded hover:bg-white/10"><Plus size={13} /></button>}>
        <div className="flex flex-col gap-2" data-testid="sim-sources">
          {placed.map((o) => {
            const p = placedSourceParams(o)!;
            return (
              <div key={o.id} className="flex items-center justify-between gap-2 text-[11px]">
                <Checkbox checked={p.enabled} onChange={(on) => updateObject(o.id, { enabled: on })} label={o.name} />
                <span className="text-neutral-400 shrink-0">
                  {Math.round(p.rateUgMin)} µg/min · {p.schedule[0] ? `${p.schedule[0].startMin}–${p.schedule[0].startMin + p.schedule[0].durationMin} min` : 'always'}
                </span>
              </div>
            );
          })}
          {sources.length === 0 && placed.length === 0 && (
            <span className="text-[11px] text-neutral-500">No indoor sources. Drag one from Asset Library › Pollution sources, or add a room-wide source with +.</span>
          )}
          {sources.length > 0 && <span className="text-[10px] text-neutral-500">Room-wide sources (spread through the room unless attached):</span>}
          {sources.map((src) => {
            const win = src.schedule?.[0];
            return (
              <div key={src.id} className="p-2 rounded bg-black/20 border border-white/10 flex flex-col gap-1.5">
                <div className="flex items-center gap-1">
                  <Select
                    className="flex-1"
                    value={(src.kind as Pm25SourceKind) ?? 'cooking-frying'}
                    onChange={(k) => {
                      const kind = k as Pm25SourceKind;
                      updateSource(src.id, { kind, label: KIND_LABELS[kind], emissionRateUgMin: PM25_EMISSION_RATES_UG_PER_MIN[kind] });
                    }}
                    options={(Object.keys(KIND_LABELS) as Pm25SourceKind[]).map((k) => ({ value: k, label: KIND_LABELS[k] }))}
                  />
                  <button type="button" aria-label="Remove source" onClick={() => setSources(sources.filter((s) => s.id !== src.id))} className="p-1 rounded hover:bg-white/10 text-neutral-400">
                    <Trash2 size={12} />
                  </button>
                </div>
                <ScrubbableInput label="Rate" value={src.emissionRateUgMin} min={0} step={50} unit="µg/min" onChange={(v) => updateSource(src.id, { emissionRateUgMin: Math.max(0, v) })} />
                <Select
                  value={src.objectId ?? ''}
                  onChange={(v) => updateSource(src.id, { objectId: v ? String(v) : undefined })}
                  options={[{ value: '', label: 'Spread through the room' }, ...room.objects.map((o) => ({ value: o.id, label: `At ${o.name}` }))]}
                />
                <Checkbox
                  checked={!win}
                  label="Always on"
                  onChange={(always) => updateSource(src.id, { schedule: always ? undefined : [{ startMin: 0, durationMin: 30 }] })}
                />
                {win && (
                  <div className="grid grid-cols-2 gap-2">
                    <ScrubbableInput label="Start" value={win.startMin} min={0} step={5} unit="min" onChange={(v) => updateSource(src.id, { schedule: [{ ...win, startMin: Math.max(0, v) }] })} />
                    <ScrubbableInput label="For" value={win.durationMin} min={1} step={5} unit="min" onChange={(v) => updateSource(src.id, { schedule: [{ ...win, durationMin: Math.max(1, v) }] })} />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </CollapsibleSection>

      {/* Devices */}
      <CollapsibleSection title="Devices" defaultOpen={false} summary={`${devices.filter((d) => d.enabled).length}/${devices.length} on`}>
        <div className="flex flex-col gap-1" data-testid="sim-devices">
          {devices.length === 0 && <span className="text-[11px] text-neutral-500">No purifiers, fans or ACs in this room.</span>}
          {devices.map((d) => (
            <div key={d.objectId} className="flex items-center justify-between gap-2 text-[11px]">
              <Checkbox checked={d.enabled} onChange={(on) => updateObject(d.objectId, { enabled: on })} label={d.name} />
              <span className="text-neutral-400 shrink-0">
                {DEVICE_LABELS[d.kind]} · {(d.flowM3s * 3600).toFixed(0)} m³/h
              </span>
            </div>
          ))}
        </div>
      </CollapsibleSection>

      {/* Display */}
      <CollapsibleSection title="Display" defaultOpen summary={viz.show ? viz.mode : 'hidden'}>
        <div className="flex flex-col gap-2" data-testid="sim-display">
          <Checkbox checked={viz.show} onChange={(show) => setViz({ show })} label="Show simulation layer" />
          {viz.mode === 'pollution' && (
            <>
              <Checkbox checked={viz.relative} onChange={(relative) => setViz({ relative })} label="Relative colours (stretch to this view)" />
              <Checkbox checked={viz.smoke} onChange={(smoke) => setViz({ smoke })} label="Smoke from sources" />
            </>
          )}
          {viz.mode === 'ventilation' && (
            <>
              <Checkbox checked={viz.stagnant} onChange={(stagnant) => setViz({ stagnant })} label="Outline the stalest zones" />
              <Checkbox checked={viz.streamlines} onChange={(streamlines) => setViz({ streamlines })} label="Faint streamlines" />
            </>
          )}
          {viz.mode === 'airflow' && (
            <>
              <Checkbox checked={viz.streamlines} onChange={(streamlines) => setViz({ streamlines })} label="Streamlines" />
              <Checkbox checked={viz.openingArrows} onChange={(openingArrows) => setViz({ openingArrows })} label="Flow arrows at openings" />
            </>
          )}
          <Slider label="Particle density" value={viz.density} min={DENSITY_RANGE[0]} max={DENSITY_RANGE[1]} step={0.25} unit="×" onChange={(density) => setViz({ density })} />
          <Slider label="Flow speed-up" value={viz.timeScale} min={1} max={50} step={1} unit="×" onChange={(timeScale) => setViz({ timeScale })} />
          <Checkbox checked={viz.roomLabels} onChange={(roomLabels) => setViz({ roomLabels })} label="Room chips" />
          <Checkbox checked={viz.ghostFurniture} onChange={(ghostFurniture) => setViz({ ghostFurniture })} label="Ghost furniture" />
          <Checkbox checked={viz.cutaway} onChange={(cutaway) => setViz({ cutaway })} label="Low walls (cut at 1 m)" />
          <CollapsibleSection title="Advanced" defaultOpen={false}>
            <div className="flex flex-col gap-2" data-testid="sim-advanced">
              <Slider label="Sampled height" value={viz.sliceHeight} min={0.1} max={ceiling} step={0.1} unit="m" onChange={(sliceHeight) => setViz({ sliceHeight })} />
              <span className="text-[10px] text-neutral-500 -mt-1">The heatmap shows the field at this height, drawn on each room's floor.</span>
              {viz.mode === 'ventilation' && <Checkbox checked={viz.autoContrast} onChange={(autoContrast) => setViz({ autoContrast })} label="Auto contrast (age)" />}
              <Checkbox checked={viz.vertical.enabled} onChange={(enabled) => setViz({ vertical: { ...viz.vertical, enabled } })} label="Vertical slice" />
              {viz.vertical.enabled && result && (
                <>
                  <Select
                    value={viz.vertical.axis}
                    onChange={(axis) => setViz({ vertical: { ...viz.vertical, axis: axis as 'x' | 'z', position: null } })}
                    options={[
                      { value: 'z', label: 'West–east cut' },
                      { value: 'x', label: 'North–south cut' },
                    ]}
                  />
                  {(() => {
                    const g = result.grid;
                    const axisIdx = viz.vertical.axis === 'x' ? 0 : 2;
                    const n = viz.vertical.axis === 'x' ? g.nx : g.nz;
                    const lo = g.origin[axisIdx]! + g.dx / 2;
                    const hi = g.origin[axisIdx]! + (n - 0.5) * g.dx;
                    return (
                      <Slider label="Position" value={viz.vertical.position ?? (lo + hi) / 2} min={lo} max={hi} step={g.dx} unit="m" onChange={(position) => setViz({ vertical: { ...viz.vertical, position } })} />
                    );
                  })()}
                </>
              )}
              <Checkbox checked={viz.arrows} onChange={(arrows) => setViz({ arrows })} label="Velocity arrows" />
              <Checkbox checked={viz.hotspots} onChange={(hotspots) => setViz({ hotspots })} label="PM2.5 hotspot boxes" />
            </div>
          </CollapsibleSection>
        </div>
      </CollapsibleSection>
    </div>
  );
};
