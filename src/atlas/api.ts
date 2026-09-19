import type { AtlasAction, AtlasSnapshot } from '../../shared/atlas/state';
import type { AtlasAssistance, AtlasNetwork, AtlasRole } from '../../shared/atlas/types';
import type { AtlasCompetitiveTicket } from '../../shared/atlas/types';
import type { AtlasWalletBinding, AtlasWalletBindingChallenge } from '../../shared/atlas/wallet-binding';
import { authenticatedRequest, type ApiFetch, type ApiResult } from '../net/api';
import { createAtlasCoreRunSubmission, type AtlasCoreRunRequest } from './competitive-run';
import type { BlitzLeaderboardRow, BlitzSubmissionInput, BlitzSubmitResult, BlitzTicket } from '../../shared/atlas/blitz/competition';
import type { BlitzCityId } from '../../shared/atlas/blitz/types';
import { isBlitzRiderProgress, type BlitzRiderProgress } from '../../shared/atlas/blitz/progress';

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
  getBlitzLeaderboard(seasonId: string, cityId: BlitzCityId, challengeId?: string): Promise<BlitzLeaderboardRow[]>;
  getBlitzPrizes(seasonId: string, cityId: BlitzCityId, challengeId?: string): Promise<BlitzPrizeTableSummary>;
  getBlitzRewards(walletAddress: string): Promise<BlitzRewardSummary[]>;
  getBlitzProgress(seasonId: string, walletAddress: string): Promise<BlitzRiderProgress>;
  openBlitzLobby(input: { actorId: string; walletAddress: string; capacity: number }): Promise<ApiResult<BlitzLobbySummary>>;
  claimBlitzSeat(lobbyId: string, input: { actorId: string; walletAddress: string }): Promise<ApiResult<BlitzSeatClaim>>;
  getBlitzLobby(lobbyId: string): Promise<BlitzLobbyView | null>;
  issueBlitzTicket(input: { actorId: string; walletAddress: string; username: string; cityId: BlitzCityId; seasonId: string }): Promise<ApiResult<BlitzTicket>>;
  submitBlitzRun(input: BlitzSubmissionInput): Promise<ApiResult<BlitzSubmitResult>>;
  /** Write a verified run onto Nimiq. Takes the signed transaction, not a hash. */
  anchorBlitzRun(runId: string, serializedTx: string): Promise<{ hash: string }>;
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
    getBlitzLeaderboard: (seasonId, cityId, challengeId) => requestData(fetchImpl, `${baseUrl}/atlas/api/blitz/leaderboard?seasonId=${encodeURIComponent(seasonId)}&cityId=${cityId}${challengeId ? `&challengeId=${encodeURIComponent(challengeId)}` : ''}`, isBlitzLeaderboard),
    getBlitzPrizes: (seasonId, cityId, challengeId) => requestData(fetchImpl, `${baseUrl}/atlas/api/blitz/prizes?seasonId=${encodeURIComponent(seasonId)}&cityId=${cityId}${challengeId ? `&challengeId=${encodeURIComponent(challengeId)}` : ''}`, isBlitzPrizeTable),
    getBlitzRewards: (walletAddress) => requestData(fetchImpl, `${baseUrl}/atlas/api/blitz/rewards?walletAddress=${encodeURIComponent(walletAddress)}`, isBlitzRewards),
    getBlitzProgress: (seasonId, walletAddress) => requestData(fetchImpl, `${baseUrl}/atlas/api/blitz/progress?seasonId=${encodeURIComponent(seasonId)}&walletAddress=${encodeURIComponent(walletAddress)}`, isBlitzRiderProgress),
    openBlitzLobby: (input) => authenticatedAtlasRequest<BlitzLobbySummary>('/atlas/api/blitz/lobbies', 'atlas.ticket.issue', input.actorId, input, isBlitzLobby, { apiBase: baseUrl, fetchImpl }),
    claimBlitzSeat: (lobbyId, input) => authenticatedAtlasRequest<BlitzSeatClaim>(`/atlas/api/blitz/lobbies/${encodeURIComponent(lobbyId)}/seats`, 'atlas.ticket.issue', input.actorId, input, isBlitzSeatClaim, { apiBase: baseUrl, fetchImpl }),
    /*
     * A lobby nobody opened is a null, not a thrown error. Following a stale
     * or mistyped invite is an ordinary thing to do, and the screen that
     * handles it needs an answer rather than an exception.
     */
    getBlitzLobby: async (lobbyId) => {
      try { return await requestData(fetchImpl, `${baseUrl}/atlas/api/blitz/lobbies/${encodeURIComponent(lobbyId)}`, isBlitzLobbyView); }
      catch { return null; }
    },
    issueBlitzTicket: (input) => authenticatedAtlasRequest<BlitzTicket>('/atlas/api/blitz/tickets', 'atlas.ticket.issue', input.actorId, input, isBlitzTicket, { apiBase: baseUrl, fetchImpl }),
    submitBlitzRun: (input) => authenticatedAtlasRequest<BlitzSubmitResult>('/atlas/api/blitz/runs', 'atlas.run.submit', input.actorId, input, isBlitzSubmitResult, { apiBase: baseUrl, fetchImpl }),
    /*
     * Unsigned on purpose. The only thing this carries is a Nimiq transaction
     * the wallet already signed, and the service checks it against the board's
     * own copy of the run rather than against anything said here. A device
     * proof would add a second identity to a request whose whole point is that
     * the chain already proves who sent it.
     */
    anchorBlitzRun: (runId, serializedTx) => requestData(
      fetchImpl,
      `${baseUrl}/atlas/api/blitz/runs/${encodeURIComponent(runId)}/anchor`,
      isBlitzAnchorReceipt,
      { method: 'POST', body: { serialized: serializedTx } },
    ),
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
    issueWalletChallenge: (input) => authenticatedAtlasRequest<AtlasWalletBindingChallenge>('/atlas/api/wallet/challenge', 'atlas.wallet.challenge', input.actorId, input, isWalletBindingChallenge, { apiBase: baseUrl, fetchImpl }),
    bindWallet: (input) => authenticatedAtlasRequest<AtlasWalletBinding>('/atlas/api/wallet/bind', 'atlas.wallet.bind', input.actorId, input, isWalletBinding, { apiBase: baseUrl, fetchImpl }),
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

