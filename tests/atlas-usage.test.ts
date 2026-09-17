import { describe, expect, it } from 'vitest';
import { withStateTransactions } from '../server/atlas/persistence';
import {
  ATLAS_USAGE_MAX_EVENTS_PER_SESSION,
  createAtlasUsageState,
  foldAtlasUsage,
  isAtlasUsageEvent,
  summariseAtlasUsage,
  type AtlasUsageState,
} from '../shared/atlas/usage';
import { createAtlasUsageService } from '../server/atlas/usage';
import { createAtlasUsageReporter } from '../src/atlas/usage';

const DAY = 86_400_000;
const MONDAY = Date.parse('2026-09-14T09:00:00.000Z');

function fold(state: AtlasUsageState, events: Array<Record<string, unknown>>): AtlasUsageState {
  return events.reduce((current, event) => foldAtlasUsage(current, event), state);
}

describe('atlas usage reporting', () => {
  /*
   * The client is static on sface.site and the service is on api.sface.site.
   * A relative '/atlas/api/usage' therefore resolves against the static host,
   * which answered 405 to every event. Caught on a real phone, not in any
   * test: the funnel would have read zero forever while people played.
   */
  it('sends events to the service origin, not the page origin', async () => {
    const calls: string[] = [];
    const reporter = createAtlasUsageReporter({
      session: 'atlas-session-abcdefgh',
      apiBase: 'https://api.sface.site',
      fetcher: (async (url: string) => { calls.push(String(url)); return { ok: true } as Response; }) as unknown as typeof fetch,
    });
    reporter.record('session-start');
    await Promise.resolve();
    expect(calls).toEqual(['https://api.sface.site/atlas/api/usage']);
  });

  it('stays relative when the service shares the origin, as it does locally', async () => {
    const calls: string[] = [];
    const reporter = createAtlasUsageReporter({
      session: 'atlas-session-abcdefgh',
      apiBase: '',
      fetcher: (async (url: string) => { calls.push(String(url)); return { ok: true } as Response; }) as unknown as typeof fetch,
    });
    reporter.record('session-start');
    await Promise.resolve();
    expect(calls).toEqual(['/atlas/api/usage']);
  });

  it('never lets a failing endpoint throw into the game loop', () => {
    const reporter = createAtlasUsageReporter({
      session: 'atlas-session-abcdefgh',
      apiBase: 'https://api.sface.site',
      fetcher: (() => { throw new Error('offline'); }) as unknown as typeof fetch,
    });
    expect(() => reporter.record('session-start')).not.toThrow();
  });
});

