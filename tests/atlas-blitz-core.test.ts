import { describe, expect, it } from 'vitest';

import { BLITZ_TICK_RATE, createBlitzRun, getBlitzScoreBreakdown, sampleBlitzRoute, stepBlitzRun } from '../shared/atlas/blitz/core';
import { BLITZ_CITIES, nextBlitzCity } from '../shared/atlas/blitz/cities';
import { selectBlitzMissions } from '../shared/atlas/blitz/missions';
import type { BlitzInput, BlitzRunState } from '../shared/atlas/blitz/types';

const idle: BlitzInput = { steer: 0, drift: false, boost: false };

function advance(state: BlitzRunState, ticks: number, input: BlitzInput = idle): BlitzRunState {
  let current = state;
  for (let tick = 0; tick < ticks; tick += 1) current = stepBlitzRun(current, input);
  return current;
}

/*
 * The boost economy.
 *
 * It drained 1.05 a tick against a 28 charge - 31.5 a second - so a boost
 * lasted 1.06 seconds and never came back, because idle regen of 0.045 a tick
 * needs ten minutes to refill. A 90 second run therefore sat at exactly base
 * speed from end to end, and the owner's report was the obvious consequence:
 * "the bike movement doesn't feel like it's moving". A racing game reads as
 * fast because its speed changes.
 */
describe('the boost economy', () => {
  const boost: BlitzInput = { steer: 0, drift: false, boost: true };
  const running = () => advance(createBlitzRun({ cityId: 'lagos', seed: 'boost' }), BLITZ_TICK_RATE * 3 + 2);

  it('holds a boost for seconds, not for one', () => {
    let state = running();
    let boostingTicks = 0;
    for (let tick = 0; tick < BLITZ_TICK_RATE * 6; tick += 1) {
      state = stepBlitzRun(state, boost);
      if (state.boostActive) boostingTicks += 1;
    }
    expect(boostingTicks / BLITZ_TICK_RATE).toBeGreaterThan(1.8);
  });

  it('actually reaches boosted speed and not just base speed', () => {
    let state = running();
    let fastest = 0;
    for (let tick = 0; tick < BLITZ_TICK_RATE * 4; tick += 1) {
      state = stepBlitzRun(state, boost);
      fastest = Math.max(fastest, state.speedMps);
    }
    // Dirt reduces Lagos cruise to 27 m/s; boost still adds 8.5 m/s.
    expect(fastest).toBeGreaterThan(35);
  });

  /*
   * The single 0.25 threshold let an empty tank flick boost on for one tick
   * every few ticks as regen crossed it, which read as a judder rather than a
   * boost. Engaging needs a real charge; continuing does not.
   */
  it('does not stutter on and off once the tank is empty', () => {
    /*
     * Counting on/off flips is the wrong measure - a drained tank is *meant*
     * to recharge and fire again. What must not happen is a boost that lasts a
     * tick or two, which is what the single 0.25 threshold produced and what
     * read as a judder. So this measures the shortest episode instead.
     */
    let state = running();
    for (let tick = 0; tick < BLITZ_TICK_RATE * 30; tick += 1) state = stepBlitzRun(state, boost);
    const episodes: number[] = [];
    let current = 0;
    for (let tick = 0; tick < BLITZ_TICK_RATE * 20; tick += 1) {
      state = stepBlitzRun(state, boost);
      if (state.boostActive) current += 1;
      else if (current > 0) { if (state.elapsedTicks - state.lastImpactTick > BLITZ_TICK_RATE) episodes.push(current); current = 0; }
    }
    expect(episodes.length).toBeGreaterThan(0);
    expect(Math.min(...episodes)).toBeGreaterThan(BLITZ_TICK_RATE * 0.4);
  });

  it('pays for drifting, which is what makes the risk worth taking', () => {
    const start = running();
    let drifted = start, cruised = start;
    for (let tick = 0; tick < BLITZ_TICK_RATE * 3; tick += 1) {
      drifted = stepBlitzRun(drifted, { steer: 0.5, drift: true, boost: false });
      cruised = stepBlitzRun(cruised, idle);
    }
    expect(drifted.boostEnergy).toBeGreaterThan(cruised.boostEnergy);
  });

  it('keeps the tank bounded so boost can never become permanent', () => {
    let state = running();
    for (let tick = 0; tick < BLITZ_TICK_RATE * 120; tick += 1) state = stepBlitzRun(state, { steer: 0.5, drift: true, boost: false });
    expect(state.boostEnergy).toBeLessThanOrEqual(60);
  });
});

