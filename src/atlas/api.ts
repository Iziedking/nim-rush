import type { AtlasAction, AtlasSnapshot } from '../../shared/atlas/state';
import type { AtlasAssistance, AtlasNetwork, AtlasRole } from '../../shared/atlas/types';
import type { AtlasCompetitiveTicket } from '../../shared/atlas/types';
import type { AtlasWalletBinding, AtlasWalletBindingChallenge } from '../../shared/atlas/wallet-binding';
import { authenticatedRequest, type ApiFetch, type ApiResult } from '../net/api';
import { createAtlasCoreRunSubmission, type AtlasCoreRunRequest } from './competitive-run';

export type { AtlasCompetitiveTicket } from '../../shared/atlas/types';

export interface AtlasOrderSummary {
  id: string;
  status: string;
  lookup?: string | null;
  [key: string]: unknown;
}

export interface AtlasBootstrapSummary {
  product: 'nim-atlas';
  campaignMode: 'local-first';
  competitiveExpeditions: boolean;
  walletRequired: false;
  curriculumVersion: number;
}

export interface AtlasBeaconSummary {
  status: 'live' | 'stale' | 'unavailable';
  verifiedContributorCount: number;
  systems: Array<{ districtId: string; repairTotal: number; target: number; stage: number }>;
}

export interface AtlasEchoSummary {
  status: 'live' | 'stale' | 'unavailable';
  echoes: Array<{ id: string; districtId: string; action: string; cosmeticId: string; displayName: string; contributionDelta: number; observedAtBucket: number }>;
}

export interface AtlasCompetitionSummary {
  role: 'explorer' | 'builder';
  bestVerifiedScore: number | null;
  eligibility: 'eligible' | 'assisted' | 'not-verified';
  dailyObligation: { status: 'estimating' | 'pending' | 'verified-paid' | 'unawarded'; amountLuna: number | null };
}

/**
 * What the day's pot is worth right now.
 *
 * `poolLuna` is what the treasury can actually settle, already capped by its
 * on-chain balance; `configuredPoolLuna` is the intent before that cap. Both
 * are shown, because a player who is told the pot shrank deserves to see why.
 *
 * The two capped fields are optional: a server deployed before the cap landed
 * simply omits them, and the daily screen has to keep working against it.
 */
export interface AtlasDailyStandingSummary {
  date: string;
  eligibleCount: number;
  shareLuna: number | null;
  poolLuna: number | null;
  configuredPoolLuna?: number | null;
  treasuryLuna?: number | null;
  rewardsEnabled: boolean;
}

/** The server's finding on a submitted day, not the player's claim. */
export interface AtlasDailySubmitResult {
  accepted: boolean;
  eligible: boolean;
  duplicate?: boolean;
  retryable?: boolean;
  reason?: string;
  date: string;
}

export interface AtlasDailyObligationSummary {
  status: 'pending-close' | 'not-eligible';
  amountLuna: number | null;
}

export interface AtlasDailySubmitInput {
  actorId: string;
  walletAddress: string;
  challengeId: string;
  answer: string;
  replayComplete: boolean;
  assistance: AtlasAssistance;
  payment?: { txHash?: string; network?: string; recipient?: string; valueLuna?: number; canonical?: boolean; success?: boolean; confirmations?: number };
}

export interface AtlasCompetitiveRunInput {
  runId: string;
  ticketId: string;
  actorId: string;
  walletAddress: string;
  network: AtlasNetwork;
  role: AtlasRole;
  seasonId: string;
  challengeId: string;
  origin: string;
  campaignHash: string;
  curriculumHash: string;
  rulesetHash: string;
  assistance: AtlasAssistance;
  actions: AtlasAction[];
  claimedSnapshot: AtlasSnapshot;
  replayHash: string;
}

export interface AtlasCompetitiveRunResult {
  run: {
    runId: string;
    actorId: string;
    walletAddress: string;
    role: AtlasRole;
    seasonId: string;
    challengeId: string;
    score: number;
    correct: true;
    assistance: AtlasAssistance;
    prizeEligible: boolean;
    replayHash: string;
    verifiedAt: number;
    status: 'verified';
    mastery?: { knowledge: number; execution: number; safety: number; efficiency: number; total: number };
  };
  row: AtlasLeaderboardRow;
  beacon: AtlasBeaconSummary | null;
}

export interface AtlasLeaderboardRow {
  runId: string;
  actorId: string;
  walletAddress: string;
  role: AtlasRole;
  seasonId: string;
  score: number;
  rank: number;
  assistance: AtlasAssistance;
  prizeEligible: boolean;
  replayHash: string;
  mastery?: { knowledge: number; execution: number; safety: number; efficiency: number; total: number };
}

