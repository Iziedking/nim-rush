/**
 * The oracle and challenge service.
 *
 * Small on purpose. It publishes one mission a day, keeps a leaderboard, and
 * stores challenge records. It holds no funds, has no keys, and can move
 * nobody's money, which is why it can run on a single box behind Caddy without
 * a blast-radius document longer than the service itself.
 *
 * Everything crossing the boundary is parsed with zod before it is touched.
 * Every public endpoint is rate limited, because they are all unauthenticated
 * by design and an open POST with no cap is an invitation.
 */

import { networkOf, NETWORK_HEADER } from './network';
import express from 'express';
import { join } from 'node:path';
import { z } from 'zod';
import { parseAllowedOrigins } from './cors';
import { createRateLimiter } from './rate-limit';
import { effectiveHealth } from './admin/health';
import { installHttpBoundary } from './http-boundary';
import { adminConfig, adminMiddleware } from './admin/auth';
import { configInventory } from './admin/config';
import { adminLogs, initialiseAdminLogs, recordAdminLog } from './admin/logs';
import { OperationNonces } from './admin/nonces';
import { buildDiagnosticBundle } from './admin/diagnostics';
import { mountAdminObservabilityRoutes } from './admin/observability-routes';
import { installRequestLogging } from './request-logging';
import { installFallbackRoutes } from './fallback-routes';
import { mountAdminOperationsRoutes } from './admin/operations-routes';
import { mountAdminReadRoutes } from './admin/read-routes';
import { mountAdminConfigRoutes } from './admin/config-routes';
import { mountAdminOverviewRoutes } from './admin/overview-routes';

import * as daily from './daily';
import { getMission, startRefreshLoop, utcDate } from './daily';
import * as board from './leaderboard';
import * as challenges from './challenges';
import * as clans from './clans';
import * as contests from './contests';
import * as contestRules from '../src/data/contests';
import { ROSTER_SIZE, xsenseConfigured } from './xsense';
import * as ghosts from './ghosts';
import * as signals from './xsignals';
import * as profiles from './profiles';
import * as xauth from './xauth';
import { xpostsConfigured } from './xposts';
import { xusersConfigured } from './xusers';
import { attachLive } from './live';
import { backupSnapshot, flush, getPersistenceHealth, listBackups, loadSnapshot, saveNow, scheduleSave } from './store';
import { PlayerAuth } from './player-auth';
import { mountPlayerAuthRoutes } from './player-auth-routes';
import { mountSystemRoutes } from './system-routes';
import { mountLeaderboardReadRoutes } from './leaderboard-read-routes';
import { mountCommunityReadRoutes } from './community-read-routes';
import { mountPublicArtifactRoutes } from './public-artifact-routes';
import { mountProfileReadRoutes } from './profile-read-routes';
import { mountXAuthRoutes } from './xauth-routes';
import { mountSignalsReadRoutes } from './signals-read-routes';
import { mountSocialReadRoutes } from './social-read-routes';
import { mountChallengeWriteRoutes } from './challenge-write-routes';
import { mountGhostWriteRoutes } from './ghost-write-routes';
import { sweepContests } from './contest-lifecycle';
import { createActorVerifier } from './player-actor';
import {
  mergeBodyDigest,
  bodyDigest,
  type DeviceProof,
} from '../src/net/player-auth-protocol';
import * as anchor from './anchor';
import * as chat from './chat';
import * as tips from './tips';
import { claimMessage, mergeClaimMessage, verifyClaim, verifyMessage } from './attest';
import { levelFacts, refuse } from './verify';
import { getRelayPersistenceHealth, loadRelayState } from './relay/store';
import { parseRelayConfig } from './relay/config';
import { createRelayDailyService } from './relay/daily';
import { createRelayTicketService } from './relay/tickets';
import { createRelayApi, mountRelayRoutes } from './relay/routes';
import { getRelayStore } from './relay/store';
import { createRelayWalletBindingService } from './relay/wallet-bindings';
import { createRelayRepository } from './relay/repository';
import { createRelayTraceStore } from './relay/traces';
import { createRelayWorldService } from './relay/world';
import { createRelayLeaderboardService } from './relay/leaderboard';
import { createRelayRewardService } from './relay/rewards';
import { createAtlasApi, mountAtlasRoutes } from './atlas/routes';
import { mountAtlasAdminRoutes } from './atlas/admin';
import { ATLAS_CURRICULUM } from '../shared/atlas/manifest';
import { createNimiqRelayChainReader } from './relay/chain';
import { createRelayPayoutService } from './relay/payouts';
import { mountRelayAdminRoutes } from './relay/admin-routes';
import { legacyConfig } from './legacy/mode';
import { mountLegacyArchiveRoutes } from './legacy/archive-routes';
import { legacyMutationMiddleware } from './legacy/mode';
import { assertSingleRelayWriter } from './relay/writer';
import { ATLAS_COMPETITIVE_POLICY, ATLAS_DAILY_POOL_LUNA, ATLAS_DAILY_REWARD_CONFIG, ATLAS_PRODUCTION_GATE, ATLAS_REWARD_MIN_CONFIRMATIONS, ATLAS_TREASURY_CONFIG, parseAtlasPaymentConfig, parseAtlasRewardRpcUrls } from './atlas/config';
import { createAtlasPayoutService } from './atlas/payouts';
import { mountAtlasPayoutAdminRoutes } from './atlas/payout-admin-routes';
import { createAtlasUsageService } from './atlas/usage';
import { mountAtlasUsageRoutes } from './atlas/usage-routes';
import { createAtlasDailyService } from './atlas/daily';
import { mountAtlasDailyRoutes } from './atlas/daily-routes';
import { createAtlasOrderStore } from './atlas/orders';
import { createAtlasChainReader } from './atlas/chain';
import { createAtlasBeaconRepository, createAtlasBeaconService } from './atlas/beacon';
import { createAtlasEchoRepository, createAtlasEchoService } from './atlas/echoes';
import { createAtlasJsonRepository, createAtlasStateStore } from './atlas/persistence';
import { createAtlasIdentityService } from './atlas/identity';
import { createAtlasTicketService } from './atlas/tickets';
import { createAtlasSubmissionService } from './atlas/submissions';
import { createAtlasLeaderboardService } from './atlas/leaderboard';
import { createAtlasBlitzService } from './atlas/blitz';
import { createBlitzMaintenance } from './atlas/blitz-worker';
import { runBlitzDailyClose } from './atlas/blitz-daily-close';
import { blitzRewardsForWallet } from './atlas/blitz-rewards';
import { BLITZ_CITIES } from '../shared/atlas/blitz/cities';
import { BLITZ_SEASON_ID } from '../shared/atlas/blitz/daily';

/*
 * Every five minutes. Frequent enough that a day settles soon after it ends,
 * rare enough that it is not a busy loop against the treasury ledger.
 */
const BLITZ_MAINTENANCE_INTERVAL_MS = 5 * 60_000;
import { createAtlasCompetitiveRuntime } from './atlas/competitive';
import { ATLAS_CORE_FIXTURE } from '../shared/atlas/world';

const PORT = Number(process.env.PORT ?? 8790);
const IS_PRODUCTION = process.env.NODE_ENV === 'production';
const ALLOWED_ORIGINS = parseAllowedOrigins(process.env.ALLOWED_ORIGINS ?? '', IS_PRODUCTION);
/** Set this when running behind Caddy or any proxy, or rate limits key on it. */
const TRUST_PROXY = process.env.TRUST_PROXY === 'true';
const ADMIN_CONFIG = adminConfig();
const ADMIN_NONCES = new OperationNonces(60_000);
const RELAY_CONFIG = parseRelayConfig();
const ATLAS_PAYMENT_CONFIG = parseAtlasPaymentConfig();
const LEGACY_CONFIG = legacyConfig();
const DATA_DIR = process.env.DATA_DIR ?? join(process.cwd(), '.data');
const RELAY_WRITER_COUNT = assertSingleRelayWriter();

/**
 * Where anchored runs are sent, and which chain counts.
 *
 * Both come from the environment because they are deployment facts, not code:
 * the address is a wallet somebody owns, and the network id is a number the
 * library's types do not expose. An unset address turns anchoring off and the
 * route says so, which is better than accepting transactions with nothing to
 * check their recipient against.
 */
const ANCHOR_ADDRESS = process.env.ANCHOR_ADDRESS ?? '';

/**
 * Default 5, which is what a transaction built for Nimiq mainnet carries in
 * the library used here. Overridable because a wrong value refuses every anchor,
 * and the refusal logs the id it actually saw so the fix is one line.
 */
const ANCHOR_NETWORK_ID = Number(process.env.ANCHOR_NETWORK_ID ?? 5);

const app = express();
const playerAuth = new PlayerAuth();