/**
 * What today's board would owe if it closed now.
 *
 * `state` is the field that matters: `unavailable` is not `unfunded`. A pool
 * the server could not read is an unknown, and rendering an unknown as "no
 * pool today" would be a claim the client cannot support either.
 */
export interface BlitzPrizeTableSummary {
  state: 'unavailable' | 'unfunded' | 'funded';
  poolLuna: number | null;
  splitBps: number[];
  allocations: Array<{ rank: number; walletAddress: string; luna: number; runId: string }>;
  remainderLuna: number;
  qualifiedRiders: number;
}

function isBlitzAnchorReceipt(value: unknown): value is { hash: string } {
  return typeof value === 'object' && value !== null
    && typeof (value as { hash?: unknown }).hash === 'string'
    && /^[0-9a-f]{64}$/i.test((value as { hash: string }).hash);
}

function isBlitzPrizeTable(value: unknown): value is BlitzPrizeTableSummary {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const table = value as Record<string, unknown>;
  if (!['unavailable', 'unfunded', 'funded'].includes(String(table.state))) return false;
  if (!(table.poolLuna === null || Number.isSafeInteger(table.poolLuna))) return false;
  if (!Number.isSafeInteger(table.remainderLuna) || !Number.isSafeInteger(table.qualifiedRiders)) return false;
  if (!Array.isArray(table.splitBps) || !table.splitBps.every((bps) => Number.isSafeInteger(bps))) return false;
  if (!Array.isArray(table.allocations)) return false;
  return table.allocations.every((entry) => {
    if (!entry || typeof entry !== 'object') return false;
    const row = entry as Record<string, unknown>;
    return Number.isSafeInteger(row.rank) && Number.isSafeInteger(row.luna)
      && typeof row.walletAddress === 'string' && typeof row.runId === 'string';
  });
}

/*
 * One reward, in the four words a rider can act on. The server collapses the
 * ledger's eight operator statuses; this mirrors that set exactly so a status
 * the client does not understand is a failed guard rather than a blank row.
 */
export interface BlitzRewardSummary {
  period: string;
  amountLuna: number;
  state: 'owed' | 'sending' | 'paid' | 'attention';
  transactionHash: string | null;
  attentionReason: string | null;
}

function isBlitzRewards(value: unknown): value is BlitzRewardSummary[] {
  return Array.isArray(value) && value.every((entry) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return false;
    const row = entry as Record<string, unknown>;
    return typeof row.period === 'string'
      && Number.isSafeInteger(row.amountLuna)
      && ['owed', 'sending', 'paid', 'attention'].includes(String(row.state))
      && (row.transactionHash === null || typeof row.transactionHash === 'string')
      && (row.attentionReason === null || typeof row.attentionReason === 'string');
  });
}

/*
 * Lobbies.
 *
 * A seat decides who is eligible for a funded pool, so every one of these
 * crosses a trust boundary: the server decides, and the client only ever
 * displays. The guards are closed for the same reason the others are - a shape
 * that does not match is refused rather than rendered half-empty.
 */
export interface BlitzLobbySummary {
  id: string;
  kind: 'daily' | 'private';
  challengeId: string;
  capacity: number;
  hostWallet: string | null;
  createdAt: number;
  expiresAt: number;
}

export interface BlitzSeatSummary {
  seat: number;
  walletAddress: string;
  claimedAt: number;
}

