import { ATLAS_DAILY_CHALLENGES, type AtlasDailyChallenge } from '../../shared/atlas/daily';
import type { AtlasStateStore } from './persistence';

export type DailySubmitReason = 'identity_required' | 'unknown_challenge' | 'wrong_answer' | 'assistance_used' | 'replay_incomplete' | 'payment_mismatch' | 'payment_unverified' | 'consensus_stale' | 'validator_concentration';

export interface DailySubmitInput {
  actorId?: string;
  walletAddress?: string;
  deviceIdentifier?: string;
  challengeId: string;
  answer: string;
  replayComplete: boolean;
  assistance: 'none' | 'free-hint' | 'purchased-hint' | 'answer-reveal' | 'debug';
  payment?: { txHash?: string; network?: string; recipient?: string; valueLuna?: number; canonical?: boolean; success?: boolean; confirmations?: number };
  consensus?: { established: boolean; observedAt: number };
  validatorDistribution?: { distinctValidators: number; totalValidators: number };
  recovery?: 'wallet-cancelled' | 'offline' | 'retryable-rpc';
}

export interface DailySubmitResult { accepted: boolean; eligible: boolean; duplicate?: boolean; retryable?: boolean; reason?: DailySubmitReason; date: string; }
export interface DailyObligation { status: 'pending-close' | 'not-eligible'; amountLuna: number | null; }

export interface AtlasDailyStanding {
  date: string;
  /** Distinct wallets that qualified today. */
  eligibleCount: number;
  /** What one wallet would receive if the day closed now, in Luna. */
  shareLuna: number | null;
  /**
   * The pot the day can actually pay, in Luna. Null when no treasury is
   * configured. Capped by the treasury's on-chain balance, so it is never a
   * promise the treasury cannot keep.
   */
  poolLuna: number | null;
  /** What the pot is configured to be, before the treasury balance caps it. */
  configuredPoolLuna: number | null;
  /** The treasury's on-chain balance in Luna, or null when it cannot be read. */
  treasuryLuna: number | null;
  /** False when nothing can be paid, so the UI can say so rather than imply a payout. */
  rewardsEnabled: boolean;
}

export interface AtlasDailyService {
  submit(input: DailySubmitInput): Promise<DailySubmitResult>;
  /**
   * Make a wallet eligible for today's pool because the server itself verified
   * something, rather than because a client said so.
   *
   * A Beacon Blitz run is not a daily challenge and must not be pushed through
   * `submit`: it has no answer to check and no guard that fits it. What it
   * does have is something stronger - the server re-simulated the whole run
   * from the player's input trace and got the same score. Eligibility is the
   * consequence of that verification, which is why this takes no claim from
   * the caller beyond who it was.
   */
  qualifyVerifiedRun(input: { actorId: string; walletAddress: string; source: AtlasDailyQualifierSource }): Promise<DailySubmitResult>;
  estimateShare(eligibleCount: number): number | null;
  pendingObligation(input: { actorId: string; walletAddress: string; challengeId: string }): Promise<DailyObligation>;
  standing(): Promise<AtlasDailyStanding>;
  /** Wallets that qualified on a date, for the close that pays them. */
  eligibleWallets(date?: string): Promise<readonly string[]>;
}

/**
 * Things the server can verify by itself, that earn a share of the day.
 *
 * Kept as a closed union rather than a free string so a new qualifier is a
 * deliberate decision recorded here, next to the pool it draws from.
 */
export type AtlasDailyQualifierSource = 'blitz-ranked';

/**
 * What a qualifying payment has to look like.
 *
 * Supplied by the server's own payment config rather than written here. The
 * previous version compared against the fixture address `NQATLASLANTERNSHOP`
 * and a 100,000 Luna price, while production runs a real recipient at 10,000,
 * so the payment guard would have rejected every genuine payment it was given
 * and accepted only a fixture that production can never produce.
 */
export interface AtlasDailyPaymentExpectation {
  readonly network: string;
  readonly recipient: string;
  readonly valueLuna: number;
  readonly minimumConfirmations: number;
}

interface PersistedDaily {
  version: 1;
  /** date -> "actorId|wallet|challengeId" keys accepted that day. */
  days: Record<string, string[]>;
}

const PERSISTENCE_KEY = 'atlas-daily';
/** Days kept before the record is pruned, so the file cannot grow forever. */
const RETAINED_DAYS = 45;

