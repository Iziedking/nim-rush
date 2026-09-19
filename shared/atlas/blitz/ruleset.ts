/**
 * Which rules a day was ridden under, and which rules a run is simulated with.
 *
 * Two facts make a plain version bump dangerous. The server re-rides every
 * ranked run with whatever code it is running, and the daily challenge id -
 * which the prize close rebuilds for past days - contains the version. Bump a
 * single constant and the close rebuilds yesterday under today's version,
 * finds no riders and pays nobody; a run started before the deploy and sent
 * after it is re-ridden under rules it was never ridden under, and refused.
 *
 * So the version is a schedule over dates, and the rules are read from the
 * seed. A ranked seed is the challenge id, so it names its own version: a run
 * ridden on v11 replays as v11 forever, and a deploy can land at any hour.
 */

/*
 * Newest first. Each entry holds from its date (UTC) until the next newer one.
 * Append-only: rewriting a past date changes the id of a day that has already
 * been played, and its board and its payouts with it.
 */
const SCHEDULE: readonly { readonly from: string; readonly version: string }[] = [
  { from: '2026-09-20', version: 'rush-posture-v13-rookie' },
  { from: '2026-09-19', version: 'rush-sectors-v12-rookie' },
  { from: '0000-01-01', version: 'rush-nimtrail-v11-rookie' },
];

/** The version a UTC date (YYYY-MM-DD) was, or will be, ridden under. */
export function blitzRulesetVersionFor(date: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error('Ruleset date is invalid.');
  return SCHEDULE.find((entry) => date >= entry.from)!.version;
}

/** The newest version, which unverified free runs ride under. */
export const BLITZ_LATEST_RULESET_VERSION = SCHEDULE[0]!.version;

/** Every version a ticket may legitimately carry. */
export function isKnownBlitzRulesetVersion(version: string): boolean {
  return SCHEDULE.some((entry) => entry.version === version);
}

/** The first version with sectors, the trail combo and daily variation. */
const V6_GENERATION = 12;
/** The first version where coasting is not a way down the hill. */
const SKILL_SPEED_GENERATION = 13;

export interface BlitzRuleFeatures {
  /** Unbroken coin streaks multiply what each coin pays. */
  readonly trailCombo: boolean;
  /** Warm-up, the Pinch and the Gauntlet: the course hardens as it goes. */
  readonly sectors: boolean;
  /** The day's seed mirrors obstacles, so no two days share a layout. */
  readonly dailyLayout: boolean;
  /**
   * Speed is ridden for, not given.
   *
   * A rider who never touched the controls reached the bottom of Lagos in 97
   * seconds, and a rider who steered but never tucked scored within 5% of one
   * who rode properly. Under this, coasting stalls and the hill pays its speed
   * out to a rider who is tucked into it.
   */
  readonly skillSpeed: boolean;
}

const LEGACY: BlitzRuleFeatures = { trailCombo: false, sectors: false, dailyLayout: false, skillSpeed: false };
const V6: BlitzRuleFeatures = { trailCombo: true, sectors: true, dailyLayout: true, skillSpeed: false };
const V13: BlitzRuleFeatures = { trailCombo: true, sectors: true, dailyLayout: true, skillSpeed: true };

/**
 * The rules a seed is simulated under.
 *
 * On only when the seed names a generation of 12 or later. A seed with no
 * version at all - the menu preview, and every seed in the test suite - keeps
 * the old rules, so the suite goes on pinning the game that was already played.
 */
export function blitzRuleFeatures(seed: string): BlitzRuleFeatures {
  const generation = /rush-[a-z]+-v(\d+)-/.exec(seed);
  if (!generation) return LEGACY;
  const version = Number(generation[1]);
  if (version >= SKILL_SPEED_GENERATION) return V13;
  return version >= V6_GENERATION ? V6 : LEGACY;
}
