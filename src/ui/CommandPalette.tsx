import React, { useState, useEffect, useRef } from 'react';
import { useSceneStore } from '../store/sceneStore';
import { useUiStore } from '../store/uiStore';

export const CommandPalette: React.FC = () => {
  const [isOpen, setIsOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const { resetRoom, deleteSelected, duplicateSelected, clearSelection } = useSceneStore();
  const { setToolMode, setView, setShowCeiling, setShowDimensions } = useUiStore();

  const commands = [
    { name: 'Reset Room', action: resetRoom },
    { name: 'Delete Selected', action: deleteSelected },
    { name: 'Duplicate Selected', action: duplicateSelected },
    { name: 'Clear Selection', action: clearSelection },
    { name: 'Toggle 2D/3D View', action: () => setView(useUiStore.getState().view === '2d' ? '3d' : '2d') },
    { name: 'Toggle Ceiling', action: () => setShowCeiling(!useUiStore.getState().showCeiling) },
    { name: 'Toggle Dimensions', action: () => setShowDimensions(!useUiStore.getState().showDimensions) },
    { name: 'Select Tool: Wall', action: () => setToolMode('draw-floor') },
    { name: 'Select Tool: Pointer', action: () => setToolMode('select') },
  ].filter(cmd => cmd.name.toLowerCase().includes(query.toLowerCase()));

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        setIsOpen(prev => !prev);
      }
      if (isOpen) {
        if (e.key === 'Escape') setIsOpen(false);
        if (e.key === 'ArrowDown') setSelectedIndex(s => Math.min(commands.length - 1, s + 1));
        if (e.key === 'ArrowUp') setSelectedIndex(s => Math.max(0, s - 1));
        if (e.key === 'Enter' && commands[selectedIndex]) {
          commands[selectedIndex].action();
          setIsOpen(false);
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, commands, selectedIndex]);

  useEffect(() => {
    if (isOpen) {
      setQuery('');
      setSelectedIndex(0);
      inputRef.current?.focus();
    }
  }, [isOpen]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[100] bg-black/50 backdrop-blur-sm flex items-start justify-center pt-[15vh]">
      <div className="bg-neutral-900 border border-neutral-700 w-full max-w-lg rounded-xl shadow-2xl overflow-hidden">
        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={e => { setQuery(e.target.value); setSelectedIndex(0); }}
          placeholder="Search commands..."
          className="w-full bg-transparent p-4 text-white outline-none border-b border-neutral-800 text-lg"
        />
        <div className="max-h-80 overflow-y-auto">
          {commands.length === 0 ? (
            <div className="p-4 text-neutral-500 text-center">No commands found</div>
          ) : (
            commands.map((cmd, i) => (
              <div
                key={cmd.name}
                onClick={() => { cmd.action(); setIsOpen(false); }}
                className={`p-3 cursor-pointer flex items-center justify-between text-sm ${i === selectedIndex ? 'bg-sky-600 text-white' : 'text-neutral-300 hover:bg-neutral-800'}`}
                onMouseEnter={() => setSelectedIndex(i)}
              >
                {cmd.name}
              </div>
            ))
          )}
        </div>
        <div className="p-2 border-t border-neutral-800 text-xs text-neutral-500 flex justify-between">
          <span>Arrows to navigate, Enter to select</span>
          <span>ESC to close</span>
        </div>
      </div>
    </div>
  );
};

export const ShortcutCheatSheet: React.FC = () => {
  const [isOpen, setIsOpen] = useState(false);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === '?' && !e.metaKey && !e.ctrlKey && (e.target as HTMLElement).tagName !== 'INPUT') {
        setIsOpen(true);
      }
      if (e.key === 'Escape') setIsOpen(false);
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[100] bg-black/60 flex items-center justify-center backdrop-blur-sm" onClick={() => setIsOpen(false)}>
      <div className="bg-neutral-900 border border-neutral-700 rounded-xl shadow-2xl p-6 max-w-2xl w-full text-white" onClick={e => e.stopPropagation()}>
        <div className="flex justify-between items-center mb-6">
          <h2 className="text-xl font-bold">Keyboard Shortcuts</h2>
          <button onClick={() => setIsOpen(false)} className="text-neutral-500 hover:text-white">✕</button>
        </div>
        <div className="grid grid-cols-2 gap-8">
          <div>
            <h3 className="text-sky-400 font-bold mb-3 border-b border-neutral-800 pb-1">General</h3>
            <ul className="space-y-2 text-sm text-neutral-300">
              <li className="flex justify-between"><span>Command Palette</span> <kbd className="bg-neutral-800 px-1 rounded">Cmd+K</kbd></li>
              <li className="flex justify-between"><span>Save Snapshot</span> <kbd className="bg-neutral-800 px-1 rounded">Cmd+S</kbd></li>
              <li className="flex justify-between"><span>Undo</span> <kbd className="bg-neutral-800 px-1 rounded">Cmd+Z</kbd></li>
              <li className="flex justify-between"><span>Redo</span> <kbd className="bg-neutral-800 px-1 rounded">Cmd+Shift+Z</kbd></li>
              <li className="flex justify-between"><span>Toggle 2D/3D</span> <kbd className="bg-neutral-800 px-1 rounded">Tab</kbd></li>
            </ul>
          </div>
          <div>
            <h3 className="text-emerald-400 font-bold mb-3 border-b border-neutral-800 pb-1">Editing</h3>
            <ul className="space-y-2 text-sm text-neutral-300">
              <li className="flex justify-between"><span>Select Mode</span> <kbd className="bg-neutral-800 px-1 rounded">V</kbd></li>
              <li className="flex justify-between"><span>Draw Wall</span> <kbd className="bg-neutral-800 px-1 rounded">W</kbd></li>
              <li className="flex justify-between"><span>Delete</span> <kbd className="bg-neutral-800 px-1 rounded">Backspace</kbd></li>
              <li className="flex justify-between"><span>Duplicate</span> <kbd className="bg-neutral-800 px-1 rounded">Shift+D</kbd></li>
              <li className="flex justify-between"><span>Multi-select</span> <kbd className="bg-neutral-800 px-1 rounded">Hold Shift</kbd></li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
};
