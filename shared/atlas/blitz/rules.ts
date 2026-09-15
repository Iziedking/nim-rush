import type { BlitzDifficulty } from './types';

export interface BlitzDifficultyRules {
  readonly difficulty: BlitzDifficulty;
  readonly rulesetVersion: string;
  readonly obstacleLimit: number;
  readonly lineTolerance: number;
  readonly controlSpeedCapMps: number;
  readonly controlExitSpeedMps: number;
  readonly riskWindowStart: number;
  readonly riskWindowEnd: number;
}

export const BLITZ_DIFFICULTY_RULES: Readonly<Record<BlitzDifficulty, BlitzDifficultyRules>> = {
  rookie: {
    difficulty: 'rookie', rulesetVersion: 'rush-missions-v5-rookie', obstacleLimit: 2,
    lineTolerance: 0.52, controlSpeedCapMps: 22, controlExitSpeedMps: 18,
    riskWindowStart: 0.64, riskWindowEnd: 0.73,
  },
  pro: {
    difficulty: 'pro', rulesetVersion: 'rush-missions-v5-pro', obstacleLimit: Number.POSITIVE_INFINITY,
    lineTolerance: 0.38, controlSpeedCapMps: 20, controlExitSpeedMps: 20,
    riskWindowStart: 0.61, riskWindowEnd: 0.77,
  },
};

export function blitzRules(difficulty: BlitzDifficulty = 'rookie'): BlitzDifficultyRules {
  return BLITZ_DIFFICULTY_RULES[difficulty];
}
