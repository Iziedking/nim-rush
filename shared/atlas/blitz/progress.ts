/**
 * A rider's record across days, from their verified runs only.
 *
 * Coming back is the other half of a daily game. A streak counts consecutive
 * UTC days with at least one verified ranked run, and it stays alive through
 * today until today is over: a rider who rode yesterday and has not ridden yet
 * today still has their streak, and one ride keeps it.
 *
 * Nothing here can be bought or claimed by the browser. It is counted from the
 * server's own rows, which exist only for runs the server re-rode itself.
 */
export interface BlitzRiderProgress {
  /** Consecutive days up to today, or up to yesterday if today is not ridden yet. */
  readonly dayStreak: number;
  /** Distinct days with a verified run. */
  readonly daysRidden: number;
  /** The best verified score across every day and city, 0 if none. */
  readonly bestScore: number;
  /** Whether today already counts. */
  readonly riddenToday: boolean;
}

const DAY_MS = 86_400_000;

export function blitzRiderProgress(input: { readonly dates: readonly string[]; readonly scores: readonly number[]; readonly today: string }): BlitzRiderProgress {
  const days = new Set(input.dates.filter((date) => /^\d{4}-\d{2}-\d{2}$/.test(date) && date <= input.today));
  const riddenToday = days.has(input.today);
  let cursor = Date.parse(`${input.today}T00:00:00.000Z`) - (riddenToday ? 0 : DAY_MS);
  let dayStreak = 0;
  while (days.has(new Date(cursor).toISOString().slice(0, 10))) {
    dayStreak += 1;
    cursor -= DAY_MS;
  }
  return {
    dayStreak,
    daysRidden: days.size,
    bestScore: input.scores.reduce((best, score) => Math.max(best, score), 0),
    riddenToday,
  };
}

export function isBlitzRiderProgress(value: unknown): value is BlitzRiderProgress {
  if (!value || typeof value !== 'object') return false;
  const progress = value as Record<string, unknown>;
  return Number.isSafeInteger(progress.dayStreak) && Number.isSafeInteger(progress.daysRidden)
    && Number.isSafeInteger(progress.bestScore) && typeof progress.riddenToday === 'boolean';
}
