import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { ExplanationEntry } from '../services/explain';
import type { SimulationState } from '../store/simulationStore';
import { LiveOutdoorCaption, LiveOutdoorChip } from './alt/LiveOutdoor';
import { WhyDetails } from './simulation/SuggestedActions';

const env = vi.hoisted(() => ({ url: null as string | null }));
vi.mock('../config', () => ({
  get apiBaseUrl() {
    return env.url;
  },
}));

const r = { facts: ['outdoor 250 > indoor 245 µg/m³ (Bedroom 1)'], roomDeltas: [{ roomId: 'b', name: 'Bedroom 1', before: 246.4, after: 189.2, delta: -57.2, fraction: -0.23 }] };

describe('backend features are gated on apiBaseUrl', () => {
  const done: ExplanationEntry = { status: 'done', text: 'The purifier cleans the bedroom air.' };
  const lookup: SimulationState['outdoorLookup'] = { status: 'done', reading: { pm25UgM3: 143, source: 'live', provider: 'open-meteo', observedAt: '2026-10-11T07:00' }, place: 'Delhi', weather: null };

  it('without a backend: no Live chip, no caption, no AI text; facts still shown', () => {
    env.url = null;
    expect(renderToStaticMarkup(<LiveOutdoorChip selected={false} loading={false} apply={() => {}} />)).toBe('');
    expect(renderToStaticMarkup(<LiveOutdoorCaption lookup={lookup} liveSelected />)).toBe('');
    const why = renderToStaticMarkup(<WhyDetails r={r} entry={done} />);
    expect(why).toContain('outdoor 250 &gt; indoor 245');
    expect(why).toContain('Bedroom 1: 246 → 189 µg/m³');
    expect(why).not.toContain('AI explanation');
    expect(why).not.toContain('The purifier');
  });

  it('with a backend: all of them render', () => {
    env.url = 'https://api.test';
    expect(renderToStaticMarkup(<LiveOutdoorChip selected loading={false} apply={() => {}} />)).toContain('Live');
    expect(renderToStaticMarkup(<LiveOutdoorCaption lookup={lookup} liveSelected />)).toContain('Live · Delhi');
    const why = renderToStaticMarkup(<WhyDetails r={r} entry={done} />);
    expect(why).toContain('The purifier cleans the bedroom air.');
    expect(why).toContain('AI explanation · numbers from the simulation');
  });

  it('shows "Explaining…" while the request runs', () => {
    env.url = 'https://api.test';
    expect(renderToStaticMarkup(<WhyDetails r={r} entry={{ status: 'loading' }} />)).toContain('Explaining…');
  });
});
