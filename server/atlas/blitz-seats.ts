/*
 * Seats.
 *
 * A challenge has a fixed number of places and they are taken first come,
 * first served. A private lobby is the same thing with a link instead of a
 * queue: a rider makes one, sends it to friends, and the first seven people
 * through the door are the field.
 *
 * WHAT MAKES THIS DELICATE
 *
 * Seats decide who is eligible for a funded pool, so a bug here is a fairness
 * bug rather than a cosmetic one. Three things have to hold under any amount
 * of simultaneous traffic:
 *
 *   1. Two riders can never hold the same seat.
 *   2. One wallet can never hold two seats in the same lobby.
 *   3. A lobby can never seat more riders than its capacity.
 *
 * None of those survive read-then-write on their own, because two claims that
 * both read "seat 3 is free" will both take seat 3. So every claim is a
 * compare-and-set against the version it read, and a claim that loses the race
 * re-reads and tries again rather than overwriting. The store has to provide
 * that primitive; it is the only thing this module cannot do for itself.
 *
 * Nothing here takes payment. Entry is free, and a seat is a place in a skill
 * contest rather than a stake in a pot.
 */

/** Seven is the most a lobby can seat, including the rider who made it. */
export const BLITZ_MAX_SEATS = 7;
/** Fewer than two is not a race. */
export const BLITZ_MIN_SEATS = 2;
/** How many times a claim will re-read and retry after losing a race. */
const CLAIM_ATTEMPTS = 6;

export type BlitzLobbyKind = 'daily' | 'private';

export interface BlitzSeat {
  /** 1-based, and stable: the number a rider is told is the number they keep. */
  readonly seat: number;
  readonly actorId: string;
  readonly walletAddress: string;
  readonly claimedAt: number;
}

export interface BlitzLobby {
  readonly id: string;
  readonly kind: BlitzLobbyKind;
  readonly challengeId: string;
  readonly capacity: number;
  /** Null for the daily lobby, which nobody owns. */
  readonly hostWallet: string | null;
  readonly createdAt: number;
  readonly expiresAt: number;
}

export interface BlitzLobbyRecord {
  readonly lobby: BlitzLobby;
  readonly seats: readonly BlitzSeat[];
}

export interface BlitzSeatStore {
  read(lobbyId: string): Promise<{ readonly record: BlitzLobbyRecord; readonly version: number } | null>;
  create(record: BlitzLobbyRecord): Promise<void>;
  /**
   * Write only if the lobby is still at `expectedVersion`.
   *
   * False means somebody else claimed in between, and the caller must re-read.
   * This is the whole of the concurrency story: without it, two riders get the
   * same seat.
   */
  compareAndSet(lobbyId: string, expectedVersion: number, record: BlitzLobbyRecord): Promise<boolean>;
}

export type BlitzSeatRefusal =
  | 'unknown_lobby'
  | 'lobby_closed'
  | 'lobby_full'
  | 'invalid_wallet';

export type BlitzSeatResult =
  | { readonly ok: true; readonly seat: BlitzSeat; readonly lobby: BlitzLobby; readonly taken: number }
  | { readonly ok: false; readonly reason: BlitzSeatRefusal };

/**
 * Open a lobby.
 *
 * The id is the invitation, so it has to be unguessable: a lobby id that could
 * be counted up to would let anybody walk into a private race. The caller
 * supplies the randomness so this stays testable and so the entropy source is
 * a deliberate choice rather than whatever was in scope.
 */
export async function createBlitzLobby(input: {
  readonly store: BlitzSeatStore;
  readonly kind: BlitzLobbyKind;
  readonly challengeId: string;
  readonly capacity: number;
  readonly hostWallet: string | null;
  readonly now: number;
  readonly expiresAt: number;
  readonly randomId: () => string;
}): Promise<BlitzLobby> {
  const capacity = Math.min(BLITZ_MAX_SEATS, Math.max(BLITZ_MIN_SEATS, Math.floor(input.capacity)));
  if (!Number.isSafeInteger(capacity)) throw new Error('Beacon Blitz lobby capacity must be a whole number of seats.');
  if (input.expiresAt <= input.now) throw new Error('Beacon Blitz lobby cannot expire before it opens.');
  const id = input.randomId();
  if (!/^[A-Za-z0-9_-]{16,64}$/.test(id)) {
    // A short or oddly-shaped id is a guessable invitation, which is the one
    // way a private lobby stops being private.
    throw new Error('Beacon Blitz lobby id is not random enough to be an invitation.');
  }
  const lobby: BlitzLobby = {
    id,
    kind: input.kind,
    challengeId: input.challengeId,
    capacity,
    hostWallet: input.hostWallet,
    createdAt: input.now,
    expiresAt: input.expiresAt,
  };
  await input.store.create({ lobby, seats: [] });
  return lobby;
}

