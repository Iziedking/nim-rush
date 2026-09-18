import { BLITZ_LINE_GATES, type BlitzCityDefinition } from './cities';
import type { BlitzDifficulty, BlitzMissionDefinition } from './types';

/*
 * The six contracts, and what a rider actually does for each.
 *
 * Every one of these is now reachable, phrased as an instruction rather than a
 * mood, and anchored to something built into the road. The two that were
 * dropped are worth naming: RISK ROUTE asked a rider to leave the trail, which
 * failed SURFACE DISCIPLINE outright whenever the day drew both; and PERFECT
 * DESCENT could only complete if its two siblings had already completed, so a
 * rider who missed one contract automatically lost two. Neither was something
 * a player could act on.
 */
export const BLITZ_MISSION_POOL: readonly BlitzMissionDefinition[] = [
  {
    id: 'line-master', label: 'LINE MASTER', kind: 'line', anchor: { kind: 'gates' },
    verb: 'Thread all three gates',
    description: 'Cross each lit gate inside the marked corridor, without a contact.',
    target: 3, bonus: 900,
  },
  {
    id: 'surface-discipline', label: 'STAY ON TRAIL', kind: 'line', anchor: { kind: 'gates' },
    verb: 'Keep it off the grass',
    description: 'Never leave the trail between the first gate and the last.',
    target: 1, bonus: 700,
  },
  {
    id: 'brake-late-exit-clean', label: 'BRAKE LATE', kind: 'control', anchor: { kind: 'fraction', start: 0.46, end: 0.62 },
    verb: 'Slow into it, fast out',
    description: 'Drop under the cap inside the control zone, then leave it carrying speed.',
    target: 2, bonus: 950,
  },
  {
    id: 'air-judge', label: 'AIR JUDGE', kind: 'control', anchor: { kind: 'jump' },
    verb: 'Land it soft',
    description: 'Take the kicker and absorb the landing instead of slamming it.',
    target: 2, bonus: 1_000,
  },
  {
    id: 'supply-line', label: 'SUPPLY LINE', kind: 'risk', anchor: { kind: 'fraction', start: 0.30, end: 0.80 },
    verb: 'Collect four supplies',
    description: 'Take four bottles or gearboxes off the road before the window closes.',
    target: 4, bonus: 1_100,
  },
  {
    id: 'hold-the-tuck', label: 'HOLD THE TUCK', kind: 'risk', anchor: { kind: 'fraction', start: 0.35, end: 0.72 },
    verb: 'Six seconds tucked',
    description: 'Hold TUCK for six unbroken seconds without touching anything.',
    target: 1, bonus: 1_000,
  },
];

/**
 * Where a contract opens and closes on this city, in metres.
 *
 * Resolved from the course rather than from a table of fractions, so a contract
 * that asks for a jump lands on the jump this city actually has.
 */
export function blitzMissionWindow(
  city: BlitzCityDefinition,
  mission: BlitzMissionDefinition,
): { start: number; end: number } {
  const anchor = mission.anchor ?? { kind: 'gates' as const };
  if (anchor.kind === 'gates') {
    const first = BLITZ_LINE_GATES[0] ?? 0.26;
    const last = BLITZ_LINE_GATES[BLITZ_LINE_GATES.length - 1] ?? 0.74;
    // A little before the first gate and a little after the last, so the
    // contract is live for every gate it is scored on.
    return { start: Math.max(0.02, first - 0.04), end: Math.min(0.98, last + 0.03) };
  }
  if (anchor.kind === 'jump') {
    const jump = city.terrainFeatures.find((feature) => feature.kind === 'jump');
    // A city with no kicker cannot be asked for one; fall back to the middle of
    // the course rather than authoring an impossible window.
    if (!jump) return { start: 0.46, end: 0.62 };
    return { start: Math.max(0.02, jump.distance01 - 0.06), end: Math.min(0.98, jump.distance01 + 0.12) };
  }
  return { start: anchor.start, end: anchor.end };
}

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