installHttpBoundary(app, {
  allowedOrigins: ALLOWED_ORIGINS,
  production: IS_PRODUCTION,
  trustProxy: TRUST_PROXY,
  networkHeader: NETWORK_HEADER,
});
const rateLimiter = createRateLimiter();
const relayDaily = createRelayDailyService({ store: getRelayStore(), seasonId: RELAY_CONFIG.seasonId });
const relayTickets = createRelayTicketService({ store: getRelayStore(), daily: relayDaily });
const relayWalletBindings = createRelayWalletBindingService({ store: getRelayStore() });
const relayRepository = createRelayRepository({ store: getRelayStore(), traces: createRelayTraceStore({ directory: getRelayStore().paths.traces }) });
const relayWorld = createRelayWorldService({ store: getRelayStore() });
const relayLeaderboard = createRelayLeaderboardService({ runs: async () => Object.values((await getRelayStore().load()).verifiedRuns) });
const relayRewards = createRelayRewardService({ store: getRelayStore(), fundedAllocationLuna: RELAY_CONFIG.seasonAllocationLuna });
const relayChain = createNimiqRelayChainReader({ network: RELAY_CONFIG.network, rpcUrls: RELAY_CONFIG.rpcUrls, minConfirmations: RELAY_CONFIG.minConfirmations });
const relayPayouts = createRelayPayoutService({ store: getRelayStore(), chain: relayChain, treasuryAddress: RELAY_CONFIG.treasuryAddress ?? '', minConfirmations: RELAY_CONFIG.minConfirmations, network: RELAY_CONFIG.network });
const atlasOrders = ATLAS_PAYMENT_CONFIG.enabled ? createAtlasOrderStore({ network: ATLAS_PAYMENT_CONFIG.network, recipient: ATLAS_PAYMENT_CONFIG.recipient!, priceLuna: ATLAS_PAYMENT_CONFIG.valueLuna, minimumConfirmations: ATLAS_PAYMENT_CONFIG.minConfirmations, repository: createAtlasJsonRepository({ directory: join(DATA_DIR, 'atlas') }) }) : undefined;
const atlasChain = ATLAS_PAYMENT_CONFIG.enabled
  ? createAtlasChainReader({
      network: ATLAS_PAYMENT_CONFIG.network,
      rpcUrls: ATLAS_PAYMENT_CONFIG.rpcUrls,
      minConfirmations: ATLAS_PAYMENT_CONFIG.minConfirmations,
      // Without this the reader labels observations with the configured network
      // name and nothing ever checks which chain answered.
      expectedGenesisHash: ATLAS_PAYMENT_CONFIG.genesisHash ?? undefined,
    })
  : undefined;
const atlasStateStore = createAtlasStateStore(createAtlasJsonRepository({ directory: join(DATA_DIR, 'atlas-state') }));
/*
 * The reward treasury's payout ledger.
 *
 * This service and its admin routes existed but were never constructed or
 * mounted, so the whole Atlas payout path was unreachable. It is wired here
 * behind ATLAS_TREASURY_CONFIG, which requires the rewards gate and therefore
 * a durable repository, and it is always given `atlasStateStore`. The ledger
 * must never be built without one: create() refuses a duplicate payout id,
 * and that refusal is all that stops a redeploy from paying every settled
 * reward a second time out of real funds.
 *
 * Release stays supervised. These are admin routes behind requireAdmin and a
 * single-use operation nonce, so a batch is approved, submitted and reconciled
 * by a person rather than automatically.
 */
/*
 * The reward side reads its own chain.
 *
 * Purchases settle on testnet while daily rewards are paid in real mainnet
 * NIM, so the payout path can no longer borrow `atlasChain`, which is built
 * for the purchase network. Borrowing it would verify a mainnet payout against
 * a practice chain and call it settled.
 *
 * Mainnet is refused without its genesis hash, and the reader latches to
 * `rejected` if the RPC answers with a different one, so a node pointed at the
 * wrong chain stops producing evidence permanently rather than intermittently.
 */
const atlasRewardChain = ATLAS_DAILY_REWARD_CONFIG.enabled && ATLAS_DAILY_REWARD_CONFIG.network
  ? createAtlasChainReader({
      network: ATLAS_DAILY_REWARD_CONFIG.network,
      rpcUrls: parseAtlasRewardRpcUrls(),
      minConfirmations: ATLAS_REWARD_MIN_CONFIRMATIONS,
      expectedGenesisHash: ATLAS_DAILY_REWARD_CONFIG.network === 'mainalbatross' ? process.env.ATLAS_MAINNET_GENESIS_HASH : undefined,
    })
  : undefined;

/*
 * Payouts follow the reward chain, not the purchase chain.
 *
 * `ATLAS_TREASURY_CONFIG` still gates the competitive reward ledger, which is
 * a separate product on its own schedule. The daily pot has its own config and
 * its own chain, and either may be enabled without the other.
 */
const atlasPayoutChain = atlasRewardChain ?? atlasChain;
const atlasPayoutNetwork = ATLAS_DAILY_REWARD_CONFIG.network ?? ATLAS_PAYMENT_CONFIG.network;
const atlasPayoutTreasury = ATLAS_DAILY_REWARD_CONFIG.treasuryAddress ?? ATLAS_TREASURY_CONFIG.treasuryAddress;
const atlasPayouts = (ATLAS_DAILY_REWARD_CONFIG.enabled || ATLAS_TREASURY_CONFIG.enabled) && atlasPayoutChain && atlasPayoutTreasury
  ? createAtlasPayoutService({
      network: atlasPayoutNetwork,
      treasuryAddress: atlasPayoutTreasury,
      minConfirmations: atlasRewardChain ? ATLAS_REWARD_MIN_CONFIRMATIONS : ATLAS_PAYMENT_CONFIG.minConfirmations,
      chain: atlasPayoutChain,
      stateStore: atlasStateStore,
    })
  : undefined;
/*
 * Usage counting is always constructed, unlike the services above.
 *
 * Without a durable repository it still counts, in memory, and simply forgets
 * on restart. That is the right trade for a number that informs us rather than
 * moving money: a deployment with no disk should still be able to say how many
 * people played today, and the alternative — the service silently not existing
 * in production — is the exact shape of the treasury bug this codebase already
 * paid for once.
 */
/*
 * The daily run, and what it owes.
 *
 * Constructed only when payments are configured, because the day's payment
 * challenge has to be checked against the *real* recipient and amount. The
 * engine previously compared against the fixture address NQATLASLANTERNSHOP
 * and a 100,000 Luna price while production runs a real recipient at 10,000,
 * so it would have rejected every genuine payment and accepted only a fixture
 * production cannot produce.
 */
const atlasDaily = ATLAS_PAYMENT_CONFIG.enabled
  ? createAtlasDailyService({
      date: () => utcDate(),
      expectation: {
        network: ATLAS_PAYMENT_CONFIG.network,
        recipient: ATLAS_PAYMENT_CONFIG.recipient!,
        valueLuna: ATLAS_PAYMENT_CONFIG.valueLuna,
        minimumConfirmations: ATLAS_PAYMENT_CONFIG.minConfirmations,
      },
      dailyPoolLuna: ATLAS_DAILY_POOL_LUNA,
      /*
       * The pot is capped by what the treasury actually holds.
       *
       * ATLAS_DAILY_POOL_LUNA is an intent, not a balance. Production ran it at
       * 10,000 Luna against a treasury holding 3,338, so standing() advertised
       * roughly three times what could be settled. Reading the balance off the
       * reward chain makes the advertised share a number the treasury can pay.
       */
      treasuryBalanceLuna: atlasRewardChain && atlasPayoutTreasury
        ? () => atlasRewardChain.balanceOf(atlasPayoutTreasury)
        : undefined,
      stateStore: ATLAS_PRODUCTION_GATE.durableRepository ? atlasStateStore : undefined,
    })
  : undefined;

const atlasUsage = createAtlasUsageService({
  stateStore: ATLAS_PRODUCTION_GATE.durableRepository ? atlasStateStore : undefined,
  salt: process.env.ATLAS_USAGE_SALT,
});
const atlasBeacon = ATLAS_PRODUCTION_GATE.durableRepository ? createAtlasBeaconService({ repository: createAtlasBeaconRepository({ stateStore: atlasStateStore }) }) : undefined;
const atlasEchoes = ATLAS_PRODUCTION_GATE.durableRepository ? createAtlasEchoService({ repository: createAtlasEchoRepository({ stateStore: atlasStateStore }) }) : undefined;
const atlasIdentity = createAtlasIdentityService({ auth: playerAuth, domain: ALLOWED_ORIGINS[0] ?? 'https://www.sface.site' });
const atlasTickets = createAtlasTicketService({ identity: atlasIdentity });
const atlasSubmissions = createAtlasSubmissionService({ tickets: atlasTickets, expectedOrigin: ALLOWED_ORIGINS[0] ?? 'https://www.sface.site', mission: ATLAS_CORE_FIXTURE });
const atlasLeaderboard = createAtlasLeaderboardService();
// A public ranked board must survive restart. The service's optional store is
// useful for isolated tests, but is not a production ranking capability.
const atlasBlitz = ATLAS_PRODUCTION_GATE.durableRepository ? createAtlasBlitzService({
  identity: atlasIdentity,
  stateStore: atlasStateStore,
  /*
   * A ranked run the server re-simulated and agreed with earns a share of the
   * day's mainnet pool. Undefined when no treasury is configured, and the
   * board works exactly the same without it.
   */
  daily: atlasDaily,
}) : undefined;

/*
 * The only unattended work NIM RUSH does.
 *
 * Two promises were being made and never kept: the result screen tells a rider
 * a pool is "paid at the close of the day" while nothing closed a day, and the
 * blitz qualification outbox had no drain. Both failed silently.
 *
 * It raises draft obligations and stops. Approving and submitting a transfer
 * stay supervised human actions, which is what makes an unattended worker safe
 * to run at all. Constructed only when there is both a board to close and a
 * treasury to owe from.
 */
