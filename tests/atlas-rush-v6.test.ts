import { describe, expect, it } from 'vitest';

import { BLITZ_CITIES, blitzCity, blitzEnabledObstacles, blitzLiveObstacles } from '../shared/atlas/blitz/cities';
import { BLITZ_COMBO_TOKEN_POINTS, BLITZ_LIMIT_SECONDS, BLITZ_TICK_RATE, blitzComboMultiplier, createBlitzRun, stepBlitzRun } from '../shared/atlas/blitz/core';
import { obstacleShape } from '../shared/atlas/blitz/course';
import { getBlitzDailyChallenge } from '../shared/atlas/blitz/daily';
import { replayBlitzTrace } from '../shared/atlas/blitz/replay';
import { BLITZ_SECTORS } from '../shared/atlas/blitz/sectors';
import { blitzRunCollectables } from '../shared/atlas/blitz/trail';
import type { BlitzCityId, BlitzInput, BlitzRunState, BlitzTraceFrame } from '../shared/atlas/blitz/types';
import { blitzRacingLine, blitzRiderInput } from './support/blitz-rider';

/*
 * V6: a run with an arc, coins that mean something, and days that differ.
 *
 * Every rule here is switched on by the seed naming v12, so each test rides a
 * real V6 day and, where it matters, the day before it on the old rules.
 */

const V6_DAY = (cityId: BlitzCityId, date = '2026-09-19') => getBlitzDailyChallenge({ now: Date.parse(`${date}T12:00:00.000Z`), cityId, seasonId: 'cycle-2' }).seed;
const V11_DAY = (cityId: BlitzCityId) => getBlitzDailyChallenge({ now: Date.parse('2026-09-18T12:00:00.000Z'), cityId, seasonId: 'cycle-2' }).seed;
const idle: BlitzInput = { steer: 0, drift: false, boost: false };

/** Out of the countdown, rolling. */
function rolling(cityId: BlitzCityId, seed: string): BlitzRunState {
  let state = createBlitzRun({ cityId, seed });
  while (state.phase === 'countdown') state = stepBlitzRun(state, idle);
  return state;
}

/*
 * A rider who goes after the coins: aim at the next coin when it is close and
 * the racing line has nothing better to say, otherwise ride the racing line.
 * It is the player the combo is built for.
 */
function trailInput(state: BlitzRunState): BlitzInput {
  const city = blitzCity(state.cityId);
  const next = blitzRunCollectables(city, state.difficulty, state.seed).find((pickup) => pickup.kind === 'token'
    && !state.collectedPickupIds.includes(pickup.id)
    && pickup.distance01 * city.lengthMeters > state.distanceMeters);
  const base = blitzRiderInput(state, { boost: false });
  if (!next || next.distance01 * city.lengthMeters - state.distanceMeters > 24) return base;
  /*
   * Swerve only for a rock actually on the path from here to the coin. The
   * trail is laid clear of every live obstacle, so a rider on it is safe; the
   * general racing line picks the widest gap instead, which is often the other
   * side from the coins.
   */
  const toCoin = next.distance01 * city.lengthMeters - state.distanceMeters;
  const onPath = blitzLiveObstacles(city, state.difficulty, state.seed).some((obstacle) => {
    const ahead = obstacle.distance01 * city.lengthMeters - state.distanceMeters;
    if (ahead < -2 || ahead > 30) return false;
    const shape = obstacleShape(obstacle.id);
    // Where this rider will be when it gets there: easing onto the coin, then on it.
    const laneThere = state.laneOffset + (next.lane - state.laneOffset) * Math.max(0, Math.min(1, ahead / Math.max(1, toCoin)));
    return Math.abs(laneThere - obstacle.lane) < shape.halfWidth + 0.32 + 0.3;
  });
  // Steer at the coin and damp by sideways speed, so the weave is followed
  // rather than overshot; tuck only once on line, because tucked grip is 62%.
  const error = next.lane - state.laneOffset;
  const follow = Math.max(-1, Math.min(1, error * 2.4 - state.lateralVelocityMps * 0.45));
  const steer = onPath ? blitzRacingLine(state) : follow;
  return { ...base, steer, tuck: Math.abs(error) < 0.25 && Math.abs(steer) < 0.25 };
}

