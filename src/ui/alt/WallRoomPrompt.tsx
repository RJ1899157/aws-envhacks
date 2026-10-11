import React, { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { Check, X } from 'lucide-react';
import { getCatalogAsset } from '../../core/catalog';
import { polygonBounds } from '../../core/parser';
import { useSceneStore } from '../../store/sceneStore';
import { useAltStore } from './altStore';
import { altLabel } from './altCatalog';

/**
 * Before placing a door, window or wall device in a house with several rooms: which room is it for?
 * A small floor plan of the rooms to click (or the list under it). The chosen room becomes the
 * active one, the view frames it, and placement starts on its walls only.
 */

/** Event asking the 3D view to frame one room (handled by the canvas camera). */
export const FRAME_ROOM_EVENT = 'airforce:frame-room';

const PLAN_W = 440;
const PLAN_H = 260;
const PAD = 14;

export const WallRoomPrompt: React.FC<{ onChosen: (assetId: string) => void }> = ({ onChosen }) => {
  const prompt = useAltStore((s) => s.roomPrompt);
  const room = useSceneStore((s) => s.room);
  const otherRooms = useSceneStore((s) => s.otherRooms);
  const [hover, setHover] = useState<string | null>(null);
  const rooms = useMemo(() => [room, ...otherRooms], [room, otherRooms]);

  const plan = useMemo(() => {
    const b = rooms.map((r) => polygonBounds(r.outline));
    const minX = Math.min(...b.map((x) => x.min[0]));
    const minZ = Math.min(...b.map((x) => x.min[1]));
    const w = Math.max(...b.map((x) => x.max[0])) - minX;
    const d = Math.max(...b.map((x) => x.max[1])) - minZ;
    const k = Math.min((PLAN_W - 2 * PAD) / Math.max(w, 1), (PLAN_H - 2 * PAD) / Math.max(d, 1));
    const ox = (PLAN_W - w * k) / 2;
    const oz = (PLAN_H - d * k) / 2;
    const at = (x: number, z: number): [number, number] => [ox + (x - minX) * k, oz + (z - minZ) * k];
    return rooms.map((r, i) => {
      const pts = r.outline.map(([x, z]) => at(x, z));
      const c = at((b[i]!.min[0] + b[i]!.max[0]) / 2, (b[i]!.min[1] + b[i]!.max[1]) / 2);
      return { id: r.id ?? '', name: r.name, points: pts.map((p) => p.join(',')).join(' '), cx: c[0], cy: c[1] };
    });
  }, [rooms]);

  const close = () => useAltStore.getState().setRoomPrompt(null);
  useEffect(() => {
    if (!prompt) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && close();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [prompt]);

  if (!prompt) return null;
  const what = altLabel(prompt.assetId, getCatalogAsset(prompt.assetId)?.label ?? 'item').toLowerCase();
  const choose = (id: string) => {
    if (!id) return;
    useSceneStore.getState().setActiveRoom(id);
    close();
    window.dispatchEvent(new CustomEvent(FRAME_ROOM_EVENT, { detail: id }));
    onChosen(prompt.assetId);
  };

  return createPortal(
    <div className="fixed inset-0 bg-neutral-950/70 backdrop-blur-sm flex items-center justify-center p-4" style={{ zIndex: 16777300 }} onClick={close} data-testid="alt-wall-room-prompt">
      <div className="relative w-[500px] max-w-full rounded-[16px] bg-neutral-900 border border-white/10 shadow-2xl p-5 text-neutral-200" onClick={(e) => e.stopPropagation()}>
        <button type="button" aria-label="Close" onClick={close} className="absolute top-3.5 right-3.5 p-1.5 rounded-[8px] text-neutral-400 hover:text-white hover:bg-white/10">
          <X size={17} />
        </button>
        <h2 className="text-[17px] font-semibold text-white">Which room is this {what} for?</h2>
        <p className="text-[12px] text-neutral-400 mt-0.5 mb-3">Click the room. You'll then place it on one of that room's walls; a wall shared with the next room connects the two.</p>

        <svg viewBox={`0 0 ${PLAN_W} ${PLAN_H}`} className="w-full h-auto rounded-[10px] bg-black/30 border border-white/10" role="group" aria-label="Floor plan">
          {plan.map((r) => {
            const selected = r.id === room.id;
            const hot = hover === r.id;
            return (
              <g key={r.id} className="cursor-pointer" onClick={() => choose(r.id)} onMouseEnter={() => setHover(r.id)} onMouseLeave={() => setHover(null)} data-testid={`alt-wall-room-${r.name}`}>
                <polygon
                  points={r.points}
                  fill={hot ? 'rgba(99,102,241,0.45)' : selected ? 'rgba(99,102,241,0.22)' : 'rgba(255,255,255,0.06)'}
                  stroke={hot || selected ? '#818cf8' : 'rgba(255,255,255,0.35)'}
                  strokeWidth={hot || selected ? 2.5 : 1.5}
                />
                <text x={r.cx} y={r.cy} textAnchor="middle" dominantBaseline="middle" className="select-none" fill="#fff" fontSize={12} fontWeight={600}>
                  {r.name}
                </text>
              </g>
            );
          })}
        </svg>

        <div className="mt-3 flex flex-wrap gap-1.5">
          {[...rooms]
            .sort((a, b) => a.name.localeCompare(b.name))
            .map((r) => (
              <button
                key={r.id}
                type="button"
                onClick={() => choose(r.id ?? '')}
                onMouseEnter={() => setHover(r.id ?? null)}
                onMouseLeave={() => setHover(null)}
                className={`px-2.5 py-1 rounded-full text-[12px] border flex items-center gap-1 ${
                  r.id === room.id ? 'border-indigo-400 bg-indigo-500/20 text-white' : 'border-white/10 bg-white/[0.04] text-neutral-200 hover:bg-white/[0.08]'
                }`}
              >
                {r.id === room.id && <Check size={12} />}
                {r.name}
              </button>
            ))}
        </div>
      </div>
    </div>,
    document.body
  );
};
