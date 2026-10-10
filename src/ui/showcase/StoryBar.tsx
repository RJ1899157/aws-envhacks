import React from 'react';
import { ArrowRight, Columns2, Copy, Loader2, LogOut, Sparkles, Zap } from 'lucide-react';
import { storyById } from '../../showcase/stories';
import { useShowcaseStore } from '../../store/showcaseStore';
import { useScenarioStore } from '../../store/scenarioStore';

/** While an example is open: its title and lesson, "See the fix", "Next story", "Make a copy to edit", "Exit example". */
export const StoryBar: React.FC = () => {
  const active = useShowcaseStore((s) => s.active);
  const comparing = useScenarioStore((s) => s.compare !== null);
  const st = useShowcaseStore.getState;
  const story = active ? storyById(active.storyId) : undefined;
  if (!active || !story) return null;
  return (
    <div className="absolute top-14 left-1/2 -translate-x-1/2 z-[17] pointer-events-none w-[min(860px,calc(100%-640px))] min-w-[520px]">
      <div data-testid="story-bar" className="pointer-events-auto px-3 py-1.5 rounded-[10px] bg-indigo-950/95 border border-indigo-400/40 shadow-2xl backdrop-blur-md flex items-center gap-3 text-neutral-200">
        <Sparkles size={15} className="text-indigo-300 shrink-0" />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="text-[12.5px] font-semibold text-white truncate">{story.title}</span>
            {active.source === 'precomputed' && (
              <span className="shrink-0 flex items-center gap-0.5 text-[9.5px] text-emerald-300" data-testid="story-precomputed" title={active.openMs !== null ? `Loaded in ${Math.round(active.openMs)} ms` : undefined}>
                <Zap size={10} /> instant results
              </span>
            )}
            {active.source === null && <Loader2 size={11} className="animate-spin text-neutral-400" />}
          </div>
          <div className="text-[10.5px] text-indigo-100/80 truncate" title={story.shows}>
            {story.shows}
          </div>
        </div>
        <button type="button" disabled={comparing} onClick={() => st().seeFix()} className="shrink-0 px-2 py-1 rounded-[7px] bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white text-[11px] font-semibold flex items-center gap-1" data-testid="story-see-fix">
          <Columns2 size={12} /> See the fix
        </button>
        <button type="button" onClick={() => void st().nextStory()} className="shrink-0 px-2 py-1 rounded-[7px] bg-white/10 hover:bg-white/15 text-[11px] flex items-center gap-1" data-testid="story-next">
          Next story <ArrowRight size={12} />
        </button>
        <button type="button" onClick={() => st().makeCopy()} className="shrink-0 px-2 py-1 rounded-[7px] bg-white/10 hover:bg-white/15 text-[11px] flex items-center gap-1" title="Keep this example as your own design (undoable)" data-testid="story-copy">
          <Copy size={12} /> Make a copy to edit
        </button>
        <button type="button" onClick={() => st().exit()} className="shrink-0 px-2 py-1 rounded-[7px] bg-white/10 hover:bg-white/15 text-[11px] flex items-center gap-1" data-testid="story-exit">
          <LogOut size={12} /> Exit example
        </button>
      </div>
    </div>
  );
};
