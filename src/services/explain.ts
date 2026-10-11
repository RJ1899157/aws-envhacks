import { create } from 'zustand';
import type { RankedAction } from '../simulation/scenarios/rank';
import { explainAction, type ExplainPayload } from './api';

/**
 * AI explanations of ranked actions ("Why?"). The ranking object is replaced on every re-rank and
 * verification update, so explanations are cached here, by a hash of the request body, not on
 * RankedAction. Requests only start when the user expands a card.
 */

/** Backend limits (infra/functions/explain/validation.py) */
const MAX_ITEMS = 20;
const MAX_STR = 300;
const MAX_NAME = 80;

const round1 = (v: number) => Math.round(v * 10) / 10 || 0;
const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

/**
 * The POST /explain body for one action. Every number is rounded to 1 decimal so the backend's
 * grounding check works on the numbers shown; `fraction` keeps 3 decimals, i.e. its percentage
 * (what the card shows) to 1 decimal.
 */
export function buildExplainPayload(r: Pick<RankedAction, 'texts' | 'effort' | 'before' | 'after' | 'fraction' | 'roomDeltas' | 'facts' | 'verified'>, objective: string, outdoorPm25: number): ExplainPayload {
  return {
    objective: clip(objective, MAX_NAME),
    action: {
      texts: r.texts.slice(0, 10).map((t) => clip(t, MAX_STR)),
      effort: r.effort,
      before: Math.max(0, round1(r.before)),
      after: Math.max(0, round1(r.after)),
      fraction: Math.round(r.fraction * 1000) / 1000 || 0,
      roomDeltas: r.roomDeltas.slice(0, MAX_ITEMS).map((d) => ({ name: clip(d.name, MAX_NAME), before: Math.max(0, round1(d.before)), after: Math.max(0, round1(d.after)) })),
      facts: r.facts.slice(0, MAX_ITEMS).map((f) => clip(f, MAX_STR)),
      verified: r.verified,
    },
    outdoorPm25: Math.max(0, round1(outdoorPm25)),
  };
}

/** cyrb53 of the JSON body (stable: the builder always emits keys in the same order). */
export function payloadKey(payload: ExplainPayload): string {
  const str = JSON.stringify(payload);
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
}

export type ExplanationEntry = { status: 'loading' } | { status: 'done'; text: string | null } | { status: 'error' };

interface ExplainState {
  entries: Record<string, ExplanationEntry>;
}

export const useExplainStore = create<ExplainState>()(() => ({ entries: {} }));

let explain: (p: ExplainPayload) => Promise<{ text: string | null }> = explainAction;

/** Tests swap the backend call. */
export function setExplainFn(fn: typeof explain): void {
  explain = fn;
}

/**
 * Requests the explanation for `payload` unless it is cached or already in flight (a failed one is
 * tried again on the next expand). Returns the cache key.
 */
export function requestExplanation(payload: ExplainPayload): string {
  const key = payloadKey(payload);
  const cur = useExplainStore.getState().entries[key];
  if (cur && cur.status !== 'error') return key;
  const put = (e: ExplanationEntry) => useExplainStore.setState((s) => ({ entries: { ...s.entries, [key]: e } }));
  put({ status: 'loading' });
  explain(payload).then(
    (res) => put({ status: 'done', text: res.text }),
    () => put({ status: 'error' })
  );
  return key;
}
