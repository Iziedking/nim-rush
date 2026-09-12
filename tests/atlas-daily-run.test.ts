import { describe, expect, it } from 'vitest';
import { createAtlasDailyService, type AtlasDailyPaymentExpectation } from '../server/atlas/daily';
import { ATLAS_DAILY_CHALLENGES } from '../shared/atlas/daily';

const WALLET = 'NQ07ABCDEFGHJKLMNPQRSTUVXY0123456789';
const OTHER_WALLET = 'NQ07ABCDEFGHJKLMNPQRSTUVXY0123456788';
const DATE = '2026-09-12';

/** Production's shape: a real recipient at 10,000 Luna, not the fixture. */
const EXPECTATION: AtlasDailyPaymentExpectation = {
  network: 'testalbatross',
  recipient: WALLET,
  valueLuna: 10_000,
  minimumConfirmations: 3,
};

const paymentChallenge = ATLAS_DAILY_CHALLENGES.find((challenge) => challenge.guard === 'payment')!;
const plainChallenge = ATLAS_DAILY_CHALLENGES.find((challenge) => challenge.guard === 'none')!;

function service(overrides: Partial<Parameters<typeof createAtlasDailyService>[0]> = {}) {
  return createAtlasDailyService({ date: () => DATE, now: () => Date.parse(`${DATE}T12:00:00Z`), expectation: EXPECTATION, ...overrides });
}

function goodPayment() {
  return { network: 'testalbatross', recipient: WALLET, valueLuna: 10_000, canonical: true, success: true, confirmations: 5 };
}

function submission(extra: Record<string, unknown> = {}) {
  return {
    actorId: 'atlas-session-aaa',
    walletAddress: WALLET,
    challengeId: paymentChallenge.id,
    answer: paymentChallenge.answer,
    replayComplete: true,
    assistance: 'none' as const,
    payment: goodPayment(),
    ...extra,
  };
}

