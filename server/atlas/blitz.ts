import { randomBytes } from 'node:crypto';

import type { AtlasIdentityService } from './identity';
import type { AtlasStateStore } from './persistence';
import type { BlitzCityId } from '../../shared/atlas/blitz/types';
import type { BlitzLeaderboardRow, BlitzSubmissionInput, BlitzSubmitResult, BlitzTicket } from '../../shared/atlas/blitz/competition';
import { hashBlitzTrace, replayBlitzTrace } from '../../shared/atlas/blitz/replay';
import { BLITZ_CITIES } from '../../shared/atlas/blitz/cities';

type StoredRow = Omit<BlitzLeaderboardRow, 'rank'>;
type StoredTicket = BlitzTicket & { usedByRunId?: string };
const BLITZ_RANKED_SUBMISSION_WINDOW_MS = 120_000;

export interface AtlasBlitzSnapshot {
  readonly version: 1;
  tickets: readonly StoredTicket[];
  readonly runs: ReadonlyArray<{ row: StoredRow; fingerprint: string }>;
  readonly usernames: ReadonlyArray<{ seasonId: string; normalized: string; walletAddress: string; display: string }>;
}

export interface AtlasBlitzService {
  issueTicket(input: { actorId: string; walletAddress: string; username: string; cityId: BlitzCityId; seasonId: string }): Promise<BlitzTicket>;
  submit(input: BlitzSubmissionInput): Promise<BlitzSubmitResult>;
  leaderboard(seasonId: string, cityId: BlitzCityId): Promise<BlitzLeaderboardRow[]>;
  serialise(): AtlasBlitzSnapshot;
  restore(raw: unknown): void;
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
}): AtlasBlitzService {
  const now = options.now ?? Date.now;
  const randomId = options.randomId ?? (() => randomBytes(16).toString('hex'));
  const tickets = new Map<string, StoredTicket>();
  const runs = new Map<string, { row: StoredRow; fingerprint: string }>();
  const best = new Map<string, StoredRow>();
  const usernameWallet = new Map<string, { walletAddress: string; display: string }>();
  const walletUsername = new Map<string, string>();
  let loaded = false;

  async function ensureLoaded(): Promise<void> {
    if (loaded) return;
    loaded = true;
    if (!options.stateStore) return;
    const snapshot = await options.stateStore.load<AtlasBlitzSnapshot | null>('blitz', null);
    if (snapshot) restoreSnapshot(snapshot);
  }

  async function persist(): Promise<void> {
    if (options.stateStore) await options.stateStore.save('blitz', serialiseSnapshot());
  }

  return {
    async issueTicket(input) {
      await ensureLoaded();
      assertSeason(input.seasonId);
      assertCity(input.cityId);
      const username = normalizeDisplayName(input.username);
      const binding = options.identity.getBinding(input.actorId, input.seasonId);
      if (!binding || binding.address !== input.walletAddress) throw new AtlasBlitzError('identity', 'The wallet binding does not match this rider and season.');
      bindUsername(input.seasonId, input.walletAddress, username);
      const issuedAt = now();
      const seedWindow = Math.floor(issuedAt / (5 * 60_000));
      const ticket: BlitzTicket = {
        id: randomId(), actorId: input.actorId, walletAddress: input.walletAddress, username,
        cityId: input.cityId, seasonId: input.seasonId, seed: `${input.seasonId}:${input.cityId}:${seedWindow}`,
        issuedAt, expiresAt: issuedAt + 5 * 60_000,
      };
      if (!/^[a-zA-Z0-9_-]{1,128}$/.test(ticket.id)) throw new AtlasBlitzError('invalid', 'Beacon Blitz ticket id is invalid.');
      tickets.set(ticket.id, structuredClone(ticket));
      await persist();
      return structuredClone(ticket);
    },

    async submit(input) {
      await ensureLoaded();
      assertSubmission(input);
      const fingerprint = `${input.ticketId}:${input.traceHash}:${input.claimedScore}`;
      const existing = runs.get(input.runId);
      if (existing) {
        if (existing.fingerprint !== fingerprint) throw new AtlasBlitzError('duplicate', 'A different Beacon Blitz run already uses this run id.');
        return { row: await rankedRow(existing.row), duplicate: true };
      }
      const ticket = tickets.get(input.ticketId);
      if (!ticket) throw new AtlasBlitzError('ticket', 'Beacon Blitz ticket is missing.');
      if (now() >= ticket.expiresAt) throw new AtlasBlitzError('ticket', 'Beacon Blitz ticket expired before the run was submitted.');
      if (now() - ticket.issuedAt > BLITZ_RANKED_SUBMISSION_WINDOW_MS) {
        throw new AtlasBlitzError('ticket', 'A ranked Beacon Blitz run must finish within two minutes of ticket issue.');
      }
      const mismatch = ticket.actorId !== input.actorId || ticket.walletAddress !== input.walletAddress || ticket.username !== input.username || ticket.cityId !== input.cityId || ticket.seasonId !== input.seasonId || ticket.seed !== input.seed;
      if (mismatch) throw new AtlasBlitzError('ticket', 'Beacon Blitz submission does not match its ticket.');
      if (ticket.usedByRunId && ticket.usedByRunId !== input.runId) throw new AtlasBlitzError('ticket', 'Beacon Blitz ticket has already been used.');
      const binding = options.identity.getBinding(input.actorId, input.seasonId);
      if (!binding || binding.address !== input.walletAddress) throw new AtlasBlitzError('identity', 'The wallet binding is no longer valid for this rider.');
      const traceHash = await hashBlitzTrace(input.frames);
      if (traceHash !== input.traceHash) throw new AtlasBlitzError('replay', 'Beacon Blitz trace hash does not match the submitted controls.');
      const replay = replayBlitzTrace({ cityId: input.cityId, seed: input.seed, frames: input.frames });
      if (replay.phase !== 'finished') throw new AtlasBlitzError('replay', 'Only a completed Beacon Blitz run can be ranked.');
      if (replay.score !== input.claimedScore) throw new AtlasBlitzError('replay', 'Beacon Blitz claimed score does not match authoritative replay.');
      const row: StoredRow = {
        runId: input.runId, actorId: input.actorId, walletAddress: input.walletAddress, username: input.username,
        cityId: input.cityId, seasonId: input.seasonId, score: replay.score, elapsedMs: replay.elapsedMs,
        collisions: replay.collisions, traceHash, verifiedAt: now(), verified: true,
      };
      ticket.usedByRunId = input.runId;
      runs.set(input.runId, { row, fingerprint });
      const key = bestKey(row);
      const current = best.get(key);
      if (!current || compareRows(row, current) < 0) best.set(key, row);
      await persist();
      return { row: await rankedRow(row), duplicate: false };
    },

    async leaderboard(seasonId, cityId) {
      await ensureLoaded();
      assertSeason(seasonId);
      assertCity(cityId);
      return ranked(seasonId, cityId);
    },

    serialise() {
      return serialiseSnapshot();
    },

    restore(raw) {
      restoreSnapshot(raw);
      loaded = true;
    },
  };

  function serialiseSnapshot(): AtlasBlitzSnapshot {
    return {
      version: 1,
      tickets: [...tickets.values()].map((ticket) => structuredClone(ticket)),
      runs: [...runs.values()].map((run) => structuredClone(run)),
      usernames: [...usernameWallet.entries()].map(([key, value]) => {
        const separator = key.indexOf(':');
        return { seasonId: key.slice(0, separator), normalized: key.slice(separator + 1), ...value };
      }),
    };
  }

  function restoreSnapshot(raw: unknown): void {
    if (!raw || typeof raw !== 'object' || (raw as { version?: unknown }).version !== 1) throw new AtlasBlitzError('invalid', 'Beacon Blitz snapshot is unsupported.');
    const snapshot = raw as AtlasBlitzSnapshot;
    if (!Array.isArray(snapshot.tickets) || !Array.isArray(snapshot.runs) || !Array.isArray(snapshot.usernames)) throw new AtlasBlitzError('invalid', 'Beacon Blitz snapshot is malformed.');
    tickets.clear(); runs.clear(); best.clear(); usernameWallet.clear(); walletUsername.clear();
    for (const ticket of snapshot.tickets) tickets.set(ticket.id, structuredClone(ticket));
    for (const stored of snapshot.runs) {
      runs.set(stored.row.runId, structuredClone(stored));
      const key = bestKey(stored.row);
      const current = best.get(key);
      if (!current || compareRows(stored.row, current) < 0) best.set(key, structuredClone(stored.row));
    }
    for (const item of snapshot.usernames) {
      usernameWallet.set(`${item.seasonId}:${item.normalized}`, { walletAddress: item.walletAddress, display: item.display });
      walletUsername.set(`${item.seasonId}:${item.walletAddress}`, item.normalized);
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
    const found = (await ranked(row.seasonId, row.cityId)).find((candidate) => candidate.runId === row.runId);
    if (found) return found;
    const bestForWallet = best.get(bestKey(row));
    const rank = bestForWallet ? (await ranked(row.seasonId, row.cityId)).find((candidate) => candidate.walletAddress === row.walletAddress)?.rank ?? 0 : 0;
    return { ...row, rank };
  }

  function ranked(seasonId: string, cityId: BlitzCityId): BlitzLeaderboardRow[] {
    const rows = [...best.values()].filter((row) => row.seasonId === seasonId && row.cityId === cityId).sort(compareRows);
    let previous: StoredRow | null = null;
    return rows.map((row, index) => {
      const rank = previous && equalRank(row, previous) ? index : index + 1;
      previous = row;
      return { ...structuredClone(row), rank };
    });
  }
}

function compareRows(left: StoredRow, right: StoredRow): number {
  return right.score - left.score || left.elapsedMs - right.elapsedMs || left.collisions - right.collisions || left.verifiedAt - right.verifiedAt || left.runId.localeCompare(right.runId);
}

function equalRank(left: StoredRow, right: StoredRow): boolean {
  return left.score === right.score && left.elapsedMs === right.elapsedMs && left.collisions === right.collisions;
}

function bestKey(row: Pick<StoredRow, 'seasonId' | 'cityId' | 'walletAddress'>): string {
  return `${row.seasonId}:${row.cityId}:${row.walletAddress}`;
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
}
