import { describe, expect, it } from 'vitest';

import { BLITZ_TICK_RATE, createBlitzRun, stepBlitzRun } from '../shared/atlas/blitz/core';
import { hashBlitzTrace } from '../shared/atlas/blitz/replay';
import type { BlitzCityId, BlitzTraceFrame } from '../shared/atlas/blitz/types';
import { createAtlasBlitzService } from '../server/atlas/blitz';
import { blitzRiderInput } from './support/blitz-rider';

const walletA = 'NQ12 TEST WALLET A';
const walletB = 'NQ34 TEST WALLET B';

function identity(bindings: Record<string, string>) {
  return { getBinding: (actorId: string, seasonId: string) => {
    const address = bindings[`${seasonId}:${actorId}`];
    return address ? { actorId, seasonId, address, network: 'testalbatross' as const, publicKey: 'aa', boundAt: 1 } : null;
  } };
}

async function completeTrace(cityId: BlitzCityId, seed: string): Promise<{ frames: BlitzTraceFrame[]; score: number; elapsedMs: number; collisions: number; hash: string }> {
  const frames: BlitzTraceFrame[] = [];
  let state = createBlitzRun({ cityId, seed });
  while (state.phase !== 'finished' && state.phase !== 'timeout') {
    const input = blitzRiderInput(state);
    frames.push({ tick: frames.length, input });
    state = stepBlitzRun(state, input);
  }
  return { frames, score: state.score, elapsedMs: state.elapsedMs, collisions: state.collisions, hash: await hashBlitzTrace(frames) };
}

describe('Beacon Blitz verified competition service', () => {
  it('issues a deterministic city ticket only to the actor wallet binding', async () => {
    const service = createAtlasBlitzService({ identity: identity({ 'season-1:actor-a': walletA }), now: () => 1_000, randomId: () => 'ticket-a' });
    const ticket = await service.issueTicket({ actorId: 'actor-a', walletAddress: walletA, username: 'Sface', cityId: 'lagos', seasonId: 'season-1' });
    expect(ticket).toMatchObject({ id: 'ticket-a', cityId: 'lagos', seasonId: 'season-1', username: 'Sface' });
    expect(ticket).toMatchObject({
      challengeId: 'season-1:lagos:1970-01-01:rush-missions-v5-rookie',
      challengeDate: '1970-01-01',
      rulesetVersion: 'rush-missions-v5-rookie',
      seed: 'season-1:lagos:1970-01-01:rush-missions-v5-rookie',
    });
    await expect(service.issueTicket({ actorId: 'actor-a', walletAddress: walletB, username: 'Sface', cityId: 'lagos', seasonId: 'season-1' })).rejects.toThrow(/wallet binding/i);
  });

  it('replays a finished trace, rejects tampering and is idempotent by run id', async () => {
    let id = 0;
    let current = 2_000;
    const service = createAtlasBlitzService({ identity: identity({ 'season-1:actor-a': walletA }), now: () => current, randomId: () => `ticket-${++id}` });
    const ticket = await service.issueTicket({ actorId: 'actor-a', walletAddress: walletA, username: 'Sface', cityId: 'lagos', seasonId: 'season-1' });
    const trace = await completeTrace('lagos', ticket.seed);
    current += trace.elapsedMs + 3_000;
    const input = { runId: 'run-a', ticketId: ticket.id, actorId: 'actor-a', walletAddress: walletA, username: 'Sface', cityId: 'lagos' as const, seasonId: 'season-1', seed: ticket.seed, frames: trace.frames, traceHash: trace.hash, claimedScore: trace.score };
    const accepted = await service.submit(input);
    expect(accepted.row).toMatchObject({ rank: 1, verified: true, username: 'Sface', walletAddress: walletA, score: trace.score });
    expect((await service.submit(input)).duplicate).toBe(true);
    const second = await service.issueTicket({ actorId: 'actor-a', walletAddress: walletA, username: 'Sface', cityId: 'lagos', seasonId: 'season-1' });
    await expect(service.submit({ ...input, runId: 'run-b', ticketId: second.id, claimedScore: trace.score + 1 })).rejects.toThrow(/score/i);
  });

  it('keeps one username per wallet and ranks by score then time and collisions', async () => {
    let id = 0;
    let current = 4_000;
    const service = createAtlasBlitzService({ identity: identity({ 'season-1:actor-a': walletA, 'season-1:actor-b': walletB }), now: () => current, randomId: () => `ticket-${++id}` });
    const ticketA = await service.issueTicket({ actorId: 'actor-a', walletAddress: walletA, username: 'Sface', cityId: 'london', seasonId: 'season-1' });
    await expect(service.issueTicket({ actorId: 'actor-b', walletAddress: walletB, username: 'sFACE', cityId: 'london', seasonId: 'season-1' })).rejects.toThrow(/username/i);
    const ticketB = await service.issueTicket({ actorId: 'actor-b', walletAddress: walletB, username: 'Kemi', cityId: 'london', seasonId: 'season-1' });
    const [traceA, traceB] = await Promise.all([completeTrace('london', ticketA.seed), completeTrace('london', ticketB.seed)]);
    current += Math.max(traceA.elapsedMs, traceB.elapsedMs) + 3_000;
    await service.submit({ runId: 'run-a', ticketId: ticketA.id, actorId: 'actor-a', walletAddress: walletA, username: 'Sface', cityId: 'london', seasonId: 'season-1', seed: ticketA.seed, frames: traceA.frames, traceHash: traceA.hash, claimedScore: traceA.score });
    await service.submit({ runId: 'run-b', ticketId: ticketB.id, actorId: 'actor-b', walletAddress: walletB, username: 'Kemi', cityId: 'london', seasonId: 'season-1', seed: ticketB.seed, frames: traceB.frames, traceHash: traceB.hash, claimedScore: traceB.score });
    const board = await service.leaderboard('season-1', 'london');
    expect(board.map((row) => row.username)).toEqual(['Sface', 'Kemi']);
    expect(board.every((row) => row.verified)).toBe(true);
  });

  it('rejects a ranked trace held beyond the two-minute live-run window', async () => {
    let current = 1_000;
    const service = createAtlasBlitzService({
      identity: identity({ 'season-1:actor-a': walletA }),
      now: () => current,
      randomId: () => 'ticket-slow',
    });
    const ticket = await service.issueTicket({
      actorId: 'actor-a', walletAddress: walletA, username: 'Sface', cityId: 'dubai', seasonId: 'season-1',
    });
    const trace = await completeTrace('dubai', ticket.seed);
    current = ticket.issuedAt + 120_001;
    await expect(service.submit({
      runId: 'run-slow', ticketId: ticket.id, actorId: ticket.actorId,
      walletAddress: ticket.walletAddress, username: ticket.username, cityId: ticket.cityId,
      seasonId: ticket.seasonId, seed: ticket.seed, frames: trace.frames,
      traceHash: trace.hash, claimedScore: trace.score,
    })).rejects.toThrow(/two minutes/i);
  });
});

