import { useMemo } from 'react';
import { useSceneStore } from '../../store/sceneStore';
import { useSimulationStore } from '../../store/simulationStore';
import { pickStaleZones, sliceCellRooms, type StaleZone } from '../../simulation/viz/stagnation';

const NONE: StaleZone[] = [];

/** The stalest zones to highlight in the Ventilation view (outlines in the scene, labels as chips). */
export function useStaleZones(): StaleZone[] {
  const result = useSimulationStore((s) => s.result);
  const on = useSimulationStore((s) => s.viz.show && s.viz.mode === 'ventilation' && s.viz.stagnant);
  const sliceHeight = useSimulationStore((s) => s.viz.sliceHeight);
  const room = useSceneStore((s) => s.room);
  const otherRooms = useSceneStore((s) => s.otherRooms);
  const cellRoom = useMemo(() => (on && result ? sliceCellRooms(result.grid, [room, ...otherRooms].map((r) => r.outline)) : null), [on, result, room, otherRooms]);
  return useMemo(
    () => (on && cellRoom && result?.ageNormalised && result.ageMinutes ? pickStaleZones(result.grid, result.ageNormalised, result.ageMinutes, sliceHeight, { cellRoom }) : NONE),
    [on, result, sliceHeight, cellRoom]
  );
}
