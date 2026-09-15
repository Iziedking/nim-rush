import { describe, expect, it } from 'vitest';
import { createBlitzRun, stepBlitzRun } from '../shared/atlas/blitz/core';
import { hashBlitzTrace, replayBlitzTrace } from '../shared/atlas/blitz/replay';
import type { BlitzTraceFrame } from '../shared/atlas/blitz/types';
import type { BlitzSubmissionInput } from '../shared/atlas/blitz/competition';
import { createAtlasBlitzService } from '../server/atlas/blitz';
import { createAtlasStateStore, type AtlasRepositorySnapshot, type AtlasStateStore } from '../server/atlas/persistence';

async function fixture(stateStore?: AtlasStateStore) {
  let clock = 1_000;
  let id = 0;
  let qualifications = 0;
  const identity = { getBinding: (actorId: string, seasonId: string) => ({ actorId, seasonId, address: 'wallet-a', network: 'testalbatross' as const, publicKey: 'aa', boundAt: 0 }) };
  const service = createAtlasBlitzService({ identity, stateStore, now: () => clock, randomId: () => `ticket-${++id}`, daily: { qualifyVerifiedRun: async () => { qualifications++; return { accepted: true, eligible: true, date: '2026-09-15' }; } } });
  const ticket = await service.issueTicket({ actorId: 'actor-a', walletAddress: 'wallet-a', username: 'Rider', cityId: 'lagos', seasonId: 'test-season' });
  let state = createBlitzRun({ cityId: ticket.cityId, seed: ticket.seed });
  const frames: BlitzTraceFrame[] = [];
  while (state.phase !== 'finished' && state.phase !== 'timeout') {
    const relayChoice = state.activeRelay ? state.missions[state.activeRelay.missionIndex]!.correctChoice : undefined;
    const input = { steer: 0, drift: false, boost: false, relayChoice };
    frames.push({ tick: frames.length, input });
    state = stepBlitzRun(state, input);
  }
  const submission: BlitzSubmissionInput = { runId: 'run-a', ticketId: ticket.id, actorId: ticket.actorId, walletAddress: ticket.walletAddress, username: ticket.username, cityId: ticket.cityId, seasonId: ticket.seasonId, seed: ticket.seed, frames, traceHash: await hashBlitzTrace(frames), claimedScore: state.score };
  clock = ticket.issuedAt + Math.ceil(state.tick * 1_000 / 30);
  return { service, submission, ticket, frames, setClock: (value: number) => { clock = value; }, qualifications: () => qualifications };
}