export interface BlitzSeatClaim {
  ok: true;
  seat: BlitzSeatSummary;
  lobby: BlitzLobbySummary;
  taken: number;
}

export interface BlitzLobbyView {
  lobby: BlitzLobbySummary;
  seats: BlitzSeatSummary[];
}

function isBlitzLobby(value: unknown): value is BlitzLobbySummary {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const lobby = value as Record<string, unknown>;
  return typeof lobby.id === 'string'
    && (lobby.kind === 'daily' || lobby.kind === 'private')
    && typeof lobby.challengeId === 'string'
    && Number.isSafeInteger(lobby.capacity)
    && (lobby.hostWallet === null || typeof lobby.hostWallet === 'string')
    && Number.isSafeInteger(lobby.createdAt)
    && Number.isSafeInteger(lobby.expiresAt);
}

function isBlitzSeat(value: unknown): value is BlitzSeatSummary {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const seat = value as Record<string, unknown>;
  return Number.isSafeInteger(seat.seat) && typeof seat.walletAddress === 'string' && Number.isSafeInteger(seat.claimedAt);
}

function isBlitzSeatClaim(value: unknown): value is BlitzSeatClaim {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const claim = value as Record<string, unknown>;
  return claim.ok === true && isBlitzSeat(claim.seat) && isBlitzLobby(claim.lobby) && Number.isSafeInteger(claim.taken);
}

function isBlitzLobbyView(value: unknown): value is BlitzLobbyView {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const view = value as Record<string, unknown>;
  return isBlitzLobby(view.lobby) && Array.isArray(view.seats) && view.seats.every(isBlitzSeat);
}

function isBlitzLeaderboard(value: unknown): value is BlitzLeaderboardRow[] {
  return Array.isArray(value) && value.every(isBlitzLeaderboardRow);
}

function isBlitzLeaderboardRow(value: unknown): value is BlitzLeaderboardRow {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const row = value as Record<string, unknown>;
  return typeof row.runId === 'string'
    && typeof row.actorId === 'string'
    && typeof row.walletAddress === 'string'
    && typeof row.username === 'string'
    && ['lagos', 'london', 'dubai'].includes(String(row.cityId))
    && typeof row.seasonId === 'string'
    && typeof row.challengeId === 'string'
    && /^\d{4}-\d{2}-\d{2}$/.test(String(row.challengeDate))
    && typeof row.rulesetVersion === 'string'
    && Number.isSafeInteger(row.score)
    && Number.isSafeInteger(row.elapsedMs)
    && Number.isSafeInteger(row.collisions)
    && typeof row.traceHash === 'string'
    && Number.isSafeInteger(row.verifiedAt)
    && row.verified === true
    && Number.isSafeInteger(row.rank);
}

function isBlitzTicket(value: unknown): value is BlitzTicket {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const ticket = value as Record<string, unknown>;
  return typeof ticket.id === 'string'
    && typeof ticket.actorId === 'string'
    && typeof ticket.walletAddress === 'string'
    && typeof ticket.username === 'string'
    && ['lagos', 'london', 'dubai'].includes(String(ticket.cityId))
    && typeof ticket.seasonId === 'string'
    && typeof ticket.challengeId === 'string'
    && /^\d{4}-\d{2}-\d{2}$/.test(String(ticket.challengeDate))
    && typeof ticket.rulesetVersion === 'string'
    && typeof ticket.seed === 'string'
    && (ticket.attemptsUsed === undefined || Number.isSafeInteger(ticket.attemptsUsed))
    && (ticket.attemptsAllowed === undefined || Number.isSafeInteger(ticket.attemptsAllowed))
    && Number.isSafeInteger(ticket.issuedAt)
    && Number.isSafeInteger(ticket.expiresAt);
}

function isBlitzSubmitResult(value: unknown): value is BlitzSubmitResult {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const result = value as Record<string, unknown>;
  return typeof result.duplicate === 'boolean' && isBlitzLeaderboardRow(result.row);
}

async function authenticatedAtlasRequest<T>(
  path: string,
  action: 'atlas.wallet.challenge' | 'atlas.wallet.bind' | 'atlas.ticket.issue' | 'atlas.run.submit',
  actorId: string,
  body: object,
  guard: (value: unknown) => value is T,
  transport: { apiBase: string; fetchImpl: AtlasFetch },
): Promise<ApiResult<T>> {
  const result = await authenticatedRequest<unknown>(path, action, actorId, body, transport);
  if (!result.ok) return result;
  const payload = result.value;
  if (!payload || typeof payload !== 'object' || Array.isArray(payload) || (payload as { ok?: unknown }).ok !== true) return { ok: false, error: 'Atlas service returned invalid data.' };
  const data = (payload as { data?: unknown }).data;
  return guard(data) ? { ok: true, value: structuredClone(data) } : { ok: false, error: 'Atlas service returned invalid data.' };
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
