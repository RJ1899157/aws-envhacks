import React, { useState } from 'react';

export const ONBOARDING_STORAGE_KEY = 'airforce_onboarding_completed_v1';

export interface OnboardingModalProps {
  isOpen: boolean;
  onClose: () => void;
}

interface StepContent {
  icon: string;
  stepNumber: number;
  title: string;
  subtitle: string;
  description: string;
  tips: string[];
}

const ONBOARDING_STEPS: StepContent[] = [
  {
    icon: '🧭', stepNumber: 1, title: 'Orbit the room', subtitle: 'Change the view from any angle',
    description: 'Drag empty space to orbit, use the view cube or angle presets, and scroll or pinch to zoom. Double-click an object to frame it.',
    tips: ['WASD or arrow keys move across the floor (Shift = faster)', 'Drag to orbit, scroll to zoom', 'Home fits the whole room'],
  },
  {
    icon: '🪑', stepNumber: 2, title: 'Place an object', subtitle: 'Build out your room at real scale',
    description: 'Drag an asset from the library into the room, then move, rotate, and resize it with the on-canvas controls or Inspector.',
    tips: ['Click an object to select it', 'G moves and R rotates', 'Use Fit Selection to frame it'],
  },
  {
    icon: '🧱', stepNumber: 3, title: 'Edit a wall', subtitle: 'Adjust room shape and dimensions',
    description: 'Hover or select a wall to reveal its controls. Drag the wall body or a corner, or double-click a dimension to enter an exact length.',
    tips: ['Select a wall to show its dimension', 'Use the plus control to split it', 'Undo is available in the toolbar'],
  },
  {
    icon: '🪟', stepNumber: 4, title: 'Add a window', subtitle: 'Openings snap to the wall',
    description: 'Double-click a wall to open the quick menu, or choose a window in the asset library and place it on a wall.',
    tips: ['Resize from the opening handles', 'Set sill height in the Inspector', 'Choose inlet, outlet, or closed'],
  },
  {
    icon: '📐',
    stepNumber: 5,
    title: 'Export your project',
    subtitle: 'Custom room geometry with millimeter precision',
    description:
      'Open File → Export Dialog to save a project or export a model, floor plan, or screenshot. Project exports can be reopened later.',
    tips: [
      'Use .airforce to preserve project data and saved views',
      'Choose the export format that fits your workflow',
      'Take a screenshot from the File menu',
    ],
  },
  {
    icon: '🛋️',
    stepNumber: 2,
    title: 'Add Real-Scale Assets',
    subtitle: 'Full catalog of furniture, fans, and appliances',
    description:
      'Drag and drop real-scale assets from the left library directly into your 3D room. Use Blender-like shortcuts to transform, duplicate, or elevate furniture, while solid collision detection prevents overlaps.',
    tips: [
      'G = Move, R = Rotate, Shift+D = Duplicate, Del/X = Delete',
      'Type numeric distance while moving (e.g. 0.5 + Enter)',
      'Elevation slider lifts wall-mounted air conditioners and ceiling fans',
    ],
  },
  {
    icon: '🪟',
    stepNumber: 3,
    title: 'Snap & Tag Ventilation Openings',
    subtitle: 'Inlet, outlet, and sill height controls',
    description:
      'Windows and doors snap directly to wall surfaces and slide smoothly along them. Tag each opening as an Inlet (blue with inward arrows), Outlet (orange with outward arrows), or Closed, and set the open percentage.',
    tips: [
      'HUD ventilation chip monitors total opening area in m²',
      'Automatic warning appears if cross-ventilation is impossible',
      'Multi-select openings with Shift to bulk-assign airflow roles',
    ],
  },
  {
    icon: '💾',
    stepNumber: 4,
    title: 'Simulate, Voxelize & Export',
    subtitle: 'IAQ parameters, 3D voxel grid, and validated JSON',
    description:
      'Configure wind speed, direction compass, temperature, and pollutant emissions in the Inspector. Toggle the 3D Voxel Debugger to inspect CFD domain cells, export crisp PNG screenshots, or download room.json.',
    tips: [
      '🧊 Voxels button reveals 3D discretization with Y-slice controls',
      'Autosave protects your scene every 500 ms in localStorage',
      'Validated import/export ensures zero data corruption',
    ],
  },
];