const atlasBlitzMaintenance = atlasBlitz && atlasPayouts
  ? createBlitzMaintenance({
      intervalMs: BLITZ_MAINTENANCE_INTERVAL_MS,
      close: () => runBlitzDailyClose({
        now: Date.now(),
        seasonId: BLITZ_SEASON_ID,
        cities: BLITZ_CITIES.map((city) => city.id),
        blitz: atlasBlitz,
        payouts: atlasPayouts,
      }),
      drainQualifications: () => atlasBlitz.retryPendingQualifications(),
    })
  : undefined;
const atlasCompetitive = ATLAS_PRODUCTION_GATE.competitive && atlasBeacon && atlasEchoes
  ? createAtlasCompetitiveRuntime({ identity: atlasIdentity, tickets: atlasTickets, submissions: atlasSubmissions, leaderboard: atlasLeaderboard, beacon: atlasBeacon, echoes: atlasEchoes, stateStore: atlasStateStore, ticketPolicy: ATLAS_COMPETITIVE_POLICY! })
  : undefined;
const provesActor = createActorVerifier(playerAuth);
installRequestLogging(app, { record: recordAdminLog });
mountRelayRoutes({ app, limit: rateLimiter.limit, api: createRelayApi({ config: RELAY_CONFIG, tickets: relayTickets, walletBindings: relayWalletBindings, daily: relayDaily, repository: relayRepository, actorExists: (actorId) => playerAuth.hasCredential(actorId), world: relayWorld, leaderboard: relayLeaderboard, rewards: relayRewards }) });
mountAtlasUsageRoutes({ app, limit: rateLimiter.limit, usage: atlasUsage });
mountAtlasDailyRoutes({ app, limit: rateLimiter.limit, daily: atlasDaily });
mountAtlasRoutes({ app, limit: rateLimiter.limit, api: createAtlasApi({
  curriculum: ATLAS_CURRICULUM,
  competitiveExpeditions: ATLAS_PRODUCTION_GATE.competitive,
  orders: atlasOrders,
  chain: atlasChain,
  beacon: atlasBeacon,
  echoes: atlasEchoes,
  identity: atlasIdentity,
  competitive: atlasCompetitive,
  blitz: atlasBlitz,
  /*
   * A rider can see their own receipts only when there is a ledger to read.
   * Without a treasury this stays undefined and the route answers 503, which
   * is the truth: rewards are unavailable, not empty.
   */
  blitzRewards: atlasPayouts ? (walletAddress: string) => blitzRewardsForWallet({ payouts: atlasPayouts, walletAddress }) : undefined,
  competition: atlasCompetitive ? () => atlasCompetitive.competition() : undefined,
  authorize: (proof, action, actorId, body) => provesActor(proof, action, actorId, body),
  orderCatalog: ATLAS_PAYMENT_CONFIG.enabled ? { itemId: ATLAS_PAYMENT_CONFIG.itemId, network: ATLAS_PAYMENT_CONFIG.network, recipient: ATLAS_PAYMENT_CONFIG.recipient!, valueLuna: ATLAS_PAYMENT_CONFIG.valueLuna } : undefined,
}) });
app.use(['/chat', '/tips', '/tips/seen', '/board', '/board/anchor', '/board/sign', '/contests', '/clans/join', '/signals/unlock', '/profile/merge'], legacyMutationMiddleware(LEGACY_CONFIG));
// Schemas ------------------------------------------------------------------

const deviceId = z.string().regex(/^[0-9a-f]{16,64}$/i, 'Device id must be hex.');
const publicKeyJwk = z.object({
  kty: z.literal('EC'),
  crv: z.literal('P-256'),
  x: z.string().min(1).max(100),
  y: z.string().min(1).max(100),
  key_ops: z.array(z.string()).optional(),
  ext: z.boolean().optional(),
});
const deviceProof = z.object({
  challengeId: z.string().min(1).max(128),
  publicKeyJwk,
  signature: z.string().regex(/^[0-9a-f]+$/i).max(1024),
});
const pilotName = z.string().min(1).max(32);
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be YYYY-MM-DD.');
const seed = z.string().min(1).max(120);
/** Nimiq addresses are NQ plus 34 base32 characters, spaces optional. */
const nimiqAddress = z
  .string()
  .transform((value) => value.replace(/\s/g, '').toUpperCase())
  .refine((value) => /^NQ\d{2}[0-9A-HJ-NP-VXY]{32}$/.test(value), 'Not a Nimiq address.');

/** Only https, and only a host X actually serves pictures from. */
const avatarUrl = z
  .string()
  .refine((value) => {
    try {
      const url = new URL(value);
      return (
        url.protocol === 'https:' &&
        ['pbs.twimg.com', 'abs.twimg.com'].includes(url.hostname)
      );
    } catch {
      return false;
    }
  }, 'Not an X image URL.');

const scoreBody = z.object({
  deviceId,
  name: pilotName,
  date: isoDate,
  seed,
  score: z.number().int().min(0).max(board.SCORE_CEILING),
  // The day's cast is eight. See ROSTER_SIZE in server/xsense.ts.
  facesExtracted: z.number().int().min(0).max(ROSTER_SIZE),
  attackersCleared: z.number().int().min(0).max(200),
  duration: z.number().min(0).max(board.MAX_DURATION),
  // Added with the profile. Optional so an older client keeps working.
  cachesTaken: z.number().int().min(0).max(40).optional(),
  relicTaken: z.boolean().optional(),
  extracted: z.boolean().optional(),
  stage: z.number().int().min(1).max(7).optional(),
  stageCleared: z.boolean().optional(),
  avatarUrl: avatarUrl.nullable().optional(),

  /*
   * The wallet's signature over this exact claim. Optional, because the board
   * has always accepted unsigned rows and a plain browser has no wallet to
   * sign with. A row that supplies one gets verified; a row that does not is
   * stored exactly as before and simply carries no address.
   */
  publicKey: z.string().regex(/^[0-9a-fA-F]{64}$/).optional(),
  signature: z.string().regex(/^[0-9a-fA-F]{128}$/).optional(),
});

/**
 * Signing a run that was already posted.
 *
 * Everything needed to rebuild the exact signed message, and nothing else. No
 * score is written from this and no profile is touched, so the fields that
 * would move a ranking are deliberately absent from the schema rather than
 * accepted and ignored.
 */
/** Opening a contest. The terms, and nothing that could move a result. */
const contestBody = z.object({
  deviceId,
  name: pilotName,
  avatarUrl: avatarUrl.nullable().optional(),
  // Where the host is paid if they win. Required for a staked contest, and
  // meaningless on a free one, so the shape allows absent rather than empty.
  address: nimiqAddress.nullable().optional(),
  kind: z.enum(['duel', 'clan', 'gauntlet']),
  stages: z.array(z.number().int().min(1).max(7)).min(1).max(7),
  // Zero is allowed: a contest with nothing on it is a free pass, not a
  // missing stake. See the constant in server/contests.ts.
  stakeNim: z.number().int().min(contests.MIN_STAKE_NIM).max(contests.MAX_STAKE_NIM),
  seats: z.number().int().min(2).max(6),
  visibility: z.enum(['open', 'private']),
  /*
   * How long it stays open, in minutes. Absent means the rest of the UTC day.
   *
   * The band is checked here and clamped again in the store, which is not
   * belt and braces for its own sake: this schema rejects a bad request, and
   * the clamp is what caps a legitimate 24 hour request at the rollover when
   * the contest was opened at four in the afternoon.
   */
  openMinutes: z
    .number()
    .int()
    .min(contestRules.MIN_OPEN_MINUTES)
    .max(contestRules.MAX_OPEN_MINUTES)
    .nullable()
    .optional(),
});

const joinContestBody = z.object({
  deviceId,
  name: pilotName,
  avatarUrl: avatarUrl.nullable().optional(),
  address: nimiqAddress.nullable().optional(),
});

/** Reporting a settlement. The hash is a claim by the payer, not a proof. */
const contestPaidBody = z.object({
  deviceId,
  txHash: z.string().min(1).max(200),
});

const signBody = z.object({
  deviceId,
  date: isoDate,
  seed,
  stage: z.number().int().min(1).max(7),
  score: z.number().int().min(0).max(board.SCORE_CEILING),
  publicKey: z.string().regex(/^[0-9a-fA-F]{64}$/),
  signature: z.string().regex(/^[0-9a-fA-F]{128}$/),
});

/**
 * Anchoring a run. The transaction, and which run it is supposed to be for.
 *
 * The run fields are not trusted: they say which board row to look at, and the
 * transaction must independently carry the same values. Sending one run's
 * numbers with another run's transaction is exactly what verifyAnchor refuses.
 */
/**
 * A line in the room. The pilot is checked against a profile, never trusted.
 *
 * The text may be empty when a run is attached, because the card is the
 * message. `runDate` says which day to look up, and the row that is read is
 * always the sender's own: it cannot name another pilot, so there is nothing to
 * check beyond the date being a date.
 */
const chatBody = z.object({
  deviceId,
  text: z.string().max(chat.MAX_MESSAGE),
  runDate: isoDate.nullish(),
  /** The message being answered. Dropped by the store if it does not exist. */
  replyTo: z.string().max(64).nullish(),
});

/**
 * A tip somebody just tried to send.
 *
 * Nothing here decides whether money moved. The wallet does that, and this only
 * records that it was attempted so the other phone can be told. `state` is not
 * taken from the client either: the service works it out from whether the
 * recipient has ever proved a wallet.
 */
const tipBody = z.object({
  deviceId,
  to: deviceId,
  nim: z.number().positive().max(tips.MAX_TIP_NIM),
  /** Whatever the wallet handed back, when it handed anything back. */
  tx: z.string().max(2048).nullish(),
});

