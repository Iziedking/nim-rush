import { randomBytes } from 'node:crypto';

import type { AtlasIdentityService } from './identity';
import type { AtlasStateStore } from './persistence';
import type { AtlasDailyService } from './daily';
import { BLITZ_PRIZE_SPLIT_BPS, allocateBlitzPrizes, withMinimumField, type BlitzPrizeAllocation } from '../../shared/atlas/blitz/prize';
import type { BlitzCityId } from '../../shared/atlas/blitz/types';
import type { BlitzLeaderboardRow, BlitzSubmissionInput, BlitzSubmitResult, BlitzTicket } from '../../shared/atlas/blitz/competition';
import { hashBlitzTrace, replayBlitzTraceWithPath, validateBlitzTrace } from '../../shared/atlas/blitz/replay';
import { blitzRivalPathFrom, type BlitzRivalPath } from '../../shared/atlas/blitz/rivals';
import { BLITZ_TICK_RATE } from '../../shared/atlas/blitz/core';
import { BLITZ_CITIES } from '../../shared/atlas/blitz/cities';
import { getBlitzDailyChallenge, BLITZ_DAILY_RULESET_VERSION } from '../../shared/atlas/blitz/daily';

type StoredRow = Omit<BlitzLeaderboardRow, 'rank'>;
type StoredTicket = BlitzTicket & { usedByRunId?: string };
export interface BlitzQualificationOutboxItem {
  readonly id: string;
  readonly actorId: string;
  readonly walletAddress: string;
  readonly source: 'blitz-ranked';
  readonly attempts: number;
  readonly nextAttemptAt: number;
  readonly lastError?: string;
  readonly completedAt?: number;
}
const BLITZ_RANKED_SUBMISSION_WINDOW_MS = 120_000;

export interface AtlasBlitzSnapshot {
  readonly version: 2;
  tickets: readonly StoredTicket[];
  /*
   * The lines riders drew, by challenge.
   *
   * Kept so a later rider has somebody to race. Optional because a snapshot
   * written before rivals existed has none, and a restart must not lose a
   * day's board just because this field is missing.
   */
  readonly rivalPaths?: ReadonlyArray<{ challengeId: string; path: BlitzRivalPath; score: number }>;
  readonly runs: ReadonlyArray<{ row: StoredRow; fingerprint: string }>;
  readonly usernames: ReadonlyArray<{ seasonId: string; normalized: string; walletAddress: string; display: string }>;
  readonly qualificationOutbox: readonly BlitzQualificationOutboxItem[];
}

export interface BlitzQualificationRetryResult {
  readonly processed: number;
  readonly failed: number;
  readonly pending: number;
}

export interface AtlasBlitzService {
  issueTicket(input: { actorId: string; walletAddress: string; username: string; cityId: BlitzCityId; seasonId: string }): Promise<BlitzTicket>;
  submit(input: BlitzSubmissionInput): Promise<BlitzSubmitResult>;
  leaderboard(seasonId: string, cityId: BlitzCityId, challengeId?: string): Promise<BlitzLeaderboardRow[]>;
  /**
   * What today's board would owe if it closed now. Read-only: it moves nothing
   * and marks nothing paid.
   */
  prizeTable(seasonId: string, cityId: BlitzCityId, challengeId?: string): Promise<BlitzPrizeTable>;
  retryPendingQualifications(): Promise<BlitzQualificationRetryResult>;
  /** One verified run, by id, or null. Read-only. */
  findRun(runId: string): Promise<BlitzLeaderboardRow | null>;
  /**
   * Attach the transaction that put this run on chain.
   *
   * Takes a hash the caller has already derived from transaction bytes it
   * verified. It never takes one from a client, because a hash is a string and
   * any string would do - the board would be publishing claims dressed as
   * receipts.
   */
  recordAnchor(runId: string, hash: string): Promise<BlitzLeaderboardRow>;
  serialise(): AtlasBlitzSnapshot;
  restore(raw: unknown): void;
}

/**
 * The states a prize table is allowed to be in, and no others.
 *
 * `unavailable` is not `unfunded`. A pool the server could not read is an
 * unknown, and showing an unknown as "no pool today" would be a claim the
 * server cannot support. The plan requires these to stay distinguishable.
 */
