import { describe, expect, it } from 'vitest';

import { BLITZ_DAILY_RULESET_VERSION, getBlitzDailyChallenge, utcDateKey } from '../shared/atlas/blitz/daily';
import { createBlitzPendingRunStore } from '../src/atlas/blitz/pending-run';

function memoryStorage(): Storage {
  const values = new Map<string, string>();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => { values.set(key, value); },
    removeItem: (key) => { values.delete(key); },
    clear: () => { values.clear(); },
    key: (index) => [...values.keys()][index] ?? null,
    get length() { return values.size; },
  };
}

describe('Beacon Blitz daily challenge identity', () => {
  it('uses one reproducible UTC challenge per season, city, and day', () => {
    const now = Date.parse('2026-09-15T13:45:00.000Z');
    const first = getBlitzDailyChallenge({ now, cityId: 'lagos', seasonId: 'cycle-2' });
    const second = getBlitzDailyChallenge({ now: now + 6 * 60 * 60 * 1_000, cityId: 'lagos', seasonId: 'cycle-2' });
    expect(first).toEqual(second);
    expect(first.rulesetVersion).toBe(BLITZ_DAILY_RULESET_VERSION);
    expect(first.challengeId).toContain('2026-09-15');
    expect(first.expiresAt - first.startsAt).toBe(86_400_000);
  });

  it('changes the board identity at UTC midnight and rejects invalid clocks', () => {
    const before = getBlitzDailyChallenge({ now: Date.parse('2026-09-15T23:59:59.999Z'), cityId: 'lagos', seasonId: 'cycle-2' });
    const after = getBlitzDailyChallenge({ now: Date.parse('2026-09-16T00:00:00.000Z'), cityId: 'lagos', seasonId: 'cycle-2' });
    expect(before.challengeId).not.toBe(after.challengeId);
    expect(utcDateKey(after.startsAt)).toBe('2026-09-16');
    expect(() => utcDateKey(-1)).toThrow(/timestamp/i);
  });
});

describe('Beacon Blitz pending ranked run store', () => {
  const ticket = {
    id: 'ticket-a', actorId: 'actor-a', walletAddress: 'wallet-a', username: 'Rider', cityId: 'lagos' as const,
    seasonId: 'cycle-2', challengeId: 'cycle-2:lagos:2026-09-15:blitz-daily-v1', challengeDate: '2026-09-15',
    rulesetVersion: 'blitz-daily-v1', seed: 'seed', issuedAt: 1, expiresAt: 2_000,
  };
  const pending = {
    runId: 'run-a', ticket, frames: [{ tick: 0, input: { steer: 0, drift: false, boost: false, brake: false } }],
    traceHash: 'a'.repeat(64), claimedScore: 42, savedAt: 1_000,
  };

  it('round-trips a pending run and clears it after successful retry', () => {
    const store = createBlitzPendingRunStore(memoryStorage());
    expect(store.save(pending)).toBe(true);
    expect(store.read()).toEqual(pending);
    store.clear();
    expect(store.read()).toBeNull();
  });

  it('drops corrupted or oversized local state instead of making it executable', () => {
    const storage = memoryStorage();
    storage.setItem('pending', '{"runId":"run-a"}');
    expect(createBlitzPendingRunStore(storage, 'pending').read()).toBeNull();
    storage.setItem('pending', 'x'.repeat(256_001));
    expect(createBlitzPendingRunStore(storage, 'pending').read()).toBeNull();
  });
});
