import type { AtlasPayoutRecord, AtlasPayoutService } from './payouts';

/*
 * What a rider is owed, in words a rider can act on.
 *
 * The ledger's own statuses are operator vocabulary: draft, approved,
 * submitted, confirming, verified, failed, reorg, unknown. A rider does not
 * need eight states, and collapsing them badly would be worse than showing
 * none: "failed" and "we cannot currently see the chain" mean very different
 * things to somebody waiting for money.
 *
 * Four states, each one a true sentence about where the money is.
 */

export type BlitzRewardState =
  /** Decided and recorded. Nobody has released it yet. */
  | 'owed'
  /** Released and on its way. A hash exists but the chain has not settled it. */
  | 'sending'
  /** Observed on chain from the treasury to this wallet, deeply enough to trust. */
  | 'paid'
  /** Something needs a human. Never shown as owed, never shown as paid. */
  | 'attention';

export interface BlitzRewardReceipt {
  readonly period: string;
  readonly amountLuna: number;
  readonly state: BlitzRewardState;
  /** Present once a transfer exists, so a rider can check it themselves. */
  readonly transactionHash: string | null;
  /** Only ever set alongside `attention`, so a UI cannot imply a problem. */
  readonly attentionReason: string | null;
}

/*
 * Ledger status to rider state. Written as a total map rather than a switch
 * with a default, so a new ledger status is a compile error here instead of
 * silently becoming whatever the fallback happened to be.
 */
const RIDER_STATE: Readonly<Record<AtlasPayoutRecord['status'], BlitzRewardState>> = {
  draft: 'owed',
  approved: 'owed',
  submitted: 'sending',
  confirming: 'sending',
  verified: 'paid',
  failed: 'attention',
  reorg: 'attention',
  unknown: 'attention',
};

/**
 * Every reward this wallet is owed or has been paid.
 *
 * Keyed on the wallet rather than on an account, because the wallet is what the
 * obligation names and what the transfer reaches. The leaderboard already shows
 * wallet addresses beside ranks, so this exposes nothing new about a rider.
 */
export async function blitzRewardsForWallet(input: {
  readonly payouts: Pick<AtlasPayoutService, 'list'>;
  readonly walletAddress: string;
}): Promise<readonly BlitzRewardReceipt[]> {
  const wanted = normalise(input.walletAddress);
  if (!wanted) return [];
  const rows = await input.payouts.list();
  return rows
    .filter((row) => row.period.startsWith('blitz-') && normalise(row.walletAddress) === wanted)
    .map((row) => ({
      period: row.period,
      amountLuna: row.amountLuna,
      state: RIDER_STATE[row.status],
      transactionHash: row.transactionHash,
      attentionReason: RIDER_STATE[row.status] === 'attention' ? row.refusalReason : null,
    }))
    // Newest first: the reward a rider just earned is the one they came to see.
    .sort((left, right) => (left.period < right.period ? 1 : left.period > right.period ? -1 : 0));
}

/*
 * Nimiq shows an address in spaced groups, and a rider may paste it either way.
 * Matching on the raw string would silently owe somebody nothing.
 */
function normalise(address: string): string {
  return typeof address === 'string' ? address.replace(/\s/g, '').toUpperCase() : '';
}
