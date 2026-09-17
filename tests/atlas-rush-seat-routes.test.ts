import { describe, expect, it } from 'vitest';
import express from 'express';

import { createAtlasApi, mountAtlasRoutes } from '../server/atlas/routes';
import { ATLAS_CURRICULUM } from '../shared/atlas/manifest';
import { createAtlasStateStore } from '../server/atlas/persistence';
import { createBlitzSeatStore } from '../server/atlas/blitz-seat-store';
import { BLITZ_MAX_SEATS, claimBlitzSeat, createBlitzLobby, readBlitzLobby } from '../server/atlas/blitz-seats';

/*
 * Lobbies over the wire, against the durable store the server actually uses.
 *
 * The seat ledger is tested on its own elsewhere; what is tested here is the
 * boundary - that the link is the credential, that a refusal is reported as a
 * refusal rather than as a crash, and that a deployment with nowhere to keep a
 * lobby says so instead of handing out a seat it will forget.
 */

function repository() {
  let snapshot: unknown = null;
  return {
    /*
     * The envelope the real repository returns. The earlier double handed back
     * the bare records, so every read saw an empty store - which the in-memory
     * cache hid until transactions started reading from the repository itself.
     */
    load: async () => ({ snapshot, recoveredFromBackup: false }) as never,
    save: async (value: unknown) => { snapshot = value; },
    /*
     * The cross-process lock the real repository provides. In one test process
     * running the operation directly is the same isolation, but the double has
     * to offer it or a read-modify-write would run without any.
     */
    /*
     * The real repository hands the operation a writer, because it already
     * holds the lock and a nested save would wait on a lock its own caller
     * owns. The double has to do the same or the write lands nowhere.
     */
    transact: async <T,>(operation: (write: (value: unknown) => Promise<void>) => Promise<T>) =>
      operation(async (value: unknown) => { snapshot = value; }),
  };
}

async function server(withSeats = true) {
  const state = createAtlasStateStore(repository() as never);
  await state.initialise();
  const store = createBlitzSeatStore(state);
  let counter = 0;
  const seats = {
    open: (input: { actorId: string; walletAddress: string; capacity: number }) => createBlitzLobby({
      store, kind: 'private' as const, challengeId: 'cycle-2:lagos:2026-09-17',
      capacity: Math.min(BLITZ_MAX_SEATS, input.capacity), hostWallet: input.walletAddress,
      now: Date.now(), expiresAt: Date.now() + 3_600_000,
      randomId: () => `lobby${String(++counter).padStart(2, '0')}${'a'.repeat(20)}`,
    }),
    claim: (input: { lobbyId: string; actorId: string; walletAddress: string }) => claimBlitzSeat({ store, ...input, now: Date.now() }),
    read: (lobbyId: string) => readBlitzLobby({ store, lobbyId }),
  };
  const api = createAtlasApi({
    curriculum: ATLAS_CURRICULUM,
    now: () => new Date('2026-09-17T12:00:00.000Z'),
    blitzSeats: withSeats ? seats : undefined,
    authorize: async () => true,
  });
  const app = express();
  app.use(express.json());
  mountAtlasRoutes({ app, limit: () => (_request, _response, next) => next(), api });
  const listening = await new Promise<ReturnType<typeof app.listen>>((resolve) => { const s = app.listen(0, () => resolve(s)); });
  const address = listening.address();
  if (!address || typeof address === 'string') throw new Error('Test server did not expose a port.');
  return { base: `http://127.0.0.1:${address.port}`, close: () => new Promise<void>((resolve, reject) => listening.close((error) => error ? reject(error) : resolve())) };
}

/* The shape the route validates. Signing itself is stubbed by authorize. */
const auth = { challengeId: 'test-challenge', publicKeyJwk: { kty: 'EC', crv: 'P-256', x: 'xx', y: 'yy' }, signature: 'ab12' };
const wallet = (n: number) => `NQ07 ${String(n).repeat(4)} 0000 0000 0000 0000 0000 0000 0000`;