const anchorBody = z.object({
  deviceId,
  date: isoDate,
  seed,
  stage: z.number().int().min(1).max(7),
  score: z.number().int().min(0).max(board.SCORE_CEILING),
  // Hex, and long enough to be a transaction rather than a typo. The real bound
  // is whether it parses, which anchor.ts does properly.
  /*
   * Whatever the wallet handed back, loosely bounded.
   *
   * It was a strict hex pattern for a serialized transaction, which refused
   * every real reply and told players their score had not been sent while the
   * transaction was already on its way. The shape is Nimiq Pay's to choose, so
   * the only thing checked here is that it is a plausible identifier at all;
   * what it actually is gets decided in anchor.ts.
   */
  receipt: z.string().min(16).max(8000),
  /** What the client thought it received. Diagnostic only, never trusted. */
  shape: z.string().max(60).optional(),
});

const joinClanBody = z.object({
  deviceId,
  name: pilotName,
  // Null leaves the clan. The shape is enforced by clans.normaliseTag, which
  // also fixes case and stray whitespace rather than refusing them.
  tag: z.string().max(8).nullable(),
});

const decideClanBody = z.object({
  /** The owner. The service checks this against the record, not the caller. */
  deviceId,
  memberId: deviceId,
  approve: z.boolean(),
});

const mergeBody = z.object({
  /** The device record being retired. */
  from: deviceId,
  /** The account record it becomes part of. */
  into: deviceId,
  sourceProof: z
    .object({
      challengeId: z.string().min(1).max(128),
      publicKeyJwk,
      signature: z.string().regex(/^[0-9a-f]+$/i).max(1024),
    })
    .optional(),
  destinationProof: z.object({
    challengeId: z.string().min(1).max(128),
    publicKeyJwk,
    signature: z.string().regex(/^[0-9a-f]+$/i).max(1024),
  }),
  walletProof: z
    .object({
      publicKey: z.string().regex(/^[0-9a-f]+$/i).max(256),
      signature: z.string().regex(/^[0-9a-f]+$/i).max(512),
    })
    .optional(),
});

const unlockBody = z.object({
  deviceId,
  /** Reported, not verified. Same limitation as challenge settlement. */
  serializedTx: z.string().regex(/^[0-9a-f]+$/i).min(32).max(4096),
});

function currentHealth() {
  return effectiveHealth({
    persistence: getPersistenceHealth(),
    relayPersistence: getRelayPersistenceHealth(),
    relayWriterCount: RELAY_WRITER_COUNT,
    anchor: anchor.isAnchorAddress(ANCHOR_ADDRESS),
    xOAuth: xauth.xauthConfigured(),
    xRead: xpostsConfigured() && xusersConfigured(),
    xSense: xsenseConfigured(),
    signals: signals.xsignalsConfigured(),
    corsRestricted: ALLOWED_ORIGINS.length > 0,
    trustedProxy: TRUST_PROXY,
  });
}


const requireAdmin = adminMiddleware(ADMIN_CONFIG, ({ reason, ip, path }) => {
  recordAdminLog({ time: Date.now(), level: 'warn', subsystem: 'admin', event: reason === 'ip_denied' ? 'login_ip_denied' : 'login_failed', message: reason === 'ip_denied' ? 'Admin request denied by IP policy' : 'Admin authentication refused', context: { reason, ip, path } });
});

// Routes -------------------------------------------------------------------

mountSystemRoutes({ app, limit: rateLimiter.limit, health: currentHealth, date: utcDate, mission: getMission });

mountAdminObservabilityRoutes({ app, limit: rateLimiter.limit, requireAdmin, logs: adminLogs, record: recordAdminLog });
mountAdminOperationsRoutes({ app, limit: rateLimiter.limit, requireAdmin, nonces: ADMIN_NONCES, backup: backupSnapshot, listBackups, diagnostics: buildDiagnosticBundle, health: currentHealth, config: configInventory, logs: adminLogs, record: recordAdminLog, date: utcDate, rateLimitCount: () => rateLimiter.count(), commit: process.env.GIT_COMMIT ?? null, restartSupported: process.env.ADMIN_RESTART_ENABLED === 'true', restart: () => { const timer = setTimeout(() => process.kill(process.pid, 'SIGTERM'), 250); timer.unref(); } });
mountAdminReadRoutes({ app, limit: rateLimiter.limit, requireAdmin, logs: adminLogs, record: recordAdminLog, sources: { profiles: profiles.serialise, scores: board.serialise, clans: clans.serialise, contests: contests.serialise, challenges: challenges.serialise, tips: tips.serialise, ghosts: ghosts.serialise, chat: chat.serialise, signals: signals.serialise } });
mountLegacyArchiveRoutes({ app, limit: rateLimiter.limit, requireAdmin, dataDirectory: DATA_DIR, adminReadsEnabled: LEGACY_CONFIG.adminReadsEnabled, sources: { profiles: profiles.serialise, scores: board.serialise, clans: clans.serialise, contests: contests.serialise, challenges: challenges.serialise, tips: tips.serialise, ghosts: ghosts.serialise, chat: chat.serialise, signals: signals.serialise }, record: recordAdminLog });
mountAdminConfigRoutes({ app, limit: rateLimiter.limit, requireAdmin, nonces: ADMIN_NONCES, inventory: configInventory, record: recordAdminLog });
mountAdminOverviewRoutes({ app, limit: rateLimiter.limit, requireAdmin, health: currentHealth, inventory: configInventory, date: utcDate, commit: process.env.GIT_COMMIT ?? null, uptimeSeconds: () => Math.floor(process.uptime()), restartSupported: process.env.ADMIN_RESTART_ENABLED === 'true' });
mountRelayAdminRoutes({ app, limit: rateLimiter.limit, requireAdmin, nonces: ADMIN_NONCES, payouts: relayPayouts, rewards: relayRewards });
if (atlasPayouts) mountAtlasPayoutAdminRoutes({ app, limit: rateLimiter.limit, requireAdmin, nonces: ADMIN_NONCES, payouts: atlasPayouts });
/**
 * The Atlas owner gates are read here rather than restated.
 *
 * These switches used to be a frozen constant that only a test read, while the
 * two places that actually gate behaviour carried their own hardcoded copies:
 * a literal `false` for competitive expeditions and a literal refusal string
 * for the evidence surface. The test pinned the constant, so it stayed green
 * while either literal drifted, which is the one failure this shape exists to
 * prevent. One source of truth, consumed at both doors.
 *
 * Flipping `durableRepository` on its own is deliberately not enough to open
 * this route: there is no durable evidence reader behind it yet, so the true
 * branch still refuses and says which half is missing. A gate that reports
 * available with nothing behind it is worse than one that stays shut.
 */
mountAtlasAdminRoutes({
  app,
  limit: rateLimiter.limit,
  requireAdmin,
  evidence: () => ({
    status: 'unavailable',
    reason: ATLAS_PRODUCTION_GATE.durableRepository ? 'atlas_durable_evidence_reader_not_implemented' : 'atlas_durable_repository_disabled',
  }),
});
mountPlayerAuthRoutes({ app, limit: rateLimiter.limit, auth: playerAuth, save: () => scheduleSave(snapshot) });
mountLeaderboardReadRoutes({ app, limit: rateLimiter.limit });
mountCommunityReadRoutes({ app, limit: rateLimiter.limit });
mountPublicArtifactRoutes({ app, limit: rateLimiter.limit });
mountProfileReadRoutes({ app, limit: rateLimiter.limit });
mountXAuthRoutes({ app, limit: rateLimiter.limit, allowedOrigins: ALLOWED_ORIGINS });
mountSignalsReadRoutes({ app, limit: rateLimiter.limit });
mountSocialReadRoutes({ app, limit: rateLimiter.limit });
mountChallengeWriteRoutes({ app, limit: rateLimiter.limit, provesActor });
mountGhostWriteRoutes({ app, limit: rateLimiter.limit, provesActor });

/*
 * Registered before /board/:date on purpose. Express matches in declaration
 * order, so the parameterised route would otherwise capture "all-time" as a
 * date, fail the YYYY-MM-DD parse, and return 400 for a route that exists.
 */
/**
 * What to quote when somebody asks how many people used this.
 *
 * Public and unauthenticated because there is nothing private in it: three
 * counts, no names, no addresses. Wallets are counted only where a signature
 * proved one, so the number is smaller than the flattering version and cannot
 * be padded by anybody who feels like posting an address. See walletCount.
 */
