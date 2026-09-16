import type { BlitzCityId, BlitzDifficulty, BlitzSurface } from './types';
import { blitzRules } from './rules';

export interface BlitzObstacle {
  readonly id: string;
  readonly distance01: number;
  readonly lane: number;
  /**
   * Which riders meet this one.
   *
   * `core` is every run, including every ranked run. `pro` is the extra
   * pressure free-play riders asked for. Difficulty used to be a count -
   * "collide with the first two of these" - while the renderer drew all of
   * them, so half the obstacles on a ranked run were scenery a rider could
   * ride straight through. A tier is the same intent without the lie: the
   * renderer draws exactly what the ruleset makes solid.
   */
  readonly tier?: 'core' | 'pro';
}

/**
 * Where a run is judged on its racing line.
 *
 * One list, read by the simulation and by the renderer. These were two lists
 * that had drifted apart - the posts stood at 0.24 / 0.51 / 0.77 while the
 * score was taken at 0.26 / 0.5 / 0.74 - so a rider who threaded the gate they
 * could see was being marked several car-lengths further on. Riding well and
 * being scored well have to be the same act.
 */
export const BLITZ_LINE_GATES: readonly number[] = [0.26, 0.5, 0.74];

export interface BlitzSurfaceSegment {
  readonly start01: number;
  readonly end01: number;
  readonly surface: BlitzSurface;
}

export interface BlitzTerrainFeature {
  readonly id: string;
  readonly distance01: number;
  readonly kind: 'jump' | 'rough';
  readonly surface: BlitzSurface;
  readonly impulseMps: number;
}

export interface BlitzCityDefinition {
  readonly closed?: boolean;
  readonly id: BlitzCityId;
  readonly name: string;
  readonly circuit: string;
  readonly callout: string;
  readonly lengthMeters: number;
  readonly roadWidth: number;
  readonly baseSpeedMps: number;
  readonly sky: number;
  readonly fog: number;
  readonly road: number;
  readonly accent: number;
  readonly signal: number;
  readonly route: readonly (readonly [number, number])[];
  readonly routeElevation: readonly number[];
  readonly surfaceSegments: readonly BlitzSurfaceSegment[];
  readonly terrainFeatures: readonly BlitzTerrainFeature[];
  readonly obstacles: readonly BlitzObstacle[];
}