export interface AtlasApiClient {
  getBootstrap(): Promise<AtlasBootstrapSummary>;
  getBeacon(): Promise<AtlasBeaconSummary>;
  getEchoes(): Promise<AtlasEchoSummary>;
  getCompetition(): Promise<AtlasCompetitionSummary[]>;
  getCompetitiveLeaderboard(seasonId: string, role: AtlasRole): Promise<AtlasLeaderboardRow[]>;
  issueCompetitiveTicket(input: { actorId: string; walletAddress: string; role: AtlasRole }): Promise<ApiResult<AtlasCompetitiveTicket>>;
  submitCompetitiveRun(input: AtlasCompetitiveRunInput): Promise<ApiResult<AtlasCompetitiveRunResult>>;
  submitCoreRun(input: AtlasCoreRunRequest): Promise<ApiResult<AtlasCompetitiveRunResult>>;
  issueWalletChallenge(input: { actorId: string; seasonId: string; address: string; network: AtlasNetwork }): Promise<ApiResult<AtlasWalletBindingChallenge>>;
  bindWallet(input: { actorId: string; challenge: AtlasWalletBindingChallenge; publicKey: string; signature: string }): Promise<ApiResult<AtlasWalletBinding>>;
  createOrder(input: { actorId: string; walletAddress: string; itemId: 'harbor-lantern'; idempotencyKey?: string }): Promise<AtlasOrderSummary>;
  submitTransactionLookup(orderId: string, lookup: string): Promise<AtlasOrderSummary>;
  reconcileOrder(orderId: string): Promise<AtlasOrderSummary>;
  cancelOrder(orderId: string, reason: string): Promise<AtlasOrderSummary>;
  getOrder(orderId: string): Promise<AtlasOrderSummary>;
  getDailyStanding(): Promise<AtlasDailyStandingSummary>;
  submitDaily(input: AtlasDailySubmitInput): Promise<AtlasDailySubmitResult>;
  getDailyObligation(input: { actorId: string; walletAddress: string; challengeId: string }): Promise<AtlasDailyObligationSummary>;
}

type AtlasFetch = ApiFetch;

export function createAtlasApiClient(options: { baseUrl?: string; fetchImpl?: AtlasFetch } = {}): AtlasApiClient {
  const baseUrl = (options.baseUrl ?? '').replace(/\/$/, '');
  const fetchImpl = options.fetchImpl ?? fetch;
  return {
    getBootstrap: () => requestData(fetchImpl, `${baseUrl}/atlas/api/bootstrap`, isBootstrap),
    getBeacon: () => requestData(fetchImpl, `${baseUrl}/atlas/api/beacon`, isBeacon),
    getEchoes: () => requestData(fetchImpl, `${baseUrl}/atlas/api/echoes`, isEchoes),
    getCompetition: () => requestData(fetchImpl, `${baseUrl}/atlas/api/competition`, isCompetition),
    getCompetitiveLeaderboard: (seasonId, role) => requestData(fetchImpl, `${baseUrl}/atlas/api/competitive/leaderboard?seasonId=${encodeURIComponent(seasonId)}&role=${role}`, isLeaderboard),
    issueCompetitiveTicket: (input) => authenticatedRequest<AtlasCompetitiveTicket>('/atlas/api/competitive/tickets', 'atlas.ticket.issue', input.actorId, input, { apiBase: baseUrl, fetchImpl }),
    submitCompetitiveRun: (input) => authenticatedRequest<AtlasCompetitiveRunResult>('/atlas/api/competitive/runs', 'atlas.run.submit', input.actorId, input, { apiBase: baseUrl, fetchImpl }),
    submitCoreRun: async (input) => {
      try {
        const submission = await createAtlasCoreRunSubmission(input);
        return authenticatedRequest<AtlasCompetitiveRunResult>('/atlas/api/competitive/runs', 'atlas.run.submit', submission.actorId, submission, { apiBase: baseUrl, fetchImpl });
      } catch (error) {
        return { ok: false, error: error instanceof Error ? error.message : 'Atlas run could not be prepared.' };
      }
    },
    issueWalletChallenge: (input) => authenticatedRequest<AtlasWalletBindingChallenge>('/atlas/api/wallet/challenge', 'atlas.wallet.challenge', input.actorId, input, { apiBase: baseUrl, fetchImpl }, isWalletBindingChallenge),
    bindWallet: (input) => authenticatedRequest<AtlasWalletBinding>('/atlas/api/wallet/bind', 'atlas.wallet.bind', input.actorId, input, { apiBase: baseUrl, fetchImpl }, isWalletBinding),
    createOrder: (input) => requestOrder(fetchImpl, `${baseUrl}/atlas/api/orders`, { method: 'POST', body: input }),
    submitTransactionLookup: (orderId, lookup) => requestOrder(fetchImpl, `${baseUrl}/atlas/api/orders/${encodeURIComponent(orderId)}/transaction`, { method: 'POST', body: { lookup } }),
    reconcileOrder: (orderId) => requestOrder(fetchImpl, `${baseUrl}/atlas/api/orders/${encodeURIComponent(orderId)}/reconcile`, { method: 'POST' }),
    cancelOrder: (orderId, reason) => requestOrder(fetchImpl, `${baseUrl}/atlas/api/orders/${encodeURIComponent(orderId)}/cancel`, { method: 'POST', body: { reason } }),
    getOrder: (orderId) => requestOrder(fetchImpl, `${baseUrl}/atlas/api/orders/${encodeURIComponent(orderId)}`),
    getDailyStanding: () => requestData(fetchImpl, `${baseUrl}/atlas/api/daily/standing`, isDailyStanding),
    /*
     * A refusal is a normal answer here, not an error: the player asked whether
     * they qualified and the server said no, with a reason they can act on. The
     * route returns 200 with `accepted: false` for exactly that reason.
     */
    submitDaily: (input) => requestData(fetchImpl, `${baseUrl}/atlas/api/daily/submit`, isDailySubmitResult, { method: 'POST', body: input }),
    getDailyObligation: (input) => requestData(fetchImpl, `${baseUrl}/atlas/api/daily/obligation`, isDailyObligation, { method: 'POST', body: input }),
  };
}