/*
 * The board is the product; the pool is a bonus on top of it. A treasury that
 * cannot be reached must never cost a player the place they just earned, so
 * qualification is attempted after the run is recorded and its failure is
 * swallowed.
 */
describe('a verified run and the day pool', () => {
  async function rankedRun(daily?: { qualifyVerifiedRun: (input: { actorId: string; walletAddress: string; source: string }) => Promise<unknown> }) {
    let current = 9_000;
    const service = createAtlasBlitzService({
      identity: identity({ 'season-1:actor-a': walletA }),
      now: () => current,
      randomId: () => 'ticket-pool',
      daily: daily as never,
    });
    const ticket = await service.issueTicket({ actorId: 'actor-a', walletAddress: walletA, username: 'Sface', cityId: 'lagos', seasonId: 'season-1' });
    const trace = await completeTrace('lagos', ticket.seed);
    current += trace.elapsedMs + 3_000;
    const result = await service.submit({
      runId: 'run-pool', ticketId: ticket.id, actorId: 'actor-a', walletAddress: walletA, username: 'Sface',
      cityId: 'lagos', seasonId: 'season-1', seed: ticket.seed, frames: trace.frames, traceHash: trace.hash, claimedScore: trace.score,
    });
    return result;
  }

  it('qualifies the rider once the server agrees with the score', async () => {
    const qualified: Array<{ walletAddress: string; source: string }> = [];
    const result = await rankedRun({ qualifyVerifiedRun: async (input) => { qualified.push(input); return { accepted: true, eligible: true, date: '2026-09-14' }; } });
    expect(result.row.verified).toBe(true);
    expect(qualified).toHaveLength(1);
    expect(qualified[0]!.source).toBe('blitz-ranked');
    expect(qualified[0]!.walletAddress).toBe(result.row.walletAddress);
  });

  it('still records the run when the pool refuses', async () => {
    const result = await rankedRun({ qualifyVerifiedRun: async () => { throw new Error('treasury unreachable'); } });
    expect(result.row.verified).toBe(true);
    expect(result.row.rank).toBe(1);
  });

  it('runs the board normally with no pool configured at all', async () => {
    expect((await rankedRun()).row.verified).toBe(true);
  });
});

