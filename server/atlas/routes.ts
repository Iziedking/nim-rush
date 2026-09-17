import type { AtlasPaymentNetwork } from '../../shared/atlas/payment-config';
import type { Express, RequestHandler } from 'express';
import { z } from 'zod';
import { Address } from '@nimiq/core';

import { validateAtlasCurriculum } from '../../shared/atlas/curriculum';
import { LAST_LANTERN } from '../../shared/atlas/adventures/last-lantern';
import type { AtlasCurriculum } from '../../shared/atlas/types';
import { toPublicAtlasOrder, type AtlasOrder, type AtlasOrderStore } from './orders';
import type { AtlasBeaconService } from './beacon';
import type { AtlasChainObserver } from './chain';
import type { AtlasEchoService } from './echoes';
import type { AtlasCompetitionSummary } from './rewards';
import type { AtlasCompetitiveRuntime } from './competitive';
import type { AtlasIdentityService, AtlasWalletBindingChallenge } from './identity';
import type { AuthAction, DeviceProof } from '../../src/net/player-auth-protocol';
import type { AtlasSnapshot } from '../../shared/atlas/state';
import type { AtlasBlitzService } from './blitz';
import type { BlitzRewardReceipt } from './blitz-rewards';
import type { BlitzLobby, BlitzSeat, BlitzSeatResult } from './blitz-seats';

export interface AtlasOrderCatalog {
  itemId: 'harbor-lantern';
  network: AtlasPaymentNetwork;
  recipient: string;
  valueLuna: number;
}

export interface AtlasApi {
  bootstrap(): Promise<{
    product: 'nim-atlas';
    campaignMode: 'local-first';
    competitiveExpeditions: boolean;
    walletRequired: false;
    curriculumVersion: 1;
  }>;
  curriculum(): Promise<AtlasCurriculum>;
  beacon?: () => Promise<Awaited<ReturnType<AtlasBeaconService['read']>>>;
  echoes?: () => Promise<Awaited<ReturnType<AtlasEchoService['read']>>>;
  competition?: () => Promise<AtlasCompetitionSummary[]>;
  orders?: AtlasOrderStore;
  orderCatalog?: AtlasOrderCatalog;
  chain?: AtlasChainObserver;
  identity?: AtlasIdentityService;
  competitive?: AtlasCompetitiveRuntime;
  blitz?: AtlasBlitzService;
  /*
   * What this wallet has been promised and what has actually reached it.
   * Optional because a board can run with no treasury behind it, and a rider
   * should then be told rewards are unavailable rather than shown an empty list.
   */
  blitzRewards?: (walletAddress: string) => Promise<readonly BlitzRewardReceipt[]>;
  /*
   * Seats in a challenge or a private lobby.
   *
   * Optional, because a deployment with no durable store has nowhere to keep a
   * lobby - and an invite link that dies on restart is worse than no invite
   * link, so the route answers unavailable rather than handing out a seat it
   * cannot remember.
   */
  blitzSeats?: {
    open(input: { actorId: string; walletAddress: string; capacity: number }): Promise<BlitzLobby>;
    claim(input: { lobbyId: string; actorId: string; walletAddress: string }): Promise<BlitzSeatResult>;
    read(lobbyId: string): Promise<{ lobby: BlitzLobby; seats: readonly Omit<BlitzSeat, 'actorId'>[] } | null>;
  };
  authorize?: (proof: DeviceProof, action: AuthAction, actorId: string, body: unknown) => Promise<boolean>;
}

export function createAtlasApi(options: {
  curriculum: unknown;
  competitiveExpeditions?: boolean;
  now?: () => Date;
  orders?: AtlasOrderStore;
  beacon?: AtlasBeaconService;
  echoes?: AtlasEchoService;
  competition?: () => Promise<AtlasCompetitionSummary[]>;
  orderCatalog?: AtlasOrderCatalog;
  chain?: AtlasChainObserver;
  identity?: AtlasIdentityService;
  competitive?: AtlasCompetitiveRuntime;
  blitz?: AtlasBlitzService;
  blitzRewards?: (walletAddress: string) => Promise<readonly BlitzRewardReceipt[]>;
  blitzSeats?: AtlasApi['blitzSeats'];
  authorize?: (proof: DeviceProof, action: AuthAction, actorId: string, body: unknown) => Promise<boolean>;
}): AtlasApi {
  const curriculum = validateAtlasCurriculum(options.curriculum, options.now?.() ?? new Date());
  return {
    async bootstrap() {
      return {
        product: 'nim-atlas',
        campaignMode: 'local-first',
        competitiveExpeditions: options.competitiveExpeditions === true,
        walletRequired: false,
        curriculumVersion: curriculum.version,
      };
    },
    async curriculum() {
      return structuredClone(curriculum);
    },
    beacon: options.beacon ? () => options.beacon!.read() : undefined,
    echoes: options.echoes ? () => options.echoes!.read() : undefined,
    competition: options.competition,
    orders: options.orders,
    orderCatalog: options.orderCatalog,
    chain: options.chain,
    identity: options.identity,
    competitive: options.competitive,
    blitz: options.blitz,
    blitzRewards: options.blitzRewards,
    blitzSeats: options.blitzSeats,
    authorize: options.authorize,
  };
}