export type BlitzPrizeState = 'unavailable' | 'unfunded' | 'funded';

export interface BlitzPrizeTable {
  readonly state: BlitzPrizeState;
  readonly poolLuna: number | null;
  readonly splitBps: readonly number[];
  readonly allocations: readonly BlitzPrizeAllocation[];
  readonly remainderLuna: number;
  /** Distinct wallets with a verified run on this board. */
  readonly qualifiedRiders: number;
}

export class AtlasBlitzError extends Error {
  constructor(readonly code: 'invalid' | 'identity' | 'ticket' | 'replay' | 'duplicate', message: string) {
    super(message);
    this.name = 'AtlasBlitzError';
  }
}

export function createAtlasBlitzService(options: {
  identity: Pick<AtlasIdentityService, 'getBinding'>;
  stateStore?: Pick<AtlasStateStore, 'load' | 'save'>;
  now?: () => number;
  randomId?: () => string;
  /**
   * The day's reward pool, when one is configured.
   *
   * A ranked run that the server re-simulated and agreed with is exactly the
   * kind of thing the pool exists to pay for, so qualification happens here
   * rather than on a client request: the player cannot ask to be eligible,
   * only to be verified, and eligibility follows from that.
   */
  /*
   * `standing` is optional on purpose. Qualification and the prize table are
   * separate needs, and a caller that only wants verified runs counted should
   * not have to supply a pool reader to get one. Without it the prize table
   * reports `unavailable`, which is the honest answer to "what is the pool?"
   * from a service that has no way to look.
   */
  daily?: Pick<AtlasDailyService, 'qualifyVerifiedRun'> & Partial<Pick<AtlasDailyService, 'standing'>>;
}): AtlasBlitzService {
  const now = options.now ?? Date.now;
  const randomId = options.randomId ?? (() => randomBytes(16).toString('hex'));
  const tickets = new Map<string, StoredTicket>();
  const runs = new Map<string, { row: StoredRow; fingerprint: string }>();
  const best = new Map<string, StoredRow>();
  const qualificationOutbox = new Map<string, BlitzQualificationOutboxItem>();
  const usernameWallet = new Map<string, { walletAddress: string; display: string }>();
  const walletUsername = new Map<string, string>();
  let loaded = false;
  let operations: Promise<void> = Promise.resolve();
  let pendingOperations = 0;
  let drainPromise: Promise<BlitzQualificationRetryResult> | null = null;
  /**
   * How many lines are kept per challenge.
   *
   * A day only needs enough riders to make a race feel like one, and every
   * extra path is payload on the ticket and bytes in the snapshot. Six is two
   * full packs of three.
   */
  const RIVAL_PATHS_PER_CHALLENGE = 6;
  /** How many go on a ticket. More than three and the road stops being readable. */
  const RIVALS_PER_TICKET = 3;

  /*
   * Best lines per challenge, fastest first.
   *
   * Scored rather than most recent, so a rider always races the runs worth
   * chasing - and so a flood of slow runs cannot push the good ones out.
   */
  const rivalPaths = new Map<string, { path: BlitzRivalPath; score: number }[]>();

  let committed: AtlasBlitzSnapshot = serialiseSnapshot();

  async function ensureLoaded(): Promise<void> {
    if (loaded) return;
    if (options.stateStore) {
      const snapshot = await options.stateStore.load<AtlasBlitzSnapshot | null>('blitz', null);
      if (snapshot) restoreSnapshot(snapshot);
    }
    committed = serialiseSnapshot();
    loaded = true;
  }

  async function persist(): Promise<void> {
    const candidate = serialiseSnapshot();
    if (options.stateStore) await options.stateStore.save('blitz', candidate);
    committed = candidate;
  }

  // One service instance owns the snapshot. Serialize check, replay, consume
  // and save together, including reads; a multi-worker service needs database
  // transactions instead. Bound queued traces so overload cannot retain them
  // without limit. Roll back to the last durable state on storage failure.
  function enqueue<T>(action: () => Promise<T>): Promise<T> {
    if (pendingOperations >= 32) return Promise.reject(new AtlasBlitzError('invalid', 'Competition is busy. Retry this run shortly.'));
    pendingOperations++;
    const operation = operations.then(async () => {
      await ensureLoaded();
      try { return await action(); }
      catch (error) { restoreSnapshot(committed); throw error; }
    });
    const settled = operation.finally(() => { pendingOperations--; });
    operations = settled.then(() => undefined, () => undefined);
    return settled;
  }

  return {
    async issueTicket(input) {
      input = structuredClone(input);
      return enqueue(async () => {
        assertSeason(input.seasonId);
        assertCity(input.cityId);
        const username = normalizeDisplayName(input.username);
        const binding = options.identity.getBinding(input.actorId, input.seasonId);
        if (!binding || binding.address !== input.walletAddress) throw new AtlasBlitzError('identity', 'The wallet binding does not match this rider and season.');
        bindUsername(input.seasonId, input.walletAddress, username);
        const issuedAt = now();
        const challenge = getBlitzDailyChallenge({ now: issuedAt, cityId: input.cityId, seasonId: input.seasonId });
        const ticket: BlitzTicket = {
          id: randomId(), actorId: input.actorId, walletAddress: input.walletAddress, username,
          cityId: input.cityId, seasonId: input.seasonId, challengeId: challenge.challengeId,
          challengeDate: challenge.date, rulesetVersion: challenge.rulesetVersion, seed: challenge.seed,
          issuedAt, expiresAt: Math.min(issuedAt + 5 * 60_000, challenge.expiresAt),
          /*
           * Pinned now, so the run a rider rides and the run the server checks
           * are the same run. Empty on the first ticket of a day, which simply
           * means the first rider down has the hill to themselves.
           */
          rivals: packFor(challenge.challengeId, input.walletAddress, username),
        };
        if (!/^[a-zA-Z0-9_-]{1,128}$/.test(ticket.id)) throw new AtlasBlitzError('invalid', 'Beacon Blitz ticket id is invalid.');
        tickets.set(ticket.id, structuredClone(ticket));
        await persist();
        return structuredClone(ticket);
      });
    },

    async submit(input) {
      assertSubmission(input);
      validateBlitzTrace(input.frames);
      input = structuredClone(input);
      const receivedAt = now();
      const result = await enqueue(async () => {
        const ticket = tickets.get(input.ticketId);
        if (!ticket) throw new AtlasBlitzError('ticket', 'Beacon Blitz ticket is missing.');
        if (ticket.rulesetVersion !== BLITZ_DAILY_RULESET_VERSION) throw new AtlasBlitzError('ticket', 'This course has changed. Reload and start a new ranked run.');
        const mismatch = ticket.actorId !== input.actorId || ticket.walletAddress !== input.walletAddress || ticket.username !== input.username || ticket.cityId !== input.cityId || ticket.seasonId !== input.seasonId || (input.challengeId !== undefined && ticket.challengeId !== input.challengeId) || (input.challengeDate !== undefined && ticket.challengeDate !== input.challengeDate) || (input.rulesetVersion !== undefined && ticket.rulesetVersion !== input.rulesetVersion) || ticket.seed !== input.seed;
        if (mismatch) throw new AtlasBlitzError('ticket', 'Beacon Blitz submission does not match its ticket.');
        const binding = options.identity.getBinding(input.actorId, input.seasonId);
        if (!binding || binding.address !== input.walletAddress) throw new AtlasBlitzError('identity', 'The wallet binding is no longer valid for this rider.');
        const traceHash = await hashBlitzTrace(input.frames);
        if (traceHash !== input.traceHash) throw new AtlasBlitzError('replay', 'Beacon Blitz trace hash does not match the submitted controls.');
        const fingerprint = `${input.ticketId}:${input.traceHash}:${input.claimedScore}`;
        const existing = runs.get(input.runId);
        if (existing) {
          if (existing.fingerprint !== fingerprint) throw new AtlasBlitzError('duplicate', 'A different Beacon Blitz run already uses this run id.');
          return { row: await rankedRow(existing.row), duplicate: true };
        }
        if (receivedAt >= ticket.expiresAt) throw new AtlasBlitzError('ticket', 'Beacon Blitz ticket expired before the run was submitted.');
        if (receivedAt - ticket.issuedAt > BLITZ_RANKED_SUBMISSION_WINDOW_MS) {
          throw new AtlasBlitzError('ticket', 'A ranked Beacon Blitz run must finish within two minutes of ticket issue.');
        }
        if (ticket.usedByRunId && ticket.usedByRunId !== input.runId) throw new AtlasBlitzError('ticket', 'Beacon Blitz ticket has already been used.');
        /*
         * Verified against the pack the ticket was issued with.
         *
         * A solid rival changes the physics, so replaying this run without the
         * rivals it was ridden against would compute a different score and
         * refuse an honest rider. The set comes from the stored ticket, never
         * from the submission: a client that chose its own rivals could choose
         * an empty road.
         */
        const { state: replay, positions } = replayBlitzTraceWithPath({
          cityId: input.cityId, seed: input.seed, frames: input.frames, rivals: ticket.rivals ?? [],
        });
        if (replay.phase !== 'finished') throw new AtlasBlitzError('replay', 'Only a completed Beacon Blitz run can be ranked.');
        if (replay.score !== input.claimedScore) throw new AtlasBlitzError('replay', 'Beacon Blitz claimed score does not match authoritative replay.');
        // Ticket issue precedes countdown. Include those ticks, and measure at
        // receipt rather than after queueing so backlog cannot legitimize an
        // instant computed run. This does not prove that a human played.
        const durationMs = Math.floor(replay.tick * 1_000 / BLITZ_TICK_RATE);
        if (receivedAt - ticket.issuedAt < durationMs) throw new AtlasBlitzError('replay', 'Beacon Blitz replay duration exceeds elapsed server time.');
        const row: StoredRow = {
          runId: input.runId, actorId: input.actorId, walletAddress: input.walletAddress, username: input.username,
          cityId: input.cityId, seasonId: input.seasonId, challengeId: ticket.challengeId, challengeDate: ticket.challengeDate,
          rulesetVersion: ticket.rulesetVersion, score: replay.score, elapsedMs: replay.elapsedMs,
          collisions: replay.collisions, traceHash, verifiedAt: now(), verified: true,
        };
        ticket.usedByRunId = input.runId;
        runs.set(input.runId, { row, fingerprint });
        // The line this rider drew becomes somebody else's rival.
        rememberRivalPath(ticket.challengeId, blitzRivalPathFrom({ runId: input.runId, username: input.username, positions }), replay.score);
        const key = bestKey(row);
        const current = best.get(key);
        if (!current || compareRows(row, current) < 0) best.set(key, row);
        if (options.daily) {
          const qualificationId = `${input.runId}:blitz-ranked`;
          if (!qualificationOutbox.has(qualificationId)) qualificationOutbox.set(qualificationId, {
            id: qualificationId, actorId: input.actorId, walletAddress: input.walletAddress, source: 'blitz-ranked',
            attempts: 0, nextAttemptAt: receivedAt,
          });
        }
        await persist();
        return { row: await rankedRow(row), duplicate: false };
      });
      // The score is already durable. Qualification is a separate, durable
      // outbox side effect, so a reward outage cannot erase or delay the board.
      if (!result.duplicate) await drainQualifications();
      return result;
    },

    async retryPendingQualifications() {
      return drainQualifications();
    },

    async findRun(runId) {
      return enqueue(async () => {
        const held = runs.get(runId);
        return held ? { ...structuredClone(held.row), rank: 0 } : null;
      });
    },

    async recordAnchor(runId, hash) {
      return enqueue(async () => {
        const held = runs.get(runId);
        if (!held) throw new AtlasBlitzError('invalid', 'That run is not on the board.');
        // One anchor per run. A second transaction for the same result is a
        // rider paying twice for a record they already have, and replacing the
        // stored hash would quietly rewrite what the board already published.
        if (held.row.anchorHash) return { ...structuredClone(held.row), rank: 0 };
        const row = { ...held.row, anchorHash: hash };
        runs.set(runId, { ...held, row });
        await persist();
        return { ...structuredClone(row), rank: 0 };
      });
    },

    async leaderboard(seasonId, cityId, challengeId) {
      return enqueue(async () => {
        assertSeason(seasonId);
        assertCity(cityId);
        if (challengeId !== undefined && !/^[a-z0-9:_-]{1,160}$/.test(challengeId)) throw new AtlasBlitzError('invalid', 'Beacon Blitz challenge id is invalid.');
        return ranked(seasonId, cityId, challengeId);
      });
    },

    async prizeTable(seasonId, cityId, challengeId) {
      const rows = await this.leaderboard(seasonId, cityId, challengeId);
      /*
       * A pool that cannot be read is `unavailable`, never `unfunded`. The
       * difference matters: one says the day has no prize, the other says the
       * server does not currently know, and only the first is a claim we can
       * make. Failure is swallowed here because the board itself is still true
       * and worth showing without it.
       */
      let poolLuna: number | null = null;
      let state: BlitzPrizeState = 'unavailable';
      try {
        const standing = await options.daily?.standing?.();
        if (standing) {
          poolLuna = standing.rewardsEnabled ? standing.poolLuna : 0;
          state = poolLuna !== null && poolLuna > 0 ? 'funded' : 'unfunded';
        }
      } catch {
        state = 'unavailable';
        poolLuna = null;
      }

      const { allocations, remainderLuna } = withMinimumField(allocateBlitzPrizes({
        poolLuna: state === 'funded' ? poolLuna : null,
        candidates: rows.map((row) => ({
          walletAddress: row.walletAddress,
          score: row.score,
          elapsedMs: row.elapsedMs,
          collisions: row.collisions,
          verifiedAt: row.verifiedAt,
          runId: row.runId,
        })),
      }), { poolLuna: state === 'funded' ? poolLuna : null, riders: new Set(rows.map((row) => row.walletAddress)).size });

      return {
        state,
        poolLuna,
        splitBps: BLITZ_PRIZE_SPLIT_BPS,
        allocations,
        remainderLuna,
        qualifiedRiders: new Set(rows.map((row) => row.walletAddress)).size,
      };
    },

    serialise() {
      return structuredClone(committed);
    },

    restore(raw) {
      if (pendingOperations > 0) throw new AtlasBlitzError('invalid', 'Cannot restore competition state during an operation.');
      restoreSnapshot(raw);
      committed = serialiseSnapshot();
      loaded = true;
    },
  };

  function rememberRivalPath(challengeId: string, path: BlitzRivalPath, score: number): void {
    const entries = rivalPaths.get(challengeId) ?? [];
    // One line per rider: a wallet that improves on their own run replaces it
    // rather than filling the pack with several copies of themselves.
    const withoutRider = entries.filter((entry) => entry.path.runId !== path.runId && entry.path.username !== path.username);
    withoutRider.push({ path, score });
    withoutRider.sort((left, right) => right.score - left.score);
    rivalPaths.set(challengeId, withoutRider.slice(0, RIVAL_PATHS_PER_CHALLENGE));
  }

  /*
   * The pack, and where it comes from when today is still empty.
   *
   * Lines were only ever drawn from the current day's challenge, and a
   * challenge id carries the date - so the pack reset to nothing every midnight
   * and the first riders of every single day raced an empty hill. Not a
   * cold start once: a cold start daily, for as long as the game runs.
   *
   * It is fixable because the course does not change. `sampleCourse` and
   * `nearbyCourseColliders` are keyed on the city alone; the seed moves the
   * missions and the supplies, not the road or the rocks. A line ridden down
   * Lagos yesterday is a true line down Lagos today, so yesterday's riders can
   * fill today's pack until today has riders of its own.
   *
   * Today is always preferred, because those runs were ridden under exactly
   * these conditions. Older days only backfill the empty seats, newest first.
   * Every one of them is a real run by a real wallet that the server verified.
   * Nothing here invents a rider.
   */
  function packFor(challengeId: string, walletAddress: string, username: string): BlitzRivalPath[] {
    const mine = (entry: { path: BlitzRivalPath }) =>
      entry.path.username === username || entry.path.runId === walletAddress;
    const city = cityOfChallenge(challengeId);
    const seen = new Set<string>();
    const pack: BlitzRivalPath[] = [];

    const take = (entries: readonly { path: BlitzRivalPath; score: number }[]) => {
      for (const entry of entries) {
        if (pack.length >= RIVALS_PER_TICKET) return;
        // Nobody races themselves. A rider meeting their own ghost as a solid
        // bike would be blocked by their own best line, which is absurd.
        if (mine(entry) || seen.has(entry.path.username)) continue;
        seen.add(entry.path.username);
        pack.push(structuredClone(entry.path));
      }
    };

    take(rivalPaths.get(challengeId) ?? []);
    if (pack.length >= RIVALS_PER_TICKET) return pack;

    // Same city, other days. Newest first, so a rider meets recent company.
    const older = [...rivalPaths.entries()]
      .filter(([id]) => id !== challengeId && cityOfChallenge(id) === city)
      .sort((left, right) => right[0].localeCompare(left[0]));
    for (const [, entries] of older) {
      take(entries);
      if (pack.length >= RIVALS_PER_TICKET) break;
    }
    return pack;
  }

  /*
   * A challenge id looks like `cycle-2:lagos:2026-09-17:rush-missions-v5-rookie`.
   * The city is the one part that decides whether a recorded line is still a
   * valid line, because it is the only part that shapes the road.
   */
  function cityOfChallenge(challengeId: string): string {
    return challengeId.split(':')[1] ?? challengeId;
  }

  function serialiseSnapshot(): AtlasBlitzSnapshot {
    return {
      version: 2,
      tickets: [...tickets.values()].map((ticket) => structuredClone(ticket)),
      rivalPaths: [...rivalPaths.entries()].flatMap(([challengeId, entries]) => entries.map((entry) => ({ challengeId, ...structuredClone(entry) }))),
      runs: [...runs.values()].map((run) => structuredClone(run)),
      usernames: [...usernameWallet.entries()].map(([key, value]) => {
        const separator = key.indexOf(':');
        return { seasonId: key.slice(0, separator), normalized: key.slice(separator + 1), ...value };
      }),
      qualificationOutbox: [...qualificationOutbox.values()].map((item) => structuredClone(item)),
    };
  }

  function restoreSnapshot(raw: unknown): void {
    if (!raw || typeof raw !== 'object' || ![1, 2].includes((raw as { version?: unknown }).version as number)) throw new AtlasBlitzError('invalid', 'Beacon Blitz snapshot is unsupported.');
    const snapshot = raw as AtlasBlitzSnapshot & { version: 1 | 2 };
    if (!Array.isArray(snapshot.tickets) || !Array.isArray(snapshot.runs) || !Array.isArray(snapshot.usernames)) throw new AtlasBlitzError('invalid', 'Beacon Blitz snapshot is malformed.');
    tickets.clear(); runs.clear(); best.clear(); usernameWallet.clear(); walletUsername.clear(); qualificationOutbox.clear();
    /*
     * Rivals survive the restart too. Losing them would empty every pack for
     * the rest of the day and quietly turn the race back into a time trial -
     * the kind of regression nobody notices until somebody asks why the hill
     * went silent.
     */
    rivalPaths.clear();
    for (const entry of snapshot.rivalPaths ?? []) {
      const entries = rivalPaths.get(entry.challengeId) ?? [];
      entries.push({ path: structuredClone(entry.path), score: entry.score });
      entries.sort((left, right) => right.score - left.score);
      rivalPaths.set(entry.challengeId, entries.slice(0, RIVAL_PATHS_PER_CHALLENGE));
    }
    for (const ticket of snapshot.tickets) tickets.set(ticket.id, upgradeTicket(ticket));
    for (const stored of snapshot.runs) {
      const upgraded = { row: upgradeRow(stored.row), fingerprint: stored.fingerprint };
      runs.set(upgraded.row.runId, structuredClone(upgraded));
      const key = bestKey(upgraded.row);
      const current = best.get(key);
      if (!current || compareRows(upgraded.row, current) < 0) best.set(key, structuredClone(upgraded.row));
    }
    for (const item of snapshot.usernames) {
      usernameWallet.set(`${item.seasonId}:${item.normalized}`, { walletAddress: item.walletAddress, display: item.display });
      walletUsername.set(`${item.seasonId}:${item.walletAddress}`, item.normalized);
    }
    const outbox = (snapshot as AtlasBlitzSnapshot & { qualificationOutbox?: unknown }).qualificationOutbox;
    if (Array.isArray(outbox)) {
      for (const item of outbox) {
        if (isQualificationOutboxItem(item)) qualificationOutbox.set(item.id, structuredClone(item));
      }
    }
  }

  function bindUsername(seasonId: string, walletAddress: string, display: string): void {
    const normalized = display.toLowerCase();
    const nameKey = `${seasonId}:${normalized}`;
    const walletKey = `${seasonId}:${walletAddress}`;
    const owner = usernameWallet.get(nameKey);
    if (owner && owner.walletAddress !== walletAddress) throw new AtlasBlitzError('identity', 'That leaderboard username already belongs to another wallet.');
    const currentName = walletUsername.get(walletKey);
    if (currentName && currentName !== normalized) throw new AtlasBlitzError('identity', 'This wallet already has a leaderboard username for the season.');
    usernameWallet.set(nameKey, { walletAddress, display });
    walletUsername.set(walletKey, normalized);
  }

  async function rankedRow(row: StoredRow): Promise<BlitzLeaderboardRow> {
    const found = (await ranked(row.seasonId, row.cityId, row.challengeId)).find((candidate) => candidate.runId === row.runId);
    if (found) return found;
    const bestForWallet = best.get(bestKey(row));
    const rank = bestForWallet ? (await ranked(row.seasonId, row.cityId, row.challengeId)).find((candidate) => candidate.walletAddress === row.walletAddress)?.rank ?? 0 : 0;
    return { ...row, rank };
  }

  function ranked(seasonId: string, cityId: BlitzCityId, challengeId?: string): BlitzLeaderboardRow[] {
    const rows = [...best.values()].filter((row) => row.seasonId === seasonId && row.cityId === cityId && (challengeId === undefined || row.challengeId === challengeId)).sort(compareRows);
    let previous: StoredRow | null = null;
    return rows.map((row, index) => {
      const rank = previous && equalRank(row, previous) ? index : index + 1;
      previous = row;
      return { ...structuredClone(row), rank };
    });
  }

  function drainQualifications(): Promise<BlitzQualificationRetryResult> {
    if (!options.daily) return Promise.resolve({ processed: 0, failed: 0, pending: 0 });
    if (drainPromise) return drainPromise;
    drainPromise = (async () => {
      const due = await enqueue(async () => [...qualificationOutbox.values()].filter((item) => !item.completedAt && item.nextAttemptAt <= now()).map((item) => structuredClone(item)));
      let processed = 0;
      let failed = 0;
      for (const item of due) {
        try {
          const result = await options.daily!.qualifyVerifiedRun({ actorId: item.actorId, walletAddress: item.walletAddress, source: item.source });
          if (!result.accepted) throw new Error(result.reason ?? 'Daily qualification was refused.');
          await enqueue(async () => {
            const current = qualificationOutbox.get(item.id);
            if (current) { qualificationOutbox.set(item.id, { ...current, completedAt: now(), lastError: undefined }); await persist(); }
          });
          processed++;
        } catch (error) {
          failed++;
          await enqueue(async () => {
            const current = qualificationOutbox.get(item.id);
            if (current) {
              const attempts = current.attempts + 1;
              qualificationOutbox.set(item.id, { ...current, attempts, nextAttemptAt: now() + Math.min(15 * 60_000, 1_000 * 2 ** Math.min(attempts, 10)), lastError: error instanceof Error ? error.message : 'Qualification failed.' });
              await persist();
            }
          });
        }
      }
      const pending = await enqueue(async () => [...qualificationOutbox.values()].filter((item) => !item.completedAt).length);
      return { processed, failed, pending };
    })().finally(() => { drainPromise = null; });
    return drainPromise;
  }
}

