import { blitzCity } from './cities';
import { blitzRunCollectables } from './trail';
import type { BlitzRunState } from './types';

/**
 * What a run earned, other than points.
 *
 * Each badge names one thing a rider did well, in words they can aim at next
 * time. Read off the final state only - the same state the server re-rides to
 * - so a badge shown on a ranked run is one the server would agree with. None
 * of them can be bought; they are the reason to ride again that is not a
 * prize.
 */
export type BlitzBadgeId = 'full-trail' | 'untouched' | 'clean-line' | 'combo-20' | 'contractor';

export interface BlitzBadge {
  readonly id: BlitzBadgeId;
  readonly label: string;
  /** What it asks for, shown whether or not it was earned. */
  readonly ask: string;
}

export const BLITZ_BADGES: readonly BlitzBadge[] = [
  { id: 'full-trail', label: 'FULL TRAIL', ask: 'Take nine coins in ten' },
  { id: 'untouched', label: 'UNTOUCHED', ask: 'Finish without touching anything' },
  { id: 'clean-line', label: 'CLEAN LINE', ask: 'Take all three gates clean' },
  { id: 'combo-20', label: 'COMBO 20', ask: 'Take twenty coins in a row' },
  { id: 'contractor', label: 'CONTRACTOR', ask: 'Clear all three contracts' },
];

/** The share of coins FULL TRAIL asks for. */
const FULL_TRAIL_SHARE = 0.9;
/** What each clean gate adds to lineScore in core.ts. */
const GATE_POINTS = 900;
const GATES = 3;

export function blitzRunBadges(state: BlitzRunState): readonly BlitzBadgeId[] {
  // A run that did not reach the bottom earned nothing: every badge describes
  // a descent, and half a descent is not one.
  if (state.phase !== 'finished') return [];
  const coins = blitzRunCollectables(blitzCity(state.cityId), state.difficulty, state.seed).filter((pickup) => pickup.kind === 'token').length;
  const earned: BlitzBadgeId[] = [];
  if (coins > 0 && state.tokensTaken >= Math.ceil(coins * FULL_TRAIL_SHARE)) earned.push('full-trail');
  if (state.collisions === 0 && state.rivalContacts === 0) earned.push('untouched');
  if (state.lineScore >= GATE_POINTS * GATES) earned.push('clean-line');
  if (state.trailBest >= 20) earned.push('combo-20');
  if (state.missions.length > 0 && state.missions.every((mission) => mission.status === 'complete')) earned.push('contractor');
  return earned;
}
