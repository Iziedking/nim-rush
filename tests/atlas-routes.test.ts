import { describe, expect, it } from 'vitest';
import express from 'express';

import { createAtlasApi } from '../server/atlas/routes';
import { ATLAS_CURRICULUM } from '../shared/atlas/manifest';
import { createAtlasBeaconRepository, createAtlasBeaconService } from '../server/atlas/beacon';
import { createAtlasOrderStore } from '../server/atlas/orders';
import { mountAtlasRoutes } from '../server/atlas/routes';
import { createAtlasEchoRepository, createAtlasEchoService } from '../server/atlas/echoes';
import type { AtlasCompetitiveRuntime } from '../server/atlas/competitive';

describe('NIM Atlas public curriculum boundary', () => {
  it('serves an honest local-first bootstrap and validated curriculum', async () => {
    const api = createAtlasApi({ curriculum: ATLAS_CURRICULUM, now: () => new Date('2026-08-25T12:00:00.000Z') });
    await expect(api.bootstrap()).resolves.toEqual({
      product: 'nim-atlas',
      campaignMode: 'local-first',
      competitiveExpeditions: false,
      walletRequired: false,
      curriculumVersion: 1,
    });
    const curriculum = await api.curriculum();
    expect(curriculum.version).toBe(1);
    expect(curriculum.districts[0]?.id).toBe('genesis-garden');
    expect(curriculum.finale.id).toBe('beacon-core');
  });

  it('refuses to boot with malformed or stale curriculum', () => {
    const malformed = structuredClone(ATLAS_CURRICULUM) as unknown as { districts: unknown[] };
    malformed.districts = [];
    expect(() => createAtlasApi({ curriculum: malformed, now: () => new Date('2026-08-25T12:00:00.000Z') })).toThrow();
  });

  it('exposes Beacon status only when the server projection is injected', async () => {
    const beacon = createAtlasBeaconService({ repository: createAtlasBeaconRepository(), now: () => 1_000 });
    const api = createAtlasApi({ curriculum: ATLAS_CURRICULUM, beacon, now: () => new Date('2026-08-25T12:00:00.000Z') });
    await expect(api.beacon?.()).resolves.toMatchObject({ status: 'live', verifiedContributorCount: 0 });
  });

  it('uses the configured live catalog and reconciles only server-observed chain evidence', async () => {
    const recipient = `NQ00${'A'.repeat(32)}`;
    const walletAddress = 'NQ07 0000 0000 0000 0000 0000 0000 0000 0000';
    const orders = createAtlasOrderStore({ recipient, priceLuna: 100_000 });
    const api = createAtlasApi({
      curriculum: ATLAS_CURRICULUM,
      orders,
      orderCatalog: { itemId: 'harbor-lantern', network: 'testalbatross', recipient, valueLuna: 100_000 },
      chain: { observe: async (lookup) => ({ lookup, network: 'testalbatross', blockHeight: 10, confirmations: 3, sender: walletAddress, recipient, valueLuna: 100_000, success: true, canonical: true }) },
    });
    const app = express();
    app.use(express.json());
    mountAtlasRoutes({ app, limit: () => (_request, _response, next) => next(), api });
    const server = await new Promise<ReturnType<typeof app.listen>>((resolve) => { const listening = app.listen(0, () => resolve(listening)); });
    try {
      const address = server.address();
      if (!address || typeof address === 'string') throw new Error('Test server did not expose a port.');
      const base = `http://127.0.0.1:${address.port}`;
      const invalid = await fetch(`${base}/atlas/api/orders`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ actorId: 'actor-invalid', walletAddress: 'NQnot-an-address' }) });
      expect(invalid.status).toBe(400);
      const created = await fetch(`${base}/atlas/api/orders`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ actorId: 'actor-1', walletAddress, recipient: 'NQattacker', valueLuna: 1 }) });
      const createdPayload = await created.json() as { data: { id: string; recipient: string; valueLuna: number; actorId?: string; walletAddress?: string; lookup?: string } };
      expect(created.status).toBe(201);
      expect(createdPayload.data).toMatchObject({ recipient, valueLuna: 100_000 });
      expect(createdPayload.data.actorId).toBeUndefined();
      expect(createdPayload.data.walletAddress).toBeUndefined();
      const submitted = await fetch(`${base}/atlas/api/orders/${createdPayload.data.id}/transaction`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ lookup: 'lookup-1' }) });
      const submittedPayload = await submitted.json() as { data: { lookup?: string; lookupSubmitted: boolean } };
      expect(submittedPayload.data.lookup).toBeUndefined();
      expect(submittedPayload.data.lookupSubmitted).toBe(true);
      const reconciled = await fetch(`${base}/atlas/api/orders/${createdPayload.data.id}/reconcile`, { method: 'POST' });
      const reconciledPayload = await reconciled.json() as { data: { status: string; actorId?: string; walletAddress?: string; chainEvidence?: { lookup?: string } } };
      expect(reconciled.status).toBe(200);
      expect(reconciledPayload.data.status).toBe('fulfilled');
      expect(reconciledPayload.data.actorId).toBeUndefined();
      expect(reconciledPayload.data.walletAddress).toBeUndefined();
      expect(reconciledPayload.data.chainEvidence?.lookup).toBeUndefined();
    } finally {
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    }
  });

  /*
   * The receipt surface. A pool nobody can see the end of is indistinguishable
   * from a pool that was never paid, so a rider has to be able to ask what they
   * are owed - and be told the difference between "nothing" and "we could not
   * look".
   */
  it('tells a rider what they are owed, and refuses a question it cannot answer', async () => {
    const walletAddress = 'NQ07 0000 0000 0000 0000 0000 0000 0000 0000';
    const api = createAtlasApi({
      curriculum: ATLAS_CURRICULUM,
      blitzRewards: async (address) => [{ period: 'blitz-cycle--2-lagos-2026-09-15', amountLuna: 5_000, state: 'owed', transactionHash: null, attentionReason: null, echoed: address }] as never,
      now: () => new Date('2026-08-25T12:00:00.000Z'),
    });
    const app = express();
    mountAtlasRoutes({ app, limit: () => (_request, _response, next) => next(), api });
    const server = await new Promise<ReturnType<typeof app.listen>>((resolve) => { const listening = app.listen(0, () => resolve(listening)); });
    try {
      const address = server.address();
      if (!address || typeof address === 'string') throw new Error('Test server did not expose a port.');
      const base = `http://127.0.0.1:${address.port}`;

      const answered = await fetch(`${base}/atlas/api/blitz/rewards?walletAddress=${encodeURIComponent(walletAddress)}`);
      expect(answered.status).toBe(200);
      const payload = await answered.json() as { data: Array<{ amountLuna: number; state: string; echoed: string }> };
      expect(payload.data[0]).toMatchObject({ amountLuna: 5_000, state: 'owed' });
      // Normalised through the real address parser, so a spaced and an unspaced
      // address are the same rider rather than two.
      expect(payload.data[0]!.echoed.replace(/s/g, '')).toBe(walletAddress.replace(/s/g, ''));

      /*
       * A mistyped address is a 400, never an empty list. "You are owed
       * nothing" and "that is not an address" must not look the same to
       * somebody waiting for money.
       */
      for (const bad of ['NQnot-an-address', '', 'NQ07 0000']) {
        const refused = await fetch(`${base}/atlas/api/blitz/rewards?walletAddress=${encodeURIComponent(bad)}`);
        expect(refused.status).toBe(400);
      }
    } finally {
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    }
  });

  // Without a treasury there is no ledger to read, and that is not an empty list.
  it('says rewards are unavailable rather than empty when no ledger is wired', async () => {
    const api = createAtlasApi({ curriculum: ATLAS_CURRICULUM, now: () => new Date('2026-08-25T12:00:00.000Z') });
    const app = express();
    mountAtlasRoutes({ app, limit: () => (_request, _response, next) => next(), api });
    const server = await new Promise<ReturnType<typeof app.listen>>((resolve) => { const listening = app.listen(0, () => resolve(listening)); });
    try {
      const address = server.address();
      if (!address || typeof address === 'string') throw new Error('Test server did not expose a port.');
      const response = await fetch(`http://127.0.0.1:${address.port}/atlas/api/blitz/rewards?walletAddress=${encodeURIComponent('NQ07 0000 0000 0000 0000 0000 0000 0000 0000')}`);
      expect(response.status).toBe(503);
    } finally {
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    }
  });

  it('serves public echoes only from the injected verified projection', async () => {
    const echoes = createAtlasEchoService({ repository: createAtlasEchoRepository(), now: () => 1_000 });
    const api = createAtlasApi({ curriculum: ATLAS_CURRICULUM, echoes, now: () => new Date('2026-08-25T12:00:00.000Z') });
    const app = express();
    mountAtlasRoutes({ app, limit: () => (_request, _response, next) => next(), api });
    const server = await new Promise<ReturnType<typeof app.listen>>((resolve) => { const listening = app.listen(0, () => resolve(listening)); });
    try {
      const address = server.address();
      if (!address || typeof address === 'string') throw new Error('Test server did not expose a port.');
      const response = await fetch(`http://127.0.0.1:${address.port}/atlas/api/echoes`);
      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toEqual({ ok: true, data: { status: 'live', echoes: [] } });
    } finally {
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    }
  });

  it('does not accept client-controlled competitive ticket seeds or content hashes', async () => {
    let issued: unknown;
    const competitive = {
      issueServerTicket: async (input: unknown) => { issued = input; return { ticketId: 'server-ticket' }; },
    } as unknown as AtlasCompetitiveRuntime;
    const api = createAtlasApi({
      curriculum: ATLAS_CURRICULUM,
      competitive,
      authorize: async () => true,
      now: () => new Date('2026-08-25T12:00:00.000Z'),
    });
    const app = express();
    app.use(express.json());
    mountAtlasRoutes({ app, limit: () => (_request, _response, next) => next(), api });
    const server = await new Promise<ReturnType<typeof app.listen>>((resolve) => { const listening = app.listen(0, () => resolve(listening)); });
    try {
      const address = server.address();
      if (!address || typeof address === 'string') throw new Error('Test server did not expose a port.');
      const response = await fetch(`http://127.0.0.1:${address.port}/atlas/api/competitive/tickets`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ actorId: 'a'.repeat(16), walletAddress: 'wallet', role: 'explorer', seed: 'attacker-seed', campaignHash: 'a'.repeat(64), curriculumHash: 'b'.repeat(64), rulesetHash: 'c'.repeat(64), auth: { challengeId: 'device-challenge', publicKeyJwk: { kty: 'EC', crv: 'P-256', x: 'x', y: 'y' }, signature: 'aa' } }),
      });
      expect(response.status).toBe(201);
      expect(issued).toEqual({ actorId: 'a'.repeat(16), walletAddress: 'wallet', role: 'explorer' });
    } finally {
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    }
  });
});