function ride(cityId: BlitzCityId, seed: string, input: (state: BlitzRunState) => BlitzInput): { state: BlitzRunState; frames: BlitzTraceFrame[] } {
  let state = createBlitzRun({ cityId, seed });
  const frames: BlitzTraceFrame[] = [];
  const limit = (BLITZ_LIMIT_SECONDS + 5) * BLITZ_TICK_RATE;
  while (state.phase !== 'finished' && state.phase !== 'timeout' && frames.length < limit) {
    const next = input(state);
    frames.push({ tick: frames.length, input: next });
    state = stepBlitzRun(state, next);
  }
  return { state, frames };
}

describe('V6 trail combo', () => {
  it('steps up at ten and twenty coins in a row', () => {
    expect(blitzComboMultiplier(1)).toBe(1);
    expect(blitzComboMultiplier(9)).toBe(1);
    expect(blitzComboMultiplier(10)).toBe(1.5);
    expect(blitzComboMultiplier(19)).toBe(1.5);
    expect(blitzComboMultiplier(20)).toBe(2);
    expect(blitzComboMultiplier(70)).toBe(2);
  });

  it('pays a rider who holds the trail more per coin than the base', () => {
    for (const city of BLITZ_CITIES) {
      const { state } = ride(city.id, V6_DAY(city.id), trailInput);
      expect(state.phase, city.id).toBe('finished');
      expect(state.trailBest, city.id).toBeGreaterThanOrEqual(20);
      expect(state.nimScore, city.id).toBeGreaterThan(state.tokensTaken * BLITZ_COMBO_TOKEN_POINTS);
    }
  }, 30_000);

  it('breaks the streak on a coin ridden past', () => {
    const city = blitzCity('lagos');
    const coin = blitzRunCollectables(city, 'rookie', V6_DAY('lagos')).find((pickup) => pickup.kind === 'token' && pickup.distance01 > 0.1)!;
    const at = coin.distance01 * city.lengthMeters;
    let state: BlitzRunState = { ...rolling('lagos', V6_DAY('lagos')), distanceMeters: at - 0.2, speedMps: 20, trailStreak: 12, trailBest: 12, laneOffset: coin.lane + 2.5 };
    state = stepBlitzRun(state, idle);
    expect(state.distanceMeters).toBeGreaterThan(at);
    expect(state.trailStreak).toBe(0);
    expect(state.trailBest).toBe(12);
  });

  it('breaks the streak on contact', () => {
    const city = blitzCity('lagos');
    const seed = V6_DAY('lagos');
    const rock = blitzLiveObstacles(city, 'rookie', seed).find((obstacle) => obstacle.distance01 > 0.1)!;
    let state: BlitzRunState = { ...rolling('lagos', seed), distanceMeters: rock.distance01 * city.lengthMeters - 2.5, speedMps: 20, laneOffset: rock.lane, lateralVelocityMps: 0, trailStreak: 9, trailBest: 9 };
    const before = state.collisions;
    for (let tick = 0; tick < 10 && state.collisions === before; tick += 1) state = stepBlitzRun(state, idle);
    expect(state.collisions).toBeGreaterThan(before);
    expect(state.trailStreak).toBe(0);
  });

  it('leaves the old rules paying the flat rate', () => {
    const { state } = ride('lagos', V11_DAY('lagos'), trailInput);
    expect(state.nimScore).toBe(state.tokensTaken * 60);
  });
});

