import { describe, expect, it } from 'vitest';

import { BLITZ_BADGES, blitzRunBadges } from '../shared/atlas/blitz/badges';
import { createBlitzRun, stepBlitzRun } from '../shared/atlas/blitz/core';
import { blitzRiderProgress } from '../shared/atlas/blitz/progress';
import { hashBlitzTrace } from '../shared/atlas/blitz/replay';
import type { BlitzRivalPath } from '../shared/atlas/blitz/rivals';
import type { BlitzCityId, BlitzRunState, BlitzTraceFrame } from '../shared/atlas/blitz/types';
import { createAtlasBlitzService } from '../server/atlas/blitz';
import { blitzRiderInput } from './support/blitz-rider';

/*
 * Layer 4 of V6, and the property that decides whether V6 can ship on a live
 * day at all: the V6 code, deployed during a V11 day, still verifies that
 * day's runs under V11. (No run crosses midnight - a ticket expires with its
 * day - so the deploy, not the reset, is the moment that has to be safe.)
 */

const wallet = 'NQ12 TEST WALLET A';
const identity = { getBinding: (actorId: string, seasonId: string) => (seasonId === 'cycle-2' && actorId === 'actor-a'
  ? { actorId, seasonId, address: wallet, network: 'testalbatross' as const, publicKey: 'aa', boundAt: 1 }
  : null) };

async function rideTicket(cityId: BlitzCityId, seed: string, rivals: readonly BlitzRivalPath[] = []): Promise<{ frames: BlitzTraceFrame[]; state: BlitzRunState; hash: string }> {
  const frames: BlitzTraceFrame[] = [];
  let state = createBlitzRun({ cityId, seed, rivals });
  while (state.phase !== 'finished' && state.phase !== 'timeout') {
    const input = blitzRiderInput(state);
    frames.push({ tick: frames.length, input });
    state = stepBlitzRun(state, input, rivals);
  }
  return { frames, state, hash: await hashBlitzTrace(frames) };
}

/** Issue, ride and submit one ranked run at a given moment. */
async function rankedRun(service: ReturnType<typeof createAtlasBlitzService>, clock: { now: number }, runId: string) {
  const ticket = await service.issueTicket({ actorId: 'actor-a', walletAddress: wallet, username: 'Rider', cityId: 'lagos', seasonId: 'cycle-2' });
  const ride = await rideTicket('lagos', ticket.seed, ticket.rivals);
  clock.now += ride.state.elapsedMs + 4_000;
  const result = await service.submit({
    runId, ticketId: ticket.id, actorId: 'actor-a', walletAddress: wallet, username: 'Rider', cityId: 'lagos', seasonId: 'cycle-2',
    challengeId: ticket.challengeId, challengeDate: ticket.challengeDate, rulesetVersion: ticket.rulesetVersion,
    seed: ticket.seed, frames: ride.frames, traceHash: ride.hash, claimedScore: ride.state.score,
  });
  return { ticket, result, state: ride.state };
}

describe('V6 deployed during a V11 day', () => {
  it('still verifies that day under V11, at the same score the rider saw', async () => {
    const clock = { now: Date.parse('2026-09-18T22:40:00.000Z') };
    let id = 0;
    const service = createAtlasBlitzService({ identity, now: () => clock.now, randomId: () => `id-${++id}` });
    const { ticket, result, state } = await rankedRun(service, clock, 'run-v11');
    expect(ticket.rulesetVersion).toBe('rush-nimtrail-v11-rookie');
    expect(ticket.challengeId).toBe('cycle-2:lagos:2026-09-18:rush-nimtrail-v11-rookie');
    expect(result.row.verified).toBe(true);
    expect(result.row.score).toBe(state.score);
    // The old rules: a flat 60 a coin, whatever the streak.
    expect(state.nimScore).toBe(state.tokensTaken * 60);
  });

  it('refuses a ticket that names a version its day never had', async () => {
    const clock = { now: Date.parse('2026-09-18T22:40:00.000Z') };
    let id = 0;
    const service = createAtlasBlitzService({ identity, now: () => clock.now, randomId: () => `id-${++id}` });
    const ticket = await service.issueTicket({ actorId: 'actor-a', walletAddress: wallet, username: 'Rider', cityId: 'lagos', seasonId: 'cycle-2' });
    const ride = await rideTicket('lagos', ticket.seed, ticket.rivals);
    clock.now += ride.state.elapsedMs + 4_000;
    await expect(service.submit({
      runId: 'run-forged', ticketId: ticket.id, actorId: 'actor-a', walletAddress: wallet, username: 'Rider', cityId: 'lagos', seasonId: 'cycle-2',
      challengeId: ticket.challengeId, challengeDate: ticket.challengeDate, rulesetVersion: 'rush-sectors-v12-rookie',
      seed: ticket.seed, frames: ride.frames, traceHash: ride.hash, claimedScore: ride.state.score,
    })).rejects.toThrow(/does not match its ticket/i);
  });

  it('verifies a full V6 ranked run on the first V6 day', async () => {
    const clock = { now: Date.parse('2026-09-19T10:00:00.000Z') };
    let id = 0;
    const service = createAtlasBlitzService({ identity, now: () => clock.now, randomId: () => `id-${++id}` });
    const { ticket, result, state } = await rankedRun(service, clock, 'run-v6');
    expect(ticket.rulesetVersion).toBe('rush-sectors-v12-rookie');
    expect(result.row.verified).toBe(true);
    expect(result.row.score).toBe(state.score);
  });
});

