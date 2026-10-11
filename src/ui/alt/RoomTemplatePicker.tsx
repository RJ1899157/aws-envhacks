import React, { Suspense, useEffect, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { Canvas } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import { Square, Sofa, X } from 'lucide-react';
import type { RoomType, Vec2 } from '../../core/schema';
import { ROOM_TYPES } from '../../core/rooms';
import { buildPresetObjects } from '../../core/roomPresets';
import { AssetMesh } from '../../builder/AssetMesh';

/**
 * Picking a room to add: a box with two small turning 3D previews, the room furnished from its
 * template or empty, and the user chooses one before placing it.
 */

const WALL_H = 1.1;
const WALL_T = 0.1;

const RoomPreview: React.FC<{ type: RoomType; furnished: boolean }> = ({ type, furnished }) => {
  const [w, d] = ROOM_TYPES[type].size;
  const outline: Vec2[] = useMemo(
    () => [
      [-w / 2, -d / 2],
      [w / 2, -d / 2],
      [w / 2, d / 2],
      [-w / 2, d / 2],
    ],
    [w, d]
  );
  const objects = useMemo(() => (furnished ? buildPresetObjects(type, outline, false) : []), [furnished, type, outline]);
  const span = Math.max(w, d);
  // Low cut-away walls so the inside stays visible from any side
  const walls: { pos: [number, number, number]; size: [number, number, number] }[] = [
    { pos: [0, WALL_H / 2, -d / 2], size: [w + WALL_T, WALL_H, WALL_T] },
    { pos: [0, WALL_H / 2, d / 2], size: [w + WALL_T, WALL_H, WALL_T] },
    { pos: [-w / 2, WALL_H / 2, 0], size: [WALL_T, WALL_H, d] },
    { pos: [w / 2, WALL_H / 2, 0], size: [WALL_T, WALL_H, d] },
  ];
  return (
    <Canvas camera={{ position: [span * 1.1, span * 1.15, span * 1.1], fov: 40 }} dpr={[1, 2]} gl={{ antialias: true }}>
      <ambientLight intensity={0.75} />
      <directionalLight position={[4, 8, 5]} intensity={1.1} />
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.001, 0]}>
        <planeGeometry args={[w, d]} />
        <meshStandardMaterial color="#c9a27a" />
      </mesh>
      {walls.map((wl, i) => (
        <mesh key={i} position={wl.pos}>
          <boxGeometry args={wl.size} />
          <meshStandardMaterial color="#e5e7eb" transparent opacity={0.85} />
        </mesh>
      ))}
      <Suspense fallback={null}>
        {objects.map((o) => (
          <AssetMesh key={o.id} object={o} />
        ))}
      </Suspense>
      <OrbitControls enablePan={false} enableZoom={false} autoRotate autoRotateSpeed={1.2} target={[0, 0.4, 0]} minPolarAngle={0.5} maxPolarAngle={1.2} />
    </Canvas>
  );
};

export const RoomTemplatePicker: React.FC<{ type: RoomType; onPick: (furnished: boolean) => void; onClose: () => void }> = ({ type, onPick, onClose }) => {
  const label = ROOM_TYPES[type].label;
  const [w, d] = ROOM_TYPES[type].size;
  const items = useMemo(() => {
    const names = buildPresetObjects(type, [[0, 0], [w, 0], [w, d], [0, d]], false).map((o) => o.name);
    return [...new Set(names)];
  }, [type, w, d]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const option = (furnished: boolean) => (
    <button
      type="button"
      onClick={() => onPick(furnished)}
      data-testid={furnished ? 'alt-room-template-furnished' : 'alt-room-template-empty'}
      className="group flex-1 min-w-[220px] text-left rounded-[12px] border border-white/10 bg-white/[0.04] hover:border-indigo-400/70 hover:bg-indigo-500/10 transition-colors overflow-hidden flex flex-col"
    >
      <div className="h-[180px] bg-gradient-to-b from-neutral-800 to-neutral-900">
        <RoomPreview type={type} furnished={furnished} />
      </div>
      <div className="p-3 flex flex-col gap-1">
        <span className="flex items-center gap-1.5 text-[13px] font-semibold text-white">
          {furnished ? <Sofa size={14} className="text-indigo-300" /> : <Square size={14} className="text-indigo-300" />}
          {furnished ? 'With furniture' : 'Empty room'}
        </span>
        <span className="text-[11px] text-neutral-400 leading-snug">
          {furnished ? (items.length > 0 ? items.join(', ') : 'The usual furniture for this room') : 'Just the walls: add your own furniture in the Furniture step.'}
        </span>
      </div>
    </button>
  );

  // On <body>: the side panel it is opened from would otherwise contain it (its backdrop filter makes
  // it the containing block of fixed elements). Above the 3D view's HTML labels (drei's z-index range).
  return createPortal(
    <div className="fixed inset-0 bg-neutral-950/70 backdrop-blur-sm flex items-center justify-center p-4" style={{ zIndex: 16777300 }} onClick={onClose} data-testid="alt-room-template">
      <div className="relative w-[600px] max-w-full rounded-[16px] bg-neutral-900 border border-white/10 shadow-2xl p-5 text-neutral-200" onClick={(e) => e.stopPropagation()}>
        <button type="button" aria-label="Close" onClick={onClose} className="absolute top-3.5 right-3.5 p-1.5 rounded-[8px] text-neutral-400 hover:text-white hover:bg-white/10">
          <X size={17} />
        </button>
        <h2 className="text-[17px] font-semibold text-white">Add a {label.toLowerCase()}</h2>
        <p className="text-[12px] text-neutral-400 mt-0.5 mb-4">
          {w} × {d} m. Start from the furnished template or an empty room; you can resize it and change anything later.
        </p>
        <div className="flex flex-wrap gap-3">
          {option(true)}
          {option(false)}
        </div>
      </div>
    </div>,
    document.body
  );
};