function compareRows(left: StoredRow, right: StoredRow): number {
  return right.score - left.score || left.elapsedMs - right.elapsedMs || left.collisions - right.collisions || left.verifiedAt - right.verifiedAt || left.runId.localeCompare(right.runId);
}

function equalRank(left: StoredRow, right: StoredRow): boolean {
  return left.score === right.score && left.elapsedMs === right.elapsedMs && left.collisions === right.collisions;
}

function bestKey(row: Pick<StoredRow, 'seasonId' | 'cityId' | 'walletAddress' | 'challengeId'>): string {
  return `${row.seasonId}:${row.cityId}:${row.challengeId}:${row.walletAddress}`;
}

function normalizeDisplayName(value: string): string {
  const name = value.trim();
  if (!/^[A-Za-z0-9_]{3,18}$/.test(name)) throw new AtlasBlitzError('invalid', 'Leaderboard username must be 3–18 letters, numbers, or underscores.');
  return name;
}

function assertCity(value: string): asserts value is BlitzCityId {
  if (!BLITZ_CITIES.some((city) => city.id === value)) throw new AtlasBlitzError('invalid', 'Beacon Blitz city is invalid.');
}

function assertSeason(value: string): void {
  if (!/^[a-z0-9-]{1,80}$/.test(value)) throw new AtlasBlitzError('invalid', 'Beacon Blitz season is invalid.');
}