describe('Blitz integrity regressions', () => {
  it('hashes every steering bit used by the simulator', async () => {
    const frame = (steer: number): BlitzTraceFrame[] => [{ tick: 0, input: { steer, drift: false, boost: false } }];
    expect(await hashBlitzTrace(frame(0.1001))).not.toBe(await hashBlitzTrace(frame(0.1002)));
  });

  it('rejects controls appended after the authoritative finish', async () => {
    const f = await fixture();
    const frames = [...f.frames, { tick: f.frames.length, input: { steer: 0, drift: false, boost: false } }];
    expect(() => replayBlitzTrace({ cityId: 'lagos', seed: f.ticket.seed, frames })).toThrow(/after.*finish|terminal/i);
  });

  it('bounds hash work and validates boolean controls before digesting', async () => {
    const frames = Array.from({ length: 3_001 }, (_, tick) => ({ tick, input: { steer: 0, drift: false, boost: false } }));
    await expect(hashBlitzTrace(frames)).rejects.toThrow(/long|limit/i);
    // Deliberately malformed wire input must be rejected even outside the HTTP schema.
    const malformed = [{ tick: 0, input: { steer: 0, drift: 'yes', boost: false } }] as unknown as BlitzTraceFrame[];
    await expect(hashBlitzTrace(malformed)).rejects.toThrow(/input/i);
  });

  it('refuses a complete computed replay delivered before its duration elapsed', async () => {
    const f = await fixture();
    f.setClock(f.ticket.issuedAt + 1);
    await expect(f.service.submit(f.submission)).rejects.toThrow(/elapsed|duration|early/i);
    expect(f.service.serialise().runs).toHaveLength(0);
    expect(f.qualifications()).toBe(0);
  });

  it('consumes a ticket once under simultaneous distinct run IDs', async () => {
    const f = await fixture();
    const results = await Promise.allSettled(Array.from({ length: 8 }, (_, i) => f.service.submit({ ...f.submission, runId: `race-${i}` })));
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(f.service.serialise().runs).toHaveLength(1);
    expect(f.qualifications()).toBe(1);
  });

  it('returns one acceptance and idempotent receipts for simultaneous exact retries', async () => {
    const f = await fixture();
    const results = await Promise.all(Array.from({ length: 8 }, () => f.service.submit(f.submission)));
    expect(results.filter((r) => !r.duplicate)).toHaveLength(1);
    expect(f.qualifications()).toBe(1);
  });

  it('does not reuse a receipt for changed wallet metadata or changed controls', async () => {
    const f = await fixture();
    await f.service.submit(f.submission);
    await expect(f.service.submit({ ...f.submission, walletAddress: 'unsigned-wallet' })).rejects.toThrow();
    const frames = structuredClone(f.frames);
    frames[100] = { tick: 100, input: { steer: 1, drift: false, boost: false } };
    await expect(f.service.submit({ ...f.submission, frames })).rejects.toThrow(/hash|controls/i);
  });

  it('rolls back failed persistence and durably accepts the same retry', async () => {
    let fail = false;
    let durable: unknown = null;
    const store: AtlasStateStore = {
      load: async <T>(_key: string, fallback: T) => structuredClone((durable ?? fallback) as T),
      save: async <T>(_key: string, value: T) => { if (fail) throw new Error('disk unavailable'); durable = structuredClone(value); },
    };
    const f = await fixture(store);
    fail = true;
    await expect(f.service.submit(f.submission)).rejects.toThrow(/disk/);
    expect(f.service.serialise().runs).toHaveLength(0);
    expect(await f.service.leaderboard('test-season', 'lagos')).toHaveLength(0);
    expect(f.qualifications()).toBe(0);
    fail = false;
    expect((await f.service.submit(f.submission)).duplicate).toBe(false);
    expect((durable as { runs: unknown[] }).runs).toHaveLength(1);
  });

  it('keeps failed store writes out of later unrelated persisted records', async () => {
    let fail = false;
    let durable: AtlasRepositorySnapshot | null = null;
    const store = createAtlasStateStore({ snapshotPath: 'fixture', lockPath: 'fixture.lock', load: async () => ({ snapshot: durable, recoveredFromBackup: false }), listBackups: async () => [], save: async (snapshot) => { if (fail) throw new Error('disk unavailable'); durable = structuredClone(snapshot); } });
    await store.save('blitz', { runs: [] });
    fail = true;
    await expect(store.save('blitz', { runs: ['uncommitted'] })).rejects.toThrow(/disk/);
    expect(await store.load('blitz', null)).toEqual({ runs: [] });
    fail = false;
    await store.save('other', { ok: true });
    expect(await store.load('blitz', null)).toEqual({ runs: [] });
  });

  it('restores accepted results and refuses ticket reuse after restart', async () => {
    const f = await fixture();
    await f.service.submit(f.submission);
    const restored = createAtlasBlitzService({
      now: () => f.ticket.issuedAt + 90_000,
      identity: { getBinding: (actorId, seasonId) => ({ actorId, seasonId, address: 'wallet-a', network: 'testalbatross', publicKey: 'aa', boundAt: 0 }) },
    });
    restored.restore(f.service.serialise());
    expect((await restored.leaderboard('test-season', 'lagos'))[0]?.runId).toBe('run-a');
    expect((await restored.submit(f.submission)).duplicate).toBe(true);
    await expect(restored.submit({ ...f.submission, runId: 'after-restart' })).rejects.toThrow(/already been used/);
  });

  it('retries a failed initial load instead of presenting an empty board as loaded', async () => {
    const f = await fixture();
    await f.service.submit(f.submission);
    let calls = 0;
    const restored = createAtlasBlitzService({
      identity: { getBinding: () => null },
      stateStore: {
        load: async <T>() => { if (++calls === 1) throw new Error('storage offline'); return f.service.serialise() as T; },
        save: async () => undefined,
      },
    });
    await expect(restored.leaderboard('test-season', 'lagos')).rejects.toThrow(/offline/);
    expect((await restored.leaderboard('test-season', 'lagos'))[0]?.runId).toBe('run-a');
  });
});
