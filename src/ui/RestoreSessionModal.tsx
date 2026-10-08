import React from 'react';
import type { AutosaveData } from '../store/useAutosave';

export interface RestoreSessionModalProps {
  session: AutosaveData;
  onRestore: () => void;
  onDismiss: () => void;
}

export const RestoreSessionModal: React.FC<RestoreSessionModalProps> = ({
  session,
  onRestore,
  onDismiss,
}) => {
  const { room, savedAt } = session;
  const savedDateStr = new Date(savedAt).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });

  return (
    <div
      data-testid="restore-session-modal"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 animate-fade-in select-none"
    >
      <div className="w-full max-w-md bg-neutral-900 border border-neutral-700/80 rounded-2xl shadow-2xl p-5 text-neutral-200 flex flex-col gap-4">
        {/* Header */}
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-sky-950 border border-sky-600/50 flex items-center justify-center text-sky-400 text-xl">
            💾
          </div>
          <div>
            <h3 className="font-bold text-white text-base">Restore Previous Session?</h3>
            <p className="text-xs text-neutral-400">
              An autosaved room session from {savedDateStr} was found.
            </p>
          </div>
        </div>

        {/* Room Preview Summary */}
        <div className="bg-neutral-950/60 rounded-xl p-3.5 border border-neutral-800 flex flex-col gap-2 text-xs">
          <div className="flex items-center justify-between">
            <span className="text-neutral-400 font-medium">Room Name:</span>
            <span className="font-semibold text-white">{room.name}</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-neutral-400 font-medium">Walls / Vertices:</span>
            <span className="font-mono text-neutral-300">{room.outline.length} corners</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-neutral-400 font-medium">Placed Objects:</span>
            <span className="font-mono text-sky-400">{room.objects.length} assets</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-neutral-400 font-medium">Openings (Windows/Doors):</span>
            <span className="font-mono text-emerald-400">{room.openings.length} openings</span>
          </div>
        </div>

        {/* Actions */}
        <div className="flex items-center justify-end gap-2.5 pt-2 border-t border-neutral-800">
          <button
            type="button"
            data-testid="dismiss-restore-btn"
            onClick={onDismiss}
            className="px-4 py-2 rounded-lg bg-neutral-800 hover:bg-neutral-700 text-neutral-300 text-xs font-semibold transition-colors"
          >
            Start Fresh
          </button>
          <button
            type="button"
            data-testid="restore-session-btn"
            onClick={onRestore}
            className="px-4 py-2 rounded-lg bg-sky-600 hover:bg-sky-500 text-white text-xs font-semibold shadow-md shadow-sky-900/40 transition-colors"
          >
            Restore Session
          </button>
        </div>
      </div>
    </div>
  );
};

export default RestoreSessionModal;
