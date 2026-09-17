import { describe, expect, it } from 'vitest';

import { BLITZ_PRIZE_SPLIT_BPS, allocateBlitzPrizes, planBlitzPayouts, withMinimumField } from '../shared/atlas/blitz/prize';
import type { BlitzPrizeCandidate } from '../shared/atlas/blitz/prize';

/*
 * Top-three prize allocation.
 *
 * The daily service splits its pool equally across every eligible wallet
 * (`Math.floor(pool / wallets)`), and it has no concept of rank at all: it
 * knows who qualified, never who was fastest. The leaderboard holds the
 * scores. This module is the missing join, and it is money, so it is written
 * red-first and adversarially.
 *
 * Pure by construction: no clock, no network, no storage. The server owns
 * funding and reconciliation; this decides only who is owed what.
 */
const WALLET_A = 'NQ07ABCDEFGHJKLMNPQRSTUVXY0123456781';
const WALLET_B = 'NQ07ABCDEFGHJKLMNPQRSTUVXY0123456782';
const WALLET_C = 'NQ07ABCDEFGHJKLMNPQRSTUVXY0123456783';
const WALLET_D = 'NQ07ABCDEFGHJKLMNPQRSTUVXY0123456784';

function rider(walletAddress: string, score: number, extra: Partial<BlitzPrizeCandidate> = {}): BlitzPrizeCandidate {
  return { walletAddress, score, elapsedMs: 60_000, collisions: 0, verifiedAt: 1_000, runId: `run-${walletAddress}-${score}`, ...extra };
}

describe('the top-three split', () => {
  it('is 50/30/20, stated once, in basis points so the maths stays integer', () => {
    expect(BLITZ_PRIZE_SPLIT_BPS).toEqual([5_000, 3_000, 2_000]);
    expect(BLITZ_PRIZE_SPLIT_BPS.reduce((total, bps) => total + bps, 0)).toBe(10_000);
  });

  it('pays first, second and third from a funded pool', () => {
    const result = allocateBlitzPrizes({
      poolLuna: 10_000,
      candidates: [rider(WALLET_A, 900), rider(WALLET_B, 800), rider(WALLET_C, 700)],
    });
    expect(result.allocations).toEqual([
      { rank: 1, walletAddress: WALLET_A, luna: 5_000, runId: `run-${WALLET_A}-900` },
      { rank: 2, walletAddress: WALLET_B, luna: 3_000, runId: `run-${WALLET_B}-800` },
      { rank: 3, walletAddress: WALLET_C, luna: 2_000, runId: `run-${WALLET_C}-700` },
    ]);
    expect(result.remainderLuna).toBe(0);
  });

  /*
   * The invariant the treasury depends on. Floors can only ever leave money
   * behind, never create it, and what is left behind is named rather than
   * quietly lost.
   */
  it('never allocates more than the pool, and accounts for every Luna', () => {
    for (const poolLuna of [1, 2, 3, 7, 99, 101, 3_338, 9_999, 10_001, 1_234_567]) {
      const result = allocateBlitzPrizes({
        poolLuna,
        candidates: [rider(WALLET_A, 900), rider(WALLET_B, 800), rider(WALLET_C, 700)],
      });
      const paid = result.allocations.reduce((total, entry) => total + entry.luna, 0);
      expect(paid).toBeLessThanOrEqual(poolLuna);
      expect(paid + result.remainderLuna).toBe(poolLuna);
      for (const entry of result.allocations) expect(Number.isSafeInteger(entry.luna)).toBe(true);
    }
  });

  it('pays only the places that exist and rolls the rest over', () => {
    // Two riders is two prizes. Inventing a third payee, or inflating the two
    // that exist, would both be lies about what the day earned.
    const result = allocateBlitzPrizes({ poolLuna: 10_000, candidates: [rider(WALLET_A, 900), rider(WALLET_B, 800)] });
    expect(result.allocations.map((entry) => entry.rank)).toEqual([1, 2]);
    expect(result.allocations.map((entry) => entry.luna)).toEqual([5_000, 3_000]);
    expect(result.remainderLuna).toBe(2_000);
  });

  it('owes nothing when nobody qualified', () => {
    const result = allocateBlitzPrizes({ poolLuna: 10_000, candidates: [] });
    expect(result.allocations).toEqual([]);
    expect(result.remainderLuna).toBe(10_000);
  });

  it('owes nothing when no pool is funded', () => {
    for (const poolLuna of [null, 0]) {
      const result = allocateBlitzPrizes({ poolLuna, candidates: [rider(WALLET_A, 900)] });
      expect(result.allocations).toEqual([]);
      expect(result.remainderLuna).toBe(0);
    }
  });

  it('refuses a pool that is not a whole number of Luna', () => {
    for (const poolLuna of [-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, Number.MAX_SAFE_INTEGER + 2]) {
      expect(() => allocateBlitzPrizes({ poolLuna, candidates: [rider(WALLET_A, 900)] })).toThrow(/pool/i);
    }
  });
});

