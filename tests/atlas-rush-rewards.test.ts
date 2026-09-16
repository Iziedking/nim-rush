import { describe, expect, it } from 'vitest';

import { blitzRewardsForWallet } from '../server/atlas/blitz-rewards';
import type { AtlasPayoutRecord } from '../server/atlas/payouts';

/*
 * What a rider is told about their money.
 *
 * The ledger has eight statuses, which is operator vocabulary. Collapsing them
 * badly would be worse than showing none: "failed" and "we cannot currently see
 * the chain" mean very different things to somebody waiting to be paid.
 */
const WALLET = 'NQ07ABCDEFGHJKLMNPQRSTUVXY0123456781';
const OTHER = 'NQ07ABCDEFGHJKLMNPQRSTUVXY0123456782';

function row(overrides: Partial<AtlasPayoutRecord> = {}): AtlasPayoutRecord {
  return {
    id: 'blitz-cycle--2-lagos-2026-09-15-1',
    period: 'blitz-cycle--2-lagos-2026-09-15',
    walletAddress: WALLET,
    amountLuna: 5_000,
    network: 'mainalbatross',
    treasuryAddress: 'NQ21YC9EFUGGC7LN172X3877CF7AVEJB78EF',
    transactionHash: null,
    status: 'draft',
    refusalReason: null,
    createdAt: 1_000,
    ...overrides,
  };
}

const payouts = (rows: readonly AtlasPayoutRecord[]) => ({ list: async () => [...rows] });

describe('what a rider is owed', () => {
  it('calls a decided but unreleased reward owed', async () => {
    for (const status of ['draft', 'approved'] as const) {
      const [receipt] = await blitzRewardsForWallet({ payouts: payouts([row({ status })]), walletAddress: WALLET });
      expect(receipt).toMatchObject({ state: 'owed', amountLuna: 5_000, attentionReason: null });
    }
  });

  it('calls a released transfer sending, and shows the hash to check', async () => {
    for (const status of ['submitted', 'confirming'] as const) {
      const [receipt] = await blitzRewardsForWallet({ payouts: payouts([row({ status, transactionHash: '0xabc' })]), walletAddress: WALLET });
      expect(receipt).toMatchObject({ state: 'sending', transactionHash: '0xabc' });
    }
  });

  /*
   * Only chain evidence makes something paid. The ledger already refuses to
   * mark verified without the right sender, recipient, amount, canonicality and
   * confirmations, and this must not soften that.
   */
  it('only calls a reward paid once the chain says so', async () => {
    const [receipt] = await blitzRewardsForWallet({ payouts: payouts([row({ status: 'verified', transactionHash: '0xdone' })]), walletAddress: WALLET });
    expect(receipt.state).toBe('paid');
  });

  it('never shows a problem as owed or as paid', async () => {
    for (const status of ['failed', 'reorg', 'unknown'] as const) {
      const [receipt] = await blitzRewardsForWallet({
        payouts: payouts([row({ status, refusalReason: 'chain_evidence_mismatch' })]),
        walletAddress: WALLET,
      });
      expect(receipt.state).toBe('attention');
      expect(receipt.attentionReason).toBe('chain_evidence_mismatch');
    }
  });

  it('gives a reason only when something actually needs attention', async () => {
    const [receipt] = await blitzRewardsForWallet({
      payouts: payouts([row({ status: 'draft', refusalReason: 'left over from an earlier retry' })]),
      walletAddress: WALLET,
    });
    expect(receipt.attentionReason).toBeNull();
  });

  it('shows one rider nothing belonging to another', async () => {
    const receipts = await blitzRewardsForWallet({
      payouts: payouts([row(), row({ id: 'other', walletAddress: OTHER })]),
      walletAddress: WALLET,
    });
    expect(receipts).toHaveLength(1);
    expect(receipts[0]!.amountLuna).toBe(5_000);
  });

  /*
   * Nimiq shows an address in spaced groups and a rider may paste either form.
   * Matching the raw string would silently tell somebody they are owed nothing.
   */
  it('matches a wallet however it was spaced or cased', async () => {
    const receipts = await blitzRewardsForWallet({
      payouts: payouts([row()]),
      walletAddress: 'nq07 abcd efgh jklm npqr stuv xy01 2345 6781',
    });
    expect(receipts).toHaveLength(1);
  });

  it('ignores payouts that are not NIM RUSH rewards', async () => {
    const receipts = await blitzRewardsForWallet({
      payouts: payouts([row({ id: 'season-reward', period: 'atlas-weekly-3' })]),
      walletAddress: WALLET,
    });
    expect(receipts).toEqual([]);
  });

  it('puts the most recent day first', async () => {
    const receipts = await blitzRewardsForWallet({
      payouts: payouts([
        row({ id: 'a', period: 'blitz-cycle--2-lagos-2026-09-14' }),
        row({ id: 'b', period: 'blitz-cycle--2-lagos-2026-09-16' }),
      ]),
      walletAddress: WALLET,
    });
    expect(receipts.map((receipt) => receipt.period)).toEqual([
      'blitz-cycle--2-lagos-2026-09-16',
      'blitz-cycle--2-lagos-2026-09-14',
    ]);
  });

  it('owes nothing to a wallet that was never given one', async () => {
    expect(await blitzRewardsForWallet({ payouts: payouts([row()]), walletAddress: OTHER })).toEqual([]);
    expect(await blitzRewardsForWallet({ payouts: payouts([row()]), walletAddress: '' })).toEqual([]);
  });
});
