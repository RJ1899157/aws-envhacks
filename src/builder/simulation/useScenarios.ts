import { useEffect, useMemo, useRef, useSyncExternalStore } from 'react';
import type { Room, Scenario } from '../../core/schema';
import { useSceneStore } from '../../store/sceneStore';
import { houseScenarios, useScenarioStore, type ScenarioRef } from '../../store/scenarioStore';
import { getVoxelQueue, useSimulationStore } from '../../store/simulationStore';
import { applyScenario, describeAction } from '../../simulation/scenarios/actions';
import { evaluateDesign, type Evaluation } from '../../simulation/scenarios/evaluate';
import {
  objectiveValue,
  voxelMetrics,
  type HouseMetrics,
} from '../../simulation/scenarios/metrics';
import { rankActions, type Ranking } from '../../simulation/scenarios/rank';
import type { VoxelQueueState } from '../../simulation/scenarios/voxelQueue';
import { simulationInputKey } from '../../simulation/viz/staleness';
import type { VoxelSimResult } from '../../simulation/voxel/solver';

/** The current design: active room first. */
export function useDesign(): Room[] {
  const room = useSceneStore((s) => s.room);
  const otherRooms = useSceneStore((s) => s.otherRooms);
  return useMemo(() => [room, ...otherRooms], [room, otherRooms]);
}

/** Live state of the voxel job queue (re-renders on every queue / cache change). */
export function useVoxelQueueState(): VoxelQueueState {
  const q = getVoxelQueue();
  return useSyncExternalStore(
    (fn) => q.subscribe(fn),
    () => q.state()
  );
}

export interface ResolvedSide {
  ref: ScenarioRef;
  name: string;
  scenario: Pick<Scenario, 'actions'>;
  texts: string[];
  design: Room[];
  key: string;
}

/** A compare side as a design: the baseline, a saved scenario, or the previewed ranked action. */
export function resolveSide(
  ref: ScenarioRef,
  rooms: Room[],
  preview: Scenario | null,
  settings: { durationS: number; resolution: 'live' | 'full' }
): ResolvedSide | null {
  let scenario: Pick<Scenario, 'actions'> & { name: string };
  if (ref.kind === 'baseline') scenario = { name: 'Baseline (your design)', actions: [] };
  else if (ref.kind === 'preview') {
    if (!preview) return null;
    scenario = preview;
  } else {
    const s = houseScenarios(rooms).find((x) => x.id === ref.id);
    if (!s) return null;
    scenario = s;
  }
  const design = applyScenario(rooms, scenario);
  return {
    ref,
    name: scenario.name,
    scenario,
    texts: scenario.actions.map((a) => describeAction(a, rooms)),
    design,
    key: simulationInputKey(design[0]!, design.slice(1), settings),
  };
}

export interface EvaluatedSide extends ResolvedSide {
  evaluation: Evaluation;
  voxel: VoxelSimResult | null;
  /** Voxel metrics when a voxel result exists, else the network's */
  metrics: HouseMetrics;
  network: HouseMetrics;
}

/**
 * Network evaluations by design key, shared by every compare consumer (panel, heatmap, legend,
 * chips, overlay, hover) so each design is simulated once, not once per component and render.
 */
const evaluationCache = new Map<string, Evaluation>();
const EVALUATION_CACHE_SIZE = 8;
function cachedEvaluation(key: string, design: readonly Room[], durationS: number): Evaluation {
  const hit = evaluationCache.get(key);
  if (hit) return hit;
  const evaluation = evaluateDesign(design, durationS);
  evaluationCache.set(key, evaluation);
  if (evaluationCache.size > EVALUATION_CACHE_SIZE)
    evaluationCache.delete(evaluationCache.keys().next().value!);
  return evaluation;
}

/** Network evaluation (instant) plus the cached voxel result, if any, of each compare side. */
export function useCompareSides(): { a: EvaluatedSide; b: EvaluatedSide } | null {
  // Only the sides matter here: the swipe position and view change on every drag frame
  const refA = useScenarioStore((s) => s.compare?.a ?? null);
  const refB = useScenarioStore((s) => s.compare?.b ?? null);
  const preview = useScenarioStore((s) => s.preview);
  const settings = useSimulationStore((s) => s.settings);
  const rooms = useDesign();
  useVoxelQueueState(); // re-render when a voxel run lands in the cache
  const sides = useMemo(() => {
    if (!refA || !refB) return null;
    const a = resolveSide(refA, rooms, preview, settings);
    const b = resolveSide(refB, rooms, preview, settings);
    if (!a || !b) return null;
    return [a, b].map((s) => {
      const evaluation = cachedEvaluation(s.key, s.design, settings.durationS);
      return { ...s, evaluation, network: evaluation.metrics };
    });
  }, [refA, refB, rooms, preview, settings]);
  const q = getVoxelQueue();
  const voxA = sides ? (q.get(sides[0]!.key) ?? null) : null;
  const voxB = sides ? (q.get(sides[1]!.key) ?? null) : null;
  return useMemo(() => {
    if (!sides) return null;
    const [a, b] = sides.map((s, i) => {
      const voxel = i === 0 ? voxA : voxB;
      return {
        ...s,
        voxel,
        metrics: voxel ? voxelMetrics(voxel, s.design, s.evaluation.network) : s.network,
      };
    }) as [EvaluatedSide, EvaluatedSide];
    // Compare like with like: voxel numbers only when both sides have them
    if (!a.voxel || !b.voxel) {
      a.metrics = a.network;
      b.metrics = b.network;
    }
    return { a, b };
  }, [sides, voxA, voxB]);
}

