import { describe, expect, it } from 'vitest';

import { BLITZ_CITIES, blitzEnabledObstacles } from '../shared/atlas/blitz/cities';
import { obstacleShape } from '../shared/atlas/blitz/course';
import { BLITZ_NITRO_BOTTLE, BLITZ_TICK_RATE, createBlitzRun, stepBlitzRun } from '../shared/atlas/blitz/core';
import { replayBlitzTrace } from '../shared/atlas/blitz/replay';
import { BLITZ_BASE_LOADOUT, BLITZ_RIDER_LEVELS, blitzLoadoutFor, blitzNextRiderLevel, blitzRiderLevel } from '../shared/atlas/blitz/rider';
import type { BlitzInput, BlitzRunState, BlitzTraceFrame } from '../shared/atlas/blitz/types';
import { blitzRiderInput } from './support/blitz-rider';

/*
 * Supplies, and what a level is allowed to be worth.
 *
 * Boost used to refill on its own and drift cost nothing, so neither was a
 * decision. Both are carried now. That only works if three things hold: a
 * supply can actually be reached, a supply cannot be conjured, and none of it
 * reaches the ranked board - a rider who has played longer must never out-rank
 * a rider who rode better.
 */

const idle: BlitzInput = { steer: 0, drift: false, boost: false };

function run(cityId: BlitzRunState['cityId'], overrides: Partial<Parameters<typeof createBlitzRun>[0]> = {}): BlitzRunState {
  let state = createBlitzRun({ cityId, seed: `${cityId}-supplies`, ...overrides });
  // Out of the countdown and up to speed. A slide needs 8 m/s to mean
  // anything, so a fixture that only clears the countdown is a stationary
  // bike and would test nothing about drifting.
  for (let tick = 0; tick < BLITZ_TICK_RATE * 6; tick += 1) state = stepBlitzRun(state, idle);
  return state;
}

/*
 * Steering hard one way for a whole slide rides off the road, and off-road
 * drops the bike under the speed a slide needs - so the test would measure the
 * shoulder rather than the drift. Weaving keeps the bike on the road with the
 * steering input a slide requires.
 */
function slalom(tick: number, drift: boolean): BlitzInput {
  return { steer: Math.floor(tick / 12) % 2 === 0 ? 1 : -1, drift, boost: false };
}

