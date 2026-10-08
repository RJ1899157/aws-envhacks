import React, { useEffect, useState } from 'react';
import { Canvas, CanvasErrorBoundary } from '../builder';
import {
  AssetLibrary,
  Toolbar,
  Inspector,
  HudOverlay,
  RestoreSessionModal,
  OnboardingModal,
  ONBOARDING_STORAGE_KEY,
} from '../ui';
import { useAutosave } from '../store/useAutosave';

export const App: React.FC = () => {
  const { pendingRestore, restoreSession, dismissRestore } = useAutosave();
  const [isOnboardingOpen, setIsOnboardingOpen] = useState(false);

  // Check first-run onboarding status on mount
  useEffect(() => {
    if (typeof localStorage !== 'undefined') {
      try {
        const completed = localStorage.getItem(ONBOARDING_STORAGE_KEY);
        if (!completed) {
          setIsOnboardingOpen(true);
        }
      } catch {
        // ignore
      }
    }
  }, []);

  return (
    <main className="relative w-screen h-screen overflow-hidden bg-neutral-950 select-none">
      {/* 3D WebGL Canvas guarded with Error Boundary */}
      <CanvasErrorBoundary>
        <Canvas />
      </CanvasErrorBoundary>

      {/* Top Application Toolbar */}
      <Toolbar onOpenOnboarding={() => setIsOnboardingOpen(true)} />

      {/* Left Asset Library Sidebar */}
      <AssetLibrary />

      {/* Right Contextual Inspector */}
      <Inspector />

      {/* Bottom Status HUD */}
      <HudOverlay />

      {/* Restore Session Modal */}
      {pendingRestore && (
        <RestoreSessionModal
          session={pendingRestore}
          onRestore={restoreSession}
          onDismiss={dismissRestore}
        />
      )}

      {/* 4-Step Onboarding Overlay */}
      <OnboardingModal isOpen={isOnboardingOpen} onClose={() => setIsOnboardingOpen(false)} />
    </main>
  );
};

export default App;
