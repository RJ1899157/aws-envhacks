import type { Room } from '../../core/schema';
import { simulateHouseNetwork, type NetworkResult } from '../house/network';
import { networkMetrics, type HouseMetrics } from './metrics';

export interface Evaluation {
  rooms: Room[];
  /** Per-room PM2.5 time series, air changes and inter-room flows */
  network: NetworkResult;
  metrics: HouseMetrics;
}

/** Instant network-model evaluation of a design (milliseconds). */
export function evaluateDesign(rooms: readonly Room[], durationS: number): Evaluation {
  const network = simulateHouseNetwork(rooms, {}, { durationS });
  return { rooms: [...rooms], network, metrics: networkMetrics(network) };
}
