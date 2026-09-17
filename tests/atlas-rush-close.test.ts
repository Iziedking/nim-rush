import { describe, expect, it } from 'vitest';
import { withStateTransactions } from '../server/atlas/persistence';

import { allocateBlitzPrizes, planBlitzPayouts } from '../shared/atlas/blitz/prize';
import { closeBlitzDayPayouts } from '../server/atlas/blitz-close';
import { createAtlasPayoutService } from '../server/atlas/payouts';

/*
 * Closing a funded day into the treasury ledger.
 *
 * Run against the real ledger, not a double: the whole promise is that its
 * duplicate refusal makes a second close safe, and a mock that agrees with my
 * understanding of that refusal would prove nothing.
 *
 * Nothing here approves, submits or pays. A closed day produces draft
 * obligations and stops.
 */
const TREASURY = 'NQ21YC9EFUGGC7LN172X3877CF7AVEJB78EF';
const WALLET_A = 'NQ07ABCDEFGHJKLMNPQRSTUVXY0123456781';
const WALLET_B = 'NQ07ABCDEFGHJKLMNPQRSTUVXY0123456782';
const CHALLENGE = 'cycle-2:lagos:2026-09-15:v5';

function ledger() {
  const store: Record<string, unknown> = {};
  return createAtlasPayoutService({
    network: 'mainalbatross',
    treasuryAddress: TREASURY,
    minConfirmations: 10,
    chain: { observe: async () => null },
    now: () => 1_000,
    stateStore: withStateTransactions({
      load: async <T>(key: string, fallback: T) => (key in store ? (store[key] as T) : fallback),
      save: async <T>(key: string, value: T) => { store[key] = value; },
    }),
  });
}

function plan(poolLuna: number | null, wallets: readonly string[]) {
  const { allocations } = allocateBlitzPrizes({
    poolLuna,
    candidates: wallets.map((walletAddress, index) => ({
      walletAddress, score: 900 - index * 10, elapsedMs: 60_000, collisions: 0, verifiedAt: 1_000, runId: `run-${index}`,
    })),
  });
  return planBlitzPayouts({ challengeId: CHALLENGE, allocations });
}

describe('closing a day into the ledger', () => {
  it('raises one draft obligation per place, and pays nothing', async () => {
    const payouts = ledger();
    const result = await closeBlitzDayPayouts({ payouts, entries: plan(10_000, [WALLET_A, WALLET_B]) });
    expect(result).toMatchObject({ created: 2, alreadyPresent: 0, conflicts: [] });
    const rows = await payouts.list();
    expect(rows.map((row) => row.amountLuna)).toEqual([5_000, 3_000]);
    // Draft, never approved or submitted. Releasing money stays a human act.
    expect(rows.every((row) => row.status === 'draft')).toBe(true);
    expect(rows.every((row) => row.transactionHash === null)).toBe(true);
  });

  /*
   * The promise the whole design rests on. A close that runs twice - a retry,
   * a redeploy, an operator pressing it again - must not owe anybody twice.
   */
  it('is safe to run again, and creates nothing the second time', async () => {
    const payouts = ledger();
    const entries = plan(10_000, [WALLET_A, WALLET_B]);
    await closeBlitzDayPayouts({ payouts, entries });
    const again = await closeBlitzDayPayouts({ payouts, entries });
    expect(again).toMatchObject({ created: 0, alreadyPresent: 2, conflicts: [] });
    expect(await payouts.list()).toHaveLength(2);
  });

  /*
   * If a re-close names a different wallet or amount for a place that already
   * has an obligation, something upstream changed a settled result. That is an
   * integrity failure, and the honest response is to refuse and say so rather
   * than to pay either party.
   */
  it('refuses when a place already belongs to a different wallet', async () => {
    const payouts = ledger();
    await closeBlitzDayPayouts({ payouts, entries: plan(10_000, [WALLET_A, WALLET_B]) });
    const rewritten = await closeBlitzDayPayouts({ payouts, entries: plan(10_000, [WALLET_B, WALLET_A]) });
    expect(rewritten.created).toBe(0);
    expect(rewritten.conflicts).toHaveLength(2);
    expect(rewritten.conflicts[0]).toMatchObject({ reason: 'wallet_mismatch' });
    // The original obligations are untouched.
    const rows = await payouts.list();
    expect(rows.find((row) => row.amountLuna === 5_000)!.walletAddress).toBe(WALLET_A);
  });

  it('refuses when a place already owes a different amount', async () => {
    const payouts = ledger();
    await closeBlitzDayPayouts({ payouts, entries: plan(10_000, [WALLET_A]) });
    const refunded = await closeBlitzDayPayouts({ payouts, entries: plan(20_000, [WALLET_A]) });
    expect(refunded.conflicts[0]).toMatchObject({ reason: 'amount_mismatch' });
    expect((await payouts.list())[0]!.amountLuna).toBe(5_000);
  });

  it('owes nothing for an unfunded or unridden day', async () => {
    const payouts = ledger();
    expect(await closeBlitzDayPayouts({ payouts, entries: plan(null, [WALLET_A]) })).toMatchObject({ created: 0 });
    expect(await closeBlitzDayPayouts({ payouts, entries: plan(10_000, []) })).toMatchObject({ created: 0 });
    expect(await payouts.list()).toEqual([]);
  });

  /*
   * A close that dies halfway must not lose what it already wrote, or the
   * retry would raise the survivors a second time.
   */
  it('keeps what it already created when a later obligation fails', async () => {
    const payouts = ledger();
    const entries = plan(10_000, [WALLET_A, WALLET_B]);
    const broken = [entries[0]!, { ...entries[1]!, amountLuna: -1 }];
    const result = await closeBlitzDayPayouts({ payouts, entries: broken });
    expect(result.created).toBe(1);
    expect(result.conflicts[0]).toMatchObject({ reason: 'rejected' });
    expect(await payouts.list()).toHaveLength(1);
  });
});
