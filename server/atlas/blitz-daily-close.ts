import { BLITZ_DAY_MS, getBlitzDailyChallenge } from '../../shared/atlas/blitz/daily';
import { blitzPayoutPeriod, planBlitzPayouts } from '../../shared/atlas/blitz/prize';
import type { BlitzCityId } from '../../shared/atlas/blitz/types';
import type { BlitzPrizeTable } from './blitz';
import { closeBlitzDayPayouts } from './blitz-close';
import type { AtlasPayoutService } from './payouts';

/*
 * The scheduled close.
 *
 * Runs unattended on a timer and creates draft obligations only. Approving and
 * submitting a transfer stay supervised human actions, which is what makes an
 * unattended worker safe to have at all: the worst it can do is decide a day
 * owes somebody, and a person still has to release it.
 *
 * Every rule here exists to stop a day becoming a debt too early or twice.
 */

export type BlitzDailySkipReason =
  | 'still_open'
  | 'unfunded'
  | 'pool_unavailable'
  | 'no_riders'
  | 'already_closed'
  | 'board_unavailable'
  | 'plan_refused';

export interface BlitzDailyCloseEntry {
  readonly challengeId: string;
  readonly cityId: BlitzCityId;
  readonly created: number;
  readonly alreadyPresent: number;
  readonly conflicts: number;
}

export interface BlitzDailySkipEntry {
  readonly challengeId: string;
  readonly cityId: BlitzCityId;
  readonly reason: BlitzDailySkipReason;
  readonly detail?: string;
}

export interface BlitzDailyCloseReport {
  readonly closed: readonly BlitzDailyCloseEntry[];
  readonly skipped: readonly BlitzDailySkipEntry[];
}

/**
 * How many finished days a single run will reach back over.
 *
 * Small on purpose. A catch-up window exists so a worker that missed a tick
 * still settles yesterday, but the prize table reads the pool as it stands
 * *now* rather than as it stood at the close, so every extra day of reach is
 * another day of drift between what a board was worth and what it pays. See
 * the note on `poolLuna` below.
 */
const DEFAULT_LOOKBACK_DAYS = 2;

export async function runBlitzDailyClose(input: {
  readonly now: number;
  readonly seasonId: string;
  readonly cities: readonly BlitzCityId[];
  readonly lookbackDays?: number;
  readonly blitz: { prizeTable(seasonId: string, cityId: BlitzCityId, challengeId?: string): Promise<BlitzPrizeTable> };
  readonly payouts: Pick<AtlasPayoutService, 'create' | 'list'>;
}): Promise<BlitzDailyCloseReport> {
  const lookbackDays = input.lookbackDays ?? DEFAULT_LOOKBACK_DAYS;
  if (!Number.isSafeInteger(lookbackDays) || lookbackDays < 0) {
    throw new Error('Beacon Blitz daily close lookback must be a whole, non-negative number of days.');
  }

  const closed: BlitzDailyCloseEntry[] = [];
  const skipped: BlitzDailySkipEntry[] = [];

  /*
   * How many obligations each day already has.
   *
   * Read once, before any board is consulted. The pool is read live, so
   * recomputing a day that has already settled would price it at today's
   * treasury balance rather than the balance it was settled at, and every
   * later run would report amount_mismatch forever. Nobody would be paid twice
   * - the ledger refuses that - but a permanent false integrity alarm is its
   * own kind of lie. The first close is authoritative; later runs verify.
   */
  const settledPerPeriod = new Map<string, number>();
  for (const row of await input.payouts.list()) {
    settledPerPeriod.set(row.period, (settledPerPeriod.get(row.period) ?? 0) + 1);
  }

  for (const cityId of input.cities) {
    // Day 0 is today, which is still running. Start at 0 anyway so that an
    // explicit lookback of 0 still reports why nothing was closed rather than
    // silently doing nothing.
    for (let daysAgo = 0; daysAgo <= lookbackDays; daysAgo += 1) {
      const challenge = getBlitzDailyChallenge({ now: input.now - daysAgo * BLITZ_DAY_MS, cityId, seasonId: input.seasonId });

      /*
       * A day still running can still receive a better run. Closing it would
       * owe the wrong riders, and because the obligation id is keyed on the
       * place, the ledger would then refuse to correct itself.
       */
      if (input.now < challenge.expiresAt) {
        skipped.push({ challengeId: challenge.challengeId, cityId, reason: 'still_open' });
        continue;
      }

      const alreadySettled = settledPerPeriod.get(blitzPayoutPeriod(challenge.challengeId)) ?? 0;
      if (alreadySettled > 0) {
        /*
         * Reported with its count rather than skipped silently, so a close that
         * only half succeeded stays visible to an operator instead of looking
         * identical to a complete one.
         */
        skipped.push({ challengeId: challenge.challengeId, cityId, reason: 'already_closed', detail: `${alreadySettled} obligation(s) already raised` });
        continue;
      }

      let table: BlitzPrizeTable;
      try {
        table = await input.blitz.prizeTable(input.seasonId, cityId, challenge.challengeId);
      } catch (error) {
        // One unreachable board must not stop the others from settling.
        skipped.push({ challengeId: challenge.challengeId, cityId, reason: 'board_unavailable', detail: error instanceof Error ? error.message : 'board could not be read' });
        continue;
      }

      /*
       * `unavailable` is not `unfunded`. Closing on a pool the server could not
       * read would either invent a debt or record that a day owed nothing, and
       * neither is something we know.
       */
      if (table.state === 'unavailable') {
        skipped.push({ challengeId: challenge.challengeId, cityId, reason: 'pool_unavailable' });
        continue;
      }
      if (table.state === 'unfunded') {
        skipped.push({ challengeId: challenge.challengeId, cityId, reason: 'unfunded' });
        continue;
      }
      if (table.allocations.length === 0) {
        skipped.push({ challengeId: challenge.challengeId, cityId, reason: 'no_riders' });
        continue;
      }

      let entries;
      try {
        entries = planBlitzPayouts({ challengeId: challenge.challengeId, allocations: table.allocations });
      } catch (error) {
        skipped.push({ challengeId: challenge.challengeId, cityId, reason: 'plan_refused', detail: error instanceof Error ? error.message : 'obligations could not be named' });
        continue;
      }

      const result = await closeBlitzDayPayouts({ payouts: input.payouts, entries });
      closed.push({ challengeId: challenge.challengeId, cityId, created: result.created, alreadyPresent: result.alreadyPresent, conflicts: result.conflicts.length });
    }
  }

  return { closed, skipped };
}