export function createAtlasDailyService(options: {
  date: () => string;
  now?: () => number;
  expectation: AtlasDailyPaymentExpectation;
  /** The day's pot in Luna. Null when no treasury is funded. */
  dailyPoolLuna?: number | null;
  /**
   * The treasury's on-chain balance, in Luna. Null when it cannot be read.
   *
   * Without this the service advertised whatever ATLAS_DAILY_POOL_LUNA said
   * regardless of what the treasury held. Production was configured at 10,000
   * Luna against a treasury holding 3,338, so every player would have been
   * shown a share roughly three times what could be paid. Advertising a share
   * nothing can settle is the same failure already fixed once in payouts.ts.
   */
  treasuryBalanceLuna?: () => Promise<number | null>;
  /** How long a balance reading is reused before it is re-read. */
  balanceCacheMs?: number;
  stateStore?: AtlasStateStore;
}): AtlasDailyService {
  const now = options.now ?? Date.now;
  const configuredPoolLuna = options.dailyPoolLuna ?? null;
  const balanceCacheMs = options.balanceCacheMs ?? 30_000;
  let cachedBalance: { at: number; value: number | null } | null = null;

  /*
   * Cached, because standing() is public and polled: an uncached read would
   * put one RPC call on a shared open node per player per poll.
   */
  async function treasuryBalance(): Promise<number | null> {
    if (!options.treasuryBalanceLuna) return null;
    if (cachedBalance && now() - cachedBalance.at < balanceCacheMs) return cachedBalance.value;
    let value: number | null = null;
    try {
      value = await options.treasuryBalanceLuna();
    } catch {
      value = null;
    }
    // An unreadable balance keeps the last good reading rather than collapsing
    // the pot to nothing on a single transient failure.
    if (value === null && cachedBalance) return cachedBalance.value;
    cachedBalance = { at: now(), value };
    return value;
  }

  /**
   * What the day can actually pay.
   *
   * An unknown balance falls back to the configured pot rather than to zero:
   * refusing to show a pot because an RPC blinked would be its own dishonesty,
   * and the payout path verifies funds again before it sends anything.
   */
  async function payablePool(): Promise<number | null> {
    if (configuredPoolLuna === null) return null;
    const balance = await treasuryBalance();
    if (balance === null) return configuredPoolLuna;
    return Math.max(0, Math.min(configuredPoolLuna, balance));
  }

  let days: Record<string, Set<string>> = {};
  let hydrated = false;
  let operations: Promise<void> = Promise.resolve();

  /*
   * Eligibility is persisted, for the reason recorded at length in payouts.ts.
   * It used to live in a bare Set, so a restart made every wallet that had
   * already qualified today eligible to qualify again. On a service that owes
   * real NIM at the close of the day, that is a double payment.
   */
  async function hydrate(): Promise<void> {
    if (hydrated || !options.stateStore) return;
    const loaded = await options.stateStore.load<PersistedDaily | null>(PERSISTENCE_KEY, null);
    if (loaded && loaded.version === 1 && loaded.days && typeof loaded.days === 'object') {
      days = Object.fromEntries(Object.entries(loaded.days).map(([day, keys]) => [day, new Set(Array.isArray(keys) ? keys : [])]));
    }
    hydrated = true;
  }

  async function save(): Promise<void> {
    const retained = Object.keys(days).sort().slice(-RETAINED_DAYS);
    days = Object.fromEntries(retained.map((day) => [day, days[day]!]));
    await options.stateStore?.save<PersistedDaily>(PERSISTENCE_KEY, {
      version: 1,
      days: Object.fromEntries(Object.entries(days).map(([day, keys]) => [day, [...keys]])),
    });
  }

  function serialise<T>(operation: () => Promise<T>, persist: boolean): Promise<T> {
    const result = operations.catch(() => undefined).then(async () => {
      await hydrate();
      const before = persist ? structuredClone(Object.fromEntries(Object.entries(days).map(([d, k]) => [d, [...k]]))) : null;
      try {
        const value = await operation();
        if (persist) await save();
        return value;
      } catch (error) {
        if (before) days = Object.fromEntries(Object.entries(before).map(([d, k]) => [d, new Set(k)]));
        throw error;
      }
    });
    operations = result.then(() => undefined, () => undefined);
    return result;
  }

  /* Scoped by the per-day bucket it lives in, so the date is not repeated here. */
  const keyFor = (actorId: string, wallet: string, challengeId: string) => `${actorId}|${wallet}|${challengeId}`;

  return {
    async submit(input) {
      return serialise(async () => {
        const date = options.date();
        if (!input.actorId || !input.walletAddress) return rejected(date, 'identity_required');
        const challenge = ATLAS_DAILY_CHALLENGES.find((item) => item.id === input.challengeId);
        if (!challenge) return rejected(date, 'unknown_challenge');
        if (input.answer !== challenge.answer) return rejected(date, 'wrong_answer');
        if (input.assistance !== 'none') return rejected(date, 'assistance_used');
        if (!input.replayComplete) return { ...rejected(date, 'replay_incomplete'), retryable: true };
        const guardResult = validateGuard(challenge, input, now(), options.expectation);
        if (guardResult) return rejected(date, guardResult);
        const key = keyFor(input.actorId, input.walletAddress, input.challengeId);
        const today = (days[date] ??= new Set());
        if (today.has(key)) return { accepted: true, eligible: true, duplicate: true, date };
        today.add(key);
        return { accepted: true, eligible: true, date };
      }, true);
    },

    /* The configured ceiling, not the payable pot: it is synchronous and so
     * cannot consult the treasury. standing() and pendingObligation() are the
     * numbers shown to players. */
    async qualifyVerifiedRun(input) {
      return serialise(async () => {
        const date = options.date();
        if (!input.actorId || !input.walletAddress) return rejected(date, 'identity_required');
        /*
         * Scoped by source so a wallet that both rides and answers today keeps
         * one key per thing it did. distinctWallets still counts it once, which
         * is what the pool is split by.
         */
        const key = keyFor(input.actorId, input.walletAddress, input.source);
        const today = (days[date] ??= new Set());
        if (today.has(key)) return { accepted: true, eligible: true, duplicate: true, date };
        today.add(key);
        return { accepted: true, eligible: true, date };
      }, true);
    },

    estimateShare(eligibleCount) {
      if (configuredPoolLuna === null) return null;
      if (!Number.isSafeInteger(eligibleCount) || eligibleCount <= 0) return null;
      // Integer Luna throughout. A share is floored so the sum of every share
      // can never exceed the pot; the remainder stays with the treasury.
      return Math.floor(configuredPoolLuna / eligibleCount);
    },

    async pendingObligation(input) {
      return serialise(async () => {
        const date = options.date();
        const today = days[date];
        const qualified = Boolean(today?.has(keyFor(input.actorId, input.walletAddress, input.challengeId)));
        if (!qualified) return { status: 'not-eligible' as const, amountLuna: null };
        const wallets = distinctWallets(today);
        const pool = await payablePool();
        const share = pool === null || wallets === 0 ? null : Math.floor(pool / wallets);
        return { status: 'pending-close' as const, amountLuna: share };
      }, false);
    },

    async standing() {
      return serialise(async () => {
        const date = options.date();
        const wallets = distinctWallets(days[date]);
        const pool = await payablePool();
        return {
          date,
          eligibleCount: wallets,
          shareLuna: pool === null || wallets === 0 ? null : Math.floor(pool / wallets),
          poolLuna: pool,
          configuredPoolLuna,
          treasuryLuna: await treasuryBalance(),
          // A funded-but-empty treasury is not "rewards on". Zero pays nobody.
          rewardsEnabled: pool !== null && pool > 0,
        };
      }, false);
    },

    async eligibleWallets(date) {
      return serialise(async () => {
        const today = days[date ?? options.date()];
        if (!today) return [];
        return [...new Set([...today].map((key) => key.split('|')[1]!))].sort();
      }, false);
    },
  };
}

