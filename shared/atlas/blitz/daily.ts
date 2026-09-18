import type { BlitzCityId } from './types';

/**
 * Versioned identity for the shared daily board. The server is authoritative
 * for issuance, while this pure module lets the client explain the same board
 * without importing a clock, network client, or UI framework.
 */
/**
 * The season every ranked run, board and close agrees on.
 *
 * Shared because the client issues tickets under a season and the maintenance
 * worker closes days under one. Two copies of this string would drift, and the
 * failure would be silent: the worker would close a season nobody played while
 * riders kept posting to another.
 */
export const BLITZ_SEASON_ID = 'cycle-2';

export const BLITZ_DAILY_RULESET_VERSION = 'rush-downhill-v10-rookie';
export const BLITZ_DAY_MS = 86_400_000;

export interface BlitzDailyChallenge {
  readonly challengeId: string;
  readonly date: string;
  readonly rulesetVersion: typeof BLITZ_DAILY_RULESET_VERSION;
  readonly cityId: BlitzCityId;
  readonly seed: string;
  readonly startsAt: number;
  readonly expiresAt: number;
}

export function utcDateKey(timestampMs: number): string {
  if (!Number.isSafeInteger(timestampMs) || timestampMs < 0) throw new Error('Daily challenge timestamp is invalid.');
  return new Date(timestampMs).toISOString().slice(0, 10);
}

export function getBlitzDailyChallenge(input: { now: number; cityId: BlitzCityId; seasonId: string }): BlitzDailyChallenge {
  if (!/^[a-z0-9-]{1,80}$/.test(input.seasonId)) throw new Error('Daily challenge season is invalid.');
  const date = utcDateKey(input.now);
  const startsAt = Date.parse(`${date}T00:00:00.000Z`);
  const challengeId = `${input.seasonId}:${input.cityId}:${date}:${BLITZ_DAILY_RULESET_VERSION}`;
  return {
    challengeId,
    date,
    rulesetVersion: BLITZ_DAILY_RULESET_VERSION,
    cityId: input.cityId,
    seed: challengeId,
    startsAt,
    expiresAt: startsAt + BLITZ_DAY_MS,
  };
}
