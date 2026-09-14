import { describe, expect, it } from 'vitest';

import { createBlitzRun, stepBlitzRun } from '../shared/atlas/blitz/core';
import { hashBlitzTrace } from '../shared/atlas/blitz/replay';
import type { BlitzCityId, BlitzTraceFrame } from '../shared/atlas/blitz/types';
import { createAtlasBlitzService } from '../server/atlas/blitz';

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
    const relay = state.activeRelay;
    const relayChoice = relay ? state.missions[relay.missionIndex]!.correctChoice : undefined;
    const input = { steer: 0, drift: false, boost: state.tick % 140 < 24, relayChoice };
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
    expect(ticket.seed).toBe('season-1:lagos:0');
    await expect(service.issueTicket({ actorId: 'actor-a', walletAddress: walletB, username: 'Sface', cityId: 'lagos', seasonId: 'season-1' })).rejects.toThrow(/wallet binding/i);
  });

  it('replays a finished trace, rejects tampering and is idempotent by run id', async () => {
    let id = 0;
    const service = createAtlasBlitzService({ identity: identity({ 'season-1:actor-a': walletA }), now: () => 2_000, randomId: () => `ticket-${++id}` });
    const ticket = await service.issueTicket({ actorId: 'actor-a', walletAddress: walletA, username: 'Sface', cityId: 'lagos', seasonId: 'season-1' });
    const trace = await completeTrace('lagos', ticket.seed);
    const input = { runId: 'run-a', ticketId: ticket.id, actorId: 'actor-a', walletAddress: walletA, username: 'Sface', cityId: 'lagos' as const, seasonId: 'season-1', seed: ticket.seed, frames: trace.frames, traceHash: trace.hash, claimedScore: trace.score };
    const accepted = await service.submit(input);
    expect(accepted.row).toMatchObject({ rank: 1, verified: true, username: 'Sface', walletAddress: walletA, score: trace.score });
    expect((await service.submit(input)).duplicate).toBe(true);
    const second = await service.issueTicket({ actorId: 'actor-a', walletAddress: walletA, username: 'Sface', cityId: 'lagos', seasonId: 'season-1' });
    await expect(service.submit({ ...input, runId: 'run-b', ticketId: second.id, claimedScore: trace.score + 1 })).rejects.toThrow(/score/i);
  });

  it('keeps one username per wallet and ranks by score then time and collisions', async () => {
    let id = 0;
    const service = createAtlasBlitzService({ identity: identity({ 'season-1:actor-a': walletA, 'season-1:actor-b': walletB }), now: () => 4_000, randomId: () => `ticket-${++id}` });
    const ticketA = await service.issueTicket({ actorId: 'actor-a', walletAddress: walletA, username: 'Sface', cityId: 'london', seasonId: 'season-1' });
    await expect(service.issueTicket({ actorId: 'actor-b', walletAddress: walletB, username: 'sFACE', cityId: 'london', seasonId: 'season-1' })).rejects.toThrow(/username/i);
    const ticketB = await service.issueTicket({ actorId: 'actor-b', walletAddress: walletB, username: 'Kemi', cityId: 'london', seasonId: 'season-1' });
    const [traceA, traceB] = await Promise.all([completeTrace('london', ticketA.seed), completeTrace('london', ticketB.seed)]);
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
    const service = createAtlasBlitzService({
      identity: identity({ 'season-1:actor-a': walletA }),
      now: () => 9_000,
      randomId: () => 'ticket-pool',
      daily: daily as never,
    });
    const ticket = await service.issueTicket({ actorId: 'actor-a', walletAddress: walletA, username: 'Sface', cityId: 'lagos', seasonId: 'season-1' });
    const trace = await completeTrace('lagos', ticket.seed);
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
