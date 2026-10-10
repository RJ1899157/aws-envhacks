import { useMemo } from 'react';
import { useSceneStore } from './sceneStore';
import { useSimulationStore } from './simulationStore';
import { devicesIn } from '../simulation/devices';
import { simulateHouseNetwork } from '../simulation/house/network';
import { isResultStale, simulationInputKey } from '../simulation/viz/staleness';

/**
 * Live whole-house network result (recomputed on every relevant change; it takes milliseconds) and
 * the latest voxel result with its staleness. Rooms are [active room, ...other rooms]; the active
 * room's params set wind, temperatures and outdoor PM2.5 for the house.
 */
export function useSimulationModel() {
  const room = useSceneStore((s) => s.room);
  const otherRooms = useSceneStore((s) => s.otherRooms);
  const settings = useSimulationStore((s) => s.settings);
  const result = useSimulationStore((s) => s.result);
  const resultKey = useSimulationStore((s) => s.resultKey);

  const rooms = useMemo(() => [room, ...otherRooms], [room, otherRooms]);
  const network = useMemo(() => simulateHouseNetwork(rooms, {}, { durationS: settings.durationS }), [rooms, settings.durationS]);
  const devices = useMemo(() => devicesIn(room.objects), [room.objects]);
  const currentKey = useMemo(() => simulationInputKey(room, otherRooms, settings), [room, otherRooms, settings]);
  const stale = result !== null && isResultStale(resultKey, currentKey);
  /** The active room's zone (always index 0 in the live network) */
  const zone = network.zones[0]!;
  /** The active room's zone in the voxel result, found by room id (the run may have had another primary) */
  const voxelZone = result ? (result.zones.find((z) => z.roomId === zone.roomId) ?? null) : null;

  return { room, otherRooms, rooms, settings, network, zone, devices, currentKey, result, voxelZone, stale };
}