describe('supplies on the road', () => {
  it('gives every city both kinds, spread across the whole descent', () => {
    for (const city of BLITZ_CITIES) {
      const nitro = city.pickups.filter((pickup) => pickup.kind === 'nitro');
      const gearboxes = city.pickups.filter((pickup) => pickup.kind === 'gearbox');
      expect(nitro.length, city.id).toBeGreaterThanOrEqual(8);
      expect(gearboxes.length, city.id).toBeGreaterThanOrEqual(4);
      // Nothing bunched into one half: a rider who runs dry at the top must
      // have somewhere to refill before the bottom.
      expect(city.pickups.filter((pickup) => pickup.distance01 < 0.5).length, city.id).toBeGreaterThanOrEqual(6);
      expect(city.pickups.filter((pickup) => pickup.distance01 >= 0.5).length, city.id).toBeGreaterThanOrEqual(6);
      expect(new Set(city.pickups.map((pickup) => pickup.id)).size, city.id).toBe(city.pickups.length);
    }
  });

  /*
   * The rule that makes the placement fair rather than cruel: a supply inside
   * an obstacle's blocked band could only be taken by crashing into it.
   */
  it('never puts a supply somewhere a rider would have to crash to take it', () => {
    for (const city of BLITZ_CITIES) {
      const edge = city.roadWidth / 2;
      for (const pickup of city.pickups) {
        const at = pickup.distance01 * city.lengthMeters;
        expect(Math.abs(pickup.lane), `${pickup.id} lane`).toBeLessThan(edge);
        // Pro carries every obstacle, so checking pro checks both rulesets.
        for (const obstacle of blitzEnabledObstacles(city, 'pro')) {
          const shape = obstacleShape(obstacle.id);
          const distance = obstacle.distance01 * city.lengthMeters;
          if (at < distance - shape.halfLength - 1.1 || at > distance + shape.halfLength + 1.1) continue;
          const blockedFrom = obstacle.lane - shape.halfWidth - 0.32;
          const blockedTo = obstacle.lane + shape.halfWidth + 0.32;
          const inside = pickup.lane > blockedFrom && pickup.lane < blockedTo;
          expect({ pickup: pickup.id, obstacle: obstacle.id, inside }).toMatchObject({ inside: false });
        }
      }
    }
  });

  it('is taken once, by riding over it, and never again', () => {
    const city = BLITZ_CITIES[0]!;
    const first = city.pickups[0]!;
    // Only the countdown: six seconds of warm-up would already be past the
    // first bottle, and the test would measure nothing.
    let state = createBlitzRun({ cityId: city.id, seed: 'taken-once' });
    for (let tick = 0; tick < BLITZ_TICK_RATE * 3 + 2; tick += 1) state = stepBlitzRun(state, idle);
    const before = state.boostEnergy;
    // The first supply sits on the centre line, so idling straight takes it.
    for (let tick = 0; tick < BLITZ_TICK_RATE * 6 && !state.collectedPickupIds.includes(first.id); tick += 1) {
      state = stepBlitzRun(state, idle);
    }
    expect(state.collectedPickupIds).toContain(first.id);
    expect(state.nitroTaken).toBe(1);
    expect(state.boostEnergy).toBeGreaterThan(before);
    const banked = state.boostEnergy;
    // Riding on cannot take it a second time, and cannot un-take it.
    for (let tick = 0; tick < BLITZ_TICK_RATE * 2; tick += 1) state = stepBlitzRun(state, idle);
    expect(state.collectedPickupIds.filter((id) => id === first.id)).toHaveLength(1);
    expect(state.nitroTaken).toBe(1);
    expect(state.boostEnergy).toBeLessThanOrEqual(banked);
  });

  it('never fills a tank past what the rider carries', () => {
    const city = BLITZ_CITIES[0]!;
    let state = createBlitzRun({ cityId: city.id, seed: 'brimmed', loadout: { ...BLITZ_BASE_LOADOUT, startingBoost: BLITZ_BASE_LOADOUT.boostCapacity } });
    for (let tick = 0; tick < BLITZ_TICK_RATE * 9; tick += 1) state = stepBlitzRun(state, idle);
    expect(state.nitroTaken).toBeGreaterThan(0);
    expect(state.boostEnergy).toBeLessThanOrEqual(BLITZ_BASE_LOADOUT.boostCapacity);
    expect(BLITZ_NITRO_BOTTLE).toBeGreaterThan(0);
  });
});

