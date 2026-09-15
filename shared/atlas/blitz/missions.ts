import type { BlitzDifficulty, BlitzMissionDefinition, BlitzMissionKind } from './types';

export const BLITZ_MISSION_POOL: readonly BlitzMissionDefinition[] = [
  { id: 'line-master', label: 'LINE MASTER', kind: 'line', verb: 'Hold the clean line', description: 'Pass three route gates inside the marked racing line.', target: 3, bonus: 900 },
  { id: 'surface-discipline', label: 'SURFACE DISCIPLINE', kind: 'line', verb: 'Respect the surface', description: 'Stay on the authored trail through the changing ground.', target: 1, bonus: 700 },
  { id: 'brake-late-exit-clean', label: 'BRAKE LATE, EXIT CLEAN', kind: 'control', verb: 'Brake late. Exit fast.', description: 'Enter the control gate below the cap, then leave with speed.', target: 2, bonus: 950 },
  { id: 'air-judge', label: 'AIR JUDGE', kind: 'control', verb: 'Land inside the rhythm', description: 'Clear the kicker and absorb the landing without a hard impact.', target: 2, bonus: 1_000 },
  { id: 'risk-route', label: 'RISK ROUTE', kind: 'risk', verb: 'Take the marked risk', description: 'Use the shoulder route, then recover before the next hazard.', target: 2, bonus: 1_100 },
  { id: 'perfect-descent', label: 'PERFECT DESCENT', kind: 'risk', verb: 'Make no contact', description: 'Finish with every selected contract complete and zero impacts.', target: 1, bonus: 1_400 },
];

export function selectBlitzMissions(seed: string, difficulty: BlitzDifficulty = 'rookie'): readonly BlitzMissionDefinition[] {
  void difficulty;
  return (['line', 'control', 'risk'] as const).map((kind) => {
    const candidates = BLITZ_MISSION_POOL.filter((mission) => mission.kind === kind).map((mission) => ({ ...mission }));
    return candidates[seededIndex(`${seed}:${kind}`, candidates.length)]!;
  });
}

function seededIndex(seed: string, length: number): number {
  let state = seedHash(seed) || 0x9e3779b9;
  state ^= state << 13;
  state ^= state >>> 17;
  state ^= state << 5;
  return (state >>> 0) % length;
}

function seedHash(seed: string): number {
  let hash = 2166136261;
  for (let index = 0; index < seed.length; index += 1) hash = Math.imul(hash ^ seed.charCodeAt(index), 16777619);
  return hash >>> 0;
}

export function missionWindow(kind: BlitzMissionKind, riskStart = 0.64, riskEnd = 0.73): { start: number; end: number } {
  if (kind === 'line') return { start: 0.16, end: 0.76 };
  if (kind === 'control') return { start: 0.46, end: 0.62 };
  return { start: riskStart, end: riskEnd };
}
