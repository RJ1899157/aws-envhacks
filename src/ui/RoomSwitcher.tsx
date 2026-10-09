import React, { useEffect, useRef, useState } from 'react';
import { ChevronDown, Plus, Trash2 } from 'lucide-react';
import { ROOM_TYPES, ROOM_TYPE_ORDER, roomTypeOf } from '../core/rooms';
import type { RoomType } from '../core/schema';
import { useSceneStore } from '../store/sceneStore';
import { useUiStore } from '../store/uiStore';

/** Toolbar dropdown: rename/retype the active room, switch between rooms, add or delete rooms. */
export const RoomSwitcher: React.FC = () => {
  const room = useSceneStore((state) => state.room);
  const otherRooms = useSceneStore((state) => state.otherRooms);
  const setActiveRoom = useSceneStore((state) => state.setActiveRoom);
  const removeRoom = useSceneStore((state) => state.removeRoom);
  const setRoomName = useSceneStore((state) => state.setRoomName);
  const setRoomType = useSceneStore((state) => state.setRoomType);

  const [open, setOpen] = useState(false);
  const [draftName, setDraftName] = useState(room.name);
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => setDraftName(room.name), [room.name]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener('pointerdown', onDown);
    return () => window.removeEventListener('pointerdown', onDown);
  }, [open]);

  const commitName = () => {
    const name = draftName.trim();
    if (name && name !== room.name) setRoomName(name);
    else setDraftName(room.name);
  };

  const allRooms = [room, ...otherRooms];
  const type = roomTypeOf(room);



  return (
    <div className="relative" ref={panelRef}>
      <button
        type="button"
        data-testid="room-switcher-btn"
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-1.5 px-2 py-1 rounded-[6px] hover:bg-white/5 border border-transparent hover:border-white/10 text-neutral-300 hover:text-white transition-colors text-xs font-medium max-w-[220px]"
        title="Rooms"
      >
        <span className="truncate">{room.name}</span>
        {allRooms.length > 1 && (
          <span className="rounded bg-white/10 px-1 text-[10px] text-neutral-400">{allRooms.length}</span>
        )}
        <ChevronDown size={13} className="shrink-0 text-neutral-500" />
      </button>

      {open && (
        <div
          data-testid="room-switcher-panel"
          className="absolute left-0 top-full z-50 mt-1.5 w-64 rounded-[10px] border border-white/10 bg-neutral-900/95 p-2 text-xs text-neutral-200 shadow-2xl backdrop-blur"
        >
          {/* Active room */}
          <div className="flex items-center gap-1.5 p-1">
            <input
              value={draftName}
              onChange={(e) => setDraftName(e.target.value)}
              onBlur={commitName}
              onKeyDown={(e) => {
                if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
                if (e.key === 'Escape') setDraftName(room.name);
              }}
              aria-label="Room name"
              className="min-w-0 flex-1 rounded border border-white/10 bg-black/30 px-2 py-1 text-xs text-white outline-none focus:border-indigo-500"
            />
            <select
              value={type}
              onChange={(e) => setRoomType(e.target.value as RoomType)}
              aria-label="Room type"
              className="rounded border border-white/10 bg-black/30 px-1 py-1 text-[11px] text-neutral-200"
            >
              {ROOM_TYPE_ORDER.map((t) => (
                <option key={t} value={t}>
                  {ROOM_TYPES[t].label}
                </option>
              ))}
            </select>
          </div>

          {/* Room list */}
          {allRooms.length > 1 && (
            <div className="mt-1 border-t border-white/10 pt-1">
              {allRooms.map((r) => {
                const isActive = r.id === room.id;
                return (
                  <div
                    key={r.id}
                    className={`group flex items-center rounded px-2 py-1 ${isActive ? 'bg-indigo-500/15 text-white' : 'hover:bg-white/5'}`}
                  >
                    <button
                      type="button"
                      className="flex flex-1 items-center gap-2 truncate text-left"
                      onClick={() => {
                        if (r.id) setActiveRoom(r.id);
                        useUiStore.getState().setSelectedWallIndex(null);
                        setOpen(false);
                      }}
                    >
                      <span className={`h-1.5 w-1.5 rounded-full ${isActive ? 'bg-indigo-400' : 'bg-neutral-600'}`} />
                      <span className="truncate">{r.name}</span>
                      <span className="text-[10px] text-neutral-500">{ROOM_TYPES[roomTypeOf(r)].label}</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => r.id && removeRoom(r.id)}
                      className="ml-1 rounded p-0.5 text-neutral-500 opacity-0 hover:text-red-400 group-hover:opacity-100"
                      title={`Delete ${r.name}`}
                    >
                      <Trash2 size={12} />
                    </button>
                  </div>
                );
              })}
            </div>
          )}

          {/* Add room: opens the Rooms panel in the library */}
          <div className="mt-1 border-t border-white/10 pt-2">
            <button
              type="button"
              data-testid="add-room-btn"
              onClick={() => {
                window.dispatchEvent(new Event('airforce:open-rooms'));
                setOpen(false);
              }}
              className="flex w-full items-center justify-center gap-1.5 rounded border border-white/10 px-2 py-1.5 text-xs hover:border-indigo-500 hover:bg-indigo-500/10"
            >
              <Plus size={13} /> Add room
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
