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

/**
 * One payout the treasury owes, named so that closing a day twice cannot pay
 * twice.
 *
 * The ledger in `server/atlas/payouts.ts` refuses a duplicate id, persists
 * across restarts, and reconciles against authoritative chain evidence before
 * anything is called verified. All of that only means something if the id a
 * close produces is the same id the next close produces, which is what this
 * shape exists to guarantee.
 */
export interface BlitzPayoutPlanEntry {
  /** Idempotency key. Stable across closes, unique across days and places. */
  readonly id: string;
  /** The challenge the obligation belongs to, carried for the ledger period. */
  readonly period: string;
  readonly rank: number;
  readonly walletAddress: string;
  readonly amountLuna: number;
}

/*
 * Kept deliberately tight. The id is embedded in a durable ledger row, so a
 * challenge id with a space or a colon-free shape would produce obligations
 * nobody can parse back apart later.
 */
const CHALLENGE_ID_PATTERN = /^[a-z0-9:_-]{1,160}$/;

/*
 * What `server/atlas/payouts.ts` will actually accept for an id and a period.
 * Mirrored here rather than imported because this module is pure and shared
 * with the client; read from that file on 2026-09-15. No colons, 80 characters.
 */
const LEDGER_NAME_PATTERN = /^[a-z0-9-]{1,80}$/;
const LEDGER_NAME_MAX = 80;

/**
 * Encode a challenge id into something the ledger will take, without ever
 * letting two different challenges become the same name.
 *
 * A plain `:` to `-` substitution is not safe: season "cycle-2" in city
 * "lagos" and a season literally called "cycle-2-lagos" would collapse onto
 * one obligation, and the ledger's duplicate refusal would then hide the
 * second day's first place instead of catching it. Doubling existing dashes
 * first makes the mapping injective and reversible.
 */
function ledgerSlug(challengeId: string): string {
  return challengeId.replace(/-/g, '--').replace(/:/g, '-').replace(/_/g, '-');
}

/**
 * Turn a closed day's allocations into the obligations it owes.
 *
 * Writes nothing and moves nothing. This is the durable-intent half of the
 * money path: decide what is owed and what each obligation is called, before
 * anything is submitted anywhere.
 *
 * The id is keyed on the **place**, not the wallet, because what a day owes is
 * "first place", once. Keying on the wallet would let a re-close after a
 * changed result quietly raise a second obligation for the same place. The
 * wallet still travels with the entry so a caller holding an existing ledger
 * row can compare the two and refuse rather than pay, which is a check the
 * caller must make - this function cannot see the ledger.
 */
export function planBlitzPayouts(input: {
  readonly challengeId: string;
  readonly allocations: readonly BlitzPrizeAllocation[];
}): readonly BlitzPayoutPlanEntry[] {
  if (!CHALLENGE_ID_PATTERN.test(input.challengeId)) {
    throw new Error('Beacon Blitz challenge id cannot name a payout obligation.');
  }
  const period = `blitz-${ledgerSlug(input.challengeId)}`;
  /*
   * Refuse here rather than at the ledger. A name that is too long fails at
   * the moment the obligation is written, which is the worst moment to find
   * out: the day is closed, the winners are decided, and the treasury has a
   * row it cannot create.
   */
  if (!LEDGER_NAME_PATTERN.test(period) || period.length + 2 > LEDGER_NAME_MAX) {
    throw new Error('Beacon Blitz challenge id is too long to name a payout obligation.');
  }
  return input.allocations
    // A share that floors to nothing is not an obligation: a transfer of zero
    // costs a fee to prove nothing happened.
    .filter((allocation) => allocation.luna > 0)
    .map((allocation) => ({
      id: `${period}-${allocation.rank}`,
      period,
      rank: allocation.rank,
      walletAddress: allocation.walletAddress,
      amountLuna: allocation.luna,
    }));
}
