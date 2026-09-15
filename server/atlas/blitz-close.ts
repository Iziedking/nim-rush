import type { BlitzPayoutPlanEntry } from '../../shared/atlas/blitz/prize';
import type { AtlasPayoutService } from './payouts';

/*
 * Writing a closed day's obligations into the treasury ledger.
 *
 * This is the only place where a decided day becomes durable intent. It
 * deliberately stops at `draft`: approving and submitting a transfer stays a
 * supervised human action, as the rest of the treasury design already has it.
 * Nothing here moves value.
 *
 * The ledger's duplicate-id refusal is what makes a second close safe, and it
 * only means anything because the ledger persists. See the note in
 * `payouts.ts` - a bare in-memory map made every settled reward payable again
 * after a restart.
 */

export type BlitzCloseConflictReason = 'wallet_mismatch' | 'amount_mismatch' | 'rejected';

export interface BlitzCloseConflict {
  readonly id: string;
  readonly rank: number;
  readonly reason: BlitzCloseConflictReason;
  readonly detail: string;
}

export interface BlitzCloseResult {
  readonly created: number;
  /** Obligations that already existed and matched. A safe repeat close. */
  readonly alreadyPresent: number;
  readonly conflicts: readonly BlitzCloseConflict[];
}

/**
 * Raise a draft obligation for every place the day owes.
 *
 * Safe to run again. An obligation that already exists and agrees is counted
 * and left alone; one that disagrees is reported and left alone. A disagreeing
 * obligation means something upstream changed a settled result, and the honest
 * response is to refuse and surface it rather than pay either wallet.
 */
export async function closeBlitzDayPayouts(input: {
  readonly payouts: Pick<AtlasPayoutService, 'create' | 'list'>;
  readonly entries: readonly BlitzPayoutPlanEntry[];
}): Promise<BlitzCloseResult> {
  if (input.entries.length === 0) return { created: 0, alreadyPresent: 0, conflicts: [] };

  const existing = new Map((await input.payouts.list()).map((row) => [row.id, row]));
  const conflicts: BlitzCloseConflict[] = [];
  let created = 0;
  let alreadyPresent = 0;

  for (const entry of input.entries) {
    const held = existing.get(entry.id);
    if (held) {
      if (held.walletAddress !== entry.walletAddress) {
        conflicts.push({ id: entry.id, rank: entry.rank, reason: 'wallet_mismatch', detail: `place ${entry.rank} already owes ${held.walletAddress}` });
      } else if (held.amountLuna !== entry.amountLuna) {
        conflicts.push({ id: entry.id, rank: entry.rank, reason: 'amount_mismatch', detail: `place ${entry.rank} already owes ${held.amountLuna} Luna` });
      } else {
        alreadyPresent += 1;
      }
      continue;
    }

    try {
      await input.payouts.create({ id: entry.id, period: entry.period, walletAddress: entry.walletAddress, amountLuna: entry.amountLuna });
      created += 1;
    } catch (error) {
      /*
       * Keep going rather than unwinding. Every obligation already written is
       * a real row the ledger will refuse to duplicate, so a retry picks up
       * exactly where this left off. Rolling back would throw away that
       * protection and make the retry the dangerous path.
       */
      conflicts.push({ id: entry.id, rank: entry.rank, reason: 'rejected', detail: error instanceof Error ? error.message : 'payout was refused' });
    }
  }

  return { created, alreadyPresent, conflicts };
}