export function mountAtlasRoutes(options: {
  app: Express;
  limit: (maximum: number, refillPerMinute: number) => RequestHandler;
  api: AtlasApi;
}): void {
  options.app.get('/atlas/api/bootstrap', options.limit(120, 40), async (_request, response) => {
    response.setHeader('cache-control', 'no-store');
    response.json({ ok: true, data: await options.api.bootstrap() });
  });
  options.app.get('/atlas/api/curriculum', options.limit(120, 40), async (_request, response) => {
    response.setHeader('cache-control', 'public, max-age=300');
    response.json({ ok: true, data: await options.api.curriculum() });
  });
  options.app.get('/atlas/api/beacon', options.limit(120, 40), async (_request, response) => {
    if (!options.api.beacon) { response.status(503).json({ ok: false, error: 'Atlas Beacon is unavailable.' }); return; }
    response.setHeader('cache-control', 'no-store');
    response.json({ ok: true, data: await options.api.beacon() });
  });
  options.app.get('/atlas/api/echoes', options.limit(120, 40), async (_request, response) => {
    if (!options.api.echoes) { response.status(503).json({ ok: false, error: 'Atlas Echoes are unavailable.' }); return; }
    response.setHeader('cache-control', 'no-store');
    response.json({ ok: true, data: await options.api.echoes() });
  });
  options.app.get('/atlas/api/competition', options.limit(120, 40), async (_request, response) => {
    if (!options.api.competition) { response.status(503).json({ ok: false, error: 'Atlas competition is unavailable.' }); return; }
    response.setHeader('cache-control', 'no-store');
    response.json({ ok: true, data: await options.api.competition() });
  });
  options.app.get('/atlas/api/competitive/leaderboard', options.limit(120, 40), async (request, response) => {
    if (!options.api.competitive) { response.status(503).json({ ok: false, error: 'Atlas competition is unavailable.' }); return; }
    const role = request.query.role === 'builder' ? 'builder' : request.query.role === 'explorer' ? 'explorer' : null;
    const seasonId = typeof request.query.seasonId === 'string' ? request.query.seasonId : '';
    if (!role || !/^[a-z0-9-]{1,80}$/.test(seasonId)) { response.status(400).json({ ok: false, error: 'Atlas leaderboard query is invalid.' }); return; }
    response.setHeader('cache-control', 'no-store');
    response.json({ ok: true, data: await options.api.competitive.leaderboard(seasonId, role) });
  });
  options.app.get('/atlas/api/blitz/leaderboard', options.limit(120, 40), async (request, response) => {
    if (!options.api.blitz) { response.status(503).json({ ok: false, error: 'Beacon Blitz leaderboard is unavailable.' }); return; }
    const seasonId = typeof request.query.seasonId === 'string' ? request.query.seasonId : '';
    const cityId = blitzCityId.safeParse(request.query.cityId);
    const challengeId = typeof request.query.challengeId === 'string' ? request.query.challengeId : undefined;
    if (!/^[a-z0-9-]{1,80}$/.test(seasonId) || !cityId.success || (challengeId !== undefined && !/^[a-z0-9:_-]{1,160}$/.test(challengeId))) { response.status(400).json({ ok: false, error: 'Beacon Blitz leaderboard query is invalid.' }); return; }
    try {
      response.setHeader('cache-control', 'no-store');
      response.json({ ok: true, data: await options.api.blitz.leaderboard(seasonId, cityId.data, challengeId) });
    } catch (error) { response.status(400).json({ ok: false, error: safeError(error) }); }
  });
  /*
   * What today's board would owe if it closed now. Public and read-only: it
   * moves nothing, marks nothing paid, and names its own state so the client
   * can tell "no pool today" apart from "the pool could not be read".
   */
  options.app.get('/atlas/api/blitz/prizes', options.limit(120, 40), async (request, response) => {
    if (!options.api.blitz) { response.status(503).json({ ok: false, error: 'Beacon Blitz prizes are unavailable.' }); return; }
    const seasonId = typeof request.query.seasonId === 'string' ? request.query.seasonId : '';
    const cityId = blitzCityId.safeParse(request.query.cityId);
    const challengeId = typeof request.query.challengeId === 'string' ? request.query.challengeId : undefined;
    if (!/^[a-z0-9-]{1,80}$/.test(seasonId) || !cityId.success || (challengeId !== undefined && !/^[a-z0-9:_-]{1,160}$/.test(challengeId))) { response.status(400).json({ ok: false, error: 'Beacon Blitz prize query is invalid.' }); return; }
    try {
      response.setHeader('cache-control', 'no-store');
      response.json({ ok: true, data: await options.api.blitz.prizeTable(seasonId, cityId.data, challengeId) });
    } catch (error) { response.status(400).json({ ok: false, error: safeError(error) }); }
  });
  /*
   * What a rider is owed and what has been paid.
   *
   * Read-only, and keyed on the wallet the obligation names. That address is
   * already public beside a rank on the leaderboard, so this exposes nothing
   * new; it exposes only amounts that wallet was awarded on a public board.
   * An unparseable address is a 400 rather than an empty list, because "owed
   * nothing" and "you typed it wrong" must not look the same to somebody
   * waiting for money.
   */
  options.app.get('/atlas/api/blitz/rewards', options.limit(60, 20), async (request, response) => {
    if (!options.api.blitzRewards) { response.status(503).json({ ok: false, error: 'Beacon Blitz rewards are unavailable.' }); return; }
    let walletAddress: string;
    try { walletAddress = requiredNimiqAddress(request.query.walletAddress); }
    catch { response.status(400).json({ ok: false, error: 'Beacon Blitz reward query is invalid.' }); return; }
    try {
      response.setHeader('cache-control', 'no-store');
      response.json({ ok: true, data: await options.api.blitzRewards(walletAddress) });
    } catch (error) { response.status(400).json({ ok: false, error: safeError(error) }); }
  });
  /*
   * Open a private lobby.
   *
   * Signed, because the lobby is attributed to the rider who opened it and an
   * unsigned open would let anybody fill the store with lobbies. The seat
   * count is clamped by the ledger rather than trusted from the body.
   */
  options.app.post('/atlas/api/blitz/lobbies', options.limit(12, 4), async (request, response) => {
    if (!options.api.blitzSeats || !options.api.authorize) { response.status(503).json({ ok: false, error: 'Beacon Blitz lobbies are unavailable.' }); return; }
    const parsed = lobbyOpenBody.safeParse(request.body);
    if (!parsed.success || !(await options.api.authorize(parsed.data.auth, 'atlas.ticket.issue', parsed.data.actorId, withoutAuth(parsed.data)))) { response.status(403).json({ ok: false, error: 'Beacon Blitz lobby request was rejected.' }); return; }
    try {
      const lobby = await options.api.blitzSeats.open({ actorId: parsed.data.actorId, walletAddress: parsed.data.walletAddress, capacity: parsed.data.capacity });
      response.status(201).json({ ok: true, data: lobby });
    } catch (error) { response.status(400).json({ ok: false, error: safeError(error) }); }
  });

  /*
   * Take a seat. First come, first served, and signed: a seat decides who is
   * eligible for a funded pool, so it is attributed to a wallet that proved
   * it owns itself rather than to whoever typed an address.
   */
  options.app.post('/atlas/api/blitz/lobbies/:lobbyId/seats', options.limit(24, 8), async (request, response) => {
    if (!options.api.blitzSeats || !options.api.authorize) { response.status(503).json({ ok: false, error: 'Beacon Blitz lobbies are unavailable.' }); return; }
    const lobbyId = typeof request.params.lobbyId === 'string' ? request.params.lobbyId : '';
    const parsed = seatClaimBody.safeParse(request.body);
    if (!/^[A-Za-z0-9_-]{16,64}$/.test(lobbyId) || !parsed.success || !(await options.api.authorize(parsed.data.auth, 'atlas.ticket.issue', parsed.data.actorId, withoutAuth(parsed.data)))) { response.status(403).json({ ok: false, error: 'Beacon Blitz seat request was rejected.' }); return; }
    try {
      const result = await options.api.blitzSeats.claim({ lobbyId, actorId: parsed.data.actorId, walletAddress: parsed.data.walletAddress });
      // A refusal is a normal answer here, not a server error: the lobby is
      // full, or closed, and the rider needs to be told which.
      response.status(result.ok ? 201 : 409).json(result.ok ? { ok: true, data: result } : { ok: false, error: result.reason });
    } catch (error) { response.status(400).json({ ok: false, error: safeError(error) }); }
  });

  /*
   * Who is in. Read-only and unsigned, because anyone holding the link is
   * invited - the link is the credential, which is why it has to be random.
   */
  options.app.get('/atlas/api/blitz/lobbies/:lobbyId', options.limit(120, 40), async (request, response) => {
    if (!options.api.blitzSeats) { response.status(503).json({ ok: false, error: 'Beacon Blitz lobbies are unavailable.' }); return; }
    const lobbyId = typeof request.params.lobbyId === 'string' ? request.params.lobbyId : '';
    if (!/^[A-Za-z0-9_-]{16,64}$/.test(lobbyId)) { response.status(400).json({ ok: false, error: 'Beacon Blitz lobby id is invalid.' }); return; }
    const found = await options.api.blitzSeats.read(lobbyId);
    if (!found) { response.status(404).json({ ok: false, error: 'Beacon Blitz lobby was not found.' }); return; }
    response.setHeader('cache-control', 'no-store');
    response.json({ ok: true, data: found });
  });

  options.app.post('/atlas/api/wallet/challenge', options.limit(24, 8), async (request, response) => {
    if (!options.api.identity || !options.api.authorize) { response.status(503).json({ ok: false, error: 'Atlas wallet identity is unavailable.' }); return; }
    const parsed = walletChallengeBody.safeParse(request.body);
    if (!parsed.success || !(await options.api.authorize(parsed.data.auth, 'atlas.wallet.challenge', parsed.data.actorId, withoutAuth(parsed.data)))) { response.status(403).json({ ok: false, error: 'Atlas wallet challenge was rejected.' }); return; }
    try { response.json({ ok: true, data: options.api.identity.issueWalletChallenge(withoutAuth(parsed.data)) }); }
    catch (error) { response.status(400).json({ ok: false, error: safeError(error) }); }
  });
  options.app.post('/atlas/api/wallet/bind', options.limit(16, 6), async (request, response) => {
    if (!options.api.identity || !options.api.authorize) { response.status(503).json({ ok: false, error: 'Atlas wallet identity is unavailable.' }); return; }
    const parsed = walletBindBody.safeParse(request.body);
    if (!parsed.success || !(await options.api.authorize(parsed.data.auth, 'atlas.wallet.bind', parsed.data.actorId, { actorId: parsed.data.actorId, challenge: parsed.data.challenge, publicKey: parsed.data.publicKey, signature: parsed.data.signature }))) { response.status(403).json({ ok: false, error: 'Atlas wallet binding was rejected.' }); return; }
    try {
      const challenge = parsed.data.challenge as AtlasWalletBindingChallenge;
      response.json({ ok: true, data: await options.api.identity.bindWallet({ challenge, publicKey: parsed.data.publicKey, signature: parsed.data.signature }) });
    }
    catch (error) { response.status(400).json({ ok: false, error: safeError(error) }); }
  });
  options.app.post('/atlas/api/competitive/tickets', options.limit(24, 8), async (request, response) => {
    if (!options.api.competitive || !options.api.authorize) { response.status(503).json({ ok: false, error: 'Atlas competition is unavailable.' }); return; }
    const parsed = ticketBody.safeParse(request.body);
    if (!parsed.success || !(await options.api.authorize(parsed.data.auth, 'atlas.ticket.issue', parsed.data.actorId, withoutAuth(parsed.data)))) { response.status(403).json({ ok: false, error: 'Atlas ticket request was rejected.' }); return; }
    try { response.status(201).json({ ok: true, data: await options.api.competitive.issueServerTicket({ actorId: parsed.data.actorId, walletAddress: parsed.data.walletAddress, role: parsed.data.role }) }); }
    catch (error) { response.status(400).json({ ok: false, error: safeError(error) }); }
  });
  options.app.post('/atlas/api/competitive/runs', options.limit(12, 4), async (request, response) => {
    if (!options.api.competitive || !options.api.authorize) { response.status(503).json({ ok: false, error: 'Atlas competition is unavailable.' }); return; }
    const parsed = submissionBody.safeParse(request.body);
    if (!parsed.success || !(await options.api.authorize(parsed.data.auth, 'atlas.run.submit', parsed.data.actorId, withoutAuth(parsed.data)))) { response.status(403).json({ ok: false, error: 'Atlas run submission was rejected.' }); return; }
    try { response.status(201).json({ ok: true, data: await options.api.competitive.submit({ ...withoutAuth(parsed.data), claimedSnapshot: parsed.data.claimedSnapshot as AtlasSnapshot }) }); }
    catch (error) { response.status(400).json({ ok: false, error: safeError(error) }); }
  });
  options.app.post('/atlas/api/blitz/tickets', options.limit(24, 8), async (request, response) => {
    if (!options.api.blitz || !options.api.authorize) { response.status(503).json({ ok: false, error: 'Beacon Blitz competition is unavailable.' }); return; }
    const parsed = blitzTicketBody.safeParse(request.body);
    if (!parsed.success || !(await options.api.authorize(parsed.data.auth, 'atlas.ticket.issue', parsed.data.actorId, withoutAuth(parsed.data)))) { response.status(403).json({ ok: false, error: 'Beacon Blitz ticket request was rejected.' }); return; }
    try { response.status(201).json({ ok: true, data: await options.api.blitz.issueTicket(withoutAuth(parsed.data)) }); }
    catch (error) { response.status(400).json({ ok: false, error: safeError(error) }); }
  });
  options.app.post('/atlas/api/blitz/runs', options.limit(12, 4), async (request, response) => {
    if (!options.api.blitz || !options.api.authorize) { response.status(503).json({ ok: false, error: 'Beacon Blitz competition is unavailable.' }); return; }
    /*
     * Two very different refusals used to share one message.
     *
     * A trace that fails the schema and a trace whose device proof does not
     * match are the same 403 to the rider, which is right - naming the failing
     * half tells a forger which half to work on. But they were also the same
     * line in the log, and a ranked run that silently would not verify on a
     * real phone took a full device session to narrow down. The rider's
     * message is unchanged; the operator now gets the half that failed.
     */
    const parsed = blitzSubmissionBody.safeParse(request.body);
    if (!parsed.success) {
      console.warn(`[sface] blitz run rejected (schema): ${parsed.error.issues.slice(0, 4).map((issue) => `${issue.path.join('.')}: ${issue.message}`).join('; ')}`);
      response.status(403).json({ ok: false, error: 'Beacon Blitz run submission was rejected.' });
      return;
    }
    if (!(await options.api.authorize(parsed.data.auth, 'atlas.run.submit', parsed.data.actorId, withoutAuth(parsed.data)))) {
      console.warn('[sface] blitz run rejected (device proof did not authorise the submitted body)');
      response.status(403).json({ ok: false, error: 'Beacon Blitz run submission was rejected.' });
      return;
    }
    try { response.status(201).json({ ok: true, data: await options.api.blitz.submit(withoutAuth(parsed.data)) }); }
    catch (error) { response.status(400).json({ ok: false, error: safeError(error) }); }
  });
  options.app.post('/atlas/api/orders', options.limit(30, 10), async (request, response) => {
    if (!options.api.orders) { response.status(503).json({ ok: false, error: 'Atlas orders are unavailable.' }); return; }
    try {
      const body = request.body as Partial<AtlasOrder> & { idempotencyKey?: unknown };
      const catalog = options.api.orderCatalog ?? { itemId: 'harbor-lantern' as const, network: 'testalbatross' as const, recipient: LAST_LANTERN.recipient, valueLuna: LAST_LANTERN.priceLuna };
      const order = await options.api.orders.create({
        actorId: requiredString(body.actorId), walletAddress: requiredNimiqAddress(body.walletAddress), itemId: catalog.itemId,
        network: catalog.network, recipient: catalog.recipient, valueLuna: catalog.valueLuna,
        idempotencyKey: body.idempotencyKey === undefined ? undefined : requiredString(body.idempotencyKey),
      });
      response.status(201).json({ ok: true, data: toPublicAtlasOrder(order) });
    } catch (error) { response.status(400).json({ ok: false, error: safeError(error) }); }
  });
  options.app.get('/atlas/api/orders/:orderId', options.limit(120, 40), async (request, response) => {
    if (!options.api.orders) { response.status(503).json({ ok: false, error: 'Atlas orders are unavailable.' }); return; }
    try { response.json({ ok: true, data: toPublicAtlasOrder(await options.api.orders.get(request.params.orderId)) }); }
    catch { response.status(404).json({ ok: false, error: 'Atlas order was not found.' }); }
  });
  options.app.post('/atlas/api/orders/:orderId/transaction', options.limit(30, 10), async (request, response) => {
    if (!options.api.orders) { response.status(503).json({ ok: false, error: 'Atlas orders are unavailable.' }); return; }
    try { response.json({ ok: true, data: toPublicAtlasOrder(await options.api.orders.submitLookup(request.params.orderId, requiredString((request.body as { lookup?: unknown }).lookup))) }); }
    catch (error) { response.status(400).json({ ok: false, error: safeError(error) }); }
  });
  options.app.post('/atlas/api/orders/:orderId/reconcile', options.limit(30, 10), async (request, response) => {
    if (!options.api.orders || !options.api.chain) { response.status(503).json({ ok: false, error: 'Atlas payment reconciliation is unavailable.' }); return; }
    try {
      const order = await options.api.orders.get(request.params.orderId);
      if (!order.lookup) { response.status(409).json({ ok: false, error: 'Atlas order has no provider lookup.' }); return; }
      const observation = await options.api.chain.observe(order.lookup);
      if (!observation) { response.status(202).json({ ok: true, data: toPublicAtlasOrder(order) }); return; }
      const fulfilled = await options.api.orders.reconcile(order.id, {
        lookup: observation.lookup,
        network: observation.network,
        sender: observation.sender,
        recipient: observation.recipient,
        valueLuna: observation.valueLuna,
        canonical: observation.canonical,
        success: observation.success,
        confirmations: observation.confirmations,
      });
      response.json({ ok: true, data: { ...toPublicAtlasOrder(fulfilled), chainEvidence: { network: observation.network, recipient: observation.recipient, valueLuna: observation.valueLuna, canonical: observation.canonical, success: observation.success, confirmations: observation.confirmations } } });
    } catch (error) {
      if (safeError(error).toLowerCase().includes('confirm')) {
        try { response.status(202).json({ ok: true, data: toPublicAtlasOrder(await options.api.orders!.get(request.params.orderId)) }); } catch { response.status(404).json({ ok: false, error: 'Atlas order was not found.' }); }
        return;
      }
      response.status(400).json({ ok: false, error: safeError(error) });
    }
  });
  options.app.post('/atlas/api/orders/:orderId/cancel', options.limit(30, 10), async (request, response) => {
    if (!options.api.orders) { response.status(503).json({ ok: false, error: 'Atlas orders are unavailable.' }); return; }
    try {
      const reason = requiredString((request.body as { reason?: unknown }).reason);
      response.json({ ok: true, data: toPublicAtlasOrder(await options.api.orders.cancel(request.params.orderId, reason)) });
    } catch (error) { response.status(400).json({ ok: false, error: safeError(error) }); }
  });
}

