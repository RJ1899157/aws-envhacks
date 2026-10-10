import React, { useCallback, useEffect } from 'react';
import { Canvas, CanvasErrorBoundary } from '../../builder';
import { useSceneStore } from '../../store/sceneStore';
import { useShowcaseStore } from '../../store/showcaseStore';
import { useSimulationStore } from '../../store/simulationStore';
import { useUiStore } from '../../store/uiStore';
import { resetToNewUser } from '../../store/resetSession';
import { useAltStore } from './altStore';
import { AltTopBar } from './AltTopBar';
import { clearAltSession, readAltSession, useAltSessionAutosave } from './altSession';
import { DesignPanel } from './DesignPanel';
import { ResultsPanel, runSimulation } from './ResultsPanel';
import { SelectionPanel } from './SelectionPanel';
import { StartScreen } from './StartScreen';
import { BuildsDialogs, saveBuild } from './BuildsDialogs';
import { hasUnsavedWork } from './buildActions';

/** Toasts from the editor (e.g. "Deleted"). */
const AltToast: React.FC = () => {
  const message = useUiStore((s) => s.toastMessage);
  const setToastMessage = useUiStore((s) => s.setToastMessage);
  useEffect(() => {
    if (!message) return;
    const id = window.setTimeout(() => setToastMessage(null), 3000);
    return () => window.clearTimeout(id);
  }, [message, setToastMessage]);
  if (!message) return null;
  return (
    <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-[30] px-3 py-1.5 rounded-[8px] bg-neutral-900/95 border border-white/10 text-[12px] text-neutral-100 shadow-xl pointer-events-none">
      {message}
    </div>
  );
};

/**
 * The app: Start → Design (rooms, furniture, doors & windows, pollution sources) → Results, around
 * the shared 3D canvas, stores and simulation.
 */
export const AltApp: React.FC = () => {
  const phase = useAltStore((s) => s.phase);
  const setPhase = useAltStore((s) => s.setPhase);
  const showcaseActive = useShowcaseStore((s) => s.active !== null);
  const pickerOpen = useShowcaseStore((s) => s.pickerOpen);

  // On load: resume the saved design where the user left off; with nothing saved (a first visit),
  // start at the start screen
  useEffect(() => {
    const saved = readAltSession();
    if (!saved) {
      useAltStore.getState().reset();
      return;
    }
    useSceneStore.getState().loadRoom(saved.room, saved.otherRooms);
    useSceneStore.temporal.getState().clear();
    useAltStore.setState({ phase: saved.phase, step: saved.step, project: saved.project, build: saved.build ?? null });
    if (saved.phase === 'results') runSimulation();
    window.setTimeout(() => window.dispatchEvent(new CustomEvent('airforce:simulation-view')), 150);
  }, []);

  useAltSessionAutosave();

  // A selected wall is a wall of the active room: forget it when another room becomes active
  const activeRoomId = useSceneStore((s) => s.room.id);
  useEffect(() => {
    useUiStore.getState().setSelectedWallIndex(null);
  }, [activeRoomId]);

  // Ctrl/⌘+S saves the build (instead of the browser's "save page")
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's') {
        e.preventDefault();
        const { phase } = useAltStore.getState();
        if (phase === 'design' || phase === 'results') void saveBuild();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // Results are only drawn on the Results screen (and in examples)
  useEffect(() => {
    useSimulationStore.getState().setViz({ show: phase === 'results' || phase === 'example' });
  }, [phase]);

  // Leaving an example goes back to the start, unless it was copied as the user's design (it brings
  // its results along); closing the picker without opening one also goes back
  useEffect(() => {
    if (phase !== 'example' || showcaseActive || pickerOpen) return;
    if (useSimulationStore.getState().result) {
      useAltStore.setState({ project: 'house', step: 'ventilation' });
      setPhase('results');
    } else setPhase('start');
  }, [phase, showcaseActive, pickerOpen, setPhase]);

  const simulate = useCallback(() => {
    useSceneStore.getState().clearSelection();
    useSimulationStore.getState().setViz({ show: true, mode: 'pollution', snapshotIndex: null, playing: false });
    setPhase('results');
    runSimulation();
    window.setTimeout(() => window.dispatchEvent(new CustomEvent('airforce:simulation-view')), 150);
  }, [setPhase]);

  const edit = useCallback(() => setPhase('design'), [setPhase]);

  const startOver = useCallback(() => {
    if (hasUnsavedWork() && !confirm('Start a new design? Unsaved changes to this one will be lost.')) return;
    clearAltSession();
    resetToNewUser();
    useAltStore.getState().reset();
  }, []);

  return (
    <main className="relative w-screen h-screen overflow-hidden bg-neutral-950 select-none" data-testid="alt-app">
      <CanvasErrorBoundary>
        <Canvas minimal />
      </CanvasErrorBoundary>
      <AltTopBar onSimulate={simulate} onEdit={edit} onStartOver={startOver} />
      {phase === 'start' && <StartScreen />}
      {phase === 'design' && (
        <>
          <DesignPanel onSimulate={simulate} />
          <SelectionPanel />
        </>
      )}
      {phase === 'results' && <ResultsPanel onEdit={edit} />}
      {phase === 'example' && showcaseActive && <ResultsPanel example />}
      <BuildsDialogs />
      <AltToast />
    </main>
  );
};

export default AltApp;
