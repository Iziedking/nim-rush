/**
 * The three parts of a descent.
 *
 * A run used to ask the same question at 0:10 as at 1:50: same pace, same
 * obstacles, same gate width. Sectors give it an arc. The Warm-up teaches, the
 * Pinch adds the obstacles a rookie never used to meet, and the Gauntlet is
 * faster with the narrowest gate - and because corner push scales with the
 * square of speed, faster is harder, not just quicker.
 *
 * Only runs whose seed names the V6 rules use this (see ruleset.ts).
 */
export interface BlitzSector {
  readonly id: 'warm-up' | 'pinch' | 'gauntlet';
  readonly label: string;
  /** Where it starts, as a fraction of the course. */
  readonly start01: number;
  /** Multiplies the city's cruising speed. */
  readonly pace: number;
  /** Multiplies how far off the centre line a gate still counts as clean. */
  readonly gateTolerance: number;
}

export const BLITZ_SECTORS: readonly BlitzSector[] = [
  { id: 'warm-up', label: 'WARM-UP', start01: 0, pace: 1, gateTolerance: 1 },
  { id: 'pinch', label: 'THE PINCH', start01: 1 / 3, pace: 1.04, gateTolerance: 0.9 },
  { id: 'gauntlet', label: 'THE GAUNTLET', start01: 2 / 3, pace: 1.08, gateTolerance: 0.8 },
];

export function blitzSectorIndex(fraction: number): number {
  for (let index = BLITZ_SECTORS.length - 1; index > 0; index -= 1) {
    if (fraction >= BLITZ_SECTORS[index]!.start01) return index;
  }
  return 0;
}

export function blitzSectorAt(fraction: number): BlitzSector {
  return BLITZ_SECTORS[blitzSectorIndex(fraction)]!;
}
