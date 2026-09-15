import type { BlitzCityId, BlitzSurface } from './types';

export interface BlitzObstacle {
  readonly id: string;
  readonly distance01: number;
  readonly lane: number;
}

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
    id: 'lagos', name: 'Lagos', circuit: 'Lagos Pulse', callout: 'Lagoon heat. Market lights. No brakes.',
    lengthMeters: 1_900, roadWidth: 7.2, baseSpeedMps: 30,
    sky: 0x6f91b7, fog: 0x9b7b82, road: 0x242838, accent: 0xffb020, signal: 0x10e0c1,
    // A visible rise, crest and drop gives the hero route a readable physical
    // profile instead of a flat loop with a city painted around it.
    routeElevation: [0.35, 1.2, 2.55, 1.65, 0.8, 0.25, 0.05, 0.4],
    surfaceSegments: [{ start01: 0.16, end01: 0.23, surface: 'dirt' }, { start01: 0.47, end01: 0.55, surface: 'gravel' }, { start01: 0.73, end01: 0.79, surface: 'wood' }],
    terrainFeatures: [
      { id: 'lagos-market-kicker', distance01: 0.18, kind: 'jump', surface: 'dirt', impulseMps: 4.6 },
      { id: 'lagos-gravel-rough', distance01: 0.51, kind: 'rough', surface: 'gravel', impulseMps: 0 },
      { id: 'lagos-boardwalk-launch', distance01: 0.75, kind: 'jump', surface: 'wood', impulseMps: 4.2 },
    ],
    route: [[-10, 11], [-2, 13], [8, 9], [12, 1], [8, -9], [-1, -12], [-11, -7], [-13, 2]],
    obstacles: [
      { id: 'lagos-keke-1', distance01: 0.18, lane: -1.8 },
      { id: 'lagos-bus-2', distance01: 0.37, lane: 1.5 },
      { id: 'lagos-crate-3', distance01: 0.61, lane: -0.4 },
      { id: 'lagos-keke-4', distance01: 0.84, lane: 1.9 },
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
      { id: 'london-cab-1', distance01: 0.16, lane: 1.2 },
      { id: 'london-bus-2', distance01: 0.34, lane: -1.6 },
      { id: 'london-barrier-3', distance01: 0.58, lane: 0.1 },
      { id: 'london-cab-4', distance01: 0.79, lane: -1.9 },
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
      { id: 'dubai-coupe-1', distance01: 0.2, lane: -2.1 },
      { id: 'dubai-van-2', distance01: 0.42, lane: 1.8 },
      { id: 'dubai-barrier-3', distance01: 0.65, lane: -0.2 },
      { id: 'dubai-coupe-4', distance01: 0.86, lane: 2.2 },
    ],
  },
];

export function blitzCity(id: BlitzCityId): BlitzCityDefinition {
  const city = BLITZ_CITIES.find((candidate) => candidate.id === id);
  if (!city) throw new Error(`Unknown Beacon Blitz city: ${id}`);
  return city;
}

export function nextBlitzCity(id: BlitzCityId): BlitzCityId {
  const index = BLITZ_CITIES.findIndex((city) => city.id === id);
  return BLITZ_CITIES[(index + 1) % BLITZ_CITIES.length]!.id;
}
