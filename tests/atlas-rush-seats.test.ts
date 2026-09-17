import { describe, expect, it } from 'vitest';

import {
  BLITZ_MAX_SEATS,
  claimBlitzSeat,
  createBlitzLobby,
  readBlitzLobby,
  type BlitzLobbyRecord,
  type BlitzSeatStore,
} from '../server/atlas/blitz-seats';

/*
 * Seats decide who is eligible for a funded pool, so a bug here is a fairness
 * bug and not a cosmetic one. Three things have to hold under any amount of
 * simultaneous traffic: no two riders on one seat, no wallet on two seats, and
 * never more riders than the lobby can hold.
 */

/** A store that behaves like a real one: versioned, and it refuses stale writes. */
function store(): BlitzSeatStore & { conflictOnce(): void; lobbies: Map<string, { record: BlitzLobbyRecord; version: number }> } {
  const lobbies = new Map<string, { record: BlitzLobbyRecord; version: number }>();
  let injectConflict = false;
  return {
    lobbies,
    conflictOnce() { injectConflict = true; },
    async read(id) {
      const found = lobbies.get(id);
      return found ? { record: found.record, version: found.version } : null;
    },
    async create(record) {
      lobbies.set(record.lobby.id, { record, version: 1 });
    },
    async compareAndSet(id, expectedVersion, record) {
      if (injectConflict) { injectConflict = false; return false; }
      const found = lobbies.get(id);
      if (!found || found.version !== expectedVersion) return false;
      lobbies.set(id, { record, version: found.version + 1 });
      return true;
    },
  };
}

const ids = () => {
  let n = 0;
  return () => `lobby${String(++n).padStart(2, '0')}_${'x'.repeat(20)}`;
};

async function lobby(seatStore: BlitzSeatStore, capacity = 7, now = 1_000) {
  return createBlitzLobby({
    store: seatStore,
    kind: 'private',
    challengeId: 'cycle-2:lagos:2026-09-17',
    capacity,
    hostWallet: 'NQ07 AAAA',
    now,
    expiresAt: now + 86_400_000,
    randomId: ids(),
  });
}

const wallet = (n: number) => `NQ07 ${String(n).repeat(4)} 0000 0000 0000 0000 0000 0000 0000`;

describe('opening a lobby', () => {
  it('never seats more than seven, or fewer than two', async () => {
    const seats = store();
    expect((await lobby(seats, 99)).capacity).toBe(BLITZ_MAX_SEATS);
    expect((await lobby(seats, 0)).capacity).toBe(2);
    expect((await lobby(seats, 4)).capacity).toBe(4);
  });

  /*
   * The id is the invitation. One that could be counted up to would let
   * anybody walk into a private race, so a weak one is refused outright rather
   * than quietly accepted.
   */
  it('refuses an id too guessable to be an invitation', async () => {
    const seats = store();
    await expect(createBlitzLobby({
      store: seats, kind: 'private', challengeId: 'c', capacity: 4, hostWallet: null,
      now: 1_000, expiresAt: 2_000, randomId: () => '7',
    })).rejects.toThrow(/random/i);
  });

  it('refuses a lobby that expires before it opens', async () => {
    const seats = store();
    await expect(createBlitzLobby({
      store: seats, kind: 'private', challengeId: 'c', capacity: 4, hostWallet: null,
      now: 5_000, expiresAt: 5_000, randomId: ids(),
    })).rejects.toThrow(/expire/i);
  });
});