function requiredString(value: unknown): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > 256) throw new Error('Atlas order field is invalid.');
  return value;
}

const authProof = z.object({ challengeId: z.string().min(1).max(128), publicKeyJwk: z.object({ kty: z.literal('EC'), crv: z.literal('P-256'), x: z.string().min(1).max(100), y: z.string().min(1).max(100) }), signature: z.string().regex(/^[0-9a-f]+$/i).max(1024) });
const actorId = z.string().regex(/^[0-9a-f]{16,64}$/i);
const walletChallengeBody = z.object({ actorId, seasonId: z.string().regex(/^[a-z0-9-]{1,80}$/), address: z.string().min(1).max(64), network: z.enum(['testalbatross', 'mainalbatross']), auth: authProof });
const walletBindBody = z.object({ actorId, challenge: z.unknown(), publicKey: z.string().regex(/^[0-9a-f]+$/i).max(256), signature: z.string().regex(/^[0-9a-f]+$/i).max(512), auth: authProof });
const ticketBody = z.object({ actorId, walletAddress: z.string().min(1).max(64), role: z.enum(['explorer', 'builder']), auth: authProof });
const actionBody = z.object({ moveX: z.number().finite(), moveY: z.number().finite(), tool: z.enum(['none', 'scanner', 'relay-tether', 'shield-pulse']), interact: z.boolean(), system: z.enum(['active', 'paused', 'hidden']).optional() });
const submissionBody = z.object({ runId: z.string().regex(/^[a-zA-Z0-9:_-]{1,128}$/), ticketId: z.string().regex(/^[a-f0-9]{32}$/), actorId, walletAddress: z.string().min(1).max(64), network: z.literal('testalbatross'), role: z.enum(['explorer', 'builder']), seasonId: z.string().regex(/^[a-z0-9-]{1,80}$/), challengeId: z.string().regex(/^[a-z0-9-]{1,80}$/), origin: z.string().url().max(256), campaignHash: z.string().regex(/^[a-f0-9]{64}$/), curriculumHash: z.string().regex(/^[a-f0-9]{64}$/), rulesetHash: z.string().regex(/^[a-f0-9]{64}$/), assistance: z.enum(['none', 'free-hint', 'purchased-hint', 'answer-reveal', 'debug']), actions: z.array(actionBody).max(20_000), claimedSnapshot: z.unknown(), replayHash: z.string().regex(/^[a-f0-9]{64}$/), auth: authProof });
const blitzCityId = z.enum(['lagos', 'london', 'dubai']);
/*
 * Every button a rider can press, including the one that was missing.
 *
 * zod strips keys it does not know about, silently and by design. `tuck`
 * arrived with the posture system - the change that made the bike stop holding
 * its own speed and made the run a series of decisions - and this schema was
 * never told. So every ranked frame arrived, had its tuck removed, and was
 * hashed into a body the rider's signature no longer matched.
 *
 * That cost the digest first, which is what the rider saw, but the worse half
 * is what would have happened had it passed: the server would have re-simulated
 * every run with the posture system switched off, disagreed with an honest
 * score, and refused honest riders as cheats.
 *
 * Keep this in step with BlitzInput in shared/atlas/blitz/types.ts. The test in
 * tests/atlas-blitz-server.test.ts fails if a field is added there and not here.
 */