/** Queues voxel runs for compare sides that don't have one (high priority: the user asked). */
export function runVoxelFor(sides: readonly ResolvedSide[]): void {
  const { settings } = useSimulationStore.getState();
  for (const s of sides) {
    void getVoxelQueue()
      .enqueue({
        key: s.key,
        label: s.name,
        priority: 'high',
        input: { rooms: s.design, resolution: settings.resolution, durationS: settings.durationS },
      })
      .catch(() => {});
  }
}

const RANK_DEBOUNCE_MS = 250;
/** Ranked actions checked with the voxel solver. */
const VERIFY_TOP = 3;

/**
 * Keeps the ranked actions current (network model, debounced after design changes) and, once the
 * baseline has a current voxel result, voxel-verifies the top results in the background.
 * Mount once while the simulation layer is on.
 */
/** The design that gets ranked and the key the ranking should have (compare with `rankingKey`). */
export function useRankingKey(): { design: Room[]; key: string } {
  const rooms = useDesign();
  const objective = useScenarioStore((s) => s.objective);
  const whatIf = useScenarioStore((s) => s.whatIf);
  const settings = useSimulationStore((s) => s.settings);
  // In what-if mode rank the baseline (the scratch copy isn't the design)
  const design = whatIf ? whatIf.baseline : rooms;
  const key = useMemo(
    () =>
      `${simulationInputKey(design[0]!, design.slice(1), settings)}|${JSON.stringify(objective)}`,
    [design, settings, objective]
  );
  return { design, key };
}

export function useScenarioEngine(active: boolean): void {
  const { design, key } = useRankingKey();
  const objective = useScenarioStore((s) => s.objective);
  const settings = useSimulationStore((s) => s.settings);
  const resultKey = useSimulationStore((s) => s.resultKey);
  const verifyStart = useRef(0);

  useEffect(() => {
    if (!active || useScenarioStore.getState().rankingKey === key) return;
    const id = window.setTimeout(() => {
      const ranking = rankActions(design, { objective, durationS: settings.durationS });
      useScenarioStore.getState().setRanking(ranking, key);
    }, RANK_DEBOUNCE_MS);
    return () => window.clearTimeout(id);
  }, [active, key, design, objective, settings.durationS]);

  // Background voxel verification of the top results
  const ranking = useScenarioStore((s) => s.ranking);
  const rankingKey = useScenarioStore((s) => s.rankingKey);
  useEffect(() => {
    if (!active || !ranking || rankingKey !== key) return;
    const q = getVoxelQueue();
    const baseKey = simulationInputKey(design[0]!, design.slice(1), settings);
    const baseVoxel = q.get(baseKey);
    if (!baseVoxel || resultKey !== baseKey) return; // only once the user has run the current design
    const baseMetrics = voxelMetrics(baseVoxel, design, ranking.baseline.network);
    const before = objectiveValue(baseMetrics, ranking.objective);
    let cancelled = false;
    verifyStart.current = performance.now();
    const top = ranking.better.slice(0, VERIFY_TOP).filter((r) => r.verified === 'unverified');
    if (top.length === 0) return;
    const update = (id: string, patch: Partial<Ranking['better'][number]>) => {
      const cur = useScenarioStore.getState();
      if (cancelled || !cur.ranking || cur.rankingKey !== key) return;
      cur.setRanking(
        {
          ...cur.ranking,
          better: cur.ranking.better.map((r) => (r.id === id ? { ...r, ...patch } : r)),
          verifyMs: performance.now() - verifyStart.current,
        },
        key
      );
    };
    for (const r of top) {
      const d = applyScenario(design, r);
      const k = simulationInputKey(d[0]!, d.slice(1), settings);
      // Precomputed (showcase) checks need no run
      const known = useScenarioStore.getState().knownVoxel[k];
      if (known) {
        const delta = objectiveValue(known, ranking.objective) - before;
        update(r.id, {
          verified: Math.sign(delta) === Math.sign(r.delta) ? 'verified' : 'disagrees',
          voxelDelta: delta,
        });
        continue;
      }
      update(r.id, { verified: 'pending' });
      q.enqueue({
        key: k,
        label: `Verify: ${r.texts.join(' + ')}`,
        priority: 'low',
        input: { rooms: d, resolution: settings.resolution, durationS: settings.durationS },
      })
        .then((vox) => {
          const after = objectiveValue(
            voxelMetrics(vox, d, evaluateDesign(d, settings.durationS).network),
            ranking.objective
          );
          const delta = after - before;
          update(r.id, {
            verified: Math.sign(delta) === Math.sign(r.delta) ? 'verified' : 'disagrees',
            voxelDelta: delta,
          });
        })
        .catch(() => update(r.id, { verified: 'unverified' }));
    }
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, rankingKey, key, resultKey]);
}
