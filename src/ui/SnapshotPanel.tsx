import React, { useEffect, useState } from 'react';
import { useSnapshotStore } from '../store/snapshotStore';

export const SnapshotPanel: React.FC = () => {
  const [collapsed, setCollapsed] = useState(true);
  const [snapName, setSnapName] = useState('');
  const { snapshots, isLoading, loadSnapshots, saveSnapshot, restoreSnapshot, deleteSnapshot } = useSnapshotStore();

  useEffect(() => {
    loadSnapshots();
  }, [loadSnapshots]);

  if (collapsed) {
    return (
      <div className="absolute right-4 top-40 bg-neutral-900/90 text-white p-2 rounded cursor-pointer z-50 border border-neutral-700" onClick={() => setCollapsed(false)}>
        📸 Snapshots
      </div>
    );
  }

  return (
    <div className="absolute right-4 top-40 w-64 bg-neutral-900/95 border border-neutral-700/60 rounded-xl shadow-2xl z-50 flex flex-col text-sm text-neutral-300 overflow-hidden select-none max-h-[50vh]">
      <div className="flex justify-between items-center p-3 border-b border-neutral-800 bg-neutral-950">
        <h3 className="font-bold text-white">Snapshots</h3>
        <button onClick={() => setCollapsed(true)} className="text-neutral-500 hover:text-white">➖</button>
      </div>
      <div className="p-3 flex gap-2 border-b border-neutral-800">
        <input 
          type="text" 
          value={snapName} 
          onChange={e => setSnapName(e.target.value)} 
          placeholder="Snapshot name..." 
          className="flex-1 bg-neutral-800 rounded px-2 outline-none text-white border border-neutral-700"
        />
        <button 
          onClick={() => { if(snapName) { saveSnapshot(snapName); setSnapName(''); } }}
          className="bg-sky-600 hover:bg-sky-500 text-white px-2 py-1 rounded"
        >Save</button>
      </div>
      <div className="overflow-y-auto flex-1 p-2 space-y-2 text-xs">
        {isLoading && <div className="text-center text-neutral-500">Loading...</div>}
        {!isLoading && snapshots.length === 0 && <div className="text-center text-neutral-500">No snapshots saved</div>}
        {snapshots.map(snap => (
          <div key={snap.id} className="p-2 bg-neutral-800 rounded flex flex-col gap-1">
            <div className="flex justify-between font-bold">
              <span>{snap.name}</span>
              <button onClick={() => deleteSnapshot(snap.id)} className="text-red-400 hover:text-red-300">✕</button>
            </div>
            <div className="text-neutral-500 text-[10px]">
              {new Date(snap.timestamp).toLocaleString()}
            </div>
            <button 
              onClick={() => { if(confirm('Restore this snapshot? Current unsaved changes will be lost.')) restoreSnapshot(snap.id); }}
              className="mt-1 bg-neutral-700 hover:bg-neutral-600 text-white py-1 rounded w-full text-center"
            >Restore</button>
          </div>
        ))}
      </div>
    </div>
  );
};
