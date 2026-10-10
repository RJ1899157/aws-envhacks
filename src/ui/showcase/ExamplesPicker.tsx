import React, { useEffect, useState } from 'react';
import { Sparkles, X } from 'lucide-react';
import { STORIES } from '../../showcase/stories';
import { SHOWCASE_DIR } from '../../showcase/precomputed';
import { useShowcaseStore } from '../../store/showcaseStore';

/** Opens the example picker from anywhere (toolbar, first-use card, empty state). */
export function openExamples(): void {
  window.dispatchEvent(new CustomEvent('airforce:open-examples'));
}

const BASE = (import.meta as { env?: { BASE_URL?: string } }).env?.BASE_URL ?? '/';

const Thumb: React.FC<{ id: string; title: string }> = ({ id, title }) => {
  const [failed, setFailed] = useState(false);
  return failed ? (
    <div className="w-full aspect-[16/10] rounded-[8px] bg-gradient-to-br from-indigo-900/70 via-neutral-900 to-fuchsia-900/50 flex items-center justify-center text-neutral-500">
      <Sparkles size={22} />
    </div>
  ) : (
    <img src={`${BASE}${SHOWCASE_DIR}/${id}/thumb.jpg`} alt={title} onError={() => setFailed(true)} className="w-full aspect-[16/10] object-cover rounded-[8px] border border-white/10 bg-neutral-950" />
  );
};

/** The four example stories: title, subtitle, thumbnail and Open. */
export const ExamplesPicker: React.FC = () => {
  const open = useShowcaseStore((s) => s.pickerOpen);
  const setOpen = useShowcaseStore((s) => s.setPickerOpen);
  const openStory = useShowcaseStore((s) => s.openStory);
  useEffect(() => {
    const show = () => setOpen(true);
    window.addEventListener('airforce:open-examples', show);
    return () => window.removeEventListener('airforce:open-examples', show);
  }, [setOpen]);
  useEffect(() => {
    if (!open) return;
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    window.addEventListener('keydown', esc);
    return () => window.removeEventListener('keydown', esc);
  }, [open, setOpen]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[60] bg-black/60 backdrop-blur-sm flex items-center justify-center p-4" onClick={() => setOpen(false)} data-testid="examples-picker">
      <div role="dialog" aria-label="Example stories" className="w-[760px] max-w-full max-h-full overflow-y-auto p-4 rounded-[14px] bg-neutral-900 border border-white/10 shadow-2xl text-neutral-200" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start gap-3 mb-3">
          <div>
            <div className="text-[15px] font-semibold text-white flex items-center gap-1.5">
              <Sparkles size={15} className="text-indigo-300" /> Examples
            </div>
            <div className="text-[11.5px] text-neutral-400">
              A Delhi 2BHK flat with ready-made results. Opens as a separate example; your own design stays as it is.
            </div>
          </div>
          <button type="button" aria-label="Close" onClick={() => setOpen(false)} className="ml-auto p-1 rounded hover:bg-white/10 text-neutral-400">
            <X size={15} />
          </button>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {STORIES.map((s, i) => (
            <div key={s.id} className="flex flex-col gap-2 p-2.5 rounded-[10px] bg-white/[0.03] border border-white/10" data-testid="example-card" data-story={s.id}>
              <Thumb id={s.id} title={s.title} />
              <div className="flex flex-col gap-0.5 min-h-[52px]">
                <span className="text-[12.5px] font-semibold text-white">
                  {i + 1}. {s.title}
                </span>
                <span className="text-[11px] text-neutral-400 leading-snug">{s.subtitle}</span>
              </div>
              <button type="button" onClick={() => void openStory(s.id)} className="self-start px-3 py-1 rounded-[7px] bg-indigo-600 hover:bg-indigo-500 text-white text-[12px] font-semibold" data-testid="example-open">
                Open
              </button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};
