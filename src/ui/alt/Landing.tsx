import React, { useEffect, useState } from 'react';
import { ArrowRight, Hand, Loader2, PencilRuler, Wind, Wrench } from 'lucide-react';
import { apiBaseUrl } from '../../config';
import type { GeoLocation } from '../../core/schema';
import { LANDING_SETTINGS, landingHouse, loadLandingResult } from '../../showcase/landing';
import { simulationInputKey } from '../../simulation/viz/staleness';
import { getVoxelQueue, useSimulationStore } from '../../store/simulationStore';
import { WHO_2021_PM25_24H } from '../../simulation/constants';
import { pm25Health } from '../../simulation/health';
import type { SimViewMode } from '../../store/simulationStore';
import { getConditions } from '../../services/api';
import { browserLocation, DELHI } from '../../services/liveConditions';
import { useCameraStore } from '../../store/cameraStore';
import { resetToNewUser } from '../../store/resetSession';
import { useSceneStore } from '../../store/sceneStore';
import { useAltStore } from './altStore';
import { runSimulation } from './ResultsPanel';

/**
 * Landing intro, before the start choices: the example flat simulated behind a short pitch, with tabs
 * for which corners stay stale, how air flows in and where smoke goes, while the camera turns a
 * slow 360° (drag to look around; it resumes after 10 s untouched). Left: what the site is for, today's outdoor PM2.5 as the hook, the three
 * steps, and "Check my home".
 */

const SCENES: { mode: SimViewMode; label: string; caption: string }[] = [
  { mode: 'ventilation', label: 'Ventilation', caption: 'Some corners barely get fresh air: yellow marks air that has been sitting there the longest.' },
  { mode: 'airflow', label: 'Airflow', caption: 'Fresh air comes in through the windows and flows from room to room.' },
  { mode: 'pollution', label: 'Smoke', caption: 'Frying in the kitchen: watch the smoke drift into the other rooms.' },
];
/** Camera idle time before the 360° turn resumes after the user moved it */
const RESUME_AFTER_MS = 10_000;