describe('boost and drift are spent, not granted', () => {
  /*
   * The change that makes the line matter. A tank that refilled on its own gave
   * a rider who did nothing the same fuel as a rider who took the harder line.
   */
  it('does not refill a tank on its own', () => {
    /*
     * Stated as the rule itself rather than as an end state: fuel may only go
     * up on a tick that took a supply or ran a slide. Asserting "the tank is
     * empty at the end" would pass just as well against a slow trickle.
     */
    let state = run('lagos');
    let rises = 0;
    for (let tick = 0; tick < BLITZ_TICK_RATE * 20; tick += 1) {
      const previous = state;
      state = stepBlitzRun(state, { steer: 0, drift: false, boost: true });
      const earned = state.nitroTaken > previous.nitroTaken || state.driftActive;
      if (state.boostEnergy > previous.boostEnergy && !earned) rises += 1;
    }
    expect(rises).toBe(0);
  });

  it('charges a gearbox for a slide and refuses one when the frame is empty', () => {
    let state = run('lagos');
    const started = state.driftCharges;
    expect(started).toBeGreaterThan(0);
    state = stepBlitzRun(state, slalom(0, true));
    expect(state.driftActive).toBe(true);
    expect(state.driftCharges).toBe(started - 1);

    // Holding must not spend the rest of the frame the instant each window ends.
    for (let tick = 1; tick < BLITZ_TICK_RATE * 8; tick += 1) state = stepBlitzRun(state, slalom(tick, true));
    expect(state.driftCharges).toBe(started - 1);
    expect(state.driftActive).toBe(false);

    // Releasing and asking again spends the next one.
    state = stepBlitzRun(state, slalom(0, false));
    state = stepBlitzRun(state, slalom(0, true));
    expect(state.driftCharges).toBe(started - 2);
  });

  it('runs a slide for exactly the window a gearbox buys', () => {
    let state = run('lagos');
    let sliding = 0;
    for (let tick = 0; tick < BLITZ_TICK_RATE * 6; tick += 1) {
      state = stepBlitzRun(state, slalom(tick, true));
      if (state.driftActive) sliding += 1;
    }
    expect(sliding).toBe(BLITZ_BASE_LOADOUT.driftWindowTicks);
  });

  /*
   * The loop that makes a gearbox worth spending: a slide is how a rider turns
   * control into fuel. Without this, a scarce drift would simply be a worse
   * drift.
   */
  it('lets a slide earn nitro back', () => {
    const start = run('lagos');
    let drifting = start;
    let straight = start;
    for (let tick = 0; tick < BLITZ_BASE_LOADOUT.driftWindowTicks; tick += 1) {
      drifting = stepBlitzRun(drifting, slalom(tick, true));
      straight = stepBlitzRun(straight, slalom(tick, false));
    }
    expect(drifting.driftActive).toBe(true);
    // Both took the same supplies, so the difference is the slide and nothing
    // else. If this ever fails the comparison is confounded, not the rule.
    expect(drifting.nitroTaken).toBe(straight.nitroTaken);
    expect(drifting.boostEnergy).toBeGreaterThan(straight.boostEnergy);
    expect(drifting.driftScore).toBeGreaterThan(straight.driftScore);
  });

  it('refuses a slide the bike is too slow to make', () => {
    let state = createBlitzRun({ cityId: 'lagos', seed: 'too-slow' });
    for (let tick = 0; tick < BLITZ_TICK_RATE * 3 + 2; tick += 1) state = stepBlitzRun(state, idle);
    const charges = state.driftCharges;
    // Braking to a stop, then asking for a slide.
    for (let tick = 0; tick < BLITZ_TICK_RATE * 4; tick += 1) state = stepBlitzRun(state, { steer: 0, drift: false, boost: false, brake: true });
    state = stepBlitzRun(state, { steer: 1, drift: true, boost: false, brake: true });
    expect(state.speedMps).toBeLessThan(8);
    expect(state.driftActive).toBe(false);
    expect(state.driftCharges).toBe(charges);
  });
});

