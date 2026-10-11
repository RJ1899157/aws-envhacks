import React, { useMemo, useState } from 'react';
import { AlertTriangle, ChevronDown, ChevronRight, HeartPulse, ShieldCheck } from 'lucide-react';
import {
  co2Health,
  dailyPm25,
  effectiveOutdoorAch,
  estimateCo2,
  occupantsOf,
  peakExposure,
  pm25Health,
  roomHazards,
  scheduledSources,
  type Co2Health,
  type Hazard,
  type Pm25Health,
} from '../../simulation/health';
import { simulateHouseNetwork } from '../../simulation/house/network';
import { useSimulationModel } from '../../store/useSimulationModel';

/**
 * "What this means for your health": each room's PM2.5 against India's AQI bands (with CPCB's
 * official health statement) and the WHO guideline, and its stale-air risk as estimated CO₂ from
 * the people usually there. Worst room first, with a headline for the most serious one.
 */

interface RoomHealth {
  roomId: string;
  name: string;
  pm: Pm25Health;
  /** PM2.5 while the scheduled sources run (what the 3D view shows), when much worse than the day average */
  whileOn: Pm25Health | null;
  /** The scheduled sources that peak is from: the ones in this room, else all of them with their room */
  whileOnSources: string[];
  co2: Co2Health | null;
  people: number;
  activity: string;
  ageMinutes: number;
  /** Carbon monoxide, cooking fumes, poor ventilation (most serious first) */
  hazards: Hazard[];
  /** 0 fine … 3 serious */
  severity: number;
}

const ACTIVITY_WORD = { sleeping: 'asleep', sitting: 'sitting', light: 'busy' } as const;

/** 0 fine, 1 mild, 2 notable, 3 serious */
function severityOf(pm: Pm25Health, co2: Co2Health | null): number {
  // PM2.5 bands Poor and above are serious; CO₂ categories map one-to-one (I fine … IV serious)
  return Math.max(Math.min(3, pm.level), co2 ? co2.category - 1 : 0);
}

const TONE = ['#2e9d3a', '#e8d23a', '#f29130', '#e2362b'] as const;
/** Text colour of a PM2.5 band: the two darkest bands (Very poor, Severe) lightened to stay readable on the dark panel */
const bandText = (pm: Pm25Health) =>
  pm.level === 5 ? '#fb7185' : pm.level === 4 ? '#c084fc' : pm.color;

/** "frying" or "frying in the Kitchen or incense burns in the Living Room" */
function sourcesText(r: RoomHealth): string {
  const n = [...new Set(r.whileOnSources)];
  return n.length <= 2 ? n.join(' or ') : `${n.slice(0, -1).join(', ')} or ${n[n.length - 1]}`;
}