app.post('/chat', rateLimiter.limit(30, 10), async (req, res) => {
  const parsed = chatBody.extend({ auth: deviceProof }).safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: firstIssue(parsed.error) });
    return;
  }

  const body = parsed.data;
  const network = networkOf(req);
  const signedBody = {
    deviceId: body.deviceId,
    text: body.text,
    runDate: body.runDate ?? null,
    replyTo: body.replyTo ?? null,
  };
  const actor = await playerAuth.verify({
    proof: body.auth as DeviceProof,
    action: 'chat.say',
    bodyDigest: await bodyDigest(signedBody),
  });
  if (!actor.ok || actor.value.playerId !== body.deviceId) {
    res.status(403).json({ error: 'unauthorized' });
    return;
  }

  /*
   * You have to have played to speak.
   *
   * Not gatekeeping for its own sake: a room anybody can post into without ever
   * opening the game is a room that fills with people who are not playing it.
   * One run is the whole requirement, and it is checked against the profile
   * rather than asked of the client.
   */
  const profile = profiles.get(body.deviceId, network);
  if (!profile || profile.runs <= 0) {
    res.status(403).json({ error: 'Fly a run first. The room is for people playing.' });
    return;
  }

  /*
   * A run can only be posted if it is on the board.
   *
   * Checked before the message is kept rather than when the room is served, so
   * a share that cannot work fails in front of the person who tried it instead
   * of becoming a line with a hole in it that everybody else sees.
   */
  if (body.runDate && !board.runCard(network, body.runDate, body.deviceId)) {
    res.status(400).json({ error: 'That run is not on the board.' });
    return;
  }

  const result = chat.say({
    network,
    pilotId: body.deviceId,
    text: body.text,
    runDate: body.runDate ?? null,
    replyTo: body.replyTo ?? null,
    now: Date.now(),
  });

  if (!result.ok) {
    res.status(result.code).json({ error: result.reason });
    return;
  }

  res.json({
    ...result.value,
    run: result.value.runDate
      ? board.runCard(network, result.value.runDate, body.deviceId)
      : null,
  });
});

/**
 * Change a message already said.
 *
 * The service decides whose it is and whether the window has closed. Nothing
 * about ownership is taken from the request: the id on the stored message is
 * this service's own record of who said what.
 */
app.post('/chat/:id', rateLimiter.limit(30, 10), async (req, res) => {
  const parsed = z
    .object({ deviceId, text: z.string().max(chat.MAX_MESSAGE), auth: deviceProof })
    .safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: firstIssue(parsed.error) });
    return;
  }

  const network = networkOf(req);
  const actor = await playerAuth.verify({
    proof: parsed.data.auth as DeviceProof,
    action: 'chat.edit',
    bodyDigest: await bodyDigest({
      id: String(req.params.id ?? ''),
      deviceId: parsed.data.deviceId,
      text: parsed.data.text,
    }),
  });
  if (!actor.ok || actor.value.playerId !== parsed.data.deviceId) {
    res.status(403).json({ error: 'unauthorized' });
    return;
  }
  const result = chat.edit({
    network,
    pilotId: parsed.data.deviceId,
    id: String(req.params.id ?? ''),
    text: parsed.data.text,
    now: Date.now(),
  });

  if (!result.ok) {
    res.status(result.code).json({ error: result.reason });
    return;
  }

  res.json({
    ...result.value,
    run: result.value.runDate
      ? board.runCard(network, result.value.runDate, parsed.data.deviceId)
      : null,
  });
});

/**
 * Tips.
 *
 * ## What these two routes are not
 *
 * They are not a payment path. No NIM passes through this service, it holds no
 * balance and it cannot stop a transaction. A tip goes wallet to wallet, is
 * approved in Nimiq Pay, and the chain is the receipt.
 *
 * What they do is carry the news. A tip is the only thing in this app that
 * happens entirely on somebody else's phone, so it is the only thing that
 * cannot be worked out on the device it needs to reach.
 *
 * ## Why the state is decided here
 *
 * Whether a tip could be sent at all depends on whether the recipient ever
 * proved a wallet, and that is this service's own record. Taking the client's
 * word for it would let a message claim money was sent that never could be.
 */
app.post('/tips', rateLimiter.limit(60, 60), async (req, res) => {
  const parsed = tipBody.extend({ auth: deviceProof }).safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: firstIssue(parsed.error) });
    return;
  }

  const body = parsed.data;
  const network = networkOf(req);
  if (!(await provesActor(body.auth as DeviceProof, 'tips.report', body.deviceId, {
    deviceId: body.deviceId, to: body.to, nim: body.nim, tx: body.tx ?? null,
  }))) {
    res.status(403).json({ error: 'unauthorized' });
    return;
  }

  const recipient = profiles.get(body.to, network);
  if (!recipient) {
    res.status(404).json({ error: 'No such pilot.' });
    return;
  }

  const result = tips.record({
    network,
    from: body.deviceId,
    to: body.to,
    nim: body.nim,
    // The service's own record of a proved wallet, never the client's claim.
    state: recipient.address ? 'sent' : 'no-wallet',
    tx: body.tx ?? null,
    now: Date.now(),
  });

  if (!result.ok) {
    res.status(result.code).json({ error: result.reason });
    return;
  }

  res.json(result.value);
});

/** Everything waiting has been seen. A watermark, so nothing half-marks. */
app.post('/tips/seen', rateLimiter.limit(60, 60), async (req, res) => {
  const parsed = z.object({ deviceId, auth: deviceProof }).safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: firstIssue(parsed.error) });
    return;
  }

  if (!(await provesActor(parsed.data.auth as DeviceProof, 'tips.seen', parsed.data.deviceId, {
    deviceId: parsed.data.deviceId,
  }))) {
    res.status(403).json({ error: 'unauthorized' });
    return;
  }
  tips.markSeen(networkOf(req), parsed.data.deviceId, Date.now());
  res.json({ ok: true });
});

app.post('/board', rateLimiter.limit(20, 10), async (req, res) => {
  const parsed = scoreBody.extend({ auth: deviceProof }).safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: firstIssue(parsed.error) });
    return;
  }

  const body = parsed.data;
  const { auth: _auth, ...submitted } = body;
  if (!(await provesActor(body.auth as DeviceProof, 'score.post', body.deviceId, submitted))) {
    res.status(403).json({ error: 'unauthorized' });
    return;
  }

  /*
   * Verify the signature, if there is one, and derive who signed.
   *
   * A bad signature is refused rather than quietly downgraded to an unsigned
   * row. Silently accepting it would mean a tampered claim still lands on the
   * board looking ordinary, and the player who sent a genuine one has no way
   * to tell their wallet failed to bind.
   *
   * The address is DERIVED from the public key. There is deliberately no
   * address field in the request: a client-supplied address is a claim about
   * a signature, whereas a derived one is the signature's author.
   */
  let address: string | null = null;
  /*
   * Kept, not just checked.
   *
   * Verifying and then discarding the signature leaves the board asserting that
   * a wallet signed, with nothing anyone else can use to confirm it. Storing it
   * makes the claim checkable by a stranger, offline, after we are gone. See
   * the Proof type in leaderboard.ts.
   */
  let proof: board.Proof | null = null;
  /** Set when a signature arrived and did not verify, so the reply can say so. */
  let signatureRefused = false;
  if (body.publicKey && body.signature) {
    const attested = verifyClaim({
      claim: {
        date: body.date,
        seed: body.seed,
        stage: body.stage ?? 1,
        score: body.score,
      },
      publicKey: body.publicKey,
      signature: body.signature,
    });

    /*
     * A signature that does not verify costs the signature, never the score.
     *
     * This used to refuse the whole post with a 422. The reasoning was that
     * silently downgrading a bad signature would let a tampered claim land
     * looking ordinary, and that half is still true. What it got wrong is the
     * price: a player who finished a real run, signed it in good faith, and hit
     * any quirk between their wallet and this check lost the entire run. Face,
     * board row, rank, all of it, with nothing they could do about it.
     *
     * That trade is backwards. A row with no signature is exactly what a plain
     * browser has always produced and the board has always accepted, and it is
     * marked as unsigned rather than passed off as attested, so nothing is
     * being smuggled through. Meanwhile the score, which is the thing the
     * player actually earned, is safe.
     *
     * Signing is a separate act now, on its own route, and it is retryable.
     * See POST /board/sign. That is where a signature belongs: something that
     * can fail and be tried again, rather than something that can take a run
     * down with it.
     */
    if (!attested) {
      signatureRefused = true;
      /*
       * Logged with enough to tell WHY, because nothing else can.
       *
       * Not one row in production has ever carried a signature. Either the
       * wallet never produced one, or every one it produced failed this check,
       * and from the outside those look identical: the score lands unsigned
       * either way and nobody is told anything.
       *
       * The message is what the service rebuilt and tried to verify against.
       * If the wallet signed something else, comparing that string to what the
       * client sent is the whole diagnosis. Public keys and signatures are
       * public by definition, so there is nothing here worth hiding.
       */
      console.warn(
        '[sface] signature refused',
        JSON.stringify({
          message: claimMessage({
            date: body.date,
            seed: body.seed,
            stage: body.stage ?? 1,
            score: body.score,
          }),
          publicKey: body.publicKey,
          signature: body.signature,
        }),
      );
    } else {
      address = attested.address;
      /*
       * Remembered on the profile as well as on the row.
       *
       * A daily row carries its own signature. Lifetime Face is the sum of
       * dozens of runs, so there is no single signature over it, and without
       * this the all-time board had no verification of any kind. Binding the
       * address here is the weaker claim that is still worth making: this
       * account has proved a wallet at least once.
       */
      profiles.bindAddress(body.deviceId, attested.address);
      proof = {
        publicKey: body.publicKey,
        signature: body.signature,
        seed: body.seed,
        stage: body.stage ?? 1,
      };
    }
  }

  /*
   * Check the claim against the level it was supposedly run on.
   *
   * The mission comes from the service's own cache, never from the request. A
   * caller who could supply the terrain could describe a level generous enough
   * to justify anything they claimed, which would make the whole check a
   * formality that validates the attacker's own homework.
   *
   * Skipped when the seed does not match today's: the service only holds one
   * day's mission, so it cannot rebuild yesterday's level to check against.
   * Those rows fall back to the old fixed bounds, which is what they had
   * before this existed.
   */
  const today = await getMission();
  if (today && today.payload.seed === body.seed) {
    const facts = levelFacts(today.payload, body.stage ?? 1);
    const impossible = facts && refuse(
      {
        seed: body.seed,
        stage: body.stage ?? 1,
        score: body.score,
        facesExtracted: body.facesExtracted,
        attackersCleared: body.attackersCleared,
        cachesTaken: body.cachesTaken ?? 0,
        duration: body.duration,
        extracted: body.extracted ?? false,
      },
      facts,
    );

    if (impossible) {
      res.status(422).json({ error: impossible });
      return;
    }
  }

  /*
   * Stamped with the network the client declared, never with anything the body
   * claims. A score can only land on the board it was played on, and the client
   * is trusted with this exactly because declaring testnet can only ever mean
   * less: no metered reads, and a row that stays off the mainnet board.
   *
   * ## Testnet lands, on its own board
   *
   * This used to return early for a rehearsal, above the verification, with a
   * comment claiming the whole path still ran. It did not: the signature was
   * never checked and the level was never rebuilt, so the one network that
   * exists to exercise those was the only one that skipped them.
   *
   * It also made two things the app says untrue. Testnet has its own board and
   * its own lifetime Face, keyed by network everywhere from server/leaderboard
   * to server/profiles, and none of it could ever fill because nothing was
   * written. The separation is what keeps free NIM out of a real rank; it was
   * never a reason to discard the rehearsal itself.
   */
  const result = board.submit({ ...body, network: networkOf(req), address, proof });
  if (!result.ok) {
    res.status(422).json({ error: result.reason });
    return;
  }

  /*
   * The board keeps the best run of the day; the profile adds every run.
   * Folded in here rather than behind a second call so a run cannot be
   * counted on one and missed on the other, which would show a player a rank
   * that disagrees with their own results screen.
   */
  /*
   * Contests are updated here rather than by a second call.
   *
   * A separate request is a second chance to fail: the score lands on the board
   * and the contest entry does not, so somebody has a run they can see and a
   * stake that does not know about it. In the same request they arrive together
   * or not at all.
   */
  sweepContests(networkOf(req));
  const justSettled = contests.recordScore({
    network: networkOf(req),
    now: Date.now(),
    pilotId: parsed.data.deviceId,
    date: parsed.data.date,
    seed: parsed.data.seed,
    stage: parsed.data.stage ?? 1,
    score: parsed.data.score,
  });

  /*
   * Write the debts once, at the moment a contest becomes settled.
   *
   * Here rather than in the store, because the store knows nothing about
   * profiles and should not: it answers who owes what, and the record of
   * whether people pay is a different question kept somewhere that outlives
   * the contest, which is pruned after two days.
   */
  for (const contest of justSettled) {
    for (const owed of contestRules.obligationsOf(contest)) {
      const who = contest.entrants.find((e) => e.id === owed.fromId);
      profiles.recordDebt(owed.fromId, who?.name ?? 'Pilot', networkOf(req));
    }
  }

  const profile = profiles.record({
    id: parsed.data.deviceId,
    name: parsed.data.name,
    // Stamped so the clan table can group profiles by chain. The id is already
    // scoped by network on the client; this is what lets a scan tell them apart.
    network: networkOf(req),
    avatarUrl: parsed.data.avatarUrl ?? null,
    score: parsed.data.score,
    rescued: parsed.data.facesExtracted,
    caches: parsed.data.cachesTaken ?? 0,
    relics: parsed.data.relicTaken ? 1 : 0,
    extracted: parsed.data.extracted === true,
    stage: parsed.data.stage,
    stageCleared: parsed.data.stageCleared === true,
  });

  /*
   * `signed` tells the client what actually happened to its signature.
   *
   * Absent from the reply is not the same as false: an older client that never
   * sent one gets neither field and has nothing to explain. A client that sent
   * one and sees `signed: false` can offer to try again, which is the whole
   * reason the score no longer dies with the signature.
   */
  res.json({
    rank: result.rank,
    profile,
    /*
     * Whether THIS run is the one on the board.
     *
     * The board keeps the best run of the day, so a later, worse run leaves the
     * earlier row in place. Anything that attaches to a row, which is what
     * anchoring does, can only attach to that one.
     *
     * Without this the client had no way to know, so it offered to write any
     * run onto the chain, took the fee, and only then found a row whose score
     * did not match. Reported with the fee already gone.
     */
    onBoard: board.bestScore(networkOf(req), body.date, body.deviceId) === body.score,
    ...(body.publicKey && body.signature
      ? { signed: !signatureRefused }
      : {}),
  });
});