/*
 * The submission schema and BlitzInput have to describe the same buttons.
 *
 * zod strips what it does not declare, without a word. When the posture system
 * added `tuck`, this schema kept the old shape, so every ranked frame was
 * quietly flattened before the server hashed it - which broke the rider's
 * signature, and would have made the replay disagree with an honest score even
 * if it had not.
 *
 * This asserts on the body the route actually hands to the authorizer, because
 * that is the object the digest is taken over, and the only place the loss was
 * observable.
 */
describe('a ranked submission keeps every input a rider pressed', () => {
  const FULL_INPUT = { steer: 0.5, drift: true, brake: true, tuck: true, boost: true, relayChoice: 'left' as const };

  it('hands the authorizer the frames it was sent, tuck included', async () => {
    let seen: unknown = null;
    const app = express();
    app.use(express.json({ limit: '2mb' }));
    mountAtlasRoutes({
      app,
      limit: () => (_request, _response, next) => next(),
      api: createAtlasApi({
        curriculum: ATLAS_CURRICULUM,
        now: () => new Date('2026-08-25T12:00:00.000Z'),
        blitz: { submit: async () => ({ row: { rank: 1 }, duplicate: false }) } as never,
        authorize: async (_proof, _action, _actorId, body) => { seen = body; return true; },
      }),
    });
    const server = await new Promise<ReturnType<typeof app.listen>>((resolve) => { const s = app.listen(0, () => resolve(s)); });
    const address = server.address();
    if (address === null || typeof address === 'string') throw new Error('no port');
    try {
      await fetch(`http://127.0.0.1:${address.port}/atlas/api/blitz/runs`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          runId: 'run-1', ticketId: 'ticket-1', actorId: 'a'.repeat(64),
          walletAddress: 'NQ07 0000 0000 0000 0000 0000 0000 0000 0000', username: 'Rider',
          cityId: 'lagos', seasonId: 'cycle-2', seed: 'seed-1',
          frames: [{ tick: 0, input: FULL_INPUT }],
          traceHash: 'f'.repeat(64), claimedScore: 10,
          auth: { challengeId: 'challenge-1', publicKeyJwk: { kty: 'EC', crv: 'P-256', x: 'x', y: 'y' }, signature: 'ab'.repeat(32) },
        }),
      });
    } finally {
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    }
    const frames = (seen as { frames?: { input?: Record<string, unknown> }[] } | null)?.frames;
    expect(frames?.[0]?.input).toEqual(FULL_INPUT);
  });
});
