import { blitzCollectables, blitzLiveObstacles, type BlitzCityDefinition, type BlitzPickup } from './cities';
import { obstacleShape } from './course';
import { blitzRuleFeatures } from './ruleset';
import type { BlitzDifficulty } from './types';

/*
 * How close a coin may sit to an obstacle before it moves. The first term is
 * the simulation's own hit margin plus a bike's width; the second is how far
 * ahead a rider needs to see a rock to be past it and back on the coins.
 */
const CLEAR_LANE = 1.1;
const CLEAR_AHEAD_METRES = 6;
const SHOULDER = 0.4;

/**
 * What this run collects from, laid out for this run's obstacles.
 *
 * The coin trail is drawn from the city and the obstacles from the day, so on a
 * V6 day a rock can land on the trail. A rider would then have to choose
 * between the coin and not crashing, and the streak - which a single missed
 * coin breaks - would be capped by the layout rather than by the rider. On
 * Lagos that cap was nineteen, one short of x2.
 *
 * So under the V6 rules a coin that sits on a live obstacle moves to the
 * nearest side of it that is clear. There is always a clean line, and holding
 * it is the skill. The simulation and the renderer both read this, so a coin
 * drawn is a coin that can be taken. Any other seed gets the authored list.
 */
export function blitzRunCollectables(city: BlitzCityDefinition, difficulty: BlitzDifficulty, seed: string): readonly BlitzPickup[] {
  const authored = blitzCollectables(city);
  if (!blitzRuleFeatures(seed).dailyLayout) return authored;
  const key = `${city.id}|${difficulty}|${seed}`;
  const cached = runCollectables.get(key);
  if (cached) return cached;

  const edge = city.roadWidth / 2 - SHOULDER;
  const bands = blitzLiveObstacles(city, difficulty, seed).map((obstacle) => {
    const shape = obstacleShape(obstacle.id);
    return { distance: obstacle.distance01 * city.lengthMeters, reach: shape.halfLength + CLEAR_AHEAD_METRES, from: obstacle.lane - shape.halfWidth - CLEAR_LANE, to: obstacle.lane + shape.halfWidth + CLEAR_LANE };
  });
  const blockedAt = (distance: number, lane: number) => bands.some((band) => Math.abs(band.distance - distance) < band.reach && lane > band.from && lane < band.to);

  const laid = authored.map((pickup) => {
    if (pickup.kind !== 'token') return pickup;
    const at = pickup.distance01 * city.lengthMeters;
    if (!blockedAt(at, pickup.lane)) return pickup;
    // Either edge of every band here, nearest first, first one clear of all.
    const candidates = bands
      .filter((band) => Math.abs(band.distance - at) < band.reach)
      .flatMap((band) => [band.from - 0.05, band.to + 0.05])
      .map((lane) => Math.max(-edge, Math.min(edge, lane)))
      .sort((left, right) => Math.abs(left - pickup.lane) - Math.abs(right - pickup.lane));
    const clear = candidates.find((lane) => !blockedAt(at, lane));
    // Nowhere clear means the road itself is shut here; the coin is dropped
    // rather than left somewhere only a crash could reach.
    return clear === undefined ? null : { ...pickup, lane: Number(clear.toFixed(3)) };
  }).filter((pickup): pickup is BlitzPickup => pickup !== null);

  if (runCollectables.size > 32) runCollectables.clear();
  runCollectables.set(key, laid);
  return laid;
}
const runCollectables = new Map<string, readonly BlitzPickup[]>();
