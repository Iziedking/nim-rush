import type { BlitzCityId } from './types';

export interface BlitzObstacle {
  readonly id: string;
  readonly distance01: number;
  readonly lane: number;
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
  readonly obstacles: readonly BlitzObstacle[];
}

export const BLITZ_CITIES: readonly BlitzCityDefinition[] = [
  {
    id: 'lagos', name: 'Lagos', circuit: 'Lagos Pulse', callout: 'Lagoon heat. Market lights. No brakes.',
    lengthMeters: 1_900, roadWidth: 7.2, baseSpeedMps: 30,
    sky: 0x231a46, fog: 0x624565, road: 0x171b37, accent: 0xffb020, signal: 0x10e0c1,
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
    sky: 0x14223b, fog: 0x4d6379, road: 0x141b28, accent: 0xef3655, signal: 0x59d8ff,
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
    sky: 0x090e2a, fog: 0x2c3152, road: 0x10152c, accent: 0xffca63, signal: 0x6ce7ff,
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
