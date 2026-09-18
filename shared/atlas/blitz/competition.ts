import type { BlitzCityId, BlitzTraceFrame } from './types';
import type { BlitzRivalPath } from './rivals';

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
  /*
   * The pack this ticket was issued against.
   *
   * Pinned by the server so the run a rider rides and the run the server
   * re-simulates are the same run. A solid rival changes the physics, so a
   * ticket without its pack would verify an honest run as a mismatch.
   */
  readonly rivals?: readonly BlitzRivalPath[];
  /*
   * How many goes this wallet has had at today's course, and how many it gets.
   *
   * Display only. The server counts attempts from its own board and refuses a
   * fourth ticket on that count, so nothing here is trusted for the rule - but
   * without it the only way a rider learns they are out of goes is by being
   * turned away, which is a poor way to find out.
   *
   * Optional because tickets persisted before this existed have neither.
   */
  readonly attemptsUsed?: number;
  readonly attemptsAllowed?: number;
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
  /*
   * The Nimiq transaction that wrote this run onto the chain, if the rider
   * chose to. Optional because anchoring costs a real fee and is a rider's
   * decision, and because every row written before the feature existed has to
   * keep restoring cleanly.
   */
  readonly anchorHash?: string;
}

export interface BlitzSubmitResult {
  readonly row: BlitzLeaderboardRow;
  readonly duplicate: boolean;
}