function assertSubmission(input: BlitzSubmissionInput): void {
  if (!/^[a-zA-Z0-9:_-]{1,128}$/.test(input.runId) || !/^[a-zA-Z0-9_-]{1,128}$/.test(input.ticketId) || !/^[a-f0-9]{64}$/.test(input.traceHash) || !Number.isSafeInteger(input.claimedScore) || input.claimedScore < 0) throw new AtlasBlitzError('invalid', 'Beacon Blitz submission is malformed.');
  normalizeDisplayName(input.username);
  assertSeason(input.seasonId);
  assertCity(input.cityId);
  if (input.challengeId !== undefined && !/^[a-z0-9:_-]{1,160}$/.test(input.challengeId)) throw new AtlasBlitzError('invalid', 'Beacon Blitz challenge id is invalid.');
  if (input.challengeDate !== undefined && !/^\d{4}-\d{2}-\d{2}$/.test(input.challengeDate)) throw new AtlasBlitzError('invalid', 'Beacon Blitz challenge date is invalid.');
  if (input.rulesetVersion !== undefined && input.rulesetVersion !== BLITZ_DAILY_RULESET_VERSION) throw new AtlasBlitzError('invalid', 'Beacon Blitz ruleset is unsupported.');
}

function upgradeTicket(ticket: StoredTicket): StoredTicket {
  if (ticket.challengeId && ticket.challengeDate && ticket.rulesetVersion) return structuredClone(ticket);
  return {
    ...structuredClone(ticket),
    challengeId: `legacy:${ticket.seasonId}:${ticket.cityId}`,
    challengeDate: '1970-01-01',
    rulesetVersion: 'legacy-v1',
  };
}

function upgradeRow(row: StoredRow): StoredRow {
  if (row.challengeId && row.challengeDate && row.rulesetVersion) return structuredClone(row);
  return {
    ...structuredClone(row),
    challengeId: `legacy:${row.seasonId}:${row.cityId}`,
    challengeDate: '1970-01-01',
    rulesetVersion: 'legacy-v1',
  };
}

function isQualificationOutboxItem(value: unknown): value is BlitzQualificationOutboxItem {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const item = value as Record<string, unknown>;
  return typeof item.id === 'string'
    && typeof item.actorId === 'string'
    && typeof item.walletAddress === 'string'
    && item.source === 'blitz-ranked'
    && Number.isSafeInteger(item.attempts)
    && Number(item.attempts) >= 0
    && Number.isSafeInteger(item.nextAttemptAt)
    && (item.lastError === undefined || typeof item.lastError === 'string')
    && (item.completedAt === undefined || Number.isSafeInteger(item.completedAt));
}
