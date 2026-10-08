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
  Outliner,
  CommandPalette,
  ShortcutCheatSheet,
  SnapshotPanel,
  ContextMenu,
} from '../ui';
import { useAutosave } from '../store/useAutosave';

import { handleFileDrop } from '../io/import/ImportManager';
import { ImportModals } from '../ui/import/ImportModals';
import { ExportModal } from '../ui/export/ExportModal';

export const App: React.FC = () => {
  const { pendingRestore, restoreSession, dismissRestore } = useAutosave();
  const [isOnboardingOpen, setIsOnboardingOpen] = useState(false);
  const [isDraggingOver, setIsDraggingOver] = useState(false);

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

  useEffect(() => {
    const onDragOver = (e: DragEvent) => {
      e.preventDefault();
      setIsDraggingOver(true);
    };
    const onDragLeave = (e: DragEvent) => {
      e.preventDefault();
      // Only hide if we actually leave the window
      if (!e.relatedTarget || (e.relatedTarget as HTMLElement).nodeName === 'HTML') {
        setIsDraggingOver(false);
      }
    };
    const onDrop = async (e: DragEvent) => {
      e.preventDefault();
      setIsDraggingOver(false);
      if (e.dataTransfer && e.dataTransfer.items.length > 0) {
        await handleFileDrop(e.dataTransfer.items);
      } else if (e.dataTransfer && e.dataTransfer.files.length > 0) {
        await handleFileDrop(e.dataTransfer.files);
      }
    };

    window.addEventListener('dragover', onDragOver);
    window.addEventListener('dragleave', onDragLeave);
    window.addEventListener('drop', onDrop);

    return () => {
      window.removeEventListener('dragover', onDragOver);
      window.removeEventListener('dragleave', onDragLeave);
      window.removeEventListener('drop', onDrop);
    };
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

      {/* Right Contextual Inspector and Outliner */}
      <Outliner />
      <SnapshotPanel />
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
      
      <CommandPalette />
      <ShortcutCheatSheet />
      <ContextMenu />

      {/* Import Modals */}
      <ImportModals />

      {/* Export Modal */}
      <ExportModal />

      {/* Global Drag Overlay */}
      {isDraggingOver && (
        <div className="fixed inset-0 z-[100] bg-sky-500/20 border-4 border-sky-400 border-dashed m-4 rounded-xl flex items-center justify-center pointer-events-none transition-all duration-200">
          <div className="bg-neutral-900/90 text-white px-8 py-6 rounded-2xl shadow-2xl flex flex-col items-center gap-3 glass-panel">
            <span className="text-4xl">📥</span>
            <span className="text-xl font-bold tracking-wide">Drop Files to Import</span>
            <span className="text-sm text-sky-200">Supports GLB, GLTF, OBJ, FBX, STL, DAE, DXF, SVG, JSON</span>
          </div>
        </div>
      )}
    </main>
  );
};

export default App;