describe('lobbies over the wire', () => {
  it('opens a lobby, seats riders in order, and refuses the eighth', async () => {
    const { base, close } = await server();
    try {
      const opened = await fetch(`${base}/atlas/api/blitz/lobbies`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ actorId: 'a'.repeat(16), walletAddress: wallet(1), capacity: 7, auth }),
      });
      expect(opened.status).toBe(201);
      const lobby = (await opened.json() as { data: { id: string; capacity: number } }).data;
      expect(lobby.capacity).toBe(7);
      // The id is the invitation, so it must not be something anyone could type.
      expect(lobby.id).toMatch(/^[A-Za-z0-9_-]{16,64}$/);

      const claims = [];
      for (let rider = 1; rider <= 8; rider += 1) {
        const response = await fetch(`${base}/atlas/api/blitz/lobbies/${lobby.id}/seats`, {
          method: 'POST', headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ actorId: String(rider).repeat(16).slice(0, 16), walletAddress: wallet(rider), auth }),
        });
        claims.push({ status: response.status, body: await response.json() as Record<string, unknown> });
      }
      expect(claims.slice(0, 7).map((claim) => claim.status)).toEqual([201, 201, 201, 201, 201, 201, 201]);
      // A full lobby is a refusal a rider can act on, not a server error.
      expect(claims[7]!.status).toBe(409);
      expect(claims[7]!.body).toEqual({ ok: false, error: 'lobby_full' });

      const view = await (await fetch(`${base}/atlas/api/blitz/lobbies/${lobby.id}`)).json() as { data: { seats: { seat: number }[] } };
      expect(view.data.seats.map((seat) => seat.seat)).toEqual([1, 2, 3, 4, 5, 6, 7]);
      // The lobby screen never learns who anybody is beyond their wallet.
      expect(JSON.stringify(view)).not.toContain('333333');
    } finally { await close(); }
  });

  it('gives one wallet the same seat however many times it asks', async () => {
    const { base, close } = await server();
    try {
      const lobby = (await (await fetch(`${base}/atlas/api/blitz/lobbies`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ actorId: 'a'.repeat(16), walletAddress: wallet(1), capacity: 4, auth }),
      })).json() as { data: { id: string } }).data;
      const claim = () => fetch(`${base}/atlas/api/blitz/lobbies/${lobby.id}/seats`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ actorId: 'b'.repeat(16), walletAddress: wallet(2), auth }),
      }).then((response) => response.json() as Promise<{ data: { seat: { seat: number } } }>);
      expect((await claim()).data.seat.seat).toBe(1);
      expect((await claim()).data.seat.seat).toBe(1);
      const view = await (await fetch(`${base}/atlas/api/blitz/lobbies/${lobby.id}`)).json() as { data: { seats: unknown[] } };
      expect(view.data.seats).toHaveLength(1);
    } finally { await close(); }
  });

  it('refuses a malformed lobby id rather than looking it up', async () => {
    const { base, close } = await server();
    try {
      expect((await fetch(`${base}/atlas/api/blitz/lobbies/short`)).status).toBe(400);
      expect((await fetch(`${base}/atlas/api/blitz/lobbies/${'z'.repeat(24)}`)).status).toBe(404);
    } finally { await close(); }
  });

  /*
   * An invite link is a promise that a place is being held. Without somewhere
   * durable to keep it, the honest answer is that lobbies are unavailable.
   */
  it('says lobbies are unavailable when there is nowhere to keep one', async () => {
    const { base, close } = await server(false);
    try {
      expect((await fetch(`${base}/atlas/api/blitz/lobbies/${'z'.repeat(24)}`)).status).toBe(503);
      const opened = await fetch(`${base}/atlas/api/blitz/lobbies`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ actorId: 'a'.repeat(16), walletAddress: wallet(1), capacity: 4, auth }),
      });
      expect(opened.status).toBe(503);
    } finally { await close(); }
  });
});
