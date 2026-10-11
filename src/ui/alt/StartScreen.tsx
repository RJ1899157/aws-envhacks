import React, { useState } from 'react';
import { ArrowLeft, Building2, DoorOpen, History, Minus, Plus, Sparkles, Upload, Wind, X } from 'lucide-react';
import { useBuildsStore } from '../../store/buildsStore';
import { BuildList, OpenFileButton } from './BuildsDialogs';
import { clearPreviousDesign, readPreviousDesign } from '../../store/resetSession';
import type { RoomType } from '../../core/schema';
import { ROOM_TYPES } from '../../core/rooms';
import { useSceneStore } from '../../store/sceneStore';
import { createShowcaseHouse } from '../../showcase/house';
import { openRooms } from './buildActions';
import { useAltStore } from './altStore';
import { createSingleRoom, createStarterHouse, type HouseCounts } from './starterHouse';
import { AboutHomeCard } from './AboutHomeCard';

const SINGLE_TYPES: { type: RoomType; note: string }[] = [
  { type: 'bedroom', note: 'Sleeping air quality' },
  { type: 'living', note: 'Where the family spends the day' },
  { type: 'kitchen', note: 'Cooking smoke' },
  { type: 'bathroom', note: 'Exhaust and stale air' },
  { type: 'dining', note: '' },
  { type: 'basic', note: 'Any other room' },
];

const HOUSE_TYPES: (keyof HouseCounts)[] = ['living', 'kitchen', 'dining', 'bedroom', 'bathroom'];
const DEFAULT_COUNTS: Required<HouseCounts> = { living: 1, kitchen: 1, dining: 0, bedroom: 2, bathroom: 1 };

function frameHouse(): void {
  window.setTimeout(() => window.dispatchEvent(new CustomEvent('airforce:simulation-view')), 120);
}

const Card: React.FC<{ icon: React.ElementType; title: string; text: string; onClick: () => void; testId: string; accent?: boolean }> = ({
  icon: Icon,
  title,
  text,
  onClick,
  testId,
  accent,
}) => (
  <button
    type="button"
    data-testid={testId}
    onClick={onClick}
    className={`flex-1 min-w-[180px] text-left p-4 rounded-[12px] border transition-colors flex flex-col gap-2 ${
      accent ? 'border-indigo-400/60 bg-indigo-500/15 hover:bg-indigo-500/25' : 'border-white/10 bg-white/[0.04] hover:bg-white/[0.08] hover:border-white/20'
    }`}
  >
    <Icon size={22} className={accent ? 'text-indigo-300' : 'text-neutral-300'} />
    <span className="text-[14px] font-semibold text-white">{title}</span>
    <span className="text-[12px] text-neutral-400 leading-snug">{text}</span>
  </button>
);

