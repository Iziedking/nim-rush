import { describe, expect, it } from 'vitest';

import { BLITZ_CITIES } from '../shared/atlas/blitz/cities';
import { BLITZ_LIMIT_SECONDS, createBlitzRun, stepBlitzRun } from '../shared/atlas/blitz/core';
import { getBlitzDailyChallenge } from '../shared/atlas/blitz/daily';
import { blitzRuleFeatures } from '../shared/atlas/blitz/ruleset';
import type { BlitzCityId, BlitzInput, BlitzRunState } from '../shared/atlas/blitz/types';
import { blitzRiderInput } from './support/blitz-rider';

/*
 * The run has to be ridden.
 *
 * The owner said it three times, and the third time with the receipt: "it rode
 * itself from start to finish without me touching it". They were right. On the
 * shipped game a rider who never touched a control reached the bottom of Lagos
 * in 97 seconds, and a rider who steered the whole way but never tucked scored
 * 14,670 against 15,488 for one who rode properly - a 5% difference between
 * playing and barely playing.
 *
 * These tests are the floor under the fix. They are written against the dates
 * the ruleset schedule assigns, so they keep holding as versions move on.
 */

const V13_DAY = '2026-09-20';
const seedFor = (cityId: BlitzCityId, date = V13_DAY) => getBlitzDailyChallenge({ now: Date.parse(`${date}T12:00:00.000Z`), cityId, seasonId: 'cycle-2' }).seed;
const idle: BlitzInput = { steer: 0, drift: false, boost: false };

function ride(cityId: BlitzCityId, drive: (state: BlitzRunState) => BlitzInput, date = V13_DAY): BlitzRunState {
  let state = createBlitzRun({ cityId, seed: seedFor(cityId, date) });
  while (state.phase === 'countdown' || state.phase === 'running') state = stepBlitzRun(state, drive(state));
  return state;
}

describe('a descent that has to be ridden', () => {
  it('is on for the scheduled day, and leaves the days before it alone', () => {
    expect(blitzRuleFeatures(seedFor('lagos')).skillSpeed).toBe(true);
    expect(blitzRuleFeatures(seedFor('lagos', '2026-09-19')).skillSpeed).toBe(false);
    // The suite's own unversioned seeds keep the rules they were written for.
    expect(blitzRuleFeatures('seed').skillSpeed).toBe(false);
  });

  it('never lets a rider who touches nothing reach the bottom', () => {
    for (const city of BLITZ_CITIES) {
      const state = ride(city.id, () => idle);
      expect(state.phase, city.id).toBe('timeout');
      expect(state.score, city.id).toBe(0);
      // And not just short: short enough that nobody mistakes it for bad luck.
      expect(state.distanceMeters / city.lengthMeters, city.id).toBeLessThan(0.9);
    }
  }, 30_000);

  it('pays a rider who works the bike far more than one who only steers', () => {
    for (const city of BLITZ_CITIES) {
      const ridden = ride(city.id, (state) => blitzRiderInput(state));
      const steerOnly = ride(city.id, (state) => ({ ...blitzRiderInput(state), tuck: false }));
      expect(ridden.phase, city.id).toBe('finished');
      // The gap was 5% when the owner said the game was playing itself.
      expect(ridden.score, city.id).toBeGreaterThan(steerOnly.score * 1.3);
    }
  }, 30_000);

  it('still lets an ordinary rider finish with time in hand', () => {
    // The scripted rider is deliberately mediocre: no braking plan, one
    // obstacle of lookahead. If it can finish, a person can, and the margin
    // here is what stops the clock feeling like a punishment.
    for (const city of BLITZ_CITIES) {
      const ridden = ride(city.id, (state) => blitzRiderInput(state));
      expect(ridden.phase, city.id).toBe('finished');
      expect(ridden.elapsedMs / 1_000, city.id).toBeLessThan(BLITZ_LIMIT_SECONDS - 25);
    }
  }, 30_000);

  it('keeps the hill honest: gravity still helps, but the tuck is what collects it', () => {
    // Tucked the whole way beats sitting up the whole way by a wide margin,
    // on the same course, with no steering in either.
    const tucked = ride('lagos', () => ({ ...idle, tuck: true }));
    const upright = ride('lagos', () => idle);
    expect(tucked.distanceMeters).toBeGreaterThan(upright.distanceMeters * 1.15);
  }, 30_000);
});