describe('taking a seat', () => {
  it('hands out seats in order, first come first served', async () => {
    const seats = store();
    const open = await lobby(seats);
    const first = await claimBlitzSeat({ store: seats, lobbyId: open.id, actorId: 'a', walletAddress: wallet(1), now: 2_000 });
    const second = await claimBlitzSeat({ store: seats, lobbyId: open.id, actorId: 'b', walletAddress: wallet(2), now: 2_001 });
    expect(first.ok && first.seat.seat).toBe(1);
    expect(second.ok && second.seat.seat).toBe(2);
    expect(second.ok && second.taken).toBe(2);
  });

  /*
   * A double tap, a retry after a dropped connection, a second device. None of
   * them may take a seat away from somebody else.
   */
  it('gives one wallet one seat, however many times it asks', async () => {
    const seats = store();
    const open = await lobby(seats);
    const first = await claimBlitzSeat({ store: seats, lobbyId: open.id, actorId: 'a', walletAddress: wallet(1), now: 2_000 });
    const again = await claimBlitzSeat({ store: seats, lobbyId: open.id, actorId: 'a', walletAddress: wallet(1), now: 2_500 });
    // Spaced differently, and on a different device: still the same rider.
    const spaced = await claimBlitzSeat({ store: seats, lobbyId: open.id, actorId: 'other-device', walletAddress: wallet(1).replace(/\s/g, '').toLowerCase(), now: 3_000 });
    expect(first.ok && first.seat.seat).toBe(1);
    expect(again.ok && again.seat.seat).toBe(1);
    expect(spaced.ok && spaced.seat.seat).toBe(1);
    expect((await readBlitzLobby({ store: seats, lobbyId: open.id }))!.seats).toHaveLength(1);
  });

  it('turns a rider away from a full lobby rather than overfilling it', async () => {
    const seats = store();
    const open = await lobby(seats, 2);
    await claimBlitzSeat({ store: seats, lobbyId: open.id, actorId: 'a', walletAddress: wallet(1), now: 2_000 });
    await claimBlitzSeat({ store: seats, lobbyId: open.id, actorId: 'b', walletAddress: wallet(2), now: 2_001 });
    const late = await claimBlitzSeat({ store: seats, lobbyId: open.id, actorId: 'c', walletAddress: wallet(3), now: 2_002 });
    expect(late).toEqual({ ok: false, reason: 'lobby_full' });
    expect((await readBlitzLobby({ store: seats, lobbyId: open.id }))!.seats).toHaveLength(2);
  });

  it('closes with its challenge', async () => {
    const seats = store();
    const open = await lobby(seats);
    const late = await claimBlitzSeat({ store: seats, lobbyId: open.id, actorId: 'a', walletAddress: wallet(1), now: open.expiresAt });
    expect(late).toEqual({ ok: false, reason: 'lobby_closed' });
  });

  it('refuses a lobby nobody opened, and a rider with no wallet', async () => {
    const seats = store();
    const open = await lobby(seats);
    expect(await claimBlitzSeat({ store: seats, lobbyId: 'not-a-lobby', actorId: 'a', walletAddress: wallet(1), now: 2_000 }))
      .toEqual({ ok: false, reason: 'unknown_lobby' });
    expect(await claimBlitzSeat({ store: seats, lobbyId: open.id, actorId: 'a', walletAddress: '  ', now: 2_000 }))
      .toEqual({ ok: false, reason: 'invalid_wallet' });
  });

  /*
   * The race this whole design exists for. Two riders who both read "seat 1 is
   * free" must not both get seat 1 - so a claim that loses the compare-and-set
   * re-reads and takes the next seat instead of overwriting.
   */
  it('gives two riders different seats when they claim at the same moment', async () => {
    const seats = store();
    const open = await lobby(seats);
    seats.conflictOnce();
    const a = await claimBlitzSeat({ store: seats, lobbyId: open.id, actorId: 'a', walletAddress: wallet(1), now: 2_000 });
    const b = await claimBlitzSeat({ store: seats, lobbyId: open.id, actorId: 'b', walletAddress: wallet(2), now: 2_000 });
    expect(a.ok && b.ok).toBe(true);
    expect(a.ok && b.ok && a.seat.seat).not.toBe(b.ok && b.seat.seat);
    const all = (await readBlitzLobby({ store: seats, lobbyId: open.id }))!.seats;
    expect(new Set(all.map((seat) => seat.seat)).size).toBe(all.length);
  });

  /*
   * A released seat leaves a gap, and the gap is what the next rider gets.
   * Counting seats and adding one would hand out a number somebody already has.
   */
  it('fills a gap rather than counting past it', async () => {
    const seats = store();
    const open = await lobby(seats, 3);
    for (const index of [1, 2, 3]) {
      await claimBlitzSeat({ store: seats, lobbyId: open.id, actorId: `a${index}`, walletAddress: wallet(index), now: 2_000 + index });
    }
    // Seat 2 gives theirs up.
    const held = seats.lobbies.get(open.id)!;
    seats.lobbies.set(open.id, {
      version: held.version + 1,
      record: { lobby: held.record.lobby, seats: held.record.seats.filter((seat) => seat.seat !== 2) },
    });
    const next = await claimBlitzSeat({ store: seats, lobbyId: open.id, actorId: 'd', walletAddress: wallet(9), now: 3_000 });
    expect(next.ok && next.seat.seat).toBe(2);
  });
});

describe('what a lobby screen may see', () => {
  it('shows the field in seat order and never the actor id', async () => {
    const seats = store();
    const open = await lobby(seats);
    await claimBlitzSeat({ store: seats, lobbyId: open.id, actorId: 'secret-actor', walletAddress: wallet(2), now: 2_001 });
    await claimBlitzSeat({ store: seats, lobbyId: open.id, actorId: 'another', walletAddress: wallet(1), now: 2_000 });
    const view = (await readBlitzLobby({ store: seats, lobbyId: open.id }))!;
    expect(view.seats.map((seat) => seat.seat)).toEqual([1, 2]);
    expect(JSON.stringify(view)).not.toContain('secret-actor');
  });

  it('is null for a lobby nobody opened', async () => {
    expect(await readBlitzLobby({ store: store(), lobbyId: 'nope' })).toBeNull();
  });
});