describe('V6 sectors', () => {
  it('names three parts of the descent, each harder than the last', () => {
    expect(BLITZ_SECTORS.map((sector) => sector.id)).toEqual(['warm-up', 'pinch', 'gauntlet']);
    for (let index = 1; index < BLITZ_SECTORS.length; index += 1) {
      expect(BLITZ_SECTORS[index]!.pace).toBeGreaterThan(BLITZ_SECTORS[index - 1]!.pace);
      expect(BLITZ_SECTORS[index]!.gateTolerance).toBeLessThan(BLITZ_SECTORS[index - 1]!.gateTolerance);
    }
  });

  it('puts more of the road in the way past the Warm-up', () => {
    for (const city of BLITZ_CITIES) {
      const pinch = BLITZ_SECTORS[1]!.start01;
      const old = blitzEnabledObstacles(city, 'rookie').filter((obstacle) => obstacle.distance01 >= pinch).length;
      const v6 = blitzLiveObstacles(city, 'rookie', V6_DAY(city.id)).filter((obstacle) => obstacle.distance01 >= pinch).length;
      expect(v6, city.id).toBeGreaterThan(old);
      // The Warm-up is left as it was: it is where a rider learns the bike.
      const warmOld = blitzEnabledObstacles(city, 'rookie').filter((obstacle) => obstacle.distance01 < pinch).length;
      const warmV6 = blitzLiveObstacles(city, 'rookie', V6_DAY(city.id)).filter((obstacle) => obstacle.distance01 < pinch).length;
      expect(warmV6, city.id).toBe(warmOld);
    }
  });

  it('reports the sector a rider is in', () => {
    const { state } = ride('lagos', V6_DAY('lagos'), (current) => blitzRiderInput(current));
    expect(state.sector).toBe(2);
    expect(rolling('lagos', V6_DAY('lagos')).sector).toBe(0);
    expect(ride('lagos', V11_DAY('lagos'), (current) => blitzRiderInput(current)).state.sector).toBe(0);
  });

  it('can still be finished by a rider who steers', () => {
    for (const city of BLITZ_CITIES) {
      const { state } = ride(city.id, V6_DAY(city.id), (current) => blitzRiderInput(current));
      expect(state.phase, city.id).toBe('finished');
    }
  }, 30_000);
});

describe('V6 daily layout', () => {
  it('gives two days two layouts, and one day the same layout every time', () => {
    for (const city of BLITZ_CITIES) {
      const lanes = (seed: string) => blitzLiveObstacles(city, 'rookie', seed).map((obstacle) => obstacle.lane).join(',');
      expect(lanes(V6_DAY(city.id, '2026-09-19')), city.id).toBe(lanes(V6_DAY(city.id, '2026-09-19')));
      const week = new Set(['19', '20', '21', '22', '23', '24', '25'].map((day) => lanes(V6_DAY(city.id, `2026-09-${day}`))));
      expect(week.size, city.id).toBeGreaterThan(3);
    }
  });

  it('only ever mirrors, so an obstacle stays where the road is', () => {
    const city = blitzCity('london');
    const authored = new Map(city.obstacles.map((obstacle) => [obstacle.id, obstacle.lane]));
    for (const obstacle of blitzLiveObstacles(city, 'rookie', V6_DAY('london'))) {
      expect(Math.abs(obstacle.lane)).toBeCloseTo(Math.abs(authored.get(obstacle.id)!), 6);
    }
  });

  it('leaves the old rules on the authored layout', () => {
    for (const city of BLITZ_CITIES) {
      expect(blitzLiveObstacles(city, 'rookie', V11_DAY(city.id))).toEqual(blitzEnabledObstacles(city, 'rookie'));
      expect(blitzLiveObstacles(city, 'rookie', 'seed')).toEqual(blitzEnabledObstacles(city, 'rookie'));
    }
  });
});

describe('V6 on the server', () => {
  it('re-rides a V6 run to the same score', () => {
    for (const city of BLITZ_CITIES) {
      const seed = V6_DAY(city.id);
      const { state, frames } = ride(city.id, seed, trailInput);
      const replay = replayBlitzTrace({ cityId: city.id, seed, frames });
      expect(replay.score, city.id).toBe(state.score);
    }
  }, 30_000);
});
