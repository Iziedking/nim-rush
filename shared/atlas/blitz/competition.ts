import type { BlitzCityId, BlitzTraceFrame } from './types';

export interface BlitzTicket {
  readonly id: string;
  readonly actorId: string;
  readonly walletAddress: string;
  readonly username: string;
  readonly cityId: BlitzCityId;
  readonly seasonId: string;
  readonly challengeId: string;
  readonly challengeDate: string;
  readonly rulesetVersion: string;
  readonly seed: string;
  readonly issuedAt: number;
  readonly expiresAt: number;
}

export interface BlitzSubmissionInput {
  readonly runId: string;
  readonly ticketId: string;
  readonly actorId: string;
  readonly walletAddress: string;
  readonly username: string;
  readonly cityId: BlitzCityId;
  readonly seasonId: string;
  /** Optional for direct callers; the ticket remains the server authority. */
  readonly challengeId?: string;
  readonly challengeDate?: string;
  readonly rulesetVersion?: string;
  readonly seed: string;
  readonly frames: readonly BlitzTraceFrame[];
  readonly traceHash: string;
  readonly claimedScore: number;
}

export interface BlitzLeaderboardRow {
  readonly runId: string;
  readonly actorId: string;
  readonly walletAddress: string;
  readonly username: string;
  readonly cityId: BlitzCityId;
  readonly seasonId: string;
  readonly challengeId: string;
  readonly challengeDate: string;
  readonly rulesetVersion: string;
  readonly score: number;
  readonly elapsedMs: number;
  readonly collisions: number;
  readonly traceHash: string;
  readonly verifiedAt: number;
  readonly verified: true;
  readonly rank: number;
}

export interface BlitzSubmitResult {
  readonly row: BlitzLeaderboardRow;
  readonly duplicate: boolean;
}