describe('day streak', () => {
  it('counts consecutive days and keeps today open until it is over', () => {
    expect(blitzRiderProgress({ dates: [], scores: [], today: '2026-09-19' })).toEqual({ dayStreak: 0, daysRidden: 0, bestScore: 0, riddenToday: false });
    // Rode yesterday and the day before, not yet today: still a streak of two.
    expect(blitzRiderProgress({ dates: ['2026-09-17', '2026-09-18'], scores: [5, 9], today: '2026-09-19' })).toMatchObject({ dayStreak: 2, riddenToday: false, bestScore: 9 });
    expect(blitzRiderProgress({ dates: ['2026-09-17', '2026-09-18', '2026-09-19'], scores: [1, 1, 1], today: '2026-09-19' })).toMatchObject({ dayStreak: 3, riddenToday: true });
  });

  it('breaks on a missed day, and counts a day once however many cities', () => {
    const progress = blitzRiderProgress({ dates: ['2026-09-10', '2026-09-11', '2026-09-13', '2026-09-13'], scores: [1, 2, 3, 4], today: '2026-09-14' });
    expect(progress.dayStreak).toBe(1);
    expect(progress.daysRidden).toBe(3);
    expect(blitzRiderProgress({ dates: ['2026-09-10'], scores: [1], today: '2026-09-14' }).dayStreak).toBe(0);
  });

  it('is counted by the server from verified rows only', async () => {
    const clock = { now: Date.parse('2026-09-18T10:00:00.000Z') };
    let id = 0;
    const service = createAtlasBlitzService({ identity, now: () => clock.now, randomId: () => `id-${++id}` });
    expect(await service.progress('cycle-2', wallet)).toMatchObject({ dayStreak: 0, daysRidden: 0 });
    await rankedRun(service, clock, 'run-day-1');
    clock.now = Date.parse('2026-09-19T10:00:00.000Z');
    expect(await service.progress('cycle-2', wallet)).toMatchObject({ dayStreak: 1, riddenToday: false, daysRidden: 1 });
    await rankedRun(service, clock, 'run-day-2');
    const after = await service.progress('cycle-2', wallet);
    expect(after).toMatchObject({ dayStreak: 2, riddenToday: true, daysRidden: 2 });
    expect(after.bestScore).toBeGreaterThan(0);
    expect(await service.progress('cycle-2', 'NQ99 SOMEONE ELSE')).toMatchObject({ dayStreak: 0, daysRidden: 0 });
  });
});

describe('badges', () => {
  it('awards nothing for a run that did not finish', () => {
    expect(blitzRunBadges(createBlitzRun({ cityId: 'lagos', seed: 'seed' }))).toEqual([]);
  });

  it('awards each badge for its condition and withholds it without', () => {
    const base = { ...createBlitzRun({ cityId: 'lagos', seed: 'seed' }), phase: 'finished' as const };
    const all = blitzRunBadges({
      ...base,
      tokensTaken: 10_000, collisions: 0, rivalContacts: 0, lineScore: 2_700, trailBest: 20,
      missions: base.missions.map((mission) => ({ ...mission, status: 'complete' as const })),
    });
    expect([...all].sort()).toEqual(BLITZ_BADGES.map((badge) => badge.id).sort());
    const none = blitzRunBadges({ ...base, tokensTaken: 0, collisions: 1, lineScore: 1_800, trailBest: 19 });
    expect(none).toEqual([]);
  });
});