/*
 * Clans. Three endpoints, no clan store, and no ownership model.
 *
 * Everything here is folded out of the profiles on demand, so a clan cannot
 * disagree with its own members. The reasoning, including why anyone is allowed
 * to join any tag, is at the top of server/clans.ts.
 */
/**
 * Bind a wallet to a run that is already on the board.
 *
 * ## Why this is separate from posting
 *
 * The wallet used to be asked to sign during the post, which meant the prompt
 * arrived unannounced, in the two seconds a player is reading their own score,
 * and could not be retried if it failed. Worse, it was asked whenever a wallet
 * was merely present, including when no account had ever been approved, so
 * inside Nimiq Pay it reliably failed.
 *
 * So the score posts first and always, and signing is a button afterwards.
 * That needs its own route, because re-posting would be refused by the board
 * (it only replaces on a better score) and would add the run's Face to the
 * lifetime profile a second time.
 *
 * Nothing here changes a ranking. It attaches proof to a row that already
 * exists, or refuses.
 */
/**
 * Write a run onto the chain, and prove it.
 *
 * ## What arrives, and what is believed
 *
 * The client posts the serialized transaction its wallet signed. Nothing it
 * says about that transaction is taken on trust, including which run it is for:
 * the expected data is rebuilt here from the row the board already holds, and
 * the transaction has to match it. The hash is computed from the bytes rather
 * than accepted, because a hash is a string and any string would do.
 *
 * See server/anchor.ts for the five fields that are checked and why leaving out
 * any one of them makes the other four decorative.
 *
 * ## Why this is refused rather than disabled when unconfigured
 *
 * Anchoring needs an address to send to. Without one there is nothing to check
 * a recipient against, so every transaction would either be accepted blindly or
 * rejected confusingly. Saying so plainly is better than either.
 */
app.post('/board/anchor', rateLimiter.limit(20, 10), async (req, res) => {
  const parsed = anchorBody.extend({ auth: deviceProof }).safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: firstIssue(parsed.error) });
    return;
  }

  if (!anchor.isAnchorAddress(ANCHOR_ADDRESS)) {
    res.status(503).json({ error: 'Anchoring is not configured on this service.' });
    return;
  }

  const body = parsed.data;
  const network = networkOf(req);
  const { auth: _auth, ...anchored } = body;
  if (!(await provesActor(body.auth as DeviceProof, 'score.anchor', body.deviceId, anchored))) {
    res.status(403).json({ error: 'unauthorized' });
    return;
  }

  // Testnet runs are verified and never written down, so there is no row to
  // anchor. Said plainly rather than returning a success nothing came of.
  if (network === 'test') {
    res.json({ ok: true, recorded: false, note: 'Testnet runs are not kept on the board.' });
    return;
  }

  /*
   * A full transaction if the wallet gave one, an identifier if it did not.
   *
   * Which of the two arrives is the wallet's decision, not ours, so both are
   * handled and the difference is recorded rather than hidden. See
   * reportedAnchor for what the weaker one is and is not worth.
   */
  const checked = anchor.looksLikeHash(body.receipt)
    ? anchor.reportedAnchor(body.receipt, profiles.get(body.deviceId, network)?.address ?? null)
    : anchor.verifyAnchor({
        serialized: body.receipt,
        claim: { date: body.date, seed: body.seed, stage: body.stage, score: body.score },
        anchorAddress: ANCHOR_ADDRESS,
        networkId: ANCHOR_NETWORK_ID,
      });

  /*
   * Logged whatever happens, because the shape is the open question.
   *
   * Nothing else can tell us what Nimiq Pay actually returns, and a player who
   * has already paid a fee should not have to keep paying to find out. One real
   * line here settles it.
   */
  console.warn(
    '[sface] anchor receipt',
    JSON.stringify({
      length: body.receipt.length,
      hash: anchor.looksLikeHash(body.receipt),
      accepted: checked.ok,
      shape: body.shape ?? null,
    }),
  );

  if (!checked.ok) {
    /*
     * Logged with the id the transaction actually carried.
     *
     * The numeric network ids are not in the library's type definitions, so the
     * expected one is configured. If it is wrong every anchor fails, and this
     * line is what turns that from a mystery into a one-line fix.
     */
    if (checked.observed !== undefined) {
      console.warn(
        '[sface] anchor on unexpected chain',
        JSON.stringify({ expected: ANCHOR_NETWORK_ID, observed: checked.observed }),
      );
    }
    res.status(422).json({ error: checked.reason });
    return;
  }

  // Only the strong path derives a sender from the transaction itself. A
  // reported one has nothing to bind, and binding a guess would be worse.
  if (checked.value.sender) profiles.bindAddress(body.deviceId, checked.value.sender);

  const result = board.attachAnchor({
    network,
    date: body.date,
    deviceId: body.deviceId,
    score: body.score,
    hash: checked.value.hash,
    address: checked.value.sender,
  });

  if (!result.ok) {
    res.status(404).json({ error: result.reason });
    return;
  }

  res.json({
    ok: true,
    recorded: true,
    hash: checked.value.hash,
    strength: checked.value.strength,
    already: result.already,
  });
});