describe('the daily run', () => {
  /*
   * The engine shipped comparing against the fixture address
   * NQATLASLANTERNSHOP at 100,000 Luna, while production runs a real recipient
   * at 10,000. It would therefore have refused every genuine payment and
   * accepted only a fixture production cannot produce. The expectation now
   * comes from the server's own payment config, and this is the test that says
   * so in both directions.
   */
  it('refuses the old fixture payment and accepts the configured one', async () => {
    const daily = service();
    const fixture = await daily.submit(submission({
      payment: { network: 'testalbatross', recipient: 'NQATLASLANTERNSHOP', valueLuna: 100_000, canonical: true, success: true, confirmations: 5 },
    }));
    expect(fixture).toMatchObject({ accepted: false, reason: 'payment_mismatch' });
    expect(await daily.submit(submission())).toMatchObject({ accepted: true, eligible: true });
  });

  it('treats a hash with nothing verified beside it as unverified, not as proof', async () => {
    const daily = service();
    const result = await daily.submit(submission({ payment: { txHash: '0xabc123', network: 'testalbatross' } }));
    expect(result).toMatchObject({ accepted: false, reason: 'payment_unverified' });
  });

  it('refuses a payment that is real but not yet confirmed enough', async () => {
    const daily = service();
    const result = await daily.submit(submission({ payment: { ...goodPayment(), confirmations: 2 } }));
    expect(result).toMatchObject({ accepted: false, reason: 'payment_unverified' });
  });

  it('refuses a non-canonical payment even when it says success', async () => {
    const daily = service();
    expect(await daily.submit(submission({ payment: { ...goodPayment(), canonical: false } }))).toMatchObject({ reason: 'payment_unverified' });
  });

  it('counts a wallet once however many times it submits', async () => {
    const daily = service();
    // toMatchObject treats an undefined value as "any", so the absence of the
    // flag is asserted directly rather than through a matcher that passes on
    // a duplicate too.
    expect((await daily.submit(submission())).duplicate).toBeUndefined();
    expect(await daily.submit(submission())).toMatchObject({ duplicate: true, eligible: true });
    expect((await daily.standing()).eligibleCount).toBe(1);
  });

  it('counts one wallet once even when two actors drive it', async () => {
    // Otherwise one funded wallet farms a share per browser profile.
    const daily = service();
    await daily.submit(submission());
    await daily.submit(submission({ actorId: 'atlas-session-bbb' }));
    expect((await daily.standing()).eligibleCount).toBe(1);
  });

  describe('what it says about rewards', () => {
    it('never advertises a share when no treasury is funded', async () => {
      const daily = service();
      await daily.submit(submission());
      const standing = await daily.standing();
      expect(standing).toMatchObject({ rewardsEnabled: false, poolLuna: null, shareLuna: null });
      expect(await daily.pendingObligation({ actorId: 'atlas-session-aaa', walletAddress: WALLET, challengeId: paymentChallenge.id }))
        .toMatchObject({ status: 'pending-close', amountLuna: null });
    });

    it('splits the pot in integer Luna, and never over-commits it', async () => {
      const daily = service({ dailyPoolLuna: 100_001 });
      await daily.submit(submission());
      await daily.submit(submission({ actorId: 'atlas-session-bbb', walletAddress: OTHER_WALLET, payment: { ...goodPayment(), recipient: WALLET } }));
      const standing = await daily.standing();
      expect(standing.eligibleCount).toBe(2);
      // Floored, so two shares are 100,000 against a 100,001 pot. The remainder
      // stays with the treasury rather than being owed to nobody.
      expect(standing.shareLuna).toBe(50_000);
      expect(standing.shareLuna! * standing.eligibleCount).toBeLessThanOrEqual(standing.poolLuna!);
    });
  });

  describe('eligibility survives a restart', () => {
    /*
     * It used to live in a bare Set. A restart made every wallet that had
     * already qualified today able to qualify again, which on a service that
     * owes real NIM at the close of the day is a double payment. Same shape as
     * the treasury bug recorded in payouts.ts.
     */
    it('remembers who already qualified today', async () => {
      const store: Record<string, unknown> = {};
      const stateStore = {
        load: async <T>(key: string, fallback: T) => (key in store ? (store[key] as T) : fallback),
        save: async <T>(key: string, value: T) => { store[key] = value; },
      };
      const first = service({ stateStore });
      await first.submit(submission());
      expect((await first.standing()).eligibleCount).toBe(1);

      const afterRestart = service({ stateStore });
      expect((await afterRestart.standing()).eligibleCount).toBe(1);
      expect(await afterRestart.submit(submission())).toMatchObject({ duplicate: true });
    });
  });

  it('still refuses the obvious cheats', async () => {
    const daily = service();
    expect(await daily.submit(submission({ answer: 'not-the-answer' }))).toMatchObject({ reason: 'wrong_answer' });
    expect(await daily.submit(submission({ assistance: 'answer-reveal' }))).toMatchObject({ reason: 'assistance_used' });
    expect(await daily.submit(submission({ replayComplete: false }))).toMatchObject({ reason: 'replay_incomplete', retryable: true });
    expect(await daily.submit(submission({ walletAddress: undefined }))).toMatchObject({ reason: 'identity_required' });
    expect(await daily.submit(submission({ challengeId: 'daily-99' }))).toMatchObject({ reason: 'unknown_challenge' });
  });

  it('does not demand payment evidence from a challenge that has no payment guard', async () => {
    const daily = service();
    const result = await daily.submit({
      actorId: 'atlas-session-aaa',
      walletAddress: WALLET,
      challengeId: plainChallenge.id,
      answer: plainChallenge.answer,
      replayComplete: true,
      assistance: 'none',
    });
    expect(result).toMatchObject({ accepted: true, eligible: true });
  });

  it('lists the wallets a close would have to pay', async () => {
    const daily = service({ dailyPoolLuna: 60_000 });
    await daily.submit(submission());
    await daily.submit(submission({ actorId: 'atlas-session-bbb', walletAddress: OTHER_WALLET }));
    expect([...(await daily.eligibleWallets())]).toEqual([OTHER_WALLET, WALLET].sort());
  });
});

/*
 * The pot is an intent; the treasury is a fact.
 *
 * Production ran ATLAS_DAILY_POOL_LUNA=10000 against a treasury that held
 * 3,338 Luna, and standing() advertised the full 10,000 because nothing ever
 * asked the chain. Every player would have been shown a share about three
 * times what could be settled — the same "advertising what cannot be paid"
 * failure already fixed once in payouts.ts.
 */