/** Live outdoor PM2.5 (backend), else a fixed, sourced fact. Never prompts for location. */
const AirFact: React.FC = () => {
  const [live, setLive] = useState<{ value: number; place: string } | null>(null);
  useEffect(() => {
    if (!apiBaseUrl) return;
    let cancelled = false;
    void (async () => {
      // The browser's position only if already allowed: no permission prompt on the landing page
      let here: GeoLocation | null = null;
      try {
        const perm = await navigator.permissions?.query({ name: 'geolocation' as PermissionName });
        if (perm?.state === 'granted') here = await browserLocation();
      } catch {
        here = null;
      }
      const at = here ?? DELHI;
      try {
        const res = await getConditions(at.lat, at.lon);
        if (!cancelled) setLive({ value: res.current.pm2_5, place: here ? 'your area' : 'Delhi' });
      } catch {
        // Keep the fixed fact
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (live) {
    const h = pm25Health(live.value);
    const times = live.value / WHO_2021_PM25_24H;
    return (
      <p className="text-[13px] text-neutral-300 leading-snug" data-testid="landing-air-fact">
        Outdoor air in {live.place} right now:{' '}
        <span className="font-semibold" style={{ color: h.level >= 4 ? '#fb7185' : h.color }}>
          {Math.round(live.value)} µg/m³ PM2.5
        </span>
        {times >= 1.5 ? `, ${times.toFixed(times < 10 ? 1 : 0)}× the WHO daily limit.` : ', within the WHO daily limit.'}
      </p>
    );
  }
  return (
    <p className="text-[13px] text-neutral-300 leading-snug" data-testid="landing-air-fact">
      In winter, Delhi's outdoor PM2.5 often goes above <span className="font-semibold text-rose-300">250 µg/m³</span>, over 15× the WHO daily limit.
    </p>
  );
};

const STEPS = [
  { icon: PencilRuler, title: 'Sketch your home', text: 'Rooms, windows, fans, the stove' },
  { icon: Wind, title: 'Watch the air move', text: 'A real airflow simulation' },
  { icon: Wrench, title: 'Get fixes that work', text: 'Ranked by how much they help' },
];

export const Landing: React.FC = () => {
  const [scene, setScene] = useState(0);
  const running = useSimulationStore((s) => s.status === 'running');
  const hasResult = useSimulationStore((s) => s.result !== null);

  // The example flat with its precomputed result (solved in the browser only if the file is out of
  // date), the camera slowly turning once it is framed
  useEffect(() => {
    let cancelled = false;
    const rooms = landingHouse();
    useSceneStore.getState().loadRoom(rooms[0]!, rooms.slice(1));
    useSceneStore.temporal.getState().clear();
    const sim = useSimulationStore.getState();
    sim.setSettings(LANDING_SETTINGS);
    sim.setViz({ show: true, mode: SCENES[0]!.mode, snapshotIndex: null, playing: false });
    void loadLandingResult(rooms, import.meta.env.BASE_URL).then((result) => {
      if (cancelled) return;
      if (!result) return runSimulation();
      // Cached under the design's key, so "Explore this example flat" is instant too
      const key = simulationInputKey(rooms[0]!, rooms.slice(1), LANDING_SETTINGS);
      getVoxelQueue().put(key, result);
      useSimulationStore.setState({ result, resultKey: key, status: 'done', progress: null, error: null });
    });
    return () => {
      cancelled = true;
      useCameraStore.getState().setTurntableActive(false);
    };
  }, []);
  // A slow 360° turn around the flat while nobody touches the camera. Any input stops it (the
  // turntable's own rule); a drag, scroll or key on the view restarts it after 10 s without camera
  // input, a click on the page around it (tabs, links) right away.
  useEffect(() => {
    if (!hasResult) return;
    const turn = useCameraStore.getState().setTurntableActive;
    let timer = 0;
    let resumeAt = 0;
    const resumeIn = (ms: number) => {
      const at = performance.now() + ms;
      // A pending camera pause wins over an earlier resume
      if (timer && at < resumeAt) return;
      window.clearTimeout(timer);
      resumeAt = at;
      timer = window.setTimeout(() => {
        timer = 0;
        turn(true);
      }, ms);
    };
    const onCamera = () => resumeIn(RESUME_AFTER_MS);
    const onPointer = (e: PointerEvent) => (e.target instanceof HTMLCanvasElement ? onCamera() : resumeIn(50));
    // Drags keep the pause going until the camera has been still for the whole wait
    const onMove = (e: PointerEvent) => {
      if (e.buttons !== 0 && e.target instanceof HTMLCanvasElement) onCamera();
    };
    const onWheel = (e: WheelEvent) => (e.target instanceof HTMLCanvasElement ? onCamera() : undefined);
    window.addEventListener('pointerdown', onPointer, true);
    window.addEventListener('pointermove', onMove, true);
    window.addEventListener('wheel', onWheel, { capture: true, passive: true });
    window.addEventListener('keydown', onCamera, true);
    // First turn once SimulationFraming has fitted the house (120 ms + a 650 ms move)
    resumeIn(1000);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener('pointerdown', onPointer, true);
      window.removeEventListener('pointermove', onMove, true);
      window.removeEventListener('wheel', onWheel, true);
      window.removeEventListener('keydown', onCamera, true);
      turn(false);
    };
  }, [hasResult]);

  useEffect(() => {
    useSimulationStore.getState().setViz({ mode: SCENES[scene]!.mode });
  }, [scene]);

  const checkMyHome = () => {
    resetToNewUser();
    useAltStore.getState().setIntro(false);
  };

  return (
    <>
      {/* Darkens the left for the text; the house stays visible and draggable on the right */}
      <div className="pointer-events-none fixed inset-x-0 top-12 bottom-0 z-[20] bg-neutral-950/85 md:bg-transparent md:bg-gradient-to-r md:from-neutral-950/95 md:via-neutral-950/30 md:to-transparent" />
      <section
        data-testid="landing"
        data-viewport-left
        className="fixed z-[21] left-4 right-4 md:right-auto top-16 bottom-4 md:w-[440px] flex flex-col justify-center gap-5 overflow-y-auto text-neutral-200 pointer-events-auto"
      >
        <div className="flex flex-col gap-3">
          <span className="self-start px-2 py-0.5 rounded-full bg-indigo-500/15 border border-indigo-400/30 text-[11px] text-indigo-200">Indoor air simulator</span>
          <h1 className="text-[30px] md:text-[34px] leading-[1.1] font-semibold text-white">
            Visualise the way pollution spreads through your house.
          </h1>
          <p className="text-[14px] text-neutral-300 leading-snug">
            Smoke from cooking, incense and mosquito coils doesn't stay where it starts. It drifts through doorways into bedrooms and living rooms, and where little fresh air comes in, it lingers for hours. You can't see it, so you never know which room is the worst.
          </p>
          <AirFact />
        </div>

        <ol className="grid grid-cols-3 gap-2" data-testid="landing-steps">
          {STEPS.map((s, i) => (
            <li key={s.title} className="p-2.5 rounded-[10px] bg-white/[0.04] border border-white/10 flex flex-col gap-1">
              <span className="flex items-center gap-1.5 text-indigo-300">
                <s.icon size={15} />
                <span className="text-[10px] text-neutral-500">{i + 1}</span>
              </span>
              <span className="text-[12px] font-semibold text-white leading-tight">{s.title}</span>
              <span className="text-[10.5px] text-neutral-400 leading-snug">{s.text}</span>
            </li>
          ))}
        </ol>

        <div className="flex flex-col gap-2">
          <button
            type="button"
            onClick={checkMyHome}
            data-testid="landing-start"
            className="w-full py-3 rounded-[12px] bg-indigo-600 hover:bg-indigo-500 text-white text-[15px] font-semibold flex items-center justify-center gap-2 shadow-lg shadow-indigo-900/40"
          >
            Check my home <ArrowRight size={17} />
          </button>
        </div>
      </section>

      {/* What the animation shows: scene pills and a one-line caption, under the house */}
      <div className="pointer-events-none fixed z-[21] bottom-5 left-4 right-4 md:left-[480px] flex flex-col items-center gap-2" data-testid="landing-scenes">
        <div role="radiogroup" aria-label="What to show" className="pointer-events-auto flex p-0.5 rounded-full bg-neutral-900/90 border border-white/15 shadow-xl backdrop-blur-md">
          {SCENES.map((s, i) => (
            <button
              key={s.mode}
              type="button"
              role="radio"
              aria-checked={scene === i}
              onClick={() => setScene(i)}
              className={`px-3 py-1 rounded-full text-[12px] font-medium transition-colors ${scene === i ? 'bg-indigo-600 text-white' : 'text-neutral-300 hover:bg-white/10'}`}
            >
              {s.label}
            </button>
          ))}
        </div>
        <p className="px-3 py-1.5 rounded-[10px] bg-neutral-950/80 text-[13px] text-neutral-100 text-center max-w-[520px] backdrop-blur-sm" aria-live="polite" data-testid="landing-caption">
          {running && !hasResult ? (
            <span className="flex items-center gap-1.5">
              <Loader2 size={13} className="animate-spin" /> Simulating the air in this flat…
            </span>
          ) : (
            SCENES[scene]!.caption
          )}
        </p>
        <span className="hidden md:flex items-center gap-1 px-2 py-0.5 rounded-full bg-neutral-950/70 text-[11px] text-neutral-400">
          <Hand size={12} /> Drag to look around · scroll to zoom
        </span>
      </div>
    </>
  );
};