app.post('/board/sign', rateLimiter.limit(20, 10), async (req, res) => {
  const parsed = signBody.extend({ auth: deviceProof }).safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: firstIssue(parsed.error) });
    return;
  }

  const body = parsed.data;
  const { auth: _auth, ...signed } = body;
  if (!(await provesActor(body.auth as DeviceProof, 'score.sign', body.deviceId, signed))) {
    res.status(403).json({ error: 'unauthorized' });
    return;
  }

  // Testnet runs are verified and never written down, so there is no row to
  // sign. Said plainly rather than returning a success nothing came of.
  if (networkOf(req) === 'test') {
    res.json({ ok: true, recorded: false, note: 'Testnet runs are not kept on the board.' });
    return;
  }

  const attested = verifyClaim({
    claim: { date: body.date, seed: body.seed, stage: body.stage, score: body.score },
    publicKey: body.publicKey,
    signature: body.signature,
  });

  if (!attested) {
    // Same reasoning as the score route: this is the only way to learn whether
    // the wallet is signing something other than what we verify against.
    console.warn(
      '[sface] sign refused',
      JSON.stringify({
        message: claimMessage({
          date: body.date,
          seed: body.seed,
          stage: body.stage,
          score: body.score,
        }),
        publicKey: body.publicKey,
        signature: body.signature,
      }),
    );
    res.status(422).json({ error: 'That signature does not match the run it was sent with.' });
    return;
  }

  // Signing an old run binds the wallet too, so the ladder catches up with
  // somebody who proved a run days after flying it.
  profiles.bindAddress(body.deviceId, attested.address);

  const result = board.attachProof({
    network: networkOf(req),
    date: body.date,
    deviceId: body.deviceId,
    score: body.score,
    address: attested.address,
    proof: {
      publicKey: body.publicKey,
      signature: body.signature,
      seed: body.seed,
      stage: body.stage,
    },
  });

  if (!result.ok) {
    res.status(404).json({ error: result.reason });
    return;
  }

  res.json({ ok: true, recorded: true, address: attested.address });
});

/*
 * Contests ------------------------------------------------------------------
 *
 * The list is public and the terms are fixed at creation. Nothing here holds a
 * stake: settlement is wallet to wallet against an address on the payer's own
 * screen, exactly as challenges already work, so the worst a wrong answer here
 * can do is describe a result incorrectly.
 */

app.post('/contests', rateLimiter.limit(12, 6), async (req, res) => {
  const parsed = contestBody.extend({ auth: deviceProof }).safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: firstIssue(parsed.error) });
    return;
  }

  const body = parsed.data;
  const network = networkOf(req);
  if (!(await provesActor(body.auth as DeviceProof, 'contest.create', body.deviceId, {
    deviceId: body.deviceId, name: body.name, avatarUrl: body.avatarUrl ?? null,
    address: body.address ?? null, kind: body.kind, stages: body.stages,
    stakeNim: body.stakeNim, seats: body.seats, visibility: body.visibility,
    openMinutes: body.openMinutes ?? null,
  }))) {
    res.status(403).json({ error: 'unauthorized' });
    return;
  }

  /*
   * Pinned to the service's own mission, never to anything the client sent.
   *
   * Every entrant has to fly the identical level, and a caller who could name
   * the seed could open a contest on a level they had already learned. The date
   * and seed come from the same cache the daily board verifies against.
   */
  const mission = await getMission({ rehearsal: network === 'test' });
  if (!mission) {
    res.status(503).json({ error: 'No mission to pin a contest to right now.' });
    return;
  }

  // The clan comes from the profile, not the request. A contest that named a
  // clan the host is not in would credit a roster nobody on it agreed to enter.
  const profile = profiles.get(body.deviceId, network);
  const clanTag = profile?.clanTag ?? null;
  // And whether they run it, because entering a clan commits every member.
  const ownsClan = clanTag !== null && clans.detail(clanTag, network)?.ownerId === body.deviceId;

  const result = contests.create({
    network,
    hostId: body.deviceId,
    hostName: body.name,
    hostAvatarUrl: body.avatarUrl ?? null,
    hostAddress: body.address ?? null,
    hostClanTag: clanTag,
    hostOwnsClan: ownsClan,
    kind: body.kind,
    stages: body.stages,
    stakeNim: body.stakeNim,
    seats: body.seats,
    visibility: body.visibility,
    openMinutes: body.openMinutes ?? null,
    date: mission.payload.date,
    seed: mission.payload.seed,
    now: Date.now(),
  });

  if (!result.ok) {
    res.status(result.code).json({ error: result.reason });
    return;
  }

  res.json(contests.toPublic(result.value));
});

app.post('/contests/:id/join', rateLimiter.limit(20, 10), async (req, res) => {
  sweepContests(networkOf(req));
  const parsed = joinContestBody.extend({ auth: deviceProof }).safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: firstIssue(parsed.error) });
    return;
  }

  const network = networkOf(req);
  const body = parsed.data;
  if (!(await provesActor(body.auth as DeviceProof, 'contest.join', body.deviceId, {
    id: String(req.params.id ?? ''), deviceId: body.deviceId, name: body.name,
    avatarUrl: body.avatarUrl ?? null, address: body.address ?? null,
  }))) {
    res.status(403).json({ error: 'unauthorized' });
    return;
  }
  // Ensured, because taking a seat is a perfectly reasonable first thing to do
  // and refusing somebody until they have posted a run would make an invite
  // look broken to exactly the person it was meant to bring in.
  const profile = profiles.ensure(body.deviceId, body.name, network);

  const result = contests.join({
    id: String(req.params.id ?? ''),
    network,
    pilotId: body.deviceId,
    name: body.name,
    avatarUrl: body.avatarUrl ?? null,
    address: body.address ?? null,
    clanTag: profile.clanTag,
    now: Date.now(),
  });

  if (!result.ok) {
    res.status(result.code).json({ error: result.reason });
    return;
  }

  res.json(contests.toPublic(result.value));
});

/**
 * Report that a debt was paid.
 *
 * The hash is recorded, never verified: this service has no Nimiq node, the
 * same as the challenge settlement it sits beside. It is published next to the
 * debt so the person who is owed can check it themselves, which is witnessing
 * rather than enforcement, and the screen says so in those words.
 */
app.post('/contests/:id/settled', rateLimiter.limit(20, 10), async (req, res) => {
  const parsed = contestPaidBody.extend({ auth: deviceProof }).safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: firstIssue(parsed.error) });
    return;
  }

  if (!(await provesActor(parsed.data.auth as DeviceProof, 'contest.settle', parsed.data.deviceId, {
    id: String(req.params.id ?? ''), deviceId: parsed.data.deviceId, txHash: parsed.data.txHash,
  }))) {
    res.status(403).json({ error: 'unauthorized' });
    return;
  }
  const result = contests.markPaid({
    id: String(req.params.id ?? ''),
    network: networkOf(req),
    pilotId: parsed.data.deviceId,
    txHash: parsed.data.txHash,
  });

  if (!result.ok) {
    res.status(result.code).json({ error: result.reason });
    return;
  }

  // The record of whether people settle, which is the only thing standing in
  // for an escrow this app was never able to build.
  profiles.recordSettlement(parsed.data.deviceId, networkOf(req));

  res.json(contests.toPublic(result.value));
});

app.post('/clans/join', rateLimiter.limit(12, 6), async (req, res) => {
  const parsed = joinClanBody.extend({ auth: deviceProof }).safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: firstIssue(parsed.error) });
    return;
  }
  if (!(await provesActor(parsed.data.auth as DeviceProof, 'clan.join', parsed.data.deviceId, {
    deviceId: parsed.data.deviceId, name: parsed.data.name, tag: parsed.data.tag,
  }))) {
    res.status(403).json({ error: 'unauthorized' });
    return;
  }

  // Null means leave. Anything else has to be a real tag, and a typo that
  // silently dropped someone out of their clan would be worse than a 400.
  const tag = parsed.data.tag === null ? null : clans.normaliseTag(parsed.data.tag);
  if (parsed.data.tag !== null && tag === null) {
    res.status(400).json({ error: 'A clan tag is two to four letters or digits.' });
    return;
  }

  const outcome = clans.join(
    parsed.data.deviceId,
    parsed.data.name,
    tag,
    Date.now(),
  );
  if (outcome.status === 'refused') {
    res.status(409).json({ error: outcome.reason });
    return;
  }

  // The profile goes back with the outcome so the client never has to guess
  // whether the tag took. On a request it has not, and the profile says so.
  res.json({
    outcome,
    profile:
      profiles.get(parsed.data.deviceId, networkOf(req)) ??
      profiles.blank(parsed.data.deviceId, parsed.data.name, networkOf(req)),
    pending: clans.pendingFor(parsed.data.deviceId),
  });
});

app.post('/clans/:tag/decide', rateLimiter.limit(30, 15), async (req, res) => {
  const parsed = decideClanBody.extend({ auth: deviceProof }).safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: firstIssue(parsed.error) });
    return;
  }

  const tag = clans.normaliseTag(req.params.tag);
  if (!tag) {
    res.status(400).json({ error: 'A clan tag is two to four letters or digits.' });
    return;
  }
  if (!(await provesActor(parsed.data.auth as DeviceProof, 'clan.decide', parsed.data.deviceId, {
    tag: String(req.params.tag ?? ''),
    deviceId: parsed.data.deviceId,
    memberId: parsed.data.memberId,
    approve: parsed.data.approve,
  }))) {
    res.status(403).json({ error: 'unauthorized' });
    return;
  }

  const result = clans.decide(
    tag,
    parsed.data.deviceId,
    parsed.data.memberId,
    parsed.data.approve,
  );
  if (!result.ok) {
    res.status(result.code).json({ error: result.reason });
    return;
  }

  res.json(clans.detail(tag, networkOf(req)));
});