describe('atlas usage counting', () => {
  it('reports a funnel where each stage is a subset of the one above it', () => {
    let state = createAtlasUsageState();
    // three arrive, two play, one finishes and verifies
    state = fold(state, [
      { name: 'session-start', session: 'aaaaaaaa', at: MONDAY },
      { name: 'session-start', session: 'bbbbbbbb', at: MONDAY },
      { name: 'session-start', session: 'cccccccc', at: MONDAY },
      { name: 'chapter-start', session: 'aaaaaaaa', chapter: 0, at: MONDAY },
      { name: 'chapter-start', session: 'bbbbbbbb', chapter: 0, at: MONDAY },
      { name: 'chapter-complete', session: 'aaaaaaaa', chapter: 0, at: MONDAY },
      { name: 'payment-verified', session: 'aaaaaaaa', at: MONDAY },
    ]);
    const summary = summariseAtlasUsage(state, MONDAY);
    expect(summary.reach).toBe(3);
    expect(summary.played).toBe(2);
    expect(summary.completed).toBe(1);
    expect(summary.verified).toBe(1);
    expect(summary.verified).toBeLessThanOrEqual(summary.completed);
    expect(summary.completed).toBeLessThanOrEqual(summary.played);
    expect(summary.played).toBeLessThanOrEqual(summary.reach);
  });

  it('does not inflate when a player replays the same chapter', () => {
    let state = createAtlasUsageState();
    state = fold(state, Array.from({ length: 12 }, () => ({ name: 'chapter-complete', session: 'aaaaaaaa', chapter: 0, at: MONDAY })));
    const summary = summariseAtlasUsage(state, MONDAY);
    // Twelve replays are one person who completed one chapter, and a number
    // that said twelve would not survive being asked how it was measured.
    expect(summary.completed).toBe(1);
    expect(summary.byChapter[0]).toMatchObject({ chapter: 0, started: 1, completed: 1 });
  });

  it('counts a returning player only when they come back on another day', () => {
    let state = createAtlasUsageState();
    state = fold(state, [
      { name: 'session-start', session: 'aaaaaaaa', at: MONDAY },
      { name: 'chapter-start', session: 'aaaaaaaa', chapter: 0, at: MONDAY + 3600_000 },
    ]);
    expect(summariseAtlasUsage(state, MONDAY).returning).toBe(0);
    state = foldAtlasUsage(state, { name: 'chapter-start', session: 'aaaaaaaa', chapter: 1, at: MONDAY + DAY });
    expect(summariseAtlasUsage(state, MONDAY + DAY).returning).toBe(1);
  });

  it('refuses malformed events instead of coercing them, and says how many', () => {
    const rejects = [
      { name: 'chapter-start', session: 'aaaaaaaa', at: MONDAY },              // chapter required
      { name: 'session-start', session: 'aaaaaaaa', chapter: 2, at: MONDAY },  // chapter refused
      { name: 'chapter-start', session: 'aaaaaaaa', chapter: 9, at: MONDAY },  // out of range
      { name: 'chapter-start', session: 'short', chapter: 0, at: MONDAY },     // id too short
      { name: 'made-up-event', session: 'aaaaaaaa', at: MONDAY },              // unknown name
      { name: 'session-start', session: 'aaaaaaaa', device: 'watch', at: MONDAY },
      null,
      'nonsense',
    ];
    for (const event of rejects) expect(isAtlasUsageEvent(event)).toBe(false);
    const state = fold(createAtlasUsageState(), rejects as Array<Record<string, unknown>>);
    expect(summariseAtlasUsage(state, MONDAY).reach).toBe(0);
    expect(summariseAtlasUsage(state, MONDAY).rejectedEvents).toBe(rejects.length);
  });

  it('caps one session so a stuck client cannot skew a day', () => {
    let state = createAtlasUsageState();
    state = fold(state, Array.from({ length: ATLAS_USAGE_MAX_EVENTS_PER_SESSION + 25 }, () => ({ name: 'session-start', session: 'aaaaaaaa', at: MONDAY })));
    expect(state.sessions[Object.keys(state.sessions)[0]!]!.events).toBe(ATLAS_USAGE_MAX_EVENTS_PER_SESSION);
    expect(summariseAtlasUsage(state, MONDAY).rejectedEvents).toBe(25);
  });

  it('never stores the raw session id the client sent', async () => {
    const saved: Record<string, unknown> = {};
    const stateStore = withStateTransactions({
      load: async <T>(_key: string, fallback: T) => fallback,
      save: async <T>(key: string, value: T) => { saved[key] = value; },
    });
    const service = createAtlasUsageService({ stateStore, salt: 'pepper', now: () => MONDAY });
    await service.record({ name: 'session-start', session: 'atlas-session-abcdef-secret' });
    const serialised = JSON.stringify(saved);
    expect(serialised).not.toContain('atlas-session-abcdef-secret');
    expect(serialised).not.toContain('secret');
    expect((await service.summary()).reach).toBe(1);
  });

  it('keeps counting without a durable store rather than silently not existing', async () => {
    // The treasury bug in payouts.ts was a service that was never constructed in
    // production. A usage counter that quietly does nothing is the same shape.
    const service = createAtlasUsageService({ now: () => MONDAY });
    await service.record({ name: 'session-start', session: 'atlas-session-one' });
    await service.record({ name: 'chapter-complete', session: 'atlas-session-one', chapter: 0 });
    const summary = await service.summary();
    expect(summary.reach).toBe(1);
    expect(summary.completed).toBe(1);
  });

  it('hydrates a persisted count instead of overwriting it on restart', async () => {
    const store: Record<string, unknown> = {};
    const stateStore = withStateTransactions({
      load: async <T>(key: string, fallback: T) => (key in store ? (store[key] as T) : fallback),
      save: async <T>(key: string, value: T) => { store[key] = value; },
    });
    const first = createAtlasUsageService({ stateStore, now: () => MONDAY });
    await first.record({ name: 'session-start', session: 'atlas-session-one' });
    const second = createAtlasUsageService({ stateStore, now: () => MONDAY + DAY });
    await second.record({ name: 'session-start', session: 'atlas-session-two' });
    expect((await second.summary()).reach).toBe(2);
  });
});
