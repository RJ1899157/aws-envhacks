import React, { useState } from 'react';
import { Building2, History, Sparkles, Upload, Wind, X } from 'lucide-react';
import { useBuildsStore } from '../../store/buildsStore';
import { BuildList, OpenFileButton } from './BuildsDialogs';
import { clearPreviousDesign, readPreviousDesign } from '../../store/resetSession';
import type { Room } from '../../core/schema';
import { useSceneStore } from '../../store/sceneStore';
import { createShowcaseHouse } from '../../showcase/house';
import { openRooms } from './buildActions';
import { useAltStore } from './altStore';
import { createSingleRoom } from './starterHouse';

function frameHouse(): void {
  window.setTimeout(() => window.dispatchEvent(new CustomEvent('airforce:simulation-view')), 120);
}

const Card: React.FC<{
  icon: React.ElementType;
  title: string;
  text: string;
  onClick: () => void;
  testId: string;
  accent?: boolean;
}> = ({ icon: Icon, title, text, onClick, testId, accent }) => (
  <button
    type="button"
    data-testid={testId}
    onClick={onClick}
    className={`flex-1 min-w-[180px] text-left p-4 rounded-[12px] border transition-colors flex flex-col gap-2 ${
      accent
        ? 'border-indigo-400/60 bg-indigo-500/15 hover:bg-indigo-500/25'
        : 'border-white/10 bg-white/[0.04] hover:bg-white/[0.08] hover:border-white/20'
    }`}
  >
    <Icon size={22} className={accent ? 'text-indigo-300' : 'text-neutral-300'} />
    <span className="text-[14px] font-semibold text-white">{title}</span>
    <span className="text-[12px] text-neutral-400 leading-snug">{text}</span>
  </button>
);

/**
 * After the landing: create your own house (straight into the Rooms step with one basic room to
 * build from) or open the ready-made example flat; also a previous design, saved builds or a file.
 */
export const StartScreen: React.FC = () => {
  const startDesign = useAltStore((s) => s.startDesign);

  const load = (rooms: Room[]) => {
    useSceneStore.getState().loadRoom(rooms[0]!, rooms.slice(1));
    useSceneStore.temporal.getState().clear();
    frameHouse();
  };

  // A design saved by the old editor, offered once so nobody loses earlier work
  const [previous] = useState(readPreviousDesign);
  const savedCount = useBuildsStore((s) => s.builds.length);

  return (
    <div
      className="fixed inset-0 z-[40] bg-neutral-950/75 backdrop-blur-sm flex items-center justify-center p-4"
      data-testid="alt-start-screen"
    >
      <div className="relative w-[640px] max-w-full rounded-[16px] bg-neutral-900 border border-white/10 shadow-2xl p-6 text-neutral-200">
        <div className="flex items-center gap-2 mb-1">
          <Wind size={20} className="text-indigo-400" />
          <span className="text-[13px] font-semibold text-white">AirForce</span>
        </div>
        <button
          type="button"
          aria-label="Close"
          title="Back to the start page"
          onClick={() => useAltStore.getState().setIntro(true)}
          className="absolute top-4 right-4 p-1.5 rounded-[8px] text-neutral-400 hover:text-white hover:bg-white/10"
          data-testid="alt-start-close"
        >
          <X size={18} />
        </button>

        <h1 className="text-[22px] font-semibold text-white mt-2">
          How clean is the air in your home?
        </h1>
        <p className="text-[13px] text-neutral-400 mt-1 mb-5">
          Sketch your home, add windows, fans and things that pollute, then simulate how the air
          moves.
        </p>
        <div className="flex flex-wrap gap-3">
          <Card
            icon={Building2}
            title="Create your own house"
            text="Start with one room and add the rest of your home in the Rooms step."
            onClick={() => {
              load([createSingleRoom('basic')]);
              startDesign('house');
            }}
            testId="alt-start-create"
            accent
          />
          <Card
            icon={Sparkles}
            title="See an example"
            text="A ready-made 2BHK flat to explore, change and simulate."
            onClick={() => openRooms(createShowcaseHouse(), null)}
            testId="alt-start-example"
          />
        </div>
        {previous && (
          <button
            type="button"
            data-testid="alt-start-previous"
            onClick={() => {
              load([previous.room, ...previous.otherRooms]);
              clearPreviousDesign();
              startDesign(previous.otherRooms.length > 0 ? 'house' : 'room');
            }}
            className="mt-3 w-full flex items-center gap-2 px-3 py-2 rounded-[10px] border border-white/10 bg-white/[0.03] hover:bg-white/[0.07] text-left text-[12px] text-neutral-300"
          >
            <History size={14} className="text-indigo-300 shrink-0" />
            <span className="flex-1">
              Continue my previous design{' '}
              <span className="text-neutral-500">
                ({[previous.room, ...previous.otherRooms].length}{' '}
                {previous.otherRooms.length ? 'rooms' : 'room'})
              </span>
            </span>
          </button>
        )}
        <div
          className={`mt-5 pt-4 border-t border-white/10 ${savedCount === 0 ? 'hidden' : ''}`}
          data-testid="alt-start-builds"
        >
          <h2 className="text-[12px] font-semibold text-neutral-300 mb-2">My saved builds</h2>
          <BuildList limit={5} />
        </div>
        <OpenFileButton className="mt-3 flex items-center gap-1.5 text-[11.5px] text-neutral-400 hover:text-white">
          <Upload size={12} /> Open a build file…
        </OpenFileButton>
      </div>
    </div>
  );
};
