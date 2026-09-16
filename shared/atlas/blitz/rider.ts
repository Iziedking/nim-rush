/*
 * What a rider carries, and what riding earns them.
 *
 * Boost and drift used to be free: the tank refilled on its own whether a
 * rider did anything or not, and a slide cost nothing at all. Neither was a
 * decision, so neither meant anything. Both are supplies now - picked up off
 * the road, spent, and gone - and the line a rider takes is what decides how
 * much of each they have at the bottom of the hill.
 *
 * Levels sit on top of that. They widen the frame a rider works in: a second
 * gearbox, a bigger tank, a longer slide. They never make the bike faster,
 * because a rider who has played longer must not out-rank a rider who rides
 * better.
 *
 * RANKED IGNORES ALL OF IT. Every ranked run is simulated from the base
 * loadout on both sides, so the board compares riding and nothing else. That
 * is not a policy the client is trusted to honour - `replayBlitzTrace` rebuilds
 * the run from the city and the seed alone, so a client that handed itself a
 * bigger tank would produce a trace the server disagrees with, and the run
 * would be refused rather than ranked.
 */

export interface BlitzLoadout {
  /** The most nitro a tank will hold. Bottles above this are wasted. */
  readonly boostCapacity: number;
  /** What a rider rolls off the line with, so the first boost is not a wait. */
  readonly startingBoost: number;
  /** How many gearboxes fit in the frame. */
  readonly driftCapacity: number;
  readonly startingDrift: number;
  /** How long one gearbox holds a slide open, in ticks. */
  readonly driftWindowTicks: number;
  /** How far off a pickup's lane a rider can be and still take it, in metres. */
  readonly pickupReach: number;
}

/**
 * The loadout every ranked run uses, on both the client and the server.
 *
 * Exported as the default rather than as level one's data so that a change to
 * the ladder can never quietly move the ranked baseline.
 */
export const BLITZ_BASE_LOADOUT: BlitzLoadout = {
  boostCapacity: 60,
  startingBoost: 28,
  driftCapacity: 3,
  startingDrift: 2,
  driftWindowTicks: 45,
  pickupReach: 1.1,
};

export interface BlitzRiderLevel {
  readonly level: number;
  readonly title: string;
  /** Career score - the sum of a rider's best run in each city - to reach it. */
  readonly requiredScore: number;
  /** What this level changes, in a rider's words. Empty at level one. */
  readonly unlock: string;
  readonly loadout: BlitzLoadout;
}

/*
 * Five rungs, each one a single legible change.
 *
 * The thresholds are set against real runs: a competent rider finishes a city
 * around 22,000, so level two is one good city, level four is all three ridden
 * well, and level five is a reason to keep going.
 */
export const BLITZ_RIDER_LEVELS: readonly BlitzRiderLevel[] = [
  {
    level: 1,
    title: 'Courier',
    requiredScore: 0,
    unlock: '',
    loadout: BLITZ_BASE_LOADOUT,
  },
  {
    level: 2,
    title: 'Ridge Runner',
    requiredScore: 15_000,
    unlock: 'A fourth gearbox in the frame, and one more to start with.',
    loadout: { ...BLITZ_BASE_LOADOUT, driftCapacity: 4, startingDrift: 3 },
  },
  {
    level: 3,
    title: 'Night Courier',
    requiredScore: 40_000,
    unlock: 'A bigger tank: 84 nitro instead of 60.',
    loadout: { ...BLITZ_BASE_LOADOUT, driftCapacity: 4, startingDrift: 3, boostCapacity: 84 },
  },
  {
    level: 4,
    title: 'Beacon Runner',
    requiredScore: 70_000,
    unlock: 'Longer slides: a gearbox holds the drift for two seconds.',
    loadout: { ...BLITZ_BASE_LOADOUT, driftCapacity: 4, startingDrift: 3, boostCapacity: 84, driftWindowTicks: 60 },
  },
  {
    level: 5,
    title: 'Descent Master',
    requiredScore: 110_000,
    unlock: 'A wider reach: supplies come off the road from further out.',
    loadout: { ...BLITZ_BASE_LOADOUT, driftCapacity: 4, startingDrift: 3, boostCapacity: 84, driftWindowTicks: 60, pickupReach: 1.6 },
  },
];

/** The rung a career score has reached. Never below one, never above the last. */
export function blitzRiderLevel(careerScore: number): BlitzRiderLevel {
  const score = Number.isFinite(careerScore) ? Math.max(0, careerScore) : 0;
  let reached = BLITZ_RIDER_LEVELS[0]!;
  for (const level of BLITZ_RIDER_LEVELS) if (score >= level.requiredScore) reached = level;
  return reached;
}

/** The next rung, and what is left to reach it. Null once the ladder is done. */
export function blitzNextRiderLevel(careerScore: number): { readonly level: BlitzRiderLevel; readonly remaining: number } | null {
  const score = Number.isFinite(careerScore) ? Math.max(0, careerScore) : 0;
  const next = BLITZ_RIDER_LEVELS.find((level) => score < level.requiredScore);
  return next ? { level: next, remaining: next.requiredScore - score } : null;
}

/**
 * The loadout a run should start from.
 *
 * `ranked` is not a hint. A ranked run is scored against every other rider on
 * the board, so it takes the base loadout no matter what the rider has earned.
 */
export function blitzLoadoutFor(input: { careerScore: number; ranked: boolean }): BlitzLoadout {
  return input.ranked ? BLITZ_BASE_LOADOUT : blitzRiderLevel(input.careerScore).loadout;
}
