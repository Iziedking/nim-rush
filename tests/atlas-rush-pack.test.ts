import { describe, expect, it } from 'vitest';

import { createAtlasBlitzService } from '../server/atlas/blitz';
import { createBlitzRun, stepBlitzRun } from '../shared/atlas/blitz/core';
import { hashBlitzTrace } from '../shared/atlas/blitz/replay';
import type { BlitzTraceFrame } from '../shared/atlas/blitz/types';
import { blitzRiderInput } from './support/blitz-rider';

/*
 * The loop that turns a time trial into a race.
 *
 * A rider finishes, the line they drew is kept, and the next rider down the
 * hill has somebody to chase. Everything here is about that loop closing - and
 * about it closing without breaking verification, because a solid rival
 * changes the physics and a server that replayed against the wrong pack would
 * refuse the very runs it just created.
 */

function service(clock: { now: number }) {
  let id = 0;
  return createAtlasBlitzService({
    identity: {
      getBinding: (actorId: string, seasonId: string) => ({
        actorId, seasonId, address: `wallet-${actorId}`, network: 'testalbatross' as const, publicKey: 'aa', boundAt: 0,
      }),
    },
    now: () => clock.now,
    randomId: () => `ticket-${++id}`,
  });
}

async function rideAndSubmit(blitz: ReturnType<typeof createAtlasBlitzService>, clock: { now: number }, actorId: string, username: string) {
  const ticket = await blitz.issueTicket({
    actorId, walletAddress: `wallet-${actorId}`, username, cityId: 'lagos', seasonId: 'cycle-2',
  });
  // Ride the pack the ticket pinned, which is what the client does.
  const rivals = ticket.rivals ?? [];
  let state = createBlitzRun({ cityId: 'lagos', seed: ticket.seed, rivals });
  const frames: BlitzTraceFrame[] = [];
  while (state.phase === 'countdown' || state.phase === 'running') {
    const input = blitzRiderInput(state);
    frames.push({ tick: frames.length, input });
    state = stepBlitzRun(state, input, rivals);
  }
  // Enough server time must have passed for the replay's duration.
  clock.now = ticket.issuedAt + Math.ceil(state.tick * 1_000 / 30) + 50;
  const result = await blitz.submit({
    runId: `run-${actorId}`, ticketId: ticket.id, actorId, walletAddress: `wallet-${actorId}`,
    username, cityId: 'lagos', seasonId: 'cycle-2', seed: ticket.seed,
    frames, traceHash: await hashBlitzTrace(frames), claimedScore: state.score,
  });
  return { ticket, state, result };
}

describe('a finished run becomes somebody else\'s rival', () => {
  it('starts the first rider of the day on an empty hill', async () => {
    const clock = { now: 1_700_000_000_000 };
    const blitz = service(clock);
    const first = await rideAndSubmit(blitz, clock, 'alpha', 'Alpha');
    // Nobody has ridden yet, so there is nobody to race. An invented rival
    // here would be a fake rider on a board that pays out.
    expect(first.ticket.rivals ?? []).toEqual([]);
    expect(first.result.row.verified).toBe(true);
  });

  it('puts the first rider in the second rider\'s race', async () => {
    const clock = { now: 1_700_000_000_000 };
    const blitz = service(clock);
    await rideAndSubmit(blitz, clock, 'alpha', 'Alpha');
    clock.now += 60_000;

    const second = await rideAndSubmit(blitz, clock, 'beta', 'Beta');
    expect(second.ticket.rivals).toHaveLength(1);
    expect(second.ticket.rivals![0]!.username).toBe('Alpha');
    // A path, not a trace: positions are what a rival needs and they are a
    // fraction of the payload.
    expect(second.ticket.rivals![0]!.distance.length).toBeGreaterThan(10);
    expect(second.ticket.rivals![0]).not.toHaveProperty('frames');
  });

  /*
   * The whole reason the pack is pinned to the ticket. If the server verified
   * against a different set - or none - it would compute a different score and
   * refuse an honest rider who did nothing but ride what they were given.
   */
  it('verifies a run ridden through traffic rather than refusing it', async () => {
    const clock = { now: 1_700_000_000_000 };
    const blitz = service(clock);
    await rideAndSubmit(blitz, clock, 'alpha', 'Alpha');
    clock.now += 60_000;
    const second = await rideAndSubmit(blitz, clock, 'beta', 'Beta');
    expect(second.ticket.rivals!.length).toBeGreaterThan(0);
    expect(second.result.row.verified).toBe(true);
    expect(second.result.row.score).toBe(second.state.score);
  });

  it('never makes a rider race their own ghost', async () => {
    const clock = { now: 1_700_000_000_000 };
    const blitz = service(clock);
    await rideAndSubmit(blitz, clock, 'alpha', 'Alpha');
    clock.now += 60_000;
    /*
     * The same rider comes back for another go, and no longer gets one: today
     * is ridden once. This used to assert that a second ticket simply carried
     * an empty pack, because racing your own line would make a good previous
     * run a punishment. The stronger rule makes that unreachable, so the test
     * now holds the rule that replaced it. Self-exclusion across days is still
     * covered by 'still refuses to hand a rider their own ghost across days'.
     */
    await expect(blitz.issueTicket({
      actorId: 'alpha', walletAddress: 'wallet-alpha', username: 'Alpha', cityId: 'lagos', seasonId: 'cycle-2',
    })).rejects.toThrow(/already posted/i);
  });

  it('keeps the pack small enough for the road to stay readable', async () => {
    const clock = { now: 1_700_000_000_000 };
    const blitz = service(clock);
    for (const rider of ['a', 'b', 'c', 'd', 'e']) {
      await rideAndSubmit(blitz, clock, rider, `Rider${rider.toUpperCase()}`);
      clock.now += 60_000;
    }
    const next = await blitz.issueTicket({
      actorId: 'zed', walletAddress: 'wallet-zed', username: 'Zed', cityId: 'lagos', seasonId: 'cycle-2',
    });
    expect(next.rivals!.length).toBeLessThanOrEqual(3);
    expect(next.rivals!.length).toBeGreaterThan(0);
    // Distinct riders: a pack of one person repeated is not a race.
    expect(new Set(next.rivals!.map((rival) => rival.username)).size).toBe(next.rivals!.length);
  });
});

