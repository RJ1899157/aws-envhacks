import React from 'react';
import type { ParseIssue } from '../core/parser';

export interface ImportIssuesModalProps {
  isOpen: boolean;
  issues: ParseIssue[];
  hasErrors: boolean;
  onClose: () => void;
}

export const ImportIssuesModal: React.FC<ImportIssuesModalProps> = ({
  isOpen,
  issues,
  hasErrors,
  onClose,
}) => {
  if (!isOpen) return null;

  return (
    <div
      data-testid="import-issues-modal"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 animate-fade-in select-none"
    >
      <div className="w-full max-w-lg bg-neutral-900 border border-neutral-700/80 rounded-2xl shadow-2xl p-5 text-neutral-200 flex flex-col gap-4">
        {/* Header */}
        <div className="flex items-center gap-3">
          <div
            className={`w-10 h-10 rounded-xl flex items-center justify-center text-xl ${
              hasErrors
                ? 'bg-red-950 border border-red-600/50 text-red-400'
                : 'bg-amber-950 border border-amber-600/50 text-amber-400'
            }`}
          >
            {hasErrors ? '❌' : '⚠️'}
          </div>
          <div>
            <h3 className="font-bold text-white text-base">
              {hasErrors ? 'Import Failed: Validation Errors' : 'Import Notices & Warnings'}
            </h3>
            <p className="text-xs text-neutral-400">
              {hasErrors
                ? 'Room contains invalid geometry or schema violations and cannot be loaded.'
                : 'The room was loaded successfully, with the following notices.'}
            </p>
          </div>
        </div>

        {/* Issues List */}
        <div className="max-h-60 overflow-y-auto flex flex-col gap-2 bg-neutral-950/60 p-3 rounded-xl border border-neutral-800">
          {issues.map((iss, idx) => (
            <div
              key={`${iss.level}-${idx}`}
              className={`p-2.5 rounded-lg border text-xs flex flex-col gap-1 ${
                iss.level === 'error'
                  ? 'bg-red-950/40 border-red-800/60 text-red-200'
                  : 'bg-amber-950/40 border-amber-800/60 text-amber-200'
              }`}
            >
              <div className="flex items-center justify-between text-[10px]">
                <span
                  className={`font-bold uppercase tracking-wider px-1.5 py-0.5 rounded text-[9px] ${
                    iss.level === 'error'
                      ? 'bg-red-900 text-red-100'
                      : 'bg-amber-900 text-amber-100'
                  }`}
                >
                  {iss.level}
                </span>
                {iss.ref && <span className="font-mono text-neutral-400">ref: {iss.ref}</span>}
              </div>
              <span className="leading-snug">{iss.message}</span>
            </div>
          ))}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end pt-2 border-t border-neutral-800">
          <button
            type="button"
            data-testid="close-import-issues-btn"
            onClick={onClose}
            className={`px-4 py-2 rounded-lg text-xs font-semibold transition-colors ${
              hasErrors
                ? 'bg-neutral-800 hover:bg-neutral-700 text-white'
                : 'bg-sky-600 hover:bg-sky-500 text-white shadow-md shadow-sky-900/40'
            }`}
          >
            {hasErrors ? 'Dismiss' : 'Continue'}
          </button>
        </div>
      </div>
    </div>
  );
};

export default ImportIssuesModal;