function isDailyStanding(value: unknown): value is AtlasDailyStandingSummary {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const row = value as Record<string, unknown>;
  return typeof row.date === 'string'
    && Number.isSafeInteger(row.eligibleCount)
    && nullableInteger(row.shareLuna)
    && nullableInteger(row.poolLuna)
    // Optional, so a server deployed before the treasury cap still validates.
    && (row.configuredPoolLuna === undefined || nullableInteger(row.configuredPoolLuna))
    && (row.treasuryLuna === undefined || nullableInteger(row.treasuryLuna))
    && typeof row.rewardsEnabled === 'boolean';
}

function isDailySubmitResult(value: unknown): value is AtlasDailySubmitResult {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const row = value as Record<string, unknown>;
  return typeof row.accepted === 'boolean'
    && typeof row.eligible === 'boolean'
    && typeof row.date === 'string'
    && (row.duplicate === undefined || typeof row.duplicate === 'boolean')
    && (row.retryable === undefined || typeof row.retryable === 'boolean')
    && (row.reason === undefined || typeof row.reason === 'string');
}

function isDailyObligation(value: unknown): value is AtlasDailyObligationSummary {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const row = value as Record<string, unknown>;
  return (row.status === 'pending-close' || row.status === 'not-eligible') && nullableInteger(row.amountLuna);
}

function nullableInteger(value: unknown): boolean {
  return value === null || Number.isSafeInteger(value);
}

function isLeaderboard(value: unknown): value is AtlasLeaderboardRow[] {
  if (!Array.isArray(value)) return false;
  return value.every((item) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return false;
    const row = item as Record<string, unknown>;
    return typeof row.runId === 'string'
      && typeof row.actorId === 'string'
      && typeof row.walletAddress === 'string'
      && (row.role === 'explorer' || row.role === 'builder')
      && typeof row.seasonId === 'string'
      && Number.isSafeInteger(row.score)
      && Number.isSafeInteger(row.rank)
      && ['none', 'free-hint', 'purchased-hint', 'answer-reveal', 'debug'].includes(String(row.assistance))
      && typeof row.prizeEligible === 'boolean'
      && typeof row.replayHash === 'string';
  });
}

async function requestOrder(fetchImpl: AtlasFetch, url: string, options: { method?: string; body?: unknown } = {}): Promise<AtlasOrderSummary> {
  return requestData(fetchImpl, url, isOrder, options);
}