describe('the rider ladder', () => {
  it('climbs on career score and never falls off either end', () => {
    expect(blitzRiderLevel(0).level).toBe(1);
    expect(blitzRiderLevel(-500).level).toBe(1);
    expect(blitzRiderLevel(Number.NaN).level).toBe(1);
    expect(blitzRiderLevel(14_999).level).toBe(1);
    expect(blitzRiderLevel(15_000).level).toBe(2);
    expect(blitzRiderLevel(10_000_000).level).toBe(BLITZ_RIDER_LEVELS.length);
    expect(blitzNextRiderLevel(10_000_000)).toBeNull();
    expect(blitzNextRiderLevel(0)?.remaining).toBe(15_000);
  });

  it('only ever widens the frame, never makes the bike faster', () => {
    // Each rung is a superset of the one below it, and none of them touches
    // anything the simulation reads as speed.
    for (let index = 1; index < BLITZ_RIDER_LEVELS.length; index += 1) {
      const lower = BLITZ_RIDER_LEVELS[index - 1]!.loadout;
      const higher = BLITZ_RIDER_LEVELS[index]!.loadout;
      expect(higher.boostCapacity).toBeGreaterThanOrEqual(lower.boostCapacity);
      expect(higher.driftCapacity).toBeGreaterThanOrEqual(lower.driftCapacity);
      expect(higher.driftWindowTicks).toBeGreaterThanOrEqual(lower.driftWindowTicks);
      expect(higher.pickupReach).toBeGreaterThanOrEqual(lower.pickupReach);
      expect(BLITZ_RIDER_LEVELS[index]!.requiredScore).toBeGreaterThan(BLITZ_RIDER_LEVELS[index - 1]!.requiredScore);
      expect(BLITZ_RIDER_LEVELS[index]!.unlock).not.toBe('');
    }
    expect(Object.keys(BLITZ_RIDER_LEVELS[0]!.loadout).sort()).toEqual(Object.keys(BLITZ_BASE_LOADOUT).sort());
  });

  /*
   * The line the whole feature rests on. If a level could reach the ranked
   * board, the board would be measuring hours played.
   */
  it('gives every ranked run the same equipment, whatever the rider has earned', () => {
    for (const level of BLITZ_RIDER_LEVELS) {
      expect(blitzLoadoutFor({ careerScore: level.requiredScore, ranked: true })).toEqual(BLITZ_BASE_LOADOUT);
    }
    expect(blitzLoadoutFor({ careerScore: 10_000_000, ranked: true })).toEqual(BLITZ_BASE_LOADOUT);
    expect(blitzLoadoutFor({ careerScore: 10_000_000, ranked: false })).not.toEqual(BLITZ_BASE_LOADOUT);
  });

  /*
   * And the reason the client cannot cheat it even if it tried: the server
   * rebuilds a ranked run from the city and the seed alone. A trace ridden on
   * a bigger tank simply does not reproduce.
   */
  it('cannot be smuggled onto the board, because a replay rebuilds the base run', () => {
    const top = BLITZ_RIDER_LEVELS[BLITZ_RIDER_LEVELS.length - 1]!.loadout;
    let cheated = createBlitzRun({ cityId: 'lagos', seed: 'smuggle', loadout: top });
    const frames: BlitzTraceFrame[] = [];
    while (cheated.phase === 'countdown' || cheated.phase === 'running') {
      const input = blitzRiderInput(cheated);
      frames.push({ tick: frames.length, input });
      cheated = stepBlitzRun(cheated, input);
    }
    expect(cheated.boostCapacity).toBe(top.boostCapacity);
    const verified = replayBlitzTrace({ cityId: 'lagos', seed: 'smuggle', frames });
    expect(verified.boostCapacity).toBe(BLITZ_BASE_LOADOUT.boostCapacity);
    expect(verified.driftCapacity).toBe(BLITZ_BASE_LOADOUT.driftCapacity);
    // The scores disagree, so the submission is refused rather than ranked.
    expect(verified.score).not.toBe(cheated.score);
  });

  it('replays a base run exactly, so an honest rider is never refused', () => {
    let honest = createBlitzRun({ cityId: 'lagos', seed: 'honest' });
    const frames: BlitzTraceFrame[] = [];
    while (honest.phase === 'countdown' || honest.phase === 'running') {
      const input = blitzRiderInput(honest);
      frames.push({ tick: frames.length, input });
      honest = stepBlitzRun(honest, input);
    }
    const verified = replayBlitzTrace({ cityId: 'lagos', seed: 'honest', frames });
    expect(verified.score).toBe(honest.score);
    expect(verified.nitroTaken).toBe(honest.nitroTaken);
    expect(verified.gearboxTaken).toBe(honest.gearboxTaken);
    expect(verified.collectedPickupIds).toEqual(honest.collectedPickupIds);
  });
});
