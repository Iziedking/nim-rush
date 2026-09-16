import type { BlitzDifficulty } from './types';

export interface BlitzDifficultyRules {
  readonly difficulty: BlitzDifficulty;
  readonly rulesetVersion: string;
  /**
   * Which obstacle tier is solid.
   *
   * This was a count, and the renderer did not honour it: a rookie run drew
   * four obstacles and collided with two, so half of what a rider swerved
   * around was scenery. A tier is read by the simulation and the renderer
   * alike, so what is drawn and what is solid cannot drift apart.
   */
  readonly obstacleTier: 'core' | 'all';
  readonly lineTolerance: number;
  readonly controlSpeedCapMps: number;
  readonly controlExitSpeedMps: number;
  readonly riskWindowStart: number;
  readonly riskWindowEnd: number;
}

export const BLITZ_DIFFICULTY_RULES: Readonly<Record<BlitzDifficulty, BlitzDifficultyRules>> = {
  rookie: {
    difficulty: 'rookie', rulesetVersion: 'rush-supplies-v7-rookie', obstacleTier: 'core',
    lineTolerance: 0.52, controlSpeedCapMps: 22, controlExitSpeedMps: 18,
    riskWindowStart: 0.64, riskWindowEnd: 0.73,
  },
  pro: {
    difficulty: 'pro', rulesetVersion: 'rush-supplies-v7-pro', obstacleTier: 'all',
    lineTolerance: 0.38, controlSpeedCapMps: 20, controlExitSpeedMps: 20,
    riskWindowStart: 0.61, riskWindowEnd: 0.77,
  },
};

export function blitzRules(difficulty: BlitzDifficulty = 'rookie'): BlitzDifficultyRules {
  return BLITZ_DIFFICULTY_RULES[difficulty];
}
