import { useMemo } from 'react';
import { fieldOfMode, useSimulationStore } from '../../store/simulationStore';
import { useSimulationModel } from '../../store/useSimulationModel';
import { AQI_SCALE_MAX, fieldDomain, isLogScale, percentile, type ColorScale, type SimField } from '../../simulation/viz/colormap';
import { horizontalSlice, speedField } from '../../simulation/viz/slice';
import type { VoxelSimResult } from '../../simulation/voxel/solver';

export interface DisplayedField {
  result: VoxelSimResult;
  /** Heatmap field of the view mode; null in Airflow (no heatmap) */
  field: SimField | null;
  values: Float32Array | null;
  scale: ColorScale | null;
  /** PM2.5 now shown (steady or the scrubbed snapshot), for smoke colours and chips */
  pm25: Float32Array;
  /** Snapshot time (s) when scrubbing, null for the steady state */
  timeS: number | null;
  stale: boolean;
  /** Speed field (m/s) and its 95th percentile, the top of the streamline speed scale */
  speed: Float32Array;
  speedRef: number;
}

/**
 * The heatmap of the current view mode with its colour scale: PM2.5 on the absolute AQI bands (or
 * YlOrRd stretched over the 2nd–98th percentile of the sampled layer with "Relative"), age of air
 * on viridis (auto contrast, log when it spans a decade).
 */
export function useDisplayedField(): DisplayedField | null {
  const { result, stale } = useSimulationModel();
  const mode = useSimulationStore((s) => s.viz.mode);
  const snapshotIndex = useSimulationStore((s) => s.viz.snapshotIndex);
  const autoContrast = useSimulationStore((s) => s.viz.autoContrast);
  const relative = useSimulationStore((s) => s.viz.relative);
  const sliceHeight = useSimulationStore((s) => s.viz.sliceHeight);
  const field = fieldOfMode(mode);

  const speed = useMemo(() => (result ? speedField(result.velocity.cell, result.grid.fluid) : null), [result]);
  const speedRef = useMemo(() => (speed ? Math.max(0.05, percentile(speed, 0.95)) : 0.5), [speed]);
  const ageDomain = useMemo(() => (result?.ageMinutes ? fieldDomain('age', result.ageMinutes, autoContrast) : null), [result, autoContrast]);
  const snap = result && snapshotIndex !== null ? (result.pm25.snapshots[snapshotIndex] ?? null) : null;
  const pm25 = snap ? snap.field : (result?.pm25.steady ?? null);
  // Relative PM2.5: robust range of the layer the heatmap shows
  const relDomain = useMemo((): [number, number] => {
    if (!result || !pm25 || !relative) return [0, AQI_SCALE_MAX];
    const layer = horizontalSlice(result.grid, pm25, sliceHeight).values;
    const lo = percentile(layer, 0.02);
    const hi = percentile(layer, 0.98);
    return Number.isFinite(lo) && Number.isFinite(hi) && hi - lo > 1e-6 ? [lo, hi] : [0, AQI_SCALE_MAX];
  }, [result, pm25, relative, sliceHeight]);

  return useMemo(() => {
    if (!result || !speed || !pm25) return null;
    const base = { result, stale, speed, speedRef, pm25, timeS: snap ? snap.tS : null };
    if (field === 'age' && result.ageMinutes && ageDomain) {
      return { ...base, field, values: result.ageMinutes, scale: { field, domain: ageDomain, log: isLogScale(field, ageDomain) }, timeS: null };
    }
    if (field === 'pm25') return { ...base, field, values: pm25, scale: { field, domain: relDomain, relative } };
    return { ...base, field: null, values: null, scale: null };
  }, [result, field, pm25, snap, speed, speedRef, ageDomain, relDomain, relative, stale]);
}