/** First thing a new user sees: room, house or a ready-made example home (or their previous design). */
export const StartScreen: React.FC = () => {
  const [choice, setChoice] = useState<'none' | 'room' | 'house' | 'about'>('none');
  // What was picked before "About your home" (its Back returns there; Next starts designing it)
  const [picked, setPicked] = useState<'room' | 'house'>('room');
  const [counts, setCounts] = useState<Required<HouseCounts>>(DEFAULT_COUNTS);
  const startDesign = useAltStore((s) => s.startDesign);

  const load = (rooms: ReturnType<typeof createStarterHouse>) => {
    useSceneStore.getState().loadRoom(rooms[0]!, rooms.slice(1));
    useSceneStore.temporal.getState().clear();
    frameHouse();
  };

  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  // A design saved by the old editor, offered once so nobody loses earlier work
  const [previous] = useState(readPreviousDesign);
  const savedCount = useBuildsStore((s) => s.builds.length);

  return (
    <div className="fixed inset-0 z-[40] bg-neutral-950/75 backdrop-blur-sm flex items-center justify-center p-4" data-testid="alt-start-screen">
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

        {choice === 'none' && (
          <>
            <h1 className="text-[22px] font-semibold text-white mt-2">How clean is the air in your home?</h1>
            <p className="text-[13px] text-neutral-400 mt-1 mb-5">
              Sketch your space, add windows, fans and things that pollute, then simulate how the air moves.
            </p>
            <div className="flex flex-wrap gap-3">
              <Card icon={DoorOpen} title="A single room" text="Quickest: one bedroom, kitchen or living room." onClick={() => setChoice('room')} testId="alt-start-room" accent />
              <Card icon={Building2} title="My whole house" text="See how air moves between rooms." onClick={() => setChoice('house')} testId="alt-start-house" />
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
                  Continue my previous design <span className="text-neutral-500">({[previous.room, ...previous.otherRooms].length} {previous.otherRooms.length ? 'rooms' : 'room'})</span>
                </span>
              </button>
            )}
            <div className={`mt-5 pt-4 border-t border-white/10 ${savedCount === 0 ? 'hidden' : ''}`} data-testid="alt-start-builds">
              <h2 className="text-[12px] font-semibold text-neutral-300 mb-2">My saved builds</h2>
              <BuildList limit={5} />
            </div>
            <OpenFileButton className="mt-3 flex items-center gap-1.5 text-[11.5px] text-neutral-400 hover:text-white">
              <Upload size={12} /> Open a build file…
            </OpenFileButton>
          </>
        )}

        {choice === 'room' && (
          <>
            <button type="button" onClick={() => setChoice('none')} className="mt-2 text-[12px] text-neutral-400 hover:text-white flex items-center gap-1">
              <ArrowLeft size={13} /> Back
            </button>
            <h1 className="text-[20px] font-semibold text-white mt-2 mb-4">Which room?</h1>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
              {SINGLE_TYPES.map(({ type, note }) => (
                <button
                  key={type}
                  type="button"
                  data-testid={`alt-room-type-${type}`}
                  onClick={() => {
                    load([createSingleRoom(type)]);
                    setPicked('room');
                    setChoice('about');
                  }}
                  className="text-left p-3 rounded-[10px] border border-white/10 bg-white/[0.04] hover:bg-indigo-500/15 hover:border-indigo-400/60 transition-colors"
                >
                  <div className="text-[13px] font-semibold text-white">{type === 'basic' ? 'Other room' : ROOM_TYPES[type].label}</div>
                  <div className="text-[11px] text-neutral-400">
                    {ROOM_TYPES[type].size[0]} × {ROOM_TYPES[type].size[1]} m{note ? ` · ${note}` : ''}
                  </div>
                </button>
              ))}
            </div>
            <p className="text-[11px] text-neutral-500 mt-3">You can change the size later.</p>
          </>
        )}

        {choice === 'about' && (
          <div className="mt-3">
            <AboutHomeCard onBack={() => setChoice(picked)} onDone={() => startDesign(picked)} doneLabel="Start designing" />
          </div>
        )}

        {choice === 'house' && (
          <>
            <button type="button" onClick={() => setChoice('none')} className="mt-2 text-[12px] text-neutral-400 hover:text-white flex items-center gap-1">
              <ArrowLeft size={13} /> Back
            </button>
            <h1 className="text-[20px] font-semibold text-white mt-2">What rooms does it have?</h1>
            <p className="text-[12px] text-neutral-400 mt-1 mb-4">We'll lay them out with doors between them. You can move, resize or add rooms next.</p>
            <div className="flex flex-col gap-1.5">
              {HOUSE_TYPES.map((t) => (
                <div key={t} className="flex items-center justify-between px-3 py-2 rounded-[10px] bg-white/[0.04] border border-white/10">
                  <span className="text-[13px] text-white">{ROOM_TYPES[t].label}</span>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      aria-label={`Fewer ${ROOM_TYPES[t].label}`}
                      disabled={counts[t] === 0}
                      onClick={() => setCounts((c) => ({ ...c, [t]: Math.max(0, c[t] - 1) }))}
                      className="w-7 h-7 rounded-[6px] bg-white/10 hover:bg-white/15 disabled:opacity-30 flex items-center justify-center"
                    >
                      <Minus size={13} />
                    </button>
                    <span className="w-5 text-center tabular-nums text-[13px] text-white" data-testid={`alt-count-${t}`}>
                      {counts[t]}
                    </span>
                    <button
                      type="button"
                      aria-label={`More ${ROOM_TYPES[t].label}`}
                      disabled={counts[t] >= 4}
                      onClick={() => setCounts((c) => ({ ...c, [t]: Math.min(4, c[t] + 1) }))}
                      className="w-7 h-7 rounded-[6px] bg-white/10 hover:bg-white/15 disabled:opacity-30 flex items-center justify-center"
                    >
                      <Plus size={13} />
                    </button>
                  </div>
                </div>
              ))}
            </div>
            <button
              type="button"
              data-testid="alt-create-house"
              disabled={total === 0}
              onClick={() => {
                load(createStarterHouse(counts));
                setPicked('house');
                setChoice('about');
              }}
              className="mt-4 w-full py-2.5 rounded-[10px] bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 text-white text-[13px] font-semibold"
            >
              Create my house ({total} {total === 1 ? 'room' : 'rooms'})
            </button>
          </>
        )}
      </div>
    </div>
  );
};