/**
 * Take a seat, first come first served.
 *
 * Idempotent per wallet: a rider who claims twice - a double tap, a retry
 * after a dropped connection, a second device - keeps the seat they already
 * had rather than taking a second one from somebody else.
 */
export async function claimBlitzSeat(input: {
  readonly store: BlitzSeatStore;
  readonly lobbyId: string;
  readonly actorId: string;
  readonly walletAddress: string;
  readonly now: number;
}): Promise<BlitzSeatResult> {
  const wallet = normaliseWallet(input.walletAddress);
  if (!wallet) return { ok: false, reason: 'invalid_wallet' };

  for (let attempt = 0; attempt < CLAIM_ATTEMPTS; attempt += 1) {
    const current = await input.store.read(input.lobbyId);
    if (!current) return { ok: false, reason: 'unknown_lobby' };
    const { record, version } = current;
    if (input.now >= record.lobby.expiresAt) return { ok: false, reason: 'lobby_closed' };

    const held = record.seats.find((seat) => normaliseWallet(seat.walletAddress) === wallet);
    if (held) return { ok: true, seat: held, lobby: record.lobby, taken: record.seats.length };
    if (record.seats.length >= record.lobby.capacity) return { ok: false, reason: 'lobby_full' };

    const seat: BlitzSeat = {
      seat: lowestFreeSeat(record),
      actorId: input.actorId,
      walletAddress: wallet,
      claimedAt: input.now,
    };
    const next: BlitzLobbyRecord = { lobby: record.lobby, seats: [...record.seats, seat] };
    if (await input.store.compareAndSet(input.lobbyId, version, next)) {
      return { ok: true, seat, lobby: record.lobby, taken: next.seats.length };
    }
    // Lost the race. Re-read and try again: the seat we chose is gone, and
    // the rider may even turn out to be seated already.
  }
  // Six riders beat us to the write in a row. Reporting the lobby as full is
  // the honest answer - it is certainly not empty - and it never invents a seat.
  return { ok: false, reason: 'lobby_full' };
}

/** Who is in, for a lobby screen. Never exposes the actor id. */
export async function readBlitzLobby(input: {
  readonly store: BlitzSeatStore;
  readonly lobbyId: string;
}): Promise<{ readonly lobby: BlitzLobby; readonly seats: readonly Omit<BlitzSeat, 'actorId'>[] } | null> {
  const current = await input.store.read(input.lobbyId);
  if (!current) return null;
  return {
    lobby: current.record.lobby,
    seats: current.record.seats
      .map(({ seat, walletAddress, claimedAt }) => ({ seat, walletAddress, claimedAt }))
      .sort((left, right) => left.seat - right.seat),
  };
}

/*
 * The lowest number nobody holds.
 *
 * Counting seats and adding one would hand out a duplicate the moment a seat
 * is ever released, and would hide a gap rather than fill it.
 */
function lowestFreeSeat(record: BlitzLobbyRecord): number {
  const taken = new Set(record.seats.map((seat) => seat.seat));
  for (let seat = 1; seat <= record.lobby.capacity; seat += 1) if (!taken.has(seat)) return seat;
  throw new Error('Beacon Blitz lobby has no free seat, which the caller should have checked.');
}

/*
 * Nimiq prints an address in spaced groups and a rider may arrive with either
 * form. Comparing raw strings would let one wallet hold two seats.
 */
function normaliseWallet(address: string): string {
  return typeof address === 'string' ? address.replace(/\s/g, '').toUpperCase() : '';
}