const blitzInputBody = z.object({ steer: z.number().finite().min(-1).max(1), drift: z.boolean(), brake: z.boolean().optional(), tuck: z.boolean().optional(), boost: z.boolean(), relayChoice: z.enum(['left', 'right']).optional() });
const lobbyOpenBody = z.object({ actorId, walletAddress: z.string().min(1).max(64), capacity: z.number().int().min(2).max(7), auth: authProof });
const seatClaimBody = z.object({ actorId, walletAddress: z.string().min(1).max(64), auth: authProof });
const blitzTicketBody = z.object({ actorId, walletAddress: z.string().min(1).max(64), username: z.string().regex(/^[A-Za-z0-9_]{3,18}$/), cityId: blitzCityId, seasonId: z.string().regex(/^[a-z0-9-]{1,80}$/), auth: authProof });
const blitzSubmissionBody = z.object({ runId: z.string().regex(/^[a-zA-Z0-9:_-]{1,128}$/), ticketId: z.string().regex(/^[a-zA-Z0-9_-]{1,128}$/), actorId, walletAddress: z.string().min(1).max(64), username: z.string().regex(/^[A-Za-z0-9_]{3,18}$/), cityId: blitzCityId, seasonId: z.string().regex(/^[a-z0-9-]{1,80}$/), challengeId: z.string().regex(/^[a-z0-9:_-]{1,160}$/).optional(), challengeDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(), rulesetVersion: z.string().regex(/^[a-z0-9-]{1,80}$/).optional(), seed: z.string().min(1).max(160), frames: z.array(z.object({ tick: z.number().int().min(0).max(3_000), input: blitzInputBody })).max(3_000), traceHash: z.string().regex(/^[a-f0-9]{64}$/), claimedScore: z.number().int().min(0).max(1_000_000), auth: authProof });
function withoutAuth<T extends { auth: unknown }>(value: T): Omit<T, 'auth'> { const { auth: _auth, ...body } = value; return body; }

function requiredNimiqAddress(value: unknown): string {
  const address = requiredString(value);
  try { return Address.fromUserFriendlyAddress(address).toUserFriendlyAddress(); }
  catch { throw new Error('Atlas wallet address is invalid.'); }
}

function safeError(error: unknown): string { return error instanceof Error ? error.message : 'Atlas request was rejected.'; }
