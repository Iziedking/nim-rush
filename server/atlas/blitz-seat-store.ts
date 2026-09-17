import type { AtlasStateStore } from './persistence';
import type { BlitzLobbyRecord, BlitzSeatStore } from './blitz-seats';

/*
 * Durable seats.
 *
 * An invite link that stops working when the server restarts is not an invite
 * link, so lobbies live in the same durable projection everything else does.
 *
 * HOW TWO RIDERS ARE KEPT OFF ONE SEAT
 *
 * The seat ledger needs compare-and-set. This used to get it from a promise
 * chain, which made read-modify-write atomic inside one process and did
 * nothing at all across two - each instance had its own queue, so two servers
 * could both read "seat 1 is free", both pass the check, and the second write
 * would erase the first rider silently. A seat decides who is eligible for a
 * funded pool, so that is a fairness bug, not a race worth tolerating.
 *
 * Every operation now runs inside `state.transact`, which holds the
 * repository's cross-process lock - an atomically created directory, with
 * stale-lock recovery - and re-reads the records from disk before deciding.
 * The decision is made against what is actually stored rather than against
 * whatever this process last cached, which is the part that makes it correct
 * with more than one instance running.
 */

const KEY = 'blitz-lobbies';

interface StoredLobby {
  readonly record: BlitzLobbyRecord;
  readonly version: number;
}

type StoredLobbies = Record<string, StoredLobby>;

export function createBlitzSeatStore(state: AtlasStateStore, now: () => number = Date.now): BlitzSeatStore {
  /*
   * Expired lobbies are dropped whenever the record is written.
   *
   * A day's lobbies are dead the moment the day closes, and keeping them would
   * grow one projection file forever for no reader.
   */
  const withoutExpired = (all: StoredLobbies): StoredLobbies => {
    const at = now();
    const kept: StoredLobbies = {};
    for (const [id, stored] of Object.entries(all)) if (stored.record.lobby.expiresAt > at) kept[id] = stored;
    return kept;
  };

  return {
    read: (lobbyId) => state.transact(async (records) => {
      const stored = (await records.load<StoredLobbies>(KEY, {}))[lobbyId];
      return stored ? { record: stored.record, version: stored.version } : null;
    }),

    create: (record) => state.transact(async (records) => {
      const all = await records.load<StoredLobbies>(KEY, {});
      // A repeated id would hand somebody else's lobby to a new host. The id
      // is random, so this guards a broken generator rather than a race.
      if (all[record.lobby.id]) throw new Error('Beacon Blitz lobby id already exists.');
      records.save(KEY, { ...withoutExpired(all), [record.lobby.id]: { record, version: 1 } });
    }),

    compareAndSet: (lobbyId, expectedVersion, record) => state.transact(async (records) => {
      const all = await records.load<StoredLobbies>(KEY, {});
      const stored = all[lobbyId];
      // Read from disk, inside the lock. A version that moved means another
      // rider - possibly on another instance - took the seat we were about to.
      if (!stored || stored.version !== expectedVersion) return false;
      records.save(KEY, { ...withoutExpired(all), [lobbyId]: { record, version: stored.version + 1 } });
      return true;
    }),
  };
}