export const OnboardingModal: React.FC<OnboardingModalProps> = ({ isOpen, onClose }) => {
  const [currentStepIndex, setCurrentStepIndex] = useState(0);

  if (!isOpen) return null;

  const step = ONBOARDING_STEPS[currentStepIndex]!;
  const isLastStep = currentStepIndex === ONBOARDING_STEPS.length - 1;

  const handleNext = () => {
    if (isLastStep) {
      handleComplete();
    } else {
      setCurrentStepIndex((prev) => prev + 1);
    }
  };

  const handleBack = () => {
    setCurrentStepIndex((prev) => Math.max(0, prev - 1));
  };

  const handleComplete = () => {
    if (typeof localStorage !== 'undefined') {
      try {
        localStorage.setItem(ONBOARDING_STORAGE_KEY, 'true');
      } catch {
        // ignore
      }
    }
    onClose();
  };

  return (
    <div
      data-testid="onboarding-modal-backdrop"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-sm p-4 font-sans select-none"
    >
      <div
        data-testid="onboarding-modal"
        className="w-full max-w-lg bg-neutral-900 border border-neutral-700/80 rounded-2xl shadow-2xl overflow-hidden flex flex-col animate-in fade-in zoom-in-95 duration-150"
      >
        {/* Header Bar */}
        <div className="bg-neutral-800/80 px-6 py-4 border-b border-neutral-800 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <span className="text-xl">🌬️</span>
            <div>
              <h2 className="font-bold text-white text-base leading-none">AirForce Studio</h2>
              <span className="text-[11px] text-neutral-400">
                Interactive Indoor Airflow & IAQ Modeler
              </span>
            </div>
          </div>
          <button
            type="button"
            data-testid="onboarding-skip-btn"
            onClick={handleComplete}
            className="text-neutral-400 hover:text-neutral-200 text-xs px-2 py-1 rounded hover:bg-neutral-700/50 transition-colors"
          >
            Skip Tutorial
          </button>
        </div>

        {/* Step Body */}
        <div className="p-6 flex flex-col gap-4">
          <div className="flex items-start gap-4">
            <div className="w-14 h-14 rounded-2xl bg-sky-950/70 border border-sky-600/40 flex items-center justify-center text-3xl shadow-inner shrink-0">
              {step.icon}
            </div>
            <div className="flex flex-col gap-1">
              <div className="flex items-center gap-2">
                <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full bg-sky-900/60 text-sky-300 border border-sky-700/50">
                  Step {step.stepNumber} of {ONBOARDING_STEPS.length}
                </span>
              </div>
              <h3 className="text-base font-bold text-white">{step.title}</h3>
              <p className="text-xs text-sky-400 font-medium">{step.subtitle}</p>
            </div>
          </div>

          <p className="text-xs text-neutral-300 leading-relaxed bg-neutral-950/60 p-3.5 rounded-xl border border-neutral-800/80">
            {step.description}
          </p>

          {/* Quick Tips */}
          <div className="flex flex-col gap-1.5 pt-1">
            <span className="text-[11px] font-semibold text-neutral-400">Pro Tips:</span>
            <ul className="flex flex-col gap-1 text-xs text-neutral-300">
              {step.tips.map((tip, idx) => (
                <li key={idx} className="flex items-center gap-2">
                  <span className="text-sky-400 text-xs">✦</span>
                  <span>{tip}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>

        {/* Footer Navigation */}
        <div className="bg-neutral-950/80 px-6 py-4 border-t border-neutral-800 flex items-center justify-between">
          {/* Step Dots */}
          <div className="flex items-center gap-1.5">
            {ONBOARDING_STEPS.map((_, i) => (
              <button
                key={i}
                type="button"
                onClick={() => setCurrentStepIndex(i)}
                className={`h-2 rounded-full transition-all cursor-pointer ${
                  i === currentStepIndex
                    ? 'w-6 bg-sky-500'
                    : 'w-2 bg-neutral-700 hover:bg-neutral-600'
                }`}
                title={`Go to step ${i + 1}`}
              />
            ))}
          </div>

          {/* Buttons */}
          <div className="flex items-center gap-2">
            {currentStepIndex > 0 && (
              <button
                type="button"
                data-testid="onboarding-back-btn"
                onClick={handleBack}
                className="px-3.5 py-1.5 rounded-lg border border-neutral-700 text-xs font-semibold text-neutral-300 hover:bg-neutral-800 transition-colors"
              >
                Back
              </button>
            )}
            <button
              type="button"
              data-testid="onboarding-next-btn"
              onClick={handleNext}
              className="px-5 py-1.5 rounded-lg bg-sky-600 hover:bg-sky-500 text-white text-xs font-semibold shadow-lg shadow-sky-900/30 transition-all cursor-pointer"
            >
              {isLastStep ? 'Get Started 🚀' : 'Next →'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default OnboardingModal;