app.post('/signals/unlock', rateLimiter.limit(12, 6), async (req, res) => {
  const parsed = unlockBody.extend({ auth: deviceProof }).safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: firstIssue(parsed.error) });
    return;
  }

  if (!(await provesActor(parsed.data.auth as DeviceProof, 'signals.unlock', parsed.data.deviceId, {
    deviceId: parsed.data.deviceId, serializedTx: parsed.data.serializedTx,
  }))) {
    res.status(403).json({ error: 'unauthorized' });
    return;
  }
  signals.grant(parsed.data.deviceId, parsed.data.serializedTx);
  res.json({ unlocked: true });
});

/**
 * Fold one proved identity into another.
 *
 * Public pilot ids are references, never bearer secrets. New identities prove
 * both keys. A wallet-bound legacy profile proves the source with the wallet
 * and the destination with its device key. Unbound legacy records stay
 * read-only because no secret exists that could establish ownership.
 */
app.post('/profile/merge', rateLimiter.limit(12, 6), async (req, res) => {
  const parsed = mergeBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: firstIssue(parsed.error) });
    return;
  }

  const network = networkOf(req);
  const claim = { from: parsed.data.from, into: parsed.data.into, network };
  const bodyDigest = await mergeBodyDigest(claim);
  const destination = await playerAuth.verify({
    proof: parsed.data.destinationProof as DeviceProof,
    action: 'profile.merge',
    bodyDigest,
  });
  if (!destination.ok || destination.value.playerId !== parsed.data.into) {
    res.status(403).json({ error: 'unauthorized' });
    return;
  }

  if (playerAuth.hasCredential(parsed.data.from)) {
    if (!parsed.data.sourceProof) {
      res.status(403).json({ error: 'unauthorized' });
      return;
    }
    const source = await playerAuth.verify({
      proof: parsed.data.sourceProof as DeviceProof,
      action: 'profile.merge',
      bodyDigest,
    });
    if (!source.ok || source.value.playerId !== parsed.data.from) {
      res.status(403).json({ error: 'unauthorized' });
      return;
    }
  } else {
    const sourceProfile = profiles.get(parsed.data.from, network);
    if (!sourceProfile?.address || !parsed.data.walletProof) {
      res.status(409).json({ error: 'legacy_profile_read_only' });
      return;
    }
    const verified = verifyMessage({
      message: mergeClaimMessage(claim),
      ...parsed.data.walletProof,
    });
    if (!verified || verified.address !== sourceProfile.address) {
      res.status(403).json({ error: 'unauthorized' });
      return;
    }
  }

  const merged = profiles.merge(parsed.data.from, parsed.data.into, network);
  if (!merged) {
    // Neither side has ever finished a run. Nothing to do, and not a failure.
    res.json({ merged: false });
    return;
  }

  res.json({ merged: true, profile: merged });
});

installFallbackRoutes(app, recordAdminLog);

function firstIssue(error: z.ZodError): string {
  return error.issues[0]?.message ?? 'Bad request.';
}

// Boot ---------------------------------------------------------------------

function snapshot() {
  return {
    version: 1 as const,
    scores: board.serialise(),
    challenges: challenges.serialise(),
    mission: daily.serialise(),
    profiles: profiles.serialise(),
    ghosts: ghosts.serialise(),
    clans: clans.serialise(),
    contests: contests.serialise(),
    chat: chat.serialise(),
    tips: tips.serialise(),
    signals: signals.serialise(),
    playerAuth: playerAuth.serialise(),
  };
}

async function main(): Promise<void> {
  await initialiseAdminLogs();
  if (ATLAS_PRODUCTION_GATE.durableRepository) await atlasStateStore.initialise();
  await loadRelayState();
  await relayDaily.load();
  const loaded = await loadSnapshot();
  if (!loaded.ok) {
    throw new Error(`Persistence startup failed: ${loaded.error}. Refusing to boot with empty state.`);
  }
  const restored = loaded.value;
  if (restored) {
    board.restore(restored.scores);
    challenges.restore(restored.challenges);
    // Before the refresh loop starts, so today's frozen seed wins over a
    // recomposed one.
    daily.restore(restored.mission);
    profiles.restore((restored as { profiles?: unknown }).profiles);
    ghosts.restore((restored as { ghosts?: unknown }).ghosts);
    clans.restore((restored as { clans?: unknown }).clans);
    contests.restore((restored as { contests?: unknown }).contests);
    chat.restore((restored as { chat?: unknown }).chat);
    tips.restore((restored as { tips?: unknown }).tips);
    signals.restore((restored as { signals?: unknown }).signals);
    playerAuth.restore(restored.playerAuth);
    console.log('[sface] restored snapshot');

    /*
     * Put the new shape on disk once, deliberately, rather than whenever.
     *
     * Profiles used to hold their totals flat; they now hold one set per chain.
     * `restore` reads both, so nothing is broken without this, and the file
     * would convert itself the first time anybody posted a score anyway.
     *
     * Doing it here buys one thing worth having: the reading half stops being
     * load-bearing. While an old-shape file exists anywhere, that branch has to
     * survive every future edit, and deleting it as dead code would not throw.
     * It would read every profile as zeroes. Face gone, ranks gone, campaign
     * progress gone, no error anywhere.
     *
     * The original is copied aside first, because this is the one write that
     * replaces data with a shape that has never been on this disk. If the
     * backup cannot be made the migration does not happen: converting anyway,
     * with nothing to go back to, is the opposite of careful.
     */
    const legacy = profiles.legacyCount();
    if (legacy > 0) {
      const stamp = utcDate();
      const kept = await backupSnapshot(stamp);
      if (kept) {
        await saveNow(snapshot());
        console.log(
          `[sface] migrated ${legacy} profile${legacy === 1 ? '' : 's'} to per-chain totals, previous snapshot kept at ${kept}`,
        );
      } else {
        console.error('[sface] skipped profile migration: could not back up the snapshot');
      }
    }
  }

  board.onChange(() => scheduleSave(snapshot));
  challenges.onChange(() => scheduleSave(snapshot));
  daily.onChange(() => scheduleSave(snapshot));
  profiles.onChange(() => scheduleSave(snapshot));
  ghosts.onChange(() => scheduleSave(snapshot));
  clans.onChange(() => scheduleSave(snapshot));
  contests.onChange(() => scheduleSave(snapshot));
  chat.onChange(() => scheduleSave(snapshot));
  tips.onChange(() => scheduleSave(snapshot));
  signals.onChange(() => scheduleSave(snapshot));

  startRefreshLoop();

  // Housekeeping. Old boards and dead challenges are not worth keeping.
  const housekeeping = setInterval(
    () => {
      board.prune(utcDate());
      challenges.prune();
      contests.expireDue(Date.now());
      contests.prune(Date.now());
      chat.prune(Date.now());
      tips.prune(Date.now());
      signals.pruneUnlocks();
      // Traces are the bulkiest thing stored and a seed is only playable on
      // its own day, so everything but today's room goes.
      void getMission().then((mission) => {
        ghosts.prune(mission ? [mission.payload.seed] : []);
      });
    },
    6 * 3_600_000,
  );
  housekeeping.unref?.();

  const server = app.listen(PORT, () => {
    console.log(`[sface] listening on :${PORT}`);
    console.log('[sface] live co-op relay on /live');
    if (!IS_PRODUCTION && ALLOWED_ORIGINS.length === 0) {
      console.warn('[sface] ALLOWED_ORIGINS is unset. Development CORS allows every origin.');
    }
    if (!TRUST_PROXY) {
      console.warn('[sface] TRUST_PROXY is not true. Set it when running behind Caddy.');
    }
  });

  // The relay shares the http server, so one port and one Caddy rule covers
  // both. It upgrades only on /live and ignores every other path.
  attachLive(server);

  /*
   * listen() reports failures by emitting 'error' on the http server, not by
   * throwing. Without a handler, a port clash on restart is an unhandled event
   * and twenty lines of stack trace in the service log. The operator needs one
   * line and a non-zero exit code so the supervisor can act on it.
   */
  server.on('error', (error: NodeJS.ErrnoException) => {
    if (error.code === 'EADDRINUSE') {
      console.error(`[sface] port ${PORT} is already in use. Is another copy running?`);
    } else {
      console.error(`[sface] could not listen on ${PORT}:`, error.message);
    }
    process.exit(1);
  });

  atlasBlitzMaintenance?.start();
  if (atlasBlitzMaintenance) console.log('[blitz] maintenance running every 5 minutes: daily close and qualification drain.');

  // Flush the snapshot before dying, or the last few scores go with it.
  const shutdown = (signal: string) => async () => {
    atlasBlitzMaintenance?.stop();
    console.log(`[sface] ${signal}, shutting down`);
    server.close();
    await flush();
    process.exit(0);
  };
  process.on('SIGTERM', shutdown('SIGTERM'));
  process.on('SIGINT', shutdown('SIGINT'));
}

void main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error('[sface] startup failed:', message);
  process.exitCode = 1;
});
