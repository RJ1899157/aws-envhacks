import React from 'react';
import { RotateCcw } from 'lucide-react';
import type { Room } from '../../core/schema';
import { OCCUPANCY_WEIGHTS } from '../../simulation/constants';
import { occupancyWeight } from '../../simulation/scenarios/metrics';
import { useSceneStore } from '../../store/sceneStore';
import { ScrubbableInput } from '../components';

/**
 * Room tab: how much this room counts in the house PM2.5 metric (occupancy weight). Empty means the
 * default for the room type (OCCUPANCY_WEIGHTS in simulation/constants.ts).
 */
export const OccupancyWeightField: React.FC<{ room: Room }> = ({ room }) => {
  const setWeight = useSceneStore((s) => s.setOccupancyWeight);
  const custom = room.occupancyWeight !== undefined;
  const fallback = OCCUPANCY_WEIGHTS[room.type ?? 'basic'];
  if (!room.id) return null;
  return (
    <div className="flex flex-col gap-1" data-testid="occupancy-weight">
      <div className="flex items-end gap-1">
        <ScrubbableInput className="flex-1" label="Occupancy weight" value={occupancyWeight(room)} min={0} max={1} step={0.05} precision={2} onChange={(v) => setWeight(room.id!, Math.min(1, Math.max(0, v)))} />
        {custom && (
          <button type="button" aria-label="Use the default weight" title={`Default for this room type: ${fallback}`} onClick={() => setWeight(room.id!, undefined)} className="p-1 mb-0.5 rounded hover:bg-white/10 text-neutral-400">
            <RotateCcw size={12} />
          </button>
        )}
      </div>
      <span className="text-[10px] text-neutral-500 leading-snug">
        How much this room counts in the house PM2.5 score (share of time people spend here). {custom ? 'Custom.' : `Default for ${room.type ?? 'basic'} rooms.`}
      </span>
    </div>
  );
};
