import React, { useEffect, useRef, useState } from 'react';
import { create } from 'zustand';
import { Check, Download, FolderOpen, Pencil, Save, Trash2, Upload, X } from 'lucide-react';
import { parseBuildFile, useBuildsStore, type Build } from '../../store/buildsStore';
import { useUiStore } from '../../store/uiStore';
import { useAltStore } from './altStore';
import { confirmDiscard, defaultBuildName, downloadCurrentBuild, openRooms, saveBuildAs, saveCurrentBuild } from './buildActions';

/** Which builds dialog is open. */
const useDialog = create<{ open: null | 'save' | 'builds'; set: (open: null | 'save' | 'builds') => void }>()((set) => ({ open: null, set: (open) => set({ open }) }));

export const openBuildsDialog = () => useDialog.getState().set('builds');

/** Save: over the open build, or ask for a name the first time. */
export async function saveBuild(): Promise<void> {
  if (!(await saveCurrentBuild())) useDialog.getState().set('save');
}

function when(ts: number): string {
  const d = new Date(ts);
  const today = new Date();
  return d.toDateString() === today.toDateString()
    ? `today ${d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`
    : d.toLocaleDateString([], { day: 'numeric', month: 'short', year: d.getFullYear() === today.getFullYear() ? undefined : 'numeric' });
}

const Modal: React.FC<{ title: string; onClose: () => void; children: React.ReactNode; testId: string; width?: number }> = ({ title, onClose, children, testId, width = 460 }) => {
  useEffect(() => {
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', esc);
    return () => window.removeEventListener('keydown', esc);
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-[50] bg-neutral-950/70 backdrop-blur-sm flex items-center justify-center p-4" onClick={onClose}>
      <div role="dialog" aria-label={title} data-testid={testId} className="max-w-full max-h-full overflow-y-auto rounded-[14px] bg-neutral-900 border border-white/10 shadow-2xl p-5 text-neutral-200" style={{ width }} onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-[16px] font-semibold text-white">{title}</h2>
          <button type="button" aria-label="Close" onClick={onClose} className="p-1 rounded hover:bg-white/10 text-neutral-400">
            <X size={15} />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
};

const SaveDialog: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  const [name, setName] = useState(defaultBuildName);
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    if (!name.trim() || busy) return;
    setBusy(true);
    await saveBuildAs(name);
    onClose();
  };
  return (
    <Modal title="Save build" onClose={onClose} testId="alt-save-dialog" width={400}>
      <label className="flex flex-col gap-1 text-[12px] text-neutral-400">
        Name
        <input
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && void submit()}
          className="bg-black/30 border border-white/10 rounded-[8px] px-2.5 py-2 text-[13px] text-white outline-none focus:border-indigo-500"
          data-testid="alt-save-name"
        />
      </label>
      <p className="text-[11px] text-neutral-500 mt-2">Saved in this browser. Use Download in My builds to keep a file copy.</p>
      <div className="flex justify-end gap-2 mt-4">
        <button type="button" onClick={onClose} className="px-3 py-1.5 rounded-[8px] text-[12px] text-neutral-300 hover:bg-white/10">
          Cancel
        </button>
        <button type="button" onClick={() => void submit()} disabled={!name.trim() || busy} className="px-4 py-1.5 rounded-[8px] bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 text-white text-[12.5px] font-semibold" data-testid="alt-save-confirm">
          Save
        </button>
      </div>
    </Modal>
  );
};

/** One saved build: open, rename, delete. */
const BuildRow: React.FC<{ build: Build; current: boolean; onOpened?: () => void }> = ({ build, current, onOpened }) => {
  const rename = useBuildsStore((s) => s.rename);
  const remove = useBuildsStore((s) => s.remove);
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(build.name);
  const commit = async () => {
    setEditing(false);
    if (name.trim() && name.trim() !== build.name) {
      await rename(build.id, name);
      const open = useAltStore.getState().build;
      if (open?.id === build.id) useAltStore.getState().setBuild({ ...open, name: name.trim() });
    } else setName(build.name);
  };
  return (
    <li className={`flex items-center gap-2 px-2.5 py-2 rounded-[9px] border ${current ? 'border-indigo-400/50 bg-indigo-500/10' : 'border-white/10 bg-white/[0.03]'}`} data-testid="alt-build-row">
      <div className="flex-1 min-w-0">
        {editing ? (
          <input
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            onBlur={() => void commit()}
            onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
            className="w-full bg-black/30 border border-white/10 rounded-[6px] px-1.5 py-0.5 text-[13px] text-white outline-none focus:border-indigo-500"
          />
        ) : (
          <div className="text-[13px] font-medium text-white truncate">
            {build.name}
            {current && <span className="ml-1.5 text-[10px] font-semibold text-indigo-300">open</span>}
          </div>
        )}
        <div className="text-[10.5px] text-neutral-500">
          {build.rooms.length} {build.rooms.length === 1 ? 'room' : 'rooms'} · saved {when(build.updatedAt)}
        </div>
      </div>
      {!current && (
        <button
          type="button"
          onClick={() => {
            if (!confirmDiscard()) return;
            openRooms(JSON.parse(JSON.stringify(build.rooms)), { id: build.id, name: build.name });
            onOpened?.();
          }}
          className="px-2.5 py-1 rounded-[7px] bg-indigo-600 hover:bg-indigo-500 text-white text-[11.5px] font-semibold"
          data-testid="alt-build-open"
        >
          Open
        </button>
      )}
      <button type="button" aria-label={`Rename ${build.name}`} title="Rename" onClick={() => setEditing(true)} className="p-1.5 rounded hover:bg-white/10 text-neutral-400">
        <Pencil size={12} />
      </button>
      <button
        type="button"
        aria-label={`Delete ${build.name}`}
        title="Delete"
        onClick={() => {
          if (!window.confirm(`Delete "${build.name}"? This can't be undone.`)) return;
          void remove(build.id);
          if (current) useAltStore.getState().setBuild(null);
        }}
        className="p-1.5 rounded hover:bg-white/10 text-neutral-500 hover:text-red-300"
      >
        <Trash2 size={12} />
      </button>
    </li>
  );
};

