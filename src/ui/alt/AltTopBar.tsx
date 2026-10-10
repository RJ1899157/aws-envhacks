import React from 'react';
import { useStore } from 'zustand';
import { ArrowLeft, Check, Layers, LayoutGrid, Play, Redo2, RotateCcw, Undo2, Wind } from 'lucide-react';
import { useSceneStore } from '../../store/sceneStore';
import { useUiStore } from '../../store/uiStore';
import { DESIGN_STEPS, useAltStore } from './altStore';
import { SaveButtons } from './BuildsDialogs';
import { useUnsaved } from './buildActions';

const iconBtn = 'h-7 w-7 rounded-[6px] flex items-center justify-center text-neutral-300 hover:text-white hover:bg-white/10 disabled:opacity-30 disabled:hover:bg-transparent';

/** Design steps as a clickable progress line. */
const Stepper: React.FC = () => {
  const step = useAltStore((s) => s.step);
  const setStep = useAltStore((s) => s.setStep);
  const index = DESIGN_STEPS.findIndex((s) => s.id === step);
  return (
    <nav className="flex items-center gap-1" aria-label="Design steps" data-testid="alt-stepper">
      {DESIGN_STEPS.map((s, i) => (
        <React.Fragment key={s.id}>
          {i > 0 && <span className={`w-4 h-px ${i <= index ? 'bg-indigo-400' : 'bg-white/15'}`} />}
          <button
            type="button"
            onClick={() => setStep(s.id)}
            aria-current={s.id === step ? 'step' : undefined}
            className={`flex items-center gap-1.5 px-2 py-1 rounded-[7px] text-[12px] transition-colors ${
              s.id === step ? 'bg-indigo-600 text-white font-semibold' : i < index ? 'text-indigo-200 hover:bg-white/10' : 'text-neutral-400 hover:text-white hover:bg-white/10'
            }`}
          >
            <span className={`w-4 h-4 rounded-full text-[10px] flex items-center justify-center ${s.id === step ? 'bg-white/25' : i < index ? 'bg-indigo-500/40' : 'bg-white/10'}`}>
              {i < index ? <Check size={10} /> : i + 1}
            </span>
            <span className="hidden md:inline">{s.label}</span>
          </button>
        </React.Fragment>
      ))}
    </nav>
  );
};

export const AltTopBar: React.FC<{ onSimulate: () => void; onEdit: () => void; onStartOver: () => void }> = ({ onSimulate, onEdit, onStartOver }) => {
  const phase = useAltStore((s) => s.phase);
  const unsaved = useUnsaved();
  const view = useUiStore((s) => s.view);
  const setView = useUiStore((s) => s.setView);
  const canUndo = useStore(useSceneStore.temporal, (s) => s.pastStates.length > 0);
  const canRedo = useStore(useSceneStore.temporal, (s) => s.futureStates.length > 0);

  return (
    <header
      data-testid="alt-topbar"
      className="fixed top-0 left-0 right-0 z-[20] h-12 px-3.5 flex items-center gap-3 bg-neutral-900/90 backdrop-blur-md border-b border-white/10 text-neutral-300 text-xs select-none"
    >
      <div className="flex items-center gap-2 shrink-0">
        <Wind size={18} className="text-indigo-400" />
        <span className="font-bold text-white text-sm tracking-tight">AirForce</span>
      </div>

      <div className="flex-1 flex items-center justify-center min-w-0">
        {phase === 'design' && <Stepper />}
        {phase === 'results' && (
          <button type="button" onClick={onEdit} className="flex items-center gap-1.5 px-2.5 py-1 rounded-[7px] text-[12px] text-neutral-300 hover:text-white hover:bg-white/10" data-testid="alt-back-to-design">
            <ArrowLeft size={13} /> Back to design
          </button>
        )}
      </div>

      <div className="flex items-center gap-1.5 shrink-0">
        {(phase === 'design' || phase === 'results') && <SaveButtons unsaved={unsaved} />}
        {phase === 'design' && (
          <>
            <button type="button" aria-label="Undo" title="Undo (Ctrl+Z)" disabled={!canUndo} onClick={() => useSceneStore.temporal.getState().undo()} className={iconBtn}>
              <Undo2 size={15} />
            </button>
            <button type="button" aria-label="Redo" title="Redo (Ctrl+Shift+Z)" disabled={!canRedo} onClick={() => useSceneStore.temporal.getState().redo()} className={iconBtn}>
              <Redo2 size={15} />
            </button>
          </>
        )}
        {phase !== 'start' && (
          <button
            type="button"
            onClick={() => setView(view === '3d' ? '2d' : '3d')}
            title="Switch between the 3D view and a top-down plan"
            className="h-7 px-2 rounded-[6px] flex items-center gap-1.5 text-neutral-300 hover:text-white hover:bg-white/10"
          >
            {view === '3d' ? <LayoutGrid size={14} /> : <Layers size={14} />}
            {view === '3d' ? 'Plan view' : '3D view'}
          </button>
        )}
        {phase === 'design' && (
          <button
            type="button"
            data-testid="alt-simulate"
            onClick={onSimulate}
            className="h-8 px-3.5 ml-1 rounded-[8px] bg-indigo-600 hover:bg-indigo-500 text-white text-[12.5px] font-semibold flex items-center gap-1.5 shadow-lg"
          >
            <Play size={13} /> Simulate airflow
          </button>
        )}
        {phase !== 'start' && <div className="w-px h-5 bg-white/10 mx-1" />}
        {phase !== 'start' && (
          <button type="button" onClick={onStartOver} title="Start a new design" className="h-7 px-2 rounded-[6px] flex items-center gap-1 text-neutral-400 hover:text-white hover:bg-white/10">
            <RotateCcw size={13} /> Start over
          </button>
        )}
      </div>
    </header>
  );
};
