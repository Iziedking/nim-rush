import { describe, expect, it } from 'vitest';
import { withStateTransactions } from '../server/atlas/persistence';

import { BLITZ_DAY_MS, getBlitzDailyChallenge } from '../shared/atlas/blitz/daily';
import { runBlitzDailyClose } from '../server/atlas/blitz-daily-close';
import { createAtlasPayoutService } from '../server/atlas/payouts';
import type { BlitzPrizeTable } from '../server/atlas/blitz';
import type { BlitzCityId } from '../shared/atlas/blitz/types';

/*
 * The scheduled close.
 *
 * It creates draft obligations and nothing else: approving and submitting a
 * transfer stay human actions, so a worker running unattended can never move
 * value. What it must get right is *when* a day is allowed to become a debt.
 */
const TREASURY = 'NQ21YC9EFUGGC7LN172X3877CF7AVEJB78EF';
const WALLET_A = 'NQ07ABCDEFGHJKLMNPQRSTUVXY0123456781';
const WALLET_B = 'NQ07ABCDEFGHJKLMNPQRSTUVXY0123456782';
const SEASON = 'cycle-2';
const NOON = Date.parse('2026-09-15T12:00:00.000Z');

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

/* A board that answers for whichever challenge it is asked about. */
function board(options: { poolLuna?: number | null; wallets?: readonly string[]; state?: BlitzPrizeTable['state'] } = {}) {
  const wallets = options.wallets ?? [WALLET_A, WALLET_B];
  const poolLuna = options.poolLuna === undefined ? 10_000 : options.poolLuna;
  const asked: string[] = [];
  const shares = [5_000, 3_000, 2_000];
  return {
    asked,
    prizeTable: async (_seasonId: string, _cityId: BlitzCityId, challengeId?: string): Promise<BlitzPrizeTable> => {
      asked.push(challengeId ?? 'none');
      const state = options.state ?? (poolLuna !== null && poolLuna > 0 ? 'funded' : 'unfunded');
      return {
        state,
        poolLuna,
        splitBps: shares,
        allocations: state === 'funded'
          ? wallets.slice(0, 3).map((walletAddress, index) => ({ rank: index + 1, walletAddress, luna: shares[index]!, runId: `run-${index}` }))
          : [],
        remainderLuna: 0,
        qualifiedRiders: wallets.length,
      };
    },
  };
}