async function requestData<T>(fetchImpl: AtlasFetch, url: string, guard: (value: unknown) => value is T, options: { method?: string; body?: unknown } = {}): Promise<T> {
  let response: Response;
  try {
    response = await fetchImpl(url, {
      method: options.method ?? 'GET',
      headers: { accept: 'application/json', ...(options.body === undefined ? {} : { 'content-type': 'application/json' }) },
      ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
    });
  } catch {
    throw new Error('Atlas service is unavailable.');
  }
  if (!response.ok) throw new Error(response.status >= 500 ? 'Atlas service is unavailable.' : 'Atlas request was rejected.');
  let payload: unknown;
  try { payload = await response.json(); } catch { throw new Error('Atlas service is unavailable.'); }
  if (!payload || typeof payload !== 'object' || (payload as { ok?: unknown }).ok !== true) throw new Error('Atlas service is unavailable.');
  const data = (payload as { data?: unknown }).data;
  if (!guard(data)) throw new Error('Atlas service is unavailable.');
  return structuredClone(data);
}

function isOrder(value: unknown): value is AtlasOrderSummary {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value) && typeof (value as { id?: unknown }).id === 'string' && typeof (value as { status?: unknown }).status === 'string');
}

function isBootstrap(value: unknown): value is AtlasBootstrapSummary {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const data = value as Record<string, unknown>;
  return data.product === 'nim-atlas' && data.campaignMode === 'local-first' && typeof data.competitiveExpeditions === 'boolean' && data.walletRequired === false && Number.isSafeInteger(data.curriculumVersion);
}

function isBeacon(value: unknown): value is AtlasBeaconSummary {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const data = value as Record<string, unknown>;
  return (data.status === 'live' || data.status === 'stale' || data.status === 'unavailable') && Number.isSafeInteger(data.verifiedContributorCount) && Array.isArray(data.systems);
}

function isEchoes(value: unknown): value is AtlasEchoSummary {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const data = value as Record<string, unknown>;
  if (!['live', 'stale', 'unavailable'].includes(String(data.status)) || !Array.isArray(data.echoes)) return false;
  return data.echoes.every((echo) => {
    if (!echo || typeof echo !== 'object' || Array.isArray(echo)) return false;
    const item = echo as Record<string, unknown>;
    return typeof item.id === 'string' && typeof item.districtId === 'string' && typeof item.action === 'string' && typeof item.cosmeticId === 'string' && typeof item.displayName === 'string' && Number.isSafeInteger(item.contributionDelta) && Number.isSafeInteger(item.observedAtBucket);
  });
}

function isCompetition(value: unknown): value is AtlasCompetitionSummary[] {
  if (!Array.isArray(value)) return false;
  return value.every((item) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return false;
    const summary = item as Record<string, unknown>;
    const obligation = summary.dailyObligation;
    if (!obligation || typeof obligation !== 'object' || Array.isArray(obligation)) return false;
    const daily = obligation as Record<string, unknown>;
    return (summary.role === 'explorer' || summary.role === 'builder')
      && (summary.bestVerifiedScore === null || Number.isSafeInteger(summary.bestVerifiedScore))
      && ['eligible', 'assisted', 'not-verified'].includes(String(summary.eligibility))
      && ['estimating', 'pending', 'verified-paid', 'unawarded'].includes(String(daily.status))
      && (daily.amountLuna === null || Number.isSafeInteger(daily.amountLuna));
  });
}

function isWalletBindingChallenge(value: unknown): value is AtlasWalletBindingChallenge {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const challenge = value as Record<string, unknown>;
  const issuedAt = challenge.issuedAt;
  const expiresAt = challenge.expiresAt;
  return typeof challenge.id === 'string'
    && typeof challenge.domain === 'string'
    && challenge.purpose === 'atlas-wallet-binding'
    && typeof challenge.actorId === 'string'
    && typeof challenge.seasonId === 'string'
    && typeof challenge.address === 'string'
    && (challenge.network === 'testalbatross' || challenge.network === 'mainalbatross')
    && typeof challenge.nonce === 'string'
    && typeof issuedAt === 'number'
    && typeof expiresAt === 'number'
    && Number.isSafeInteger(issuedAt)
    && Number.isSafeInteger(expiresAt)
    && expiresAt > issuedAt;
}

function isWalletBinding(value: unknown): value is AtlasWalletBinding {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const binding = value as Record<string, unknown>;
  return typeof binding.actorId === 'string'
    && typeof binding.seasonId === 'string'
    && typeof binding.address === 'string'
    && (binding.network === 'testalbatross' || binding.network === 'mainalbatross')
    && typeof binding.publicKey === 'string'
    && /^[0-9a-f]+$/i.test(binding.publicKey)
    && Number.isSafeInteger(binding.boundAt);
}