describe('who gets which place', () => {
  /*
   * The caller's own `rank` field is deliberately not trusted. A leaderboard
   * row carries one, but a payout that believes whatever it is handed is a
   * payout waiting to be handed the wrong thing.
   */
  it('orders by score, and ignores the order it was given', () => {
    const candidates = [rider(WALLET_C, 700), rider(WALLET_A, 900), rider(WALLET_B, 800)];
    const result = allocateBlitzPrizes({ poolLuna: 10_000, candidates });
    expect(result.allocations.map((entry) => entry.walletAddress)).toEqual([WALLET_A, WALLET_B, WALLET_C]);
  });

  it('breaks a tied score on elapsed time, then contacts, then verified time', () => {
    const slow = rider(WALLET_A, 900, { elapsedMs: 70_000 });
    const quick = rider(WALLET_B, 900, { elapsedMs: 60_000 });
    expect(allocateBlitzPrizes({ poolLuna: 10_000, candidates: [slow, quick] }).allocations[0]!.walletAddress).toBe(WALLET_B);

    const clean = rider(WALLET_C, 900, { collisions: 0 });
    const scraped = rider(WALLET_D, 900, { collisions: 2 });
    expect(allocateBlitzPrizes({ poolLuna: 10_000, candidates: [scraped, clean] }).allocations[0]!.walletAddress).toBe(WALLET_C);

    const early = rider(WALLET_A, 900, { verifiedAt: 500 });
    const late = rider(WALLET_B, 900, { verifiedAt: 900 });
    expect(allocateBlitzPrizes({ poolLuna: 10_000, candidates: [late, early] }).allocations[0]!.walletAddress).toBe(WALLET_A);
  });

  /*
   * Every tie-break can still tie. A payout that depends on input order would
   * pay different wallets on a retry of the same close, so the last resort is
   * a total order on something every candidate has.
   */
  it('is stable when every tie-break ties', () => {
    const one = rider(WALLET_B, 900, { runId: 'run-b' });
    const two = rider(WALLET_A, 900, { runId: 'run-a' });
    const forwards = allocateBlitzPrizes({ poolLuna: 10_000, candidates: [one, two] });
    const backwards = allocateBlitzPrizes({ poolLuna: 10_000, candidates: [two, one] });
    expect(forwards.allocations).toEqual(backwards.allocations);
  });

  /*
   * The daily engine already counts a wallet once however many times it
   * qualified. A rider who posts the two best runs of the day takes first, and
   * second belongs to the next rider, not to the same wallet again.
   */
  it('gives one wallet one place, however many runs it posted', () => {
    const result = allocateBlitzPrizes({
      poolLuna: 10_000,
      candidates: [rider(WALLET_A, 900), rider(WALLET_A, 850), rider(WALLET_B, 800)],
    });
    expect(result.allocations.map((entry) => entry.walletAddress)).toEqual([WALLET_A, WALLET_B]);
    expect(result.allocations[0]!.luna).toBe(5_000);
    expect(result.remainderLuna).toBe(2_000);
  });

  it('keeps a wallet at its best run, not its first seen', () => {
    const result = allocateBlitzPrizes({
      poolLuna: 10_000,
      candidates: [rider(WALLET_A, 100, { runId: 'weak' }), rider(WALLET_A, 900, { runId: 'strong' })],
    });
    expect(result.allocations).toHaveLength(1);
    expect(result.allocations[0]!.runId).toBe('strong');
  });

  it('refuses a candidate with no wallet to pay', () => {
    expect(() => allocateBlitzPrizes({ poolLuna: 10_000, candidates: [rider('', 900)] })).toThrow(/wallet/i);
  });

  it('refuses a score that is not a real number', () => {
    for (const score of [Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => allocateBlitzPrizes({ poolLuna: 10_000, candidates: [rider(WALLET_A, score)] })).toThrow(/score/i);
    }
  });

  /*
   * Re-running a close must produce the same answer. The payout worker is
   * idempotent by key, and this is the other half of that promise: the same
   * inputs decide the same winners, so a replayed close cannot pay a second
   * set of people.
   */
  it('decides the same winners every time it is asked', () => {
    const candidates = [rider(WALLET_D, 850), rider(WALLET_A, 900), rider(WALLET_C, 700), rider(WALLET_B, 850)];
    const first = allocateBlitzPrizes({ poolLuna: 3_338, candidates });
    for (let attempt = 0; attempt < 24; attempt += 1) {
      expect(allocateBlitzPrizes({ poolLuna: 3_338, candidates: [...candidates].reverse() })).toEqual(first);
    }
  });
});