/*
 * The prize table.
 *
 * Read-only: it moves nothing and marks nothing paid. What it must never do is
 * blur the three states apart from each other, because "no pool today" and
 * "the server could not read the pool" are different claims and only one of
 * them is something we know.
 */
describe('what the board would owe if it closed now', () => {
  const pool = (poolLuna: number | null, rewardsEnabled = true) => ({
    qualifyVerifiedRun: async () => ({ accepted: true as const, eligible: true as const, date: '2026-09-15' }),
    standing: async () => ({ date: '2026-09-15', eligibleCount: 0, shareLuna: null, poolLuna, configuredPoolLuna: poolLuna, treasuryLuna: poolLuna, rewardsEnabled }),
  });

  async function boardOf(daily: unknown, scores: readonly number[]) {
    let id = 0;
    // The server refuses a run submitted sooner than the run could have taken,
    // so the clock has to advance past the replay duration between issue and
    // submit. A fixed clock trips that guard, which is the guard working.
    let current = 1_000;
    const wallets = ['NQ12 TEST WALLET A', 'NQ34 TEST WALLET B', 'NQ56 TEST WALLET C', 'NQ78 TEST WALLET D'];
    const bindings: Record<string, string> = {};
    for (const [index] of scores.entries()) bindings[`season-1:actor-${index}`] = wallets[index]!;
    const service = createAtlasBlitzService({ identity: identity(bindings), now: () => current, randomId: () => `ticket-${++id}`, daily: daily as never });
    for (const [index] of scores.entries()) {
      const ticket = await service.issueTicket({ actorId: `actor-${index}`, walletAddress: wallets[index]!, username: `Rider${index}`, cityId: 'lagos', seasonId: 'season-1' });
      const trace = await completeTrace('lagos', ticket.seed);
      // The guard measures replay *ticks*, which include the countdown, not the
      // run's elapsed time. Advance by the whole trace or it still trips.
      current += Math.ceil((trace.frames.length * 1_000) / BLITZ_TICK_RATE) + 1_000;
      await service.submit({
        runId: `run-${index}`, ticketId: ticket.id, actorId: `actor-${index}`, walletAddress: wallets[index]!, username: `Rider${index}`,
        cityId: 'lagos', seasonId: 'season-1', seed: ticket.seed, frames: trace.frames, traceHash: trace.hash, claimedScore: trace.score,
      });
    }
    return service.prizeTable('season-1', 'lagos');
  }

  it('reports a funded pool split 50/30/20 across the riders who exist', async () => {
    const table = await boardOf(pool(10_000), [1, 2, 3]);
    expect(table.state).toBe('funded');
    expect(table.poolLuna).toBe(10_000);
    expect(table.splitBps).toEqual([5_000, 3_000, 2_000]);
    expect(table.allocations.map((entry) => entry.luna)).toEqual([5_000, 3_000, 2_000]);
    expect(table.qualifiedRiders).toBe(3);
  });

  it('calls an unfunded day unfunded, and owes nobody anything', async () => {
    const table = await boardOf(pool(0), [1, 2]);
    expect(table.state).toBe('unfunded');
    expect(table.allocations).toEqual([]);
  });

  it('calls rewards-disabled unfunded rather than inventing a pool', async () => {
    const table = await boardOf(pool(10_000, false), [1]);
    expect(table.state).toBe('unfunded');
    expect(table.allocations).toEqual([]);
  });

  /*
   * The distinction that matters most. A treasury the server cannot reach is
   * an unknown, and reporting an unknown as "no pool today" would be a claim
   * about the treasury that nothing supports.
   */
  it('calls an unreadable pool unavailable, not unfunded', async () => {
    const table = await boardOf({
      qualifyVerifiedRun: async () => ({ accepted: true as const, eligible: true as const, date: '2026-09-15' }),
      standing: async () => { throw new Error('treasury unreachable'); },
    }, [1, 2]);
    expect(table.state).toBe('unavailable');
    expect(table.poolLuna).toBeNull();
    expect(table.allocations).toEqual([]);
  });

  it('is unavailable when nothing can tell it about a pool at all', async () => {
    const table = await boardOf(undefined, [1]);
    expect(table.state).toBe('unavailable');
    expect(table.allocations).toEqual([]);
  });

  it('still shows the board when the pool is missing', async () => {
    const table = await boardOf(undefined, [1, 2]);
    expect(table.qualifiedRiders).toBe(2);
  });

  it('pays only the places that exist and keeps the rest', async () => {
    const table = await boardOf(pool(10_000), [1]);
    expect(table.allocations).toHaveLength(1);
    expect(table.remainderLuna).toBe(5_000);
  });
});