/** One wallet counts once, however many challenges it answered. */
function distinctWallets(keys: Set<string> | undefined): number {
  if (!keys) return 0;
  return new Set([...keys].map((key) => key.split('|')[1])).size;
}

function validateGuard(
  challenge: AtlasDailyChallenge,
  input: DailySubmitInput,
  now: number,
  expectation: AtlasDailyPaymentExpectation,
): DailySubmitReason | null {
  if (challenge.guard === 'payment') {
    const payment = input.payment;
    // A hash with nothing verified beside it is a claim, not evidence. It is
    // called out separately so the player is told which of the two is missing.
    if (payment?.txHash && (!payment.network || !payment.recipient || payment.valueLuna === undefined || payment.canonical === undefined || payment.success === undefined || payment.confirmations === undefined)) return 'payment_unverified';
    if (!payment || !payment.network || !payment.recipient || payment.valueLuna === undefined) return 'payment_mismatch';
    if (payment.network !== expectation.network) return 'payment_mismatch';
    if (normaliseAddress(payment.recipient) !== normaliseAddress(expectation.recipient)) return 'payment_mismatch';
    if (payment.valueLuna !== expectation.valueLuna) return 'payment_mismatch';
    if (!payment.canonical || !payment.success) return 'payment_unverified';
    if (!Number.isSafeInteger(payment.confirmations) || (payment.confirmations ?? 0) < expectation.minimumConfirmations) return 'payment_unverified';
  }
  if (challenge.guard === 'consensus') {
    if (!input.consensus || !input.consensus.established || !Number.isSafeInteger(input.consensus.observedAt) || now - input.consensus.observedAt > 5 * 60 * 1_000) return 'consensus_stale';
  }
  if (challenge.guard === 'validator-distribution') {
    if (!input.validatorDistribution || input.validatorDistribution.distinctValidators < 3 || input.validatorDistribution.totalValidators < input.validatorDistribution.distinctValidators) return 'validator_concentration';
  }
  return null;
}

function normaliseAddress(value: string): string { return value.replace(/\s/g, '').toUpperCase(); }

function rejected(date: string, reason: DailySubmitReason): DailySubmitResult { return { accepted: false, eligible: false, reason, date }; }
