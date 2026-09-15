/*
 * Who is owed what, when a funded day closes.
 *
 * The daily service splits its pool equally across every eligible wallet and
 * has no concept of rank: it knows who qualified, never who was fastest. The
 * leaderboard holds the scores. This is the join between them, and it decides
 * money, so it is pure by construction - no clock, no network, no storage, no
 * framework - and every rule it applies is one a test can pin exactly.
 *
 * Its second consumer is the server's payout worker, which reconciles each
 * allocation against authoritative chain evidence under an idempotency key.
 * That worker must be able to re-run a close and get the same answer, which is
 * why ordering here is total and input order cannot change the outcome.
 *
 * What this module does NOT do, deliberately: decide whether a pool is funded,
 * move any value, or mark anything paid. It is arithmetic over a settled set of
 * verified results.
 */

/**
 * The fixed top-three split, in basis points.
 *
 * Basis points rather than percentages so the arithmetic stays in integers all
 * the way down: Luna has no sub-unit, and a float split is how a treasury ends
 * up owing a fraction it cannot pay. Stated once here because the plan records
 * it as an open decision - changing the split is one edit to this line.
 */
export const BLITZ_PRIZE_SPLIT_BPS: readonly number[] = [5_000, 3_000, 2_000];

const BPS_TOTAL = 10_000;

/** One verified result, reduced to only what deciding a prize needs. */
export interface BlitzPrizeCandidate {
  readonly walletAddress: string;
  readonly score: number;
  /** Finish time. Lower is better, and it breaks a tied score. */
  readonly elapsedMs: number;
  /** Contacts taken. Lower is better, and it breaks a tied time. */
  readonly collisions: number;
  /** When the server verified the replay. Earlier wins a dead heat. */
  readonly verifiedAt: number;
  /** Carried through so a payout receipt can name the run it paid for. */
  readonly runId: string;
}

export interface BlitzPrizeAllocation {
  readonly rank: number;
  readonly walletAddress: string;
  readonly luna: number;
  readonly runId: string;
}

export interface BlitzPrizeAllocationResult {
  readonly allocations: readonly BlitzPrizeAllocation[];
  /**
   * What the day did not pay out: flooring dust, and the shares of places
   * nobody finished in. It stays with the treasury rather than being spread
   * across the riders who did finish, because inflating a prize beyond its
   * stated share is the same lie as inventing a rider to pay.
   */
  readonly remainderLuna: number;
}

export function allocateBlitzPrizes(input: {
  readonly poolLuna: number | null;
  readonly candidates: readonly BlitzPrizeCandidate[];
}): BlitzPrizeAllocationResult {
  const poolLuna = input.poolLuna;
  if (poolLuna === null) return { allocations: [], remainderLuna: 0 };
  if (!Number.isSafeInteger(poolLuna) || poolLuna < 0) {
    throw new Error('Beacon Blitz prize pool must be a whole, non-negative number of Luna.');
  }

  const best = bestRunPerWallet(input.candidates);
  if (poolLuna === 0 || best.length === 0) return { allocations: [], remainderLuna: poolLuna };

  const ordered = [...best].sort(compareCandidates);
  const allocations: BlitzPrizeAllocation[] = [];
  let paid = 0;
  for (const [index, bps] of BLITZ_PRIZE_SPLIT_BPS.entries()) {
    const winner = ordered[index];
    if (!winner) break;
    // Floored, so the sum of every share can never exceed the pot. The dust
    // lands in the remainder, which is named rather than lost.
    const luna = Math.floor((poolLuna * bps) / BPS_TOTAL);
    allocations.push({ rank: index + 1, walletAddress: winner.walletAddress, luna, runId: winner.runId });
    paid += luna;
  }

  return { allocations, remainderLuna: poolLuna - paid };
}

/**
 * One wallet, one place.
 *
 * The daily engine already counts a wallet once however many times it
 * qualified, and a rider who posts the two best runs of the day must not also
 * take second from the rider behind them.
 */
function bestRunPerWallet(candidates: readonly BlitzPrizeCandidate[]): readonly BlitzPrizeCandidate[] {
  const best = new Map<string, BlitzPrizeCandidate>();
  for (const candidate of candidates) {
    assertPayable(candidate);
    const held = best.get(candidate.walletAddress);
    if (!held || compareCandidates(candidate, held) < 0) best.set(candidate.walletAddress, candidate);
  }
  return [...best.values()];
}

function assertPayable(candidate: BlitzPrizeCandidate): void {
  if (typeof candidate.walletAddress !== 'string' || candidate.walletAddress.trim() === '') {
    throw new Error('Beacon Blitz prize candidate has no wallet address to pay.');
  }
  if (!Number.isFinite(candidate.score)) throw new Error('Beacon Blitz prize candidate has an invalid score.');
  if (!Number.isFinite(candidate.elapsedMs) || !Number.isFinite(candidate.collisions) || !Number.isFinite(candidate.verifiedAt)) {
    throw new Error('Beacon Blitz prize candidate has an invalid result field.');
  }
}

/**
 * The board's own order: score, then finish time, then contacts, then who was
 * verified first.
 *
 * The caller's `rank` is deliberately not consulted. A leaderboard row carries
 * one, but a payout that believes whatever it is handed is a payout waiting to
 * be handed the wrong thing.
 *
 * The final comparison is on run id, which every candidate has and no two share.
 * Without it a dead heat would resolve by input order, and a replayed close
 * could pay a different wallet than the first close did.
 */
function compareCandidates(left: BlitzPrizeCandidate, right: BlitzPrizeCandidate): number {
  if (left.score !== right.score) return right.score - left.score;
  if (left.elapsedMs !== right.elapsedMs) return left.elapsedMs - right.elapsedMs;
  if (left.collisions !== right.collisions) return left.collisions - right.collisions;
  if (left.verifiedAt !== right.verifiedAt) return left.verifiedAt - right.verifiedAt;
  return left.runId < right.runId ? -1 : left.runId > right.runId ? 1 : 0;
}