describe('what the treasury can actually pay', () => {
  const balanced = (luna: number | null, calls?: { n: number }) => async () => {
    if (calls) calls.n += 1;
    return luna;
  };

  it('caps the advertised pot at the treasury balance', async () => {
    const daily = service({ dailyPoolLuna: 10_000, treasuryBalanceLuna: balanced(3_338) });
    await daily.submit(submission());
    const standing = await daily.standing();
    expect(standing).toMatchObject({ poolLuna: 3_338, configuredPoolLuna: 10_000, treasuryLuna: 3_338, rewardsEnabled: true });
    expect(standing.shareLuna).toBe(3_338);
  });

  it('splits only what is there when several wallets qualify', async () => {
    const daily = service({ dailyPoolLuna: 10_000, treasuryBalanceLuna: balanced(3_338) });
    await daily.submit(submission());
    await daily.submit(submission({ actorId: 'atlas-session-bbb', walletAddress: OTHER_WALLET }));
    const standing = await daily.standing();
    expect(standing.eligibleCount).toBe(2);
    expect(standing.shareLuna).toBe(1_669);
    expect(standing.shareLuna! * standing.eligibleCount).toBeLessThanOrEqual(standing.treasuryLuna!);
  });

  it('leaves the pot alone when the treasury holds more than it', async () => {
    const daily = service({ dailyPoolLuna: 10_000, treasuryBalanceLuna: balanced(5_000_000) });
    await daily.submit(submission());
    expect(await daily.standing()).toMatchObject({ poolLuna: 10_000, shareLuna: 10_000 });
  });

  it('says rewards are off when the treasury is empty, rather than promising zero', async () => {
    const daily = service({ dailyPoolLuna: 10_000, treasuryBalanceLuna: balanced(0) });
    await daily.submit(submission());
    expect(await daily.standing()).toMatchObject({ poolLuna: 0, shareLuna: 0, rewardsEnabled: false });
  });

  it('quotes the obligation from the payable pot, not the configured one', async () => {
    const daily = service({ dailyPoolLuna: 10_000, treasuryBalanceLuna: balanced(3_338) });
    await daily.submit(submission());
    expect(await daily.pendingObligation({ actorId: 'atlas-session-aaa', walletAddress: WALLET, challengeId: paymentChallenge.id }))
      .toMatchObject({ status: 'pending-close', amountLuna: 3_338 });
  });

  /*
   * An unreadable balance is "unknown", never "empty". Collapsing the pot on a
   * blinking RPC would take the reward away from players who earned it, and
   * the payout path checks funds again before it sends anything.
   */
  it('falls back to the configured pot when the balance cannot be read', async () => {
    const daily = service({ dailyPoolLuna: 10_000, treasuryBalanceLuna: balanced(null) });
    await daily.submit(submission());
    expect(await daily.standing()).toMatchObject({ poolLuna: 10_000, treasuryLuna: null, rewardsEnabled: true });
  });

  it('keeps the last good reading when a later read fails', async () => {
    let answer: number | null = 3_338;
    const daily = service({ dailyPoolLuna: 10_000, balanceCacheMs: 0, treasuryBalanceLuna: async () => answer });
    await daily.submit(submission());
    expect((await daily.standing()).poolLuna).toBe(3_338);
    answer = null;
    expect((await daily.standing()).poolLuna).toBe(3_338);
  });

  it('survives a balance reader that throws', async () => {
    const daily = service({ dailyPoolLuna: 10_000, treasuryBalanceLuna: async () => { throw new Error('rpc down'); } });
    await daily.submit(submission());
    expect((await daily.standing()).poolLuna).toBe(10_000);
  });

  /* standing() is public and polled, so an uncached read would put one RPC
   * call on a shared open node per player per poll. */
  it('caches the balance instead of reading it on every poll', async () => {
    const calls = { n: 0 };
    const daily = service({ dailyPoolLuna: 10_000, treasuryBalanceLuna: balanced(3_338, calls) });
    await daily.standing();
    await daily.standing();
    await daily.standing();
    expect(calls.n).toBe(1);
  });

  it('still reports no rewards when no pot is configured at all', async () => {
    const daily = service({ treasuryBalanceLuna: balanced(5_000_000) });
    await daily.submit(submission());
    expect(await daily.standing()).toMatchObject({ poolLuna: null, configuredPoolLuna: null, rewardsEnabled: false });
  });
});