/*
 * Turning a closed day into payout obligations.
 *
 * The treasury ledger already refuses a duplicate id, reconciles against
 * authoritative chain evidence and persists across restarts. What did not
 * exist is the step before it: deciding which rows a closed day becomes, with
 * ids stable enough that closing twice cannot pay twice.
 *
 * This is the durable-intent half of the money path. It writes nothing and
 * moves nothing; it decides what the day owes and what each obligation is
 * called.
 */
describe('what a closed day owes', () => {
  const CHALLENGE = 'cycle-2:lagos:2026-09-15:rush-missions-v5-rookie';
  const table = (poolLuna: number | null, wallets: readonly string[]) => allocateBlitzPrizes({
    poolLuna,
    candidates: wallets.map((wallet, index) => rider(wallet, 900 - index * 10)),
  });

  it('becomes one obligation per place that was actually won', () => {
    const plan = planBlitzPayouts({ challengeId: CHALLENGE, allocations: table(10_000, [WALLET_A, WALLET_B, WALLET_C]).allocations });
    expect(plan.map((entry) => entry.rank)).toEqual([1, 2, 3]);
    expect(plan.map((entry) => entry.amountLuna)).toEqual([5_000, 3_000, 2_000]);
    // The period is derived from the challenge rather than being it: the ledger
    // stores no colons, so the raw challenge id could never be written.
    expect(new Set(plan.map((entry) => entry.period)).size).toBe(1);
    expect(plan[0]!.period).toMatch(/^blitz-/);
  });

  /*
   * The property the whole thing rests on. The ledger refuses a duplicate id,
   * so an id that is stable across closes is what makes closing twice safe.
   */
  it('names every obligation the same way every time it is planned', () => {
    const allocations = table(10_000, [WALLET_A, WALLET_B, WALLET_C]).allocations;
    const first = planBlitzPayouts({ challengeId: CHALLENGE, allocations });
    const second = planBlitzPayouts({ challengeId: CHALLENGE, allocations });
    expect(second).toEqual(first);
    expect(new Set(first.map((entry) => entry.id)).size).toBe(first.length);
  });

  it('keys an obligation to the place, so a day cannot pay a place twice', () => {
    const plan = planBlitzPayouts({ challengeId: CHALLENGE, allocations: table(10_000, [WALLET_A, WALLET_B, WALLET_C]).allocations });
    expect(plan.map((entry) => entry.rank)).toEqual([1, 2, 3]);
    expect(new Set(plan.map((entry) => entry.id)).size).toBe(3);
    expect(plan.every((entry) => entry.id.endsWith('-1') || entry.id.endsWith('-2') || entry.id.endsWith('-3'))).toBe(true);
  });

  /*
   * The ledger in server/atlas/payouts.ts validates both id and period against
   * /^[a-z0-9-]{1,80}$/ - no colons, 80 characters. Challenge ids are
   * colon-separated and long, so an obligation named after one directly is
   * refused at the moment it is written, which is the worst possible moment.
   */
  it('names obligations the treasury ledger will actually accept', () => {
    const ledgerId = /^[a-z0-9-]{1,80}$/;
    const plan = planBlitzPayouts({ challengeId: CHALLENGE, allocations: table(10_000, [WALLET_A, WALLET_B, WALLET_C]).allocations });
    for (const entry of plan) {
      expect(entry.id, `id ${entry.id} would be refused`).toMatch(ledgerId);
      expect(entry.period, `period ${entry.period} would be refused`).toMatch(ledgerId);
    }
  });

  /*
   * Slugging colons to dashes is only safe if it cannot collapse two different
   * challenges onto one name. A season literally called "cycle-2-lagos" must
   * not produce the same obligation as season "cycle-2" in city "lagos".
   */
  it('cannot collapse two different challenges onto one obligation', () => {
    const allocations = table(10_000, [WALLET_A]).allocations;
    const separate = planBlitzPayouts({ challengeId: 'cycle-2:lagos:2026-09-15', allocations })[0]!;
    const collided = planBlitzPayouts({ challengeId: 'cycle-2-lagos:2026-09-15', allocations })[0]!;
    expect(separate.id).not.toBe(collided.id);
    expect(separate.period).not.toBe(collided.period);
  });

  it('refuses rather than emitting a name the ledger would reject', () => {
    const allocations = table(10_000, [WALLET_A]).allocations;
    // Long enough that any encoding of it exceeds the ledger's 80 characters.
    expect(() => planBlitzPayouts({ challengeId: `cycle-2:lagos:2026-09-15:${'v'.repeat(90)}`, allocations })).toThrow(/challenge/i);
  });

  /*
   * Two different days must never collide, or the ledger's duplicate refusal
   * would silently swallow the second day's first place.
   */
  it('never reuses an id across days or cities', () => {
    const allocations = table(10_000, [WALLET_A]).allocations;
    const monday = planBlitzPayouts({ challengeId: 'cycle-2:lagos:2026-09-15:v5', allocations });
    const tuesday = planBlitzPayouts({ challengeId: 'cycle-2:lagos:2026-09-16:v5', allocations });
    const london = planBlitzPayouts({ challengeId: 'cycle-2:london:2026-09-15:v5', allocations });
    expect(new Set([monday[0]!.id, tuesday[0]!.id, london[0]!.id]).size).toBe(3);
  });

  it('owes nothing when no pool was funded', () => {
    expect(planBlitzPayouts({ challengeId: CHALLENGE, allocations: table(null, [WALLET_A]).allocations })).toEqual([]);
    expect(planBlitzPayouts({ challengeId: CHALLENGE, allocations: table(0, [WALLET_A]).allocations })).toEqual([]);
  });

  it('owes nothing when nobody rode', () => {
    expect(planBlitzPayouts({ challengeId: CHALLENGE, allocations: table(10_000, []).allocations })).toEqual([]);
  });

  /*
   * A zero share is not an obligation. Flooring a tiny pool can produce one,
   * and sending a transfer of nothing costs a fee to prove nothing.
   */
  it('does not raise an obligation for a share that rounds to nothing', () => {
    const plan = planBlitzPayouts({ challengeId: CHALLENGE, allocations: table(3, [WALLET_A, WALLET_B, WALLET_C]).allocations });
    expect(plan.every((entry) => entry.amountLuna > 0)).toBe(true);
  });

  it('refuses a challenge id it cannot safely name an obligation after', () => {
    const allocations = table(10_000, [WALLET_A]).allocations;
    for (const challengeId of ['', ' ', 'has space', 'a'.repeat(200)]) {
      expect(() => planBlitzPayouts({ challengeId, allocations })).toThrow(/challenge/i);
    }
  });
});

