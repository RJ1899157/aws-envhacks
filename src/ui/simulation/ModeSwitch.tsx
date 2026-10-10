import React from 'react';
import { Factory, Hourglass, Wind } from 'lucide-react';
import { useSimulationStore, type SimViewMode } from '../../store/simulationStore';

const MODES: { id: SimViewMode; label: string; icon: React.ElementType; hint: string }[] = [
  { id: 'pollution', label: 'Pollution', icon: Factory, hint: 'PM2.5 at breathing height and smoke from sources' },
  { id: 'ventilation', label: 'Ventilation', icon: Hourglass, hint: 'Age of air and stagnant zones' },
  { id: 'airflow', label: 'Airflow', icon: Wind, hint: 'Streamlines and flow through openings' },
];

/** Pollution · Ventilation · Airflow segmented control (one story at a time). */
export const ModeSwitch: React.FC<{ compact?: boolean; testId?: string }> = ({ compact = false, testId = 'sim-mode-switch' }) => {
  const mode = useSimulationStore((s) => s.viz.mode);
  const setViz = useSimulationStore((s) => s.setViz);
  return (
    <div role="radiogroup" aria-label="Simulation view" data-testid={testId} className="flex p-0.5 rounded-[7px] bg-black/30 border border-white/10">
      {MODES.map(({ id, label, icon: Icon, hint }) => (
        <button
          key={id}
          type="button"
          role="radio"
          aria-checked={mode === id}
          title={hint}
          data-mode={id}
          onClick={() => setViz({ mode: id, playing: false })}
          className={`flex-1 flex items-center justify-center gap-1 rounded-[5px] font-medium transition-colors ${compact ? 'px-1.5 py-0.5 text-[10px]' : 'px-2 py-1 text-[11px]'} ${
            mode === id ? 'bg-indigo-600 text-white shadow' : 'text-neutral-300 hover:text-white hover:bg-white/10'
          }`}
        >
          <Icon size={compact ? 11 : 12} />
          {label}
        </button>
      ))}
    </div>
  );
};

/** Asks the canvas to frame the whole house from above at an angle (handled in Canvas.tsx). */
export function requestSimulationView(): void {
  window.dispatchEvent(new CustomEvent('airforce:simulation-view'));
}
