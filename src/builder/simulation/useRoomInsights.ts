import { useMemo } from 'react';
import type { Vec2 } from '../../core/schema';
import { useSimulationStore, type SimViewMode } from '../../store/simulationStore';
import { useSimulationModel } from '../../store/useSimulationModel';
import { achCss, scaleCss } from '../../simulation/viz/colormap';
import { roomCause } from '../../simulation/viz/explain';
import { formatMetric, houseSummary, metricOf, rankRooms, type FormattedMetric, type RoomMetrics } from '../../simulation/viz/insights';
import { poleOfInaccessibility, shortRoomName } from '../../simulation/viz/layout';
import { useDisplayedField } from './useDisplayedField';

export interface RoomInsight extends RoomMetrics {
  shortName: string;
  /** Index in the live network (the active room is 0) */
  zoneIndex: number;
  /** The current mode's metric, formatted with unit and band word */
  value: number;
  formatted: FormattedMetric;
  /** CSS colour of `value` on exactly the floor's colour scale */
  color: string;
  /** Dominant cause in plain words */
  cause: string;
  /** Pole of inaccessibility of the floor outline (world XZ) and its distance to the nearest wall (m) */
  anchor: [number, number];
  clearance: number;
  outline: readonly Vec2[];
}

export interface RoomInsights {
  mode: SimViewMode;
  rows: RoomInsight[];
  /** Worst → best for the mode */
  ranked: RoomInsight[];
  summary: string;
  /** Inputs changed since the voxel run (values fall back to the network model) */
  stale: boolean;
}

/**
 * Per-room results in the current view mode, shared by the room chips, the Insights panel and the
 * Airflow floor tint so their numbers and colours always agree: PM2.5 (voxel room mean when the
 * result is current, the scrubbed snapshot when playing back, else the network), mean age of air
 * and outdoor-air changes per hour.
 */
export function useRoomInsights(): RoomInsights | null {
  const { network, result, stale, rooms } = useSimulationModel();
  const displayed = useDisplayedField();
  const mode = useSimulationStore((s) => s.viz.mode);
  const snapshotIndex = useSimulationStore((s) => s.viz.snapshotIndex);
  const scale = displayed?.scale ?? null;

  const anchors = useMemo(() => {
    const m = new Map<string, { point: [number, number]; distance: number }>();
    for (const r of rooms) if (r.id) m.set(r.id, poleOfInaccessibility(r.outline));
    return m;
  }, [rooms]);

  return useMemo(() => {
    if (!result) return null;
    const fresh = !stale ? result : null;
    const pmOverride = fresh && snapshotIndex !== null ? (fresh.pm25.snapshots[snapshotIndex]?.zoneMeans ?? null) : null;
    const rows: RoomInsight[] = network.zones.map((z, i) => {
      const room = network.house.zones[i]!.room;
      const vi = fresh ? fresh.zones.findIndex((r) => r.roomId === z.roomId) : -1;
      const vz = vi >= 0 ? fresh!.zones[vi]! : null;
      const pm25 = vz ? (pmOverride?.[vi] ?? vz.voxelPm25Steady) : z.cssUgM3;
      const ageMinutes = vz?.voxelAgeMinutes ?? z.ageMinutes;
      const metrics: RoomMetrics = { roomId: z.roomId, name: z.name, pm25, ageMinutes, ach: z.achOutdoor };
      const value = metricOf(mode, metrics);
      const color = mode === 'airflow' || !scale ? achCss(z.achOutdoor) : scaleCss(scale, value);
      const a = anchors.get(z.roomId) ?? poleOfInaccessibility(room.outline);
      return {
        ...metrics,
        shortName: shortRoomName(z.name),
        zoneIndex: i,
        value,
        formatted: formatMetric(mode, value),
        color,
        cause: roomCause(network, i, mode, { ageMinutes }),
        anchor: a.point,
        clearance: a.distance,
        outline: room.outline,
      };
    });
    return { mode, rows, ranked: rankRooms(mode, rows), summary: houseSummary(mode, rows), stale };
  }, [network, result, stale, snapshotIndex, mode, scale, anchors]);
}