/** Opens a build file from disk (this app's format or the old editor's JSON). */
export const OpenFileButton: React.FC<{ className?: string; onOpened?: () => void; children: React.ReactNode }> = ({ className, onOpened, children }) => {
  const input = useRef<HTMLInputElement>(null);
  return (
    <>
      <input
        ref={input}
        type="file"
        accept=".json,.airforce,application/json"
        className="hidden"
        data-testid="alt-open-file-input"
        onChange={async (e) => {
          const file = e.target.files?.[0];
          e.target.value = '';
          if (!file) return;
          try {
            const { rooms } = parseBuildFile(await file.text());
            if (!confirmDiscard()) return;
            openRooms(rooms, null);
            useUiStore.getState().setToastMessage(`Opened "${file.name}". Save it to add it to My builds.`);
            onOpened?.();
          } catch (err) {
            window.alert(err instanceof Error ? err.message : "This file couldn't be opened.");
          }
        }}
      />
      <button type="button" className={className} onClick={() => input.current?.click()}>
        {children}
      </button>
    </>
  );
};

/** Compact list of saved builds (start screen and the My builds dialog). */
export const BuildList: React.FC<{ limit?: number; onOpened?: () => void }> = ({ limit, onOpened }) => {
  const builds = useBuildsStore((s) => s.builds);
  const loaded = useBuildsStore((s) => s.loaded);
  const error = useBuildsStore((s) => s.error);
  const load = useBuildsStore((s) => s.load);
  const openId = useAltStore((s) => s.build?.id);
  const phase = useAltStore((s) => s.phase);
  useEffect(() => {
    if (!loaded) void load();
  }, [loaded, load]);
  if (error) return <p className="text-[11.5px] text-amber-200/90">{error}</p>;
  if (loaded && builds.length === 0) return <p className="text-[11.5px] text-neutral-500">No saved builds yet. Use Save while designing.</p>;
  return (
    <ul className="flex flex-col gap-1.5" data-testid="alt-build-list">
      {(limit ? builds.slice(0, limit) : builds).map((b) => (
        <BuildRow key={b.id} build={b} current={b.id === openId && phase !== 'start'} onOpened={onOpened} />
      ))}
    </ul>
  );
};

const BuildsDialog: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  const phase = useAltStore((s) => s.phase);
  const designing = phase === 'design' || phase === 'results';
  const btn = 'flex items-center gap-1.5 px-2.5 py-1.5 rounded-[8px] bg-white/10 hover:bg-white/15 text-[12px] text-white';
  return (
    <Modal title="My builds" onClose={onClose} testId="alt-builds-dialog" width={520}>
      <div className="flex flex-wrap gap-2 mb-3">
        {designing && (
          <>
            <button type="button" className={btn} onClick={() => useDialog.getState().set('save')} data-testid="alt-save-copy">
              <Save size={13} /> Save as new build
            </button>
            <button type="button" className={btn} onClick={downloadCurrentBuild} data-testid="alt-download">
              <Download size={13} /> Download this build
            </button>
          </>
        )}
        <OpenFileButton className={btn} onOpened={onClose}>
          <Upload size={13} /> Open a file…
        </OpenFileButton>
      </div>
      <BuildList onOpened={onClose} />
    </Modal>
  );
};

/** Renders whichever builds dialog is open. */
export const BuildsDialogs: React.FC = () => {
  const open = useDialog((s) => s.open);
  const set = useDialog((s) => s.set);
  if (open === 'save') return <SaveDialog onClose={() => set(null)} />;
  if (open === 'builds') return <BuildsDialog onClose={() => set(null)} />;
  return null;
};

/** Top-bar buttons: Save (with an unsaved marker) and My builds. */
export const SaveButtons: React.FC<{ unsaved: boolean }> = ({ unsaved }) => {
  const name = useAltStore((s) => s.build?.name);
  return (
    <>
      <button
        type="button"
        onClick={() => void saveBuild()}
        title={name ? `Save "${name}" (Ctrl+S)` : 'Save this build (Ctrl+S)'}
        data-testid="alt-save"
        className="h-7 px-2.5 rounded-[6px] flex items-center gap-1.5 text-neutral-200 hover:text-white hover:bg-white/10"
      >
        {unsaved ? <Save size={14} /> : <Check size={14} className="text-emerald-400" />}
        <span>{unsaved ? 'Save' : 'Saved'}</span>
        {unsaved && name && <span className="w-1.5 h-1.5 rounded-full bg-amber-400" aria-label="unsaved changes" />}
      </button>
      <button type="button" onClick={openBuildsDialog} title="My builds" data-testid="alt-my-builds" className="h-7 px-2 rounded-[6px] flex items-center gap-1.5 text-neutral-300 hover:text-white hover:bg-white/10">
        <FolderOpen size={14} /> <span className="hidden lg:inline">My builds</span>
      </button>
    </>
  );
};