/*
 * The hill is not empty again every midnight.
 *
 * Recorded lines were filed under the challenge id, and a challenge id carries
 * the date - so the pack emptied at every reset and the first riders of every
 * single day raced nobody. That is not a cold start, it is a cold start daily.
 *
 * It is safe to reach back because the course does not move: `sampleCourse`
 * and `nearbyCourseColliders` are keyed on the city, and the seed changes the
 * missions and the supplies rather than the road. Yesterday's line down Lagos
 * is a true line down Lagos today.
 */
describe('yesterday fills today until today fills itself', () => {
  const DAY = 24 * 60 * 60 * 1_000;

  it('gives the next day a pack instead of an empty hill', async () => {
    const clock = { now: 1_700_000_000_000 };
    const blitz = service(clock);

    const yesterday = await rideAndSubmit(blitz, clock, 'alpha', 'Alpha');
    expect(yesterday.result.row.verified).toBe(true);

    clock.now += DAY;
    const today = await blitz.issueTicket({
      actorId: 'beta', walletAddress: 'wallet-beta', username: 'Beta', cityId: 'lagos', seasonId: 'cycle-2',
    });

    expect(today.challengeId).not.toBe(yesterday.ticket.challengeId);
    expect((today.rivals ?? []).map((rival) => rival.username)).toEqual(['Alpha']);
  });

  it('still refuses to hand a rider their own ghost across days', async () => {
    const clock = { now: 1_700_000_000_000 };
    const blitz = service(clock);
    await rideAndSubmit(blitz, clock, 'alpha', 'Alpha');

    clock.now += DAY;
    const again = await blitz.issueTicket({
      actorId: 'alpha', walletAddress: 'wallet-alpha', username: 'Alpha', cityId: 'lagos', seasonId: 'cycle-2',
    });
    expect(again.rivals ?? []).toEqual([]);
  });

  it('prefers today, and only backfills the seats today has not filled', async () => {
    const clock = { now: 1_700_000_000_000 };
    const blitz = service(clock);
    await rideAndSubmit(blitz, clock, 'alpha', 'Alpha');

    clock.now += DAY;
    await rideAndSubmit(blitz, clock, 'beta', 'Beta');
    const third = await blitz.issueTicket({
      actorId: 'gamma', walletAddress: 'wallet-gamma', username: 'Gamma', cityId: 'lagos', seasonId: 'cycle-2',
    });

    const names = (third.rivals ?? []).map((rival) => rival.username);
    // Today's rider comes first; yesterday's fills the seat behind them.
    expect(names[0]).toBe('Beta');
    expect(names).toContain('Alpha');
  });
});
