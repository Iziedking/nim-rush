import { describe, expect, it } from 'vitest';

import { BLITZ_CITIES, blitzCity } from '../shared/atlas/blitz/cities';
import { BLITZ_LIMIT_SECONDS, createBlitzRun, sampleBlitzRoute, stepBlitzRun } from '../shared/atlas/blitz/core';
import { getBlitzDailyChallenge } from '../shared/atlas/blitz/daily';
import { blitzRuleFeatures } from '../shared/atlas/blitz/ruleset';
import type { BlitzCityId, BlitzInput, BlitzRunState } from '../shared/atlas/blitz/types';
import { blitzRiderInput } from './support/blitz-rider';

/*
 * The bike is ridden, or it is not going anywhere.
 *
 * The owner said it four times, the last time with the receipt: "it rode
 * itself from start to finish without me touching it". On the shipped game a
 * rider who touched nothing reached the bottom of Lagos in 97 seconds, and
 * steering without ever tucking scored within 5% of riding properly.
 *
 * The model now is the one a bike actually has. The tuck is the rider on the
 * bike: it is what drives it. Nitro is a shove that runs out in seconds. Let
 * go of both and nothing is driving it - gravity against drag and the tyres -
 * so it keeps rolling down a pitch and winds down to a stop on the flat.
 */

const V13_DAY = '2026-09-20';
const seedFor = (cityId: BlitzCityId, date = V13_DAY) => getBlitzDailyChallenge({ now: Date.parse(`${date}T12:00:00.000Z`), cityId, seasonId: 'cycle-2' }).seed;
const idle: BlitzInput = { steer: 0, drift: false, boost: false };

function ride(cityId: BlitzCityId, drive: (state: BlitzRunState) => BlitzInput, date = V13_DAY): BlitzRunState {
  let state = createBlitzRun({ cityId, seed: seedFor(cityId, date) });
  while (state.phase === 'countdown' || state.phase === 'running') state = stepBlitzRun(state, drive(state));
  return state;
}

/** Rolling at a chosen point on the course, so one pitch can be tested alone. */
function rollingAt(cityId: BlitzCityId, distanceMeters: number, speedMps: number): BlitzRunState {
  let state = createBlitzRun({ cityId, seed: seedFor(cityId) });
  while (state.phase === 'countdown') state = stepBlitzRun(state, idle);
  return { ...state, distanceMeters, speedMps };
}

/** The flattest and the steepest stretch of a course, from its own samples. */
function pitches(cityId: BlitzCityId): { flattest: number; steepest: number } {
  const city = blitzCity(cityId);
  let flattest = 60;
  let steepest = 60;
  for (let at = 60; at < city.lengthMeters - 60; at += 20) {
    const drop = -sampleBlitzRoute(cityId, at).slope;
    if (drop < -sampleBlitzRoute(cityId, flattest).slope) flattest = at;
    if (drop > -sampleBlitzRoute(cityId, steepest).slope) steepest = at;
  }
  return { flattest, steepest };
}

describe('a descent that has to be ridden', () => {
  it('is on for the scheduled day, and leaves the days before it alone', () => {
    expect(blitzRuleFeatures(seedFor('lagos')).skillSpeed).toBe(true);
    expect(blitzRuleFeatures(seedFor('lagos', '2026-09-19')).skillSpeed).toBe(false);
    expect(blitzRuleFeatures('seed').skillSpeed).toBe(false);
  });

  it('goes nowhere for a rider who touches nothing', () => {
    for (const city of BLITZ_CITIES) {
      const state = ride(city.id, () => idle);
      expect(state.phase, city.id).toBe('timeout');
      expect(state.distanceMeters / city.lengthMeters, city.id).toBeLessThan(0.4);
      // Nothing, against the ~17,000 a ridden run scores.
      expect(state.score, city.id).toBeLessThan(700);
    }
  }, 30_000);

  it('winds down on the flat, and keeps rolling down a pitch', () => {
    const { flattest, steepest } = pitches('lagos');
    let flat = rollingAt('lagos', flattest, 18);
    let steep = rollingAt('lagos', steepest, 18);
    for (let tick = 0; tick < 6 * 30; tick += 1) {
      flat = stepBlitzRun(flat, idle);
      steep = stepBlitzRun(steep, idle);
    }
    // Nothing is driving it on the flat, so it gives the speed back.
    expect(flat.speedMps).toBeLessThan(14);
    // The hill is still a hill.
    expect(steep.speedMps).toBeGreaterThan(flat.speedMps);
  }, 30_000);

  it('lets nitro shove a bike that is not tucked', () => {
    const start = rollingAt('lagos', 400, 10);
    let coasting = start;
    let boosted = start;
    for (let tick = 0; tick < 60; tick += 1) {
      coasting = stepBlitzRun(coasting, idle);
      boosted = stepBlitzRun(boosted, { ...idle, boost: true });
    }
    // Worth spending sitting up, which is exactly when a rider reaches for it.
    expect(boosted.speedMps).toBeGreaterThan(coasting.speedMps + 4);
    // And it is a burst, not a ride: the tank goes down while it runs.
    expect(boosted.boostEnergy).toBeLessThan(start.boostEnergy);
  }, 30_000);

  it('pays a rider who works the bike far more than one who only steers', () => {
    for (const city of BLITZ_CITIES) {
      const ridden = ride(city.id, (state) => blitzRiderInput(state));
      const steerOnly = ride(city.id, (state) => ({ ...blitzRiderInput(state), tuck: false, boost: false }));
      expect(ridden.phase, city.id).toBe('finished');
      expect(steerOnly.phase, city.id).toBe('timeout');
      expect(ridden.score, city.id).toBeGreaterThan(steerOnly.score * 5);
    }
  }, 30_000);

  it('still lets an ordinary rider finish, and rewards one who commits to the tuck', () => {
    for (const city of BLITZ_CITIES) {
      const timid = ride(city.id, (state) => blitzRiderInput(state));
      const keen = ride(city.id, (state) => { const input = blitzRiderInput(state); return { ...input, tuck: Math.abs(input.steer) < 0.5 }; });
      expect(timid.phase, city.id).toBe('finished');
      expect(keen.phase, city.id).toBe('finished');
      expect(keen.elapsedMs / 1_000, city.id).toBeLessThan(BLITZ_LIMIT_SECONDS - 20);
    }
  }, 30_000);

  it('does not hold the racing line for a rider who is not steering', () => {
    /*
     * "It still bends accurately even without playing." A lane is measured
     * from the centre line, so a bike nobody steers sat in the middle and the
     * ROAD did the cornering; the corner push meant to prevent that scales
     * with the SQUARE of speed and was worth almost nothing at a coasting
     * pace. Tested with the tuck held, because a bike that is not moving
     * cannot demonstrate anything about corners.
     */
    for (const city of BLITZ_CITIES) {
      let state = createBlitzRun({ cityId: city.id, seed: seedFor(city.id) });
      let widest = 0;
      let offRoadTicks = 0;
      let ticks = 0;
      while (state.phase === 'countdown' || state.phase === 'running') {
        state = stepBlitzRun(state, { ...idle, tuck: true });
        if (state.phase !== 'running') continue;
        ticks += 1;
        widest = Math.max(widest, Math.abs(state.laneOffset));
        if (Math.abs(state.laneOffset) > city.roadWidth / 2) offRoadTicks += 1;
      }
      // It leaves the road, and not once by a whisker: more than half the run.
      expect(widest, city.id).toBeGreaterThan(city.roadWidth / 2);
      expect(offRoadTicks / ticks, city.id).toBeGreaterThan(0.5);
    }
  }, 30_000);
});
