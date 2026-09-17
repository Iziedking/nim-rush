import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { createAtlasJsonRepository, createAtlasStateStore } from '../server/atlas/persistence';
import { createBlitzSeatStore } from '../server/atlas/blitz-seat-store';
import { claimBlitzSeat, createBlitzLobby, readBlitzLobby } from '../server/atlas/blitz-seats';

/*
 * Seats, against the real file-backed store rather than a double.
 *
 * The earlier store got its atomicity from a promise chain, which isolated
 * within one process and did nothing across two: each instance had its own
 * queue, so two servers could both read "seat 1 is free", both pass the check,
 * and the second write would erase the first rider without a word. A seat
 * decides who is eligible for a funded pool, so this is the difference between
 * a fair race and a silently stolen place.
 *
 * These tests build two completely independent stores over one directory,
 * which is the closest thing to two server instances that a test can be.
 */

const directories: string[] = [];

async function instance() {
  return async (directory: string) => {
    const repository = createAtlasJsonRepository({ directory, lockStaleMs: 5_000 });
    const state = createAtlasStateStore(repository);
    await state.initialise();
    return createBlitzSeatStore(state);
  };
}

async function freshDirectory() {
  const directory = await mkdtemp(join(tmpdir(), 'nim-rush-seats-'));
  directories.push(directory);
  return directory;
}

afterEach(async () => {
  for (const directory of directories.splice(0)) {
    await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }).catch(() => undefined);
  }
});

const wallet = (n: number) => `NQ07 ${String(n).repeat(4)} 0000 0000 0000 0000 0000 0000 0000`;

describe('seats survive a restart', () => {
  it('still holds the field when the process goes away', { timeout: 30_000 }, async () => {
    const directory = await freshDirectory();
    const build = await instance();

    const first = await build(directory);
    const lobby = await createBlitzLobby({
      store: first, kind: 'private', challengeId: 'c', capacity: 4, hostWallet: wallet(1),
      now: Date.now(), expiresAt: Date.now() + 3_600_000, randomId: () => `a${'b'.repeat(23)}`,
    });
    await claimBlitzSeat({ store: first, lobbyId: lobby.id, actorId: 'x'.repeat(16), walletAddress: wallet(1), now: Date.now() });

    // A completely separate store over the same directory: a restart, or a
    // second instance. The invite link has to keep working.
    const second = await build(directory);
    const view = await readBlitzLobby({ store: second, lobbyId: lobby.id });
    expect(view?.seats).toHaveLength(1);
    expect(view?.lobby.capacity).toBe(4);
  });
});

describe('two instances cannot seat two riders on one seat', () => {
  /*
   * The bug the promise queue could not prevent. Both stores read the lobby
   * before either writes, which is exactly the interleaving that used to lose
   * a rider.
   */
  it('gives simultaneous claims from separate instances different seats', { timeout: 30_000 }, async () => {
    const directory = await freshDirectory();
    const build = await instance();
    const alpha = await build(directory);
    const beta = await build(directory);

    const lobby = await createBlitzLobby({
      store: alpha, kind: 'private', challengeId: 'c', capacity: 7, hostWallet: null,
      now: Date.now(), expiresAt: Date.now() + 3_600_000, randomId: () => `c${'d'.repeat(23)}`,
    });

    const claims = await Promise.all([
      claimBlitzSeat({ store: alpha, lobbyId: lobby.id, actorId: '1'.repeat(16), walletAddress: wallet(1), now: Date.now() }),
      claimBlitzSeat({ store: beta, lobbyId: lobby.id, actorId: '2'.repeat(16), walletAddress: wallet(2), now: Date.now() }),
      claimBlitzSeat({ store: alpha, lobbyId: lobby.id, actorId: '3'.repeat(16), walletAddress: wallet(3), now: Date.now() }),
      claimBlitzSeat({ store: beta, lobbyId: lobby.id, actorId: '4'.repeat(16), walletAddress: wallet(4), now: Date.now() }),
    ]);

    expect(claims.every((claim) => claim.ok)).toBe(true);
    const seats = claims.map((claim) => (claim.ok ? claim.seat.seat : -1));
    // Four riders, four distinct seats. A duplicate here means somebody's
    // place was handed to somebody else.
    expect(new Set(seats).size).toBe(4);

    // And the stored field agrees with what each rider was told.
    const view = await readBlitzLobby({ store: await build(directory), lobbyId: lobby.id });
    expect(view?.seats).toHaveLength(4);
    expect(new Set(view!.seats.map((seat) => seat.seat)).size).toBe(4);
  });

  it('never seats more riders than a lobby holds, whichever instance asks', { timeout: 30_000 }, async () => {
    const directory = await freshDirectory();
    const build = await instance();
    const alpha = await build(directory);
    const beta = await build(directory);

    const lobby = await createBlitzLobby({
      store: alpha, kind: 'private', challengeId: 'c', capacity: 2, hostWallet: null,
      now: Date.now(), expiresAt: Date.now() + 3_600_000, randomId: () => `e${'f'.repeat(23)}`,
    });

    const claims = await Promise.all([1, 2, 3, 4, 5].map((rider) => claimBlitzSeat({
      store: rider % 2 === 0 ? beta : alpha,
      lobbyId: lobby.id,
      actorId: String(rider).repeat(16).slice(0, 16),
      walletAddress: wallet(rider),
      now: Date.now(),
    })));

    expect(claims.filter((claim) => claim.ok)).toHaveLength(2);
    expect(claims.filter((claim) => !claim.ok && claim.reason === 'lobby_full')).toHaveLength(3);
    const view = await readBlitzLobby({ store: await build(directory), lobbyId: lobby.id });
    expect(view?.seats).toHaveLength(2);
  });
});
