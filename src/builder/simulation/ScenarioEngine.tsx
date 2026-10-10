import type React from 'react';
import { useSimulationStore } from '../../store/simulationStore';
import { useScenarioEngine } from './useScenarios';

/** Keeps the ranked actions (and their voxel checks) current while the simulation layer is on. */
export const ScenarioEngine: React.FC = () => {
  useScenarioEngine(useSimulationStore((s) => s.viz.show));
  return null;
};