/*
 * A day with one rider on it does not pay.
 *
 * The board's claim is that a place was taken from somebody. A single entrant
 * beating nobody is not that, and a pool that pays them anyway is a withdrawal
 * dressed as a prize - so the whole pot stays in the remainder and rolls into
 * a day that has a race in it.
 */
describe('a prize needs a field', () => {
  const rider = (walletAddress: string, score: number) => ({
    walletAddress, score, elapsedMs: 88_000, collisions: 0, verifiedAt: 1_000, runId: `run-${walletAddress}`,
  });

  const split = (candidates: BlitzPrizeCandidate[]) => allocateBlitzPrizes({ poolLuna: 100_000, candidates });
  const field = (candidates: BlitzPrizeCandidate[]) => new Set(candidates.map((c) => c.walletAddress)).size;
  const settle = (candidates: BlitzPrizeCandidate[]) =>
    withMinimumField(split(candidates), { poolLuna: 100_000, riders: field(candidates) });

  it('pays nothing to a field of one and keeps the whole pot named', () => {
    const result = settle([rider('NQ01', 9_000)]);
    expect(result.allocations).toEqual([]);
    expect(result.remainderLuna).toBe(100_000);
  });

  it('pays as soon as a second rider makes it a race', () => {
    const result = settle([rider('NQ01', 9_000), rider('NQ02', 8_000)]);
    expect(result.allocations.map((a) => a.walletAddress)).toEqual(['NQ01', 'NQ02']);
    expect(result.allocations[0]!.luna).toBeGreaterThan(result.allocations[1]!.luna);
  });

  it('counts wallets, not runs, so one rider cannot make their own field', () => {
    const twice = [rider('NQ01', 9_000), { ...rider('NQ01', 8_000), runId: 'run-second' }];
    expect(settle(twice).allocations).toEqual([]);
    expect(settle(twice).remainderLuna).toBe(100_000);
  });

  it('leaves the split itself alone, which still has a right answer for one', () => {
    // The arithmetic and the policy are deliberately separable: a field of one
    // still has a first place, it just does not get paid today.
    expect(split([rider('NQ01', 9_000)]).allocations).toHaveLength(1);
  });
});
