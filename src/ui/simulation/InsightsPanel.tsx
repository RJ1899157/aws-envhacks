import React, { useEffect, useRef, useState } from 'react';
import { AlertTriangle, ChevronDown, ChevronRight } from 'lucide-react';
import { useSimulationStore } from '../../store/simulationStore';
import { useRoomInsights } from '../../builder/simulation/useRoomInsights';
import { focusSimulationRoom } from '../../builder/simulation/simulationCamera';
import { useSceneStore } from '../../store/sceneStore';
import { SuggestedActions } from './SuggestedActions';
import { ComparePanel } from './ComparePanel';
import { useScenarioStore } from '../../store/scenarioStore';

const METRIC_NAME = { pollution: 'PM2.5', ventilation: 'Air age', airflow: 'Air changes' } as const;

/** Black or white text for a CSS colour ("rgb(r g b)" or "#rrggbb") used as a background. */
function textOn(color: string): string {
  const m = color.match(/\d+(\.\d+)?/g);
  const rgb = color.startsWith('#') ? [1, 3, 5].map((i) => parseInt(color.slice(i, i + 2), 16)) : (m ?? ['0', '0', '0']).slice(0, 3).map(Number);
  const [r, g, b] = rgb.map((c) => {
    const s = c! / 255;
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b! > 0.22 ? '#0a0a0a' : '#ffffff';
}

/**
 * Insights: a one-line conclusion for the house, then every room ranked worst → best in the
 * current view's metric with the dominant cause in plain words. Clicking a room selects and frames
 * it. Below: the ranked suggested actions.
 */
export const InsightsPanel: React.FC<{ variant: 'docked' | 'floating' }> = ({ variant }) => {
  const insights = useRoomInsights();
  const stale = insights?.stale === true;
  const collapsed = useSimulationStore((s) => s.insightsCollapsed);
  const setUi = useSimulationStore((s) => s.setUi);
  const activeRoomId = useSceneStore((s) => s.room.id);
  const ref = useRef<HTMLElement>(null);
  if (!insights) return null;
  const floating = variant === 'floating';

  return (
    <section
      ref={ref}
      data-testid={floating ? 'sim-insights-floating' : 'sim-insights'}
      aria-label="Simulation insights"
      className={`flex flex-col gap-1.5 text-[11px] text-neutral-200 ${
        floating ? 'w-[264px] max-h-full px-2.5 py-2 rounded-[10px] bg-neutral-900/95 border border-white/10 shadow-xl backdrop-blur-md' : 'p-2.5 rounded-[8px] bg-black/20 border border-white/10'
      }`}
    >
      <button type="button" onClick={() => setUi({ insightsCollapsed: !collapsed })} className="flex items-center gap-1 text-left" aria-expanded={!collapsed} data-testid="sim-insights-toggle">
        {collapsed ? <ChevronRight size={13} /> : <ChevronDown size={13} />}
        <span className="text-[10px] uppercase tracking-wider font-semibold text-neutral-400">Insights</span>
        <span className="ml-auto text-[9.5px] text-neutral-500">{METRIC_NAME[insights.mode]} · worst first</span>
      </button>
      <p className="text-[11.5px] font-semibold text-white leading-snug" data-testid="sim-insights-summary">
        {insights.summary}
      </p>
      {stale && (
        <span className="flex items-center gap-1 text-[10px] text-amber-300">
          <AlertTriangle size={11} /> Inputs changed since the run — re-run to update
        </span>
      )}
      {!collapsed && (
        <>
          <ol className={`flex flex-col gap-0.5 ${floating ? 'overflow-y-auto min-h-0' : ''}`} data-testid="sim-insights-rooms">
            {insights.ranked.map((r) => (
              <li key={r.roomId}>
                <button
                  type="button"
                  data-testid="sim-insights-row"
                  data-room={r.name}
                  onClick={() => focusSimulationRoom(r.roomId)}
                  className={`w-full text-left px-1.5 py-1 rounded-[6px] hover:bg-white/10 flex flex-col gap-0.5 ${r.roomId === activeRoomId ? 'bg-white/5' : ''}`}
                >
                  <span className="flex items-center gap-1.5">
                    <span className="truncate font-medium text-neutral-100">{r.shortName}</span>
                    <span className="ml-auto shrink-0 px-1.5 rounded-full text-[10px] font-semibold tabular-nums" style={{ background: r.color, color: textOn(r.color) }} title={r.formatted.text}>
                      {r.formatted.value}
                    </span>
                    <span className="shrink-0 w-[58px] text-[9.5px] text-neutral-400 truncate">{r.formatted.word}</span>
                  </span>
                  <span className="text-[10px] text-neutral-400 leading-snug">{r.cause}</span>
                </button>
              </li>
            ))}
          </ol>
          <SuggestedActions />
        </>
      )}
    </section>
  );
};

/** Right offset that keeps the floating panel clear of the Inspector when it is open. */
function useInspectorClearance(active: boolean): { right: number; maxHeight: number } {
  const [state, setState] = useState({ right: 12, maxHeight: 600 });
  // setState bails out when nothing changed, so polling does not re-render
  useEffect(() => {
    if (!active) return;
    const update = () => {
      const insp = document.querySelector('[data-testid="inspector-panel"]');
      const r = insp?.getBoundingClientRect();
      const shown = r && r.width > 0 && r.left < window.innerWidth - 8;
      const right = shown ? Math.round(window.innerWidth - r.left + 12) : 12;
      const maxHeight = window.innerHeight - 96 - 72;
      setState((s) => (s.right === right && s.maxHeight === maxHeight ? s : { right, maxHeight }));
    };
    update();
    // The Inspector opens and closes without a resize; a cheap poll keeps up with it
    window.addEventListener('resize', update);
    const id = window.setInterval(update, 500);
    return () => {
      window.clearInterval(id);
      window.removeEventListener('resize', update);
    };
  }, [active]);
  return state;
}

/** The Insights panel floating on the right of the canvas, whenever the Simulation tab isn't showing it. */
export const FloatingInsights: React.FC = () => {
  const docked = useSimulationStore((s) => s.insightsDocked);
  const show = useSimulationStore((s) => s.viz.show && s.result !== null);
  const comparing = useScenarioStore((s) => s.compare !== null);
  const active = (show || comparing) && !docked;
  const { right, maxHeight } = useInspectorClearance(active);
  if (!active) return null;
  return (
    <div className="pointer-events-auto absolute top-[96px] z-[12] flex" style={{ right, maxHeight }}>
      {comparing ? <ComparePanel variant="floating" /> : <InsightsPanel variant="floating" />}
    </div>
  );
};
