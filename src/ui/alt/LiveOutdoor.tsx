import React from 'react';
import { apiBaseUrl } from '../../config';
import type { RoomParams } from '../../core/schema';
import { fetchLiveConditions, liveCaption } from '../../services/liveConditions';
import { useSceneStore } from '../../store/sceneStore';
import type { SimulationState } from '../../store/simulationStore';

/**
 * "Live" outdoor-air chip (after the presets) and its caption. Both render nothing without a
 * backend (VITE_API_BASE_URL unset).
 */
export const LiveOutdoorChip: React.FC<{ selected: boolean; loading: boolean; apply: (p: Partial<RoomParams>) => void }> = ({ selected, loading, apply }) => {
  if (!apiBaseUrl) return null;
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      aria-busy={loading}
      disabled={loading}
      onClick={() => void fetchLiveConditions(useSceneStore.getState().room.params, apply)}
      title="Current outdoor PM2.5 and weather for your location"
      data-testid="alt-outdoor-live"
      className={`px-2 py-0.5 rounded-full text-[10.5px] border ${
        selected ? 'bg-indigo-600 border-indigo-400 text-white' : 'bg-white/5 border-white/10 text-neutral-300 hover:bg-white/10'
      }`}
    >
      Live
    </button>
  );
};

export const LiveOutdoorCaption: React.FC<{ lookup: SimulationState['outdoorLookup']; liveSelected: boolean }> = ({ lookup, liveSelected }) => {
  const text = apiBaseUrl ? liveCaption(lookup, liveSelected) : null;
  if (!text) return null;
  return (
    <p className="text-[10px] text-neutral-500" data-testid="alt-outdoor-live-caption" aria-live="polite">
      {text}
    </p>
  );
};