export const HealthCard: React.FC = () => {
  const { rooms, network, result, stale } = useSimulationModel();
  const [open, setOpen] = useState(true);

  // 24-hour average PM2.5 per room (sources on their schedules), compared with 24-hour guidelines
  const daily = useMemo(
    () =>
      dailyPm25(rooms, (rs, durationS) => simulateHouseNetwork(rs, {}, { durationS, dtS: 300 })),
    [rooms]
  );

  const scheduled = useMemo(() => scheduledSources(rooms), [rooms]);

  const rows = useMemo<RoomHealth[]>(() => {
    const co2 = estimateCo2(network);
    return network.zones
      .map((z, i) => {
        const voxel =
          result && !stale ? result.zones.find((v) => v.roomId === z.roomId) : undefined;
        const pm = pm25Health(daily.meanUgM3[i] ?? z.cssUgM3);
        // The same steady value as the room chips in the 3D view
        const whileOn =
          scheduled.length > 0 ? peakExposure(pm.ugM3, voxel?.voxelPm25Steady ?? z.cssUgM3) : null;
        const here = scheduled.filter((src) => src.roomId === z.roomId);
        const whileOnSources =
          here.length > 0
            ? here.map((src) => src.activity)
            : scheduled.map((src) => `${src.activity} in the ${src.roomName}`);
        const occ = occupantsOf(network.house.zones[i]!.room);
        const c = occ.count > 0 ? co2Health(co2[i]!) : null;
        const hazards = roomHazards(
          network.house.zones[i]!.room,
          effectiveOutdoorAch(z.achOutdoor, z.ageMinutes),
          network.house.env.infiltrationAch,
          z.exhaustM3s > 0
        );
        return {
          roomId: z.roomId,
          name: z.name,
          pm,
          whileOn,
          whileOnSources,
          co2: c,
          people: occ.count,
          activity: ACTIVITY_WORD[occ.activity],
          ageMinutes: voxel?.voxelAgeMinutes ?? z.ageMinutes,
          hazards,
          severity: Math.max(
            severityOf(pm, c),
            whileOn ? Math.min(3, whileOn.level) : 0,
            ...hazards.map((h) => h.level)
          ),
        };
      })
      .sort((a, b) => b.severity - a.severity || b.pm.ugM3 - a.pm.ugM3);
  }, [network, result, stale, daily, scheduled]);

  if (rows.length === 0) return null;
  const worst = rows[0]!;
  const serious = rows.filter((r) => r.severity >= 3);

  // Headline: the single most serious reason in the worst room (ties go to the more specific one:
  // carbon monoxide, then PM2.5, then CO₂, then the other hazards)
  const reasons = (r: RoomHealth): { level: number; text: string }[] => [
    ...r.hazards
      .filter((h) => h.level === 3)
      .map((h) => ({ level: 3.5, text: `${h.title}. ${h.detail}` })),
    ...(r.whileOn
      ? [
          {
            level: Math.min(3, r.whileOn.level) + 0.35,
            text: `${r.whileOn.band} air while ${sourcesText(r)}: ~${Math.round(r.whileOn.ugM3)} µg/m³ PM2.5. Anyone in the room breathes this for as long as it runs. Use the exhaust fan or range hood and open a window while it's on.`,
          },
        ]
      : []),
    {
      level: Math.min(3, r.pm.level) + 0.3,
      text: `${r.pm.band} air: ${Math.round(r.pm.ugM3)} µg/m³ PM2.5 over the day, ${r.pm.timesWho.toFixed(r.pm.timesWho < 10 ? 1 : 0)}× the WHO limit. ${r.pm.statement}`,
    },
    ...(r.co2
      ? [
          {
            level: r.co2.category - 1 + 0.2,
            text: `${r.co2.label.toLowerCase() === 'stale' ? 'Stale' : r.co2.label} air: CO₂ ~${Math.round(r.co2.ppm / 50) * 50} ppm. ${r.co2.statement}`,
          },
        ]
      : []),
    ...r.hazards
      .filter((h) => h.level < 3)
      .map((h) => ({ level: h.level + 0.1, text: `${h.title}. ${h.detail}` })),
  ];
  const top = reasons(worst).sort((a, b) => b.level - a.level)[0]!;
  const headline =
    worst.severity >= 2
      ? `${worst.name}: ${top.text}`
      : 'No serious risks: the air in every room is within or close to the guidelines.';

  return (
    <section
      className="flex flex-col gap-2 p-2.5 rounded-[8px] bg-black/20 border border-white/10"
      data-testid="alt-health"
    >
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="flex items-center gap-1 text-left"
        aria-expanded={open}
      >
        {open ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
        <span className="text-[10px] uppercase tracking-wider font-semibold text-neutral-400 flex items-center gap-1">
          <HeartPulse size={12} /> Health
        </span>
        {serious.length > 0 && (
          <span className="ml-auto text-[10px] font-semibold text-red-300">
            {serious.length} {serious.length === 1 ? 'room' : 'rooms'} at risk
          </span>
        )}
      </button>

      <div
        className="flex gap-2 p-2 rounded-[7px] border"
        style={{
          borderColor: `${TONE[worst.severity]}66`,
          background: `${TONE[worst.severity]}1a`,
        }}
        data-testid="alt-health-headline"
      >
        {worst.severity >= 2 ? (
          <AlertTriangle
            size={15}
            className="shrink-0 mt-px"
            style={{ color: TONE[worst.severity] }}
          />
        ) : (
          <ShieldCheck size={15} className="shrink-0 mt-px text-emerald-400" />
        )}
        <p className="text-[11.5px] text-neutral-100 leading-snug">{headline}</p>
      </div>

      {open && (
        <ul className="flex flex-col gap-1.5" data-testid="alt-health-rooms">
          {rows.map((r) => (
            <li
              key={r.roomId}
              className="px-2 py-1.5 rounded-[7px] bg-white/[0.03] flex flex-col gap-1"
            >
              <div className="flex items-center gap-1.5">
                <span
                  className="w-1.5 h-1.5 rounded-full shrink-0"
                  style={{ background: TONE[r.severity] }}
                />
                <span className="text-[12px] font-medium text-white truncate">{r.name}</span>
              </div>
              <div className="text-[10.5px] text-neutral-300 leading-snug">
                <span className="font-semibold" style={{ color: bandText(r.pm) }}>
                  PM2.5 {Math.round(r.pm.ugM3)} µg/m³ day avg · {r.pm.band}
                </span>
                <span className="text-neutral-500">
                  {' '}
                  ({r.pm.timesWho < 1 ? 'within' : `${r.pm.timesWho.toFixed(1)}×`} WHO)
                </span>
                {r.pm.level >= 1 && (
                  <span className="block text-neutral-400">{r.pm.statement}</span>
                )}
              </div>
              {r.whileOn && (
                <div
                  className="px-2 py-1 rounded-[6px] text-[10.5px] leading-snug border"
                  style={{
                    borderColor: `${bandText(r.whileOn)}55`,
                    background: `${bandText(r.whileOn)}14`,
                  }}
                  data-testid="alt-health-while-on"
                >
                  <span className="font-semibold" style={{ color: bandText(r.whileOn) }}>
                    While {sourcesText(r)}: ~{Math.round(r.whileOn.ugM3)} µg/m³ ·{' '}
                    {r.whileOn.band}
                  </span>
                  <span className="block text-neutral-300">
                    Anyone in the room breathes this while it runs (the 3D view shows this level).
                    Use the exhaust or hood and open a window.
                  </span>
                </div>
              )}
              {r.co2 ? (
                <div className="text-[10.5px] text-neutral-300 leading-snug">
                  <span className="font-semibold" style={{ color: r.co2.color }}>
                    CO₂ ~{Math.round(r.co2.ppm / 50) * 50} ppm · {r.co2.label}
                  </span>
                  <span className="text-neutral-500">
                    {' '}
                    ({r.people} {r.people === 1 ? 'person' : 'people'} {r.activity}, air ~
                    {Math.round(r.ageMinutes)} min old)
                  </span>
                  {r.co2.category >= 3 && (
                    <span className="block text-neutral-400">{r.co2.statement}</span>
                  )}
                </div>
              ) : (
                <div className="text-[10.5px] text-neutral-500">
                  Air ~{Math.round(r.ageMinutes)} min old (nobody usually here)
                </div>
              )}
              {r.hazards.map((h) => (
                <div
                  key={h.title}
                  className="mt-0.5 px-2 py-1 rounded-[6px] text-[10.5px] leading-snug border"
                  style={{ borderColor: `${TONE[h.level]}66`, background: `${TONE[h.level]}14` }}
                  data-testid="alt-health-hazard"
                >
                  <span
                    className="font-semibold flex items-center gap-1"
                    style={{ color: TONE[h.level] }}
                  >
                    <AlertTriangle size={11} /> {h.title}
                  </span>
                  <span className="text-neutral-300">{h.detail}</span>
                </div>
              ))}
            </li>
          ))}
        </ul>
      )}
      {daily.alwaysOn.length > 0 && (
        <p
          className="text-[10.5px] text-amber-200/90 leading-snug"
          data-testid="alt-health-always-on"
        >
          Counted as running all day: {daily.alwaysOn.join(', ')}. Select it and set how long it
          runs for a realistic daily picture.
        </p>
      )}
      <p className="text-[9.5px] text-neutral-500 leading-snug">
        Day average: PM2.5 over 24 hours with each source on its schedule, the figure the WHO and
        India limits are set for. The 3D view and room labels show PM2.5 while every source is
        running. Hazards follow WHO guidance on ventilation, damp and indoor air. PM2.5 per India's
        AQI (CPCB) and WHO 2021; CO₂ is an estimate from the people usually in each room, per EN
        16798-1. Guidance, not medical advice.
      </p>
    </section>
  );
};
