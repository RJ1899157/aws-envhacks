import React, { useMemo } from 'react';
import { Html } from '@react-three/drei';
import type { ThreeEvent } from '@react-three/fiber';
import { polygonBounds } from '../core/parser';
import { ROOM_TYPES, roomTypeOf } from '../core/rooms';
import type { Room } from '../core/schema';
import { useSceneStore } from '../store/sceneStore';
import { useSimulationStore } from '../store/simulationStore';
import { useUiStore } from '../store/uiStore';
import { AssetMesh } from './AssetMesh';
import { RoomShell } from './RoomShell';

const InactiveRoom: React.FC<{ room: Room }> = ({ room }) => {
  const setActiveRoom = useSceneStore((state) => state.setActiveRoom);
  const activate = useMemo(() => () => room.id && setActiveRoom(room.id), [room.id, setActiveRoom]);
  const simChips = useSimulationStore((s) => s.viz.show && s.viz.roomLabels && s.result !== null);

  const center = useMemo(() => {
    const b = polygonBounds(room.outline);
    return [(b.min[0] + b.max[0]) / 2, (b.min[1] + b.max[1]) / 2] as const;
  }, [room.outline]);

  const typeLabel = ROOM_TYPES[roomTypeOf(room)].label;

  const onObjectClick = (e: ThreeEvent<MouseEvent>) => {
    const { toolMode } = useUiStore.getState();
    if (e.delta > 4 || toolMode === 'place' || toolMode === 'opening') return;
    e.stopPropagation();
    activate();
  };

  return (
    <group name={`inactive-room-${room.id}`}>
      <RoomShell room={room} interactive={false} onActivate={activate} />

      <group onClick={onObjectClick}>
        {room.objects.map((obj) => (
          <AssetMesh key={obj.id} object={obj} />
        ))}
      </group>

      {/* While the simulation's room chips are up they replace this name pill */}
      {!simChips && (
      <Html center position={[center[0], 0.05, center[1]]} className="select-none" zIndexRange={[20, 0]}>
        <button
          type="button"
          onClick={activate}
          className="whitespace-nowrap rounded-full border border-white/15 bg-neutral-900/80 px-2.5 py-1 text-[11px] font-medium text-neutral-200 shadow backdrop-blur-sm hover:border-indigo-400 hover:text-white"
          title="Click to edit this room"
        >
          {room.name}
          {roomTypeOf(room) !== 'basic' && !room.name.startsWith(typeLabel) && <span className="ml-1.5 text-neutral-500">{typeLabel}</span>}
        </button>
      </Html>
      )}
    </group>
  );
};

/** Every room of the floor plan except the active one, drawn read-only; clicking one activates it. */
export const InactiveRooms: React.FC = () => {
  const otherRooms = useSceneStore((state) => state.otherRooms);
  return (
    <>
      {otherRooms.map((room) => (
        <InactiveRoom key={room.id} room={room} />
      ))}
    </>
  );
};