describe('the scheduled daily close', () => {
  /*
   * The rule the money depends on. A day still running can still receive a
   * better run, so closing it would owe the wrong riders, and the ledger would
   * then refuse to correct itself.
   */
  it('never closes a day that is still open', async () => {
    const payouts = ledger();
    const report = await runBlitzDailyClose({ now: NOON, seasonId: SEASON, cities: ['lagos'], lookbackDays: 0, blitz: board(), payouts });
    expect(report.closed).toEqual([]);
    expect(report.skipped[0]).toMatchObject({ reason: 'still_open' });
    expect(await payouts.list()).toEqual([]);
  });

  it('closes yesterday once the day has ended', async () => {
    const payouts = ledger();
    const report = await runBlitzDailyClose({ now: NOON, seasonId: SEASON, cities: ['lagos'], lookbackDays: 1, blitz: board(), payouts });
    expect(report.closed).toHaveLength(1);
    expect(report.closed[0]).toMatchObject({ created: 2 });
    const rows = await payouts.list();
    expect(rows.map((row) => row.amountLuna)).toEqual([5_000, 3_000]);
    expect(rows.every((row) => row.status === 'draft')).toBe(true);
  });

  it('asks about the day it is closing, not about today', async () => {
    const blitz = board();
    await runBlitzDailyClose({ now: NOON, seasonId: SEASON, cities: ['lagos'], lookbackDays: 1, blitz, payouts: ledger() });
    const yesterday = getBlitzDailyChallenge({ now: NOON - BLITZ_DAY_MS, cityId: 'lagos', seasonId: SEASON });
    const today = getBlitzDailyChallenge({ now: NOON, cityId: 'lagos', seasonId: SEASON });
    expect(blitz.asked).toContain(yesterday.challengeId);
    expect(blitz.asked).not.toContain(today.challengeId);
  });

  /*
   * A worker runs on a timer, so it runs again. Every repeat must be a no-op,
   * which is the ledger's duplicate refusal doing its job through the close.
   */
  it('owes nobody twice however often it runs', async () => {
    const payouts = ledger();
    for (let run = 0; run < 5; run += 1) {
      await runBlitzDailyClose({ now: NOON, seasonId: SEASON, cities: ['lagos'], lookbackDays: 1, blitz: board(), payouts });
    }
    expect(await payouts.list()).toHaveLength(2);
  });

  it('catches up days it missed, within the lookback', async () => {
    const payouts = ledger();
    const report = await runBlitzDailyClose({ now: NOON, seasonId: SEASON, cities: ['lagos'], lookbackDays: 3, blitz: board(), payouts });
    expect(report.closed).toHaveLength(3);
    expect(await payouts.list()).toHaveLength(6);
  });

  it('does not reach back further than it was told to', async () => {
    const payouts = ledger();
    const report = await runBlitzDailyClose({ now: NOON, seasonId: SEASON, cities: ['lagos'], lookbackDays: 1, blitz: board(), payouts });
    expect(report.closed).toHaveLength(1);
  });

  it('owes nothing for an unfunded day', async () => {
    const payouts = ledger();
    const report = await runBlitzDailyClose({ now: NOON, seasonId: SEASON, cities: ['lagos'], lookbackDays: 1, blitz: board({ poolLuna: 0 }), payouts });
    expect(report.closed).toEqual([]);
    expect(report.skipped.some((entry) => entry.reason === 'unfunded')).toBe(true);
    expect(await payouts.list()).toEqual([]);
  });

  /*
   * A pool the server could not read is an unknown. Closing on an unknown
   * would either invent a debt or wrongly record that a day owed nothing.
   */
  it('refuses to close on a pool it could not read', async () => {
    const payouts = ledger();
    const report = await runBlitzDailyClose({ now: NOON, seasonId: SEASON, cities: ['lagos'], lookbackDays: 1, blitz: board({ state: 'unavailable', poolLuna: null }), payouts });
    expect(report.closed).toEqual([]);
    expect(report.skipped.some((entry) => entry.reason === 'pool_unavailable')).toBe(true);
  });

  it('owes nothing for a day nobody rode', async () => {
    const payouts = ledger();
    const report = await runBlitzDailyClose({ now: NOON, seasonId: SEASON, cities: ['lagos'], lookbackDays: 1, blitz: board({ wallets: [] }), payouts });
    expect(report.skipped.some((entry) => entry.reason === 'no_riders')).toBe(true);
    expect(await payouts.list()).toEqual([]);
  });

  /*
   * The pool is read live, so a treasury top-up between two ticks would make a
   * re-close compute larger prizes than the day was settled at. Nobody is paid
   * twice either way - the ledger refuses that - but recomputing would report
   * amount_mismatch forever and look like an integrity failure when it is only
   * drift. The first close is authoritative; later runs verify.
   */
  it('does not re-price a day after the treasury moves', async () => {
    const payouts = ledger();
    await runBlitzDailyClose({ now: NOON, seasonId: SEASON, cities: ['lagos'], lookbackDays: 1, blitz: board({ poolLuna: 10_000 }), payouts });
    const afterTopUp = await runBlitzDailyClose({ now: NOON, seasonId: SEASON, cities: ['lagos'], lookbackDays: 1, blitz: board({ poolLuna: 40_000 }), payouts });

    expect(afterTopUp.closed).toEqual([]);
    expect(afterTopUp.skipped.some((entry) => entry.reason === 'already_closed')).toBe(true);
    // Settled at the original figures, and no false conflict raised.
    expect((await payouts.list()).map((row) => row.amountLuna)).toEqual([5_000, 3_000]);
  });

  it('does not ask the board about a day it has already settled', async () => {
    const payouts = ledger();
    await runBlitzDailyClose({ now: NOON, seasonId: SEASON, cities: ['lagos'], lookbackDays: 1, blitz: board(), payouts });
    const second = board();
    await runBlitzDailyClose({ now: NOON, seasonId: SEASON, cities: ['lagos'], lookbackDays: 1, blitz: second, payouts });
    expect(second.asked).toEqual([]);
  });

  /*
   * A close that only half succeeded must stay visible. Skipping it silently
   * would leave a rider owed nothing with nothing to show that.
   */
  it('reports how much a partially settled day actually owes', async () => {
    const payouts = ledger();
    await runBlitzDailyClose({ now: NOON, seasonId: SEASON, cities: ['lagos'], lookbackDays: 1, blitz: board({ wallets: [WALLET_A] }), payouts });
    const later = await runBlitzDailyClose({ now: NOON, seasonId: SEASON, cities: ['lagos'], lookbackDays: 1, blitz: board(), payouts });
    const settled = later.skipped.find((entry) => entry.reason === 'already_closed');
    expect(settled?.detail).toContain('1');
  });

  it('keeps closing the other cities when one board is unreachable', async () => {
    const payouts = ledger();
    const healthy = board();
    const failing = {
      prizeTable: async (seasonId: string, cityId: BlitzCityId, challengeId?: string): Promise<BlitzPrizeTable> => {
        if (cityId === 'lagos') throw new Error('board unreachable');
        return healthy.prizeTable(seasonId, cityId, challengeId);
      },
    };
    const report = await runBlitzDailyClose({ now: NOON, seasonId: SEASON, cities: ['lagos', 'london'], lookbackDays: 1, blitz: failing, payouts });
    expect(report.skipped.some((entry) => entry.reason === 'board_unavailable')).toBe(true);
    expect(report.closed).toHaveLength(1);
  });
});
