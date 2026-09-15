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
    const parsed = blitzSubmissionBody.safeParse(request.body);
    if (!parsed.success || !(await options.api.authorize(parsed.data.auth, 'atlas.run.submit', parsed.data.actorId, withoutAuth(parsed.data)))) { response.status(403).json({ ok: false, error: 'Beacon Blitz run submission was rejected.' }); return; }
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
const blitzInputBody = z.object({ steer: z.number().finite().min(-1).max(1), drift: z.boolean(), brake: z.boolean().optional(), boost: z.boolean(), relayChoice: z.enum(['left', 'right']).optional() });
const blitzTicketBody = z.object({ actorId, walletAddress: z.string().min(1).max(64), username: z.string().regex(/^[A-Za-z0-9_]{3,18}$/), cityId: blitzCityId, seasonId: z.string().regex(/^[a-z0-9-]{1,80}$/), auth: authProof });
const blitzSubmissionBody = z.object({ runId: z.string().regex(/^[a-zA-Z0-9:_-]{1,128}$/), ticketId: z.string().regex(/^[a-zA-Z0-9_-]{1,128}$/), actorId, walletAddress: z.string().min(1).max(64), username: z.string().regex(/^[A-Za-z0-9_]{3,18}$/), cityId: blitzCityId, seasonId: z.string().regex(/^[a-z0-9-]{1,80}$/), challengeId: z.string().regex(/^[a-z0-9:_-]{1,160}$/).optional(), challengeDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(), rulesetVersion: z.string().regex(/^[a-z0-9-]{1,80}$/).optional(), seed: z.string().min(1).max(160), frames: z.array(z.object({ tick: z.number().int().min(0).max(3_000), input: blitzInputBody })).max(3_000), traceHash: z.string().regex(/^[a-f0-9]{64}$/), claimedScore: z.number().int().min(0).max(1_000_000), auth: authProof });
function withoutAuth<T extends { auth: unknown }>(value: T): Omit<T, 'auth'> { const { auth: _auth, ...body } = value; return body; }

function requiredNimiqAddress(value: unknown): string {
  const address = requiredString(value);
  try { return Address.fromUserFriendlyAddress(address).toUserFriendlyAddress(); }
  catch { throw new Error('Atlas wallet address is invalid.'); }
}

function safeError(error: unknown): string { return error instanceof Error ? error.message : 'Atlas request was rejected.'; }