export const BLITZ_CITIES: readonly BlitzCityDefinition[] = [
  {
    id: 'lagos', name: 'Lagos', circuit: 'Ridge Run', callout: 'Read the trail. Brake before the turn. Land clean.', closed: false,
    lengthMeters: 1_900, roadWidth: 7.2, baseSpeedMps: 30,
    sky: 0xa9c3ca, fog: 0xb5c2b6, road: 0x897054, accent: 0xf4ba36, signal: 0xe9e4cc,
    // A visible rise, crest and drop gives the hero route a readable physical
    // profile instead of a flat loop with a city painted around it.
    routeElevation: [112, 106, 92, 77, 82, 64, 49, 37, 28, 18, 8, 2],
    surfaceSegments: [{ start01: 0, end01: 0.47, surface: 'dirt' }, { start01: 0.47, end01: 0.55, surface: 'gravel' }, { start01: 0.55, end01: 0.73, surface: 'dirt' }, { start01: 0.73, end01: 0.79, surface: 'wood' }, { start01: 0.79, end01: 1, surface: 'dirt' }],
    terrainFeatures: [
      { id: 'lagos-market-kicker', distance01: 0.18, kind: 'jump', surface: 'dirt', impulseMps: 4.6 },
      { id: 'lagos-gravel-rough', distance01: 0.51, kind: 'rough', surface: 'gravel', impulseMps: 0 },
      { id: 'lagos-boardwalk-launch', distance01: 0.75, kind: 'jump', surface: 'wood', impulseMps: 4.2 },
    ],
    route: [[0, 0], [0, 12], [8, 26], [-2, 40], [-14, 48], [-8, 62], [10, 76], [16, 91], [2, 108], [-10, 120], [-3, 137], [8, 151]],
    obstacles: [
      // Two easy singles to teach the read before anything is asked of them.
      { id: 'lagos-rock-1', distance01: 0.055, lane: -1.8 },
      { id: 'lagos-crate-2', distance01: 0.102, lane: 1.7 },
      // A wide log: the first obstacle that has to be committed to early.
      { id: 'lagos-log-3', distance01: 0.143, lane: -0.5 },
      // 0.18 is the market kicker. Nothing lands on a rider mid-air.
      { id: 'lagos-rock-4', distance01: 0.218, lane: 1.9 },
      { id: 'lagos-rock-5', distance01: 0.218, lane: -1.9, tier: 'pro' },
      // 0.26 is a line gate: the centre stays open through it.
      { id: 'lagos-crate-6', distance01: 0.295, lane: -2.1 },
      { id: 'lagos-rock-7', distance01: 0.34, lane: 1.5 },
      // A true pinch: both halves are in reach at once, so it is one committed
      // line through the middle rather than two easy swerves.
      { id: 'lagos-crate-8', distance01: 0.386, lane: -2.2 },
      { id: 'lagos-rock-9', distance01: 0.386, lane: 2.1 },
      { id: 'lagos-log-10', distance01: 0.435, lane: 1.1 },
      // Gravel runs 0.47 to 0.55. Grip is already the problem here, so the
      // obstacles thin out rather than stack onto it.
      { id: 'lagos-rock-11', distance01: 0.472, lane: -1.7 },
      { id: 'lagos-rock-12', distance01: 0.552, lane: 1.8 },
      { id: 'lagos-log-13', distance01: 0.6, lane: -0.6 },
      { id: 'lagos-crate-14', distance01: 0.645, lane: 2.1 },
      { id: 'lagos-rock-15', distance01: 0.688, lane: -2.0 },
      { id: 'lagos-rock-16', distance01: 0.688, lane: 1.9, tier: 'pro' },
      // 0.75 is the boardwalk launch. Clear ground for the landing.
      { id: 'lagos-crate-17', distance01: 0.8, lane: -1.9 },
      { id: 'lagos-rock-18', distance01: 0.845, lane: 1.9 },
      { id: 'lagos-log-19', distance01: 0.888, lane: 0.1 },
      { id: 'lagos-rock-20', distance01: 0.93, lane: -2.1 },
      { id: 'lagos-crate-21', distance01: 0.93, lane: 1.9, tier: 'pro' },
    ],
  },
  {
    id: 'london', name: 'London', circuit: 'London Relay', callout: 'Wet corners. Red signals. Hold the line.',
    lengthMeters: 2_000, roadWidth: 6.6, baseSpeedMps: 29.8,
    sky: 0x71869d, fog: 0xa1aeb9, road: 0x202631, accent: 0xef3655, signal: 0x59d8ff,
    routeElevation: [0.2, 0.5, 0.9, 0.65, 0.1, -0.3, -0.55, -0.25, 0.05, 0.15],
    surfaceSegments: [{ start01: 0.2, end01: 0.27, surface: 'wood' }, { start01: 0.47, end01: 0.55, surface: 'gravel' }, { start01: 0.72, end01: 0.8, surface: 'dirt' }],
    terrainFeatures: [{ id: 'london-boardwalk-drop', distance01: 0.23, kind: 'jump', surface: 'wood', impulseMps: 4.1 }, { id: 'london-gravel-rough', distance01: 0.49, kind: 'rough', surface: 'gravel', impulseMps: 0 }],
    route: [[-11, 10], [-3, 12], [5, 11], [11, 5], [9, -2], [12, -9], [2, -12], [-7, -10], [-12, -3], [-8, 3]],
    obstacles: [
      { id: 'london-cab-1', distance01: 0.06, lane: 1.3 },
      { id: 'london-barrier-2', distance01: 0.108, lane: -1.6 },
      { id: 'london-cab-3', distance01: 0.155, lane: 0.4 },
      // 0.23 is the boardwalk drop. Clear ground either side of the landing.
      { id: 'london-bus-4', distance01: 0.2, lane: -1.7 },
      { id: 'london-cab-5', distance01: 0.285, lane: 1.8 },
      { id: 'london-barrier-6', distance01: 0.33, lane: -0.4 },
      { id: 'london-cab-7', distance01: 0.33, lane: 1.9, tier: 'pro' },
      // A double-decker is tall as well as wide: this one cannot be jumped.
      { id: 'london-bus-8', distance01: 0.415, lane: -1.5 },
      { id: 'london-cab-9', distance01: 0.458, lane: 1.4 },
      // Gravel 0.47 to 0.55.
      { id: 'london-barrier-10', distance01: 0.545, lane: -1.8 },
      { id: 'london-cab-11', distance01: 0.59, lane: 0.6 },
      { id: 'london-barrier-12', distance01: 0.632, lane: -1.9 },
      { id: 'london-cab-13', distance01: 0.632, lane: 1.9, tier: 'pro' },
      { id: 'london-bus-14', distance01: 0.68, lane: 1.5 },
      { id: 'london-cab-15', distance01: 0.782, lane: -1.7 },
      { id: 'london-barrier-16', distance01: 0.828, lane: 0.5 },
      { id: 'london-cab-17', distance01: 0.872, lane: 1.8 },
      { id: 'london-bus-18', distance01: 0.918, lane: -1.6 },
      { id: 'london-cab-19', distance01: 0.918, lane: 1.7, tier: 'pro' },
    ],
  },
  {
    id: 'dubai', name: 'Dubai', circuit: 'Dubai Afterglow', callout: 'Gold night. Wide sweepers. Full boost.',
    lengthMeters: 2_160, roadWidth: 8.2, baseSpeedMps: 31.5,
    sky: 0xd49367, fog: 0xb26e5c, road: 0x2b2731, accent: 0xffca63, signal: 0x6ce7ff,
    routeElevation: [0.05, 0.45, 0.75, 0.9, 0.55, 0.05, -0.4, -0.2],
    surfaceSegments: [{ start01: 0.18, end01: 0.25, surface: 'dirt' }, { start01: 0.4, end01: 0.49, surface: 'gravel' }, { start01: 0.68, end01: 0.76, surface: 'wood' }],
    terrainFeatures: [{ id: 'dubai-dune-kicker', distance01: 0.21, kind: 'jump', surface: 'dirt', impulseMps: 4.8 }, { id: 'dubai-stone-rough', distance01: 0.69, kind: 'rough', surface: 'gravel', impulseMps: 0 }],
    route: [[-12, 8], [-5, 13], [6, 13], [13, 7], [12, -4], [5, -13], [-6, -12], [-13, -4]],
    obstacles: [
      { id: 'dubai-coupe-1', distance01: 0.058, lane: -2.1 },
      { id: 'dubai-barrier-2', distance01: 0.105, lane: 1.8 },
      { id: 'dubai-coupe-3', distance01: 0.152, lane: -0.5 },
      // 0.21 is the dune kicker. Nothing in the landing.
      { id: 'dubai-van-4', distance01: 0.252, lane: 2.0 },
      { id: 'dubai-coupe-5', distance01: 0.298, lane: -1.9 },
      { id: 'dubai-barrier-6', distance01: 0.342, lane: 0.6 },
      // Dubai is the widest road, so its pinches can be tighter.
      { id: 'dubai-van-7', distance01: 0.389, lane: -1.8 },
      { id: 'dubai-van-8', distance01: 0.389, lane: 1.8 },
      { id: 'dubai-van-9', distance01: 0.437, lane: 1.5 },
      { id: 'dubai-barrier-10', distance01: 0.437, lane: -1.5, tier: 'pro' },
      { id: 'dubai-coupe-11', distance01: 0.545, lane: -2.0 },
      { id: 'dubai-van-12', distance01: 0.592, lane: 1.9 },
      { id: 'dubai-barrier-13', distance01: 0.638, lane: -0.4 },
      // 0.69 is stone rough. Grip is the test there, not traffic.
      { id: 'dubai-coupe-14', distance01: 0.652, lane: 2.2 },
      { id: 'dubai-van-15', distance01: 0.782, lane: -2.1 },
      { id: 'dubai-coupe-16', distance01: 0.828, lane: 1.7 },
      { id: 'dubai-barrier-17', distance01: 0.87, lane: -0.6 },
      { id: 'dubai-coupe-18', distance01: 0.915, lane: 2.1 },
      { id: 'dubai-van-19', distance01: 0.915, lane: -1.9, tier: 'pro' },
      { id: 'dubai-coupe-20', distance01: 0.958, lane: 0.7 },
    ],
  },
];

/**
 * The obstacles that are actually solid for this rider.
 *
 * The single answer to "what is on this course", used by the simulation, the
 * replay verifier and the renderer alike. If these three ever disagree, a
 * rider is being scored against a course they were not shown.
 */
export function blitzEnabledObstacles(city: BlitzCityDefinition, difficulty: BlitzDifficulty): readonly BlitzObstacle[] {
  const tier = blitzRules(difficulty).obstacleTier;
  return tier === 'all' ? city.obstacles : city.obstacles.filter((obstacle) => (obstacle.tier ?? 'core') === 'core');
}

export function blitzCity(id: BlitzCityId): BlitzCityDefinition {
  const city = BLITZ_CITIES.find((candidate) => candidate.id === id);
  if (!city) throw new Error(`Unknown Beacon Blitz city: ${id}`);
  return city;
}

export function nextBlitzCity(id: BlitzCityId): BlitzCityId {
  const index = BLITZ_CITIES.findIndex((city) => city.id === id);
  return BLITZ_CITIES[(index + 1) % BLITZ_CITIES.length]!.id;
}
