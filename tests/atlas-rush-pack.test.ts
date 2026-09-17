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
    // The same rider comes back for another go.
    const again = await blitz.issueTicket({
      actorId: 'alpha', walletAddress: 'wallet-alpha', username: 'Alpha', cityId: 'lagos', seasonId: 'cycle-2',
    });
    // Being blocked by your own best line is absurd, and would make a good
    // previous run a punishment.
    expect(again.rivals ?? []).toEqual([]);
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
