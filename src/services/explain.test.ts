import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { RankedAction } from '../simulation/scenarios/rank';
import { buildExplainPayload, payloadKey, requestExplanation, setExplainFn, useExplainStore } from './explain';

const action: Pick<RankedAction, 'texts' | 'effort' | 'before' | 'after' | 'fraction' | 'roomDeltas' | 'facts' | 'verified'> = {
  texts: ['Add an air purifier (300 m³/h) to Bedroom 1', 'Close the north window in Bedroom 1'],
  effort: 'Purchase',
  before: 244.6371,
  after: 189.0449,
  fraction: -0.22724,
  roomDeltas: [{ roomId: 'r1', name: 'Bedroom 1', before: 244.6371, after: 189.0449, delta: -55.59, fraction: -0.2272 }],
  facts: ['outdoor 250 > indoor 245 µg/m³ (Bedroom 1)'],
  verified: 'verified',
};

describe('buildExplainPayload', () => {
  it('matches the /explain contract exactly, numbers rounded to 1 decimal', () => {
    expect(buildExplainPayload(action, 'Bedroom 1', 250.04)).toEqual({
      objective: 'Bedroom 1',
      action: {
        texts: action.texts,
        effort: 'Purchase',
        before: 244.6,
        after: 189,
        fraction: -0.227, // its percentage (22.7 %) to 1 decimal
        roomDeltas: [{ name: 'Bedroom 1', before: 244.6, after: 189 }],
        facts: action.facts,
        verified: 'verified',
      },
      outdoorPm25: 250,
    });
  });

  it('keeps within the backend limits', () => {
    const p = buildExplainPayload({ ...action, facts: Array.from({ length: 30 }, (_, i) => `fact ${i} `.repeat(50)) }, 'x'.repeat(200), 35);
    expect(p.action.facts).toHaveLength(20);
    expect(p.action.facts.every((f) => f.length <= 300)).toBe(true);
    expect(p.objective.length).toBeLessThanOrEqual(80);
  });

  it('gives equal payloads equal keys', () => {
    expect(payloadKey(buildExplainPayload(action, 'Whole house', 35))).toBe(payloadKey(buildExplainPayload({ ...action, before: 244.61 }, 'Whole house', 35)));
    expect(payloadKey(buildExplainPayload(action, 'Whole house', 35))).not.toBe(payloadKey(buildExplainPayload(action, 'Bedroom 1', 35)));
  });
});

describe('explanation cache', () => {
  beforeEach(() => useExplainStore.setState({ entries: {} }));

  it('never sends a duplicate while one is in flight, then serves the cache', async () => {
    let resolve!: (v: { text: string | null }) => void;
    const fn = vi.fn(() => new Promise<{ text: string | null }>((r) => (resolve = r)));
    setExplainFn(fn);
    const p = buildExplainPayload(action, 'Whole house', 35);
    const k1 = requestExplanation(p);
    const k2 = requestExplanation(buildExplainPayload(action, 'Whole house', 35));
    expect(k1).toBe(k2);
    expect(fn).toHaveBeenCalledTimes(1);
    expect(useExplainStore.getState().entries[k1]).toEqual({ status: 'loading' });
    resolve({ text: 'Closing the window helps.' });
    await Promise.resolve();
    await Promise.resolve();
    expect(useExplainStore.getState().entries[k1]).toEqual({ status: 'done', text: 'Closing the window helps.' });
    requestExplanation(p);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('retries a failed request on the next expand', async () => {
    const fn = vi.fn(() => Promise.reject(new Error('502')));
    setExplainFn(fn);
    const p = buildExplainPayload(action, 'Whole house', 35);
    const k = requestExplanation(p);
    await Promise.resolve();
    await Promise.resolve();
    expect(useExplainStore.getState().entries[k]).toEqual({ status: 'error' });
    requestExplanation(p);
    expect(fn).toHaveBeenCalledTimes(2);
  });
});
