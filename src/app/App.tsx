import React from 'react';
import { Canvas } from '../builder';
import { AssetLibrary, Toolbar, Inspector, HudOverlay, RestoreSessionModal } from '../ui';
import { useAutosave } from '../store/useAutosave';

export const App: React.FC = () => {
  const { pendingRestore, restoreSession, dismissRestore } = useAutosave();

  return (
    <main className="relative w-screen h-screen overflow-hidden bg-neutral-950 select-none">
      <Canvas />
      <Toolbar />
      <AssetLibrary />
      <Inspector />
      <HudOverlay />

      {/* Restore Session Modal */}
      {pendingRestore && (
        <RestoreSessionModal
          session={pendingRestore}
          onRestore={restoreSession}
          onDismiss={dismissRestore}
        />
      )}
    </main>
  );
};

export default App;