describe('Beacon Blitz deterministic arcade core', () => {
  it('ships three ordered launch cities and loops the tour', () => {
    expect(BLITZ_CITIES.map((city) => city.id)).toEqual(['lagos', 'london', 'dubai']);
    expect(nextBlitzCity('lagos')).toBe('london');
    expect(nextBlitzCity('dubai')).toBe('lagos');
  });

  it('rotates three distinct Nimiq missions deterministically from a larger pool', () => {
    const first = selectBlitzMissions('lagos-seed-21');
    const replay = selectBlitzMissions('lagos-seed-21');
    const next = selectBlitzMissions('lagos-seed-22');
    expect(first).toEqual(replay);
    expect(new Set(first.map((mission) => mission.id)).size).toBe(3);
    expect(first).not.toEqual(next);
    expect(first.every((mission) => mission.description.length <= 120)).toBe(true);
  });

  it('counts down, accelerates automatically, steers lanes, drifts and spends boost', () => {
    let state = createBlitzRun({ cityId: 'lagos', seed: 'handling' });
    state = advance(state, BLITZ_TICK_RATE * 3);
    expect(state.phase).toBe('running');

    const rolling = advance(state, BLITZ_TICK_RATE);
    const turning = advance(rolling, 10, { steer: 0.8, drift: true, boost: false });
    expect(rolling.speedMps).toBeGreaterThan(10);
    expect(turning.laneOffset).toBeGreaterThan(0);
    expect(turning.driftScore).toBeGreaterThan(0);
    expect(turning.boostEnergy).toBeGreaterThan(rolling.boostEnergy);

    const boosted = advance(turning, 12, { steer: 0, drift: false, boost: true });
    expect(boosted.boostEnergy).toBeLessThan(turning.boostEnergy);
    expect(boosted.speedMps).toBeGreaterThan(turning.speedMps);
  });

  it('carries lateral momentum and brakes instead of teleporting between lanes', () => {
    let state = advance(createBlitzRun({ cityId: 'lagos', seed: 'physical-handling' }), BLITZ_TICK_RATE * 3 + 2);
    state = advance(state, 12, { steer: 0.8, drift: false, boost: false });
    expect(state.lateralVelocityMps).toBeGreaterThan(0.5);
    const offsetAtRelease = state.laneOffset;
    state = advance(state, 10, idle);
    expect(state.laneOffset).toBeGreaterThan(offsetAtRelease);
    expect(Math.abs(state.lateralVelocityMps)).toBeLessThan(3);

    const coasting = advance(state, 12, idle);
    const braking = advance(state, 12, { ...idle, brake: true });
    expect(braking.speedMps).toBeLessThan(coasting.speedMps - 2);
  });

  it('emits deterministic surface, launch and landing events from authored terrain', () => {
    let state = advance(createBlitzRun({ cityId: 'lagos', seed: 'physical-events' }), BLITZ_TICK_RATE * 3 + 2);
    let sawLaunch = false;
    let sawLanding = false;
    let sawSurface = false;
    let visitedNonPavement = false;
    for (let tick = 0; tick < BLITZ_TICK_RATE * 35 && state.phase === 'running'; tick += 1) {
      state = stepBlitzRun(state, idle);
      sawLaunch ||= state.lastEvent?.type === 'launch';
      sawLanding ||= state.lastEvent?.type === 'landing';
      sawSurface ||= state.lastEvent?.type === 'surface-change';
      visitedNonPavement ||= state.surface !== 'pavement';
    }
    expect(sawLaunch).toBe(true);
    expect(sawLanding).toBe(true);
    expect(sawSurface).toBe(true);
    expect(visitedNonPavement).toBe(true);
    expect(state.heightMeters).toBeGreaterThanOrEqual(0);
  });

  it('projects a stable world position and heading along each authored route', () => {
    for (const city of BLITZ_CITIES) {
      const a = sampleBlitzRoute(city.id, city.lengthMeters * 0.35, -1.2);
      const b = sampleBlitzRoute(city.id, city.lengthMeters * 0.35, -1.2);
      expect(a).toEqual(b);
      expect(Number.isFinite(a.x) && Number.isFinite(a.z) && Number.isFinite(a.headingRadians)).toBe(true);
    }
  });

  it('opens physical mission contracts on the road without blocking the ride', () => {
    let state = createBlitzRun({ cityId: 'lagos', seed: 'relay-gate' });
    state = advance(state, BLITZ_TICK_RATE * 3);
    while (!state.activeMission && state.phase === 'running') state = stepBlitzRun(state, idle);
    expect(state.activeMission).not.toBeNull();
    expect(state.missions[state.activeMission!.missionIndex]?.status).toBe('active');
    expect(state.missions[state.activeMission!.missionIndex]?.description).toBeTruthy();
  });

  it('finishes every launch city in 55–75 seconds on a clean strong run', () => {
    for (const city of BLITZ_CITIES) {
      let state = createBlitzRun({ cityId: city.id, seed: `${city.id}-clean-finish` });
      for (let tick = 0; tick < BLITZ_TICK_RATE * 90 && state.phase !== 'finished'; tick += 1) {
        state = stepBlitzRun(state, { steer: 0, drift: false, boost: tick % 120 < 24 });
      }
      expect(state.phase, city.id).toBe('finished');
      expect(state.elapsedMs, city.id).toBeGreaterThanOrEqual(55_000);
      expect(state.elapsedMs, city.id).toBeLessThanOrEqual(75_000);
      expect(state.score, city.id).toBe(getBlitzScoreBreakdown(state).total);
    }
  });

  it('times out a rider who stays off the racing line', () => {
    let state = createBlitzRun({ cityId: 'dubai', seed: 'timeout' });
    for (let tick = 0; tick < BLITZ_TICK_RATE * 94 && state.phase !== 'timeout' && state.phase !== 'finished'; tick += 1) {
      state = stepBlitzRun(state, { steer: 1, drift: false, boost: false });
    }
    expect(state.phase).toBe('timeout');
    expect(state.distanceMeters).toBeLessThan(BLITZ_CITIES[2]!.lengthMeters);
  });
});
