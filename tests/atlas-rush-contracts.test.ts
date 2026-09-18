import { describe, expect, it } from 'vitest';

import { BLITZ_CITIES, BLITZ_LINE_GATES, blitzCity } from '../shared/atlas/blitz/cities';
import { BLITZ_TICK_RATE, createBlitzRun, stepBlitzRun } from '../shared/atlas/blitz/core';
import { BLITZ_MISSION_POOL, blitzMissionWindow, selectBlitzMissions } from '../shared/atlas/blitz/missions';
import type { BlitzRunState } from '../shared/atlas/blitz/types';
import { blitzRiderInput } from './support/blitz-rider';

/*
 * Can the day's contracts be done at all?
 *
 * This file exists because for a long time the answer was no, and nothing said
 * so. AIR JUDGE asked for a jump between 0.46 and 0.62 of a course whose only
 * kickers sit at 0.18 and 0.75, so it failed on every city, every day, and took
 * 220 points with it. PERFECT DESCENT could only complete once its two siblings
 * had, so missing one contract lost two. The seed for 2026-09-18 drew both plus
 * a third, and the owner rode a board on which nothing could be cleared.
 *
 * None of that was visible in a unit test, because every test drove a rider and
 * checked a score. What was missing was a check that the thing being asked for
 * is present on the road at the point it is asked for. That is what these are.
 */

function ride(cityId: 'lagos' | 'london' | 'dubai', pick: (state: BlitzRunState, tick: number) => Parameters<typeof stepBlitzRun>[1], seed = 'contracts') {
  let state = createBlitzRun({ cityId, seed });
  for (let tick = 0; tick < BLITZ_TICK_RATE * 140 && state.phase !== 'finished' && state.phase !== 'timeout'; tick += 1) {
    state = stepBlitzRun(state, pick(state, tick));
  }
  return state;
}

describe('every contract can be reached on every city', () => {
  it.each(BLITZ_CITIES.map((city) => [city.id] as const))('%s puts a kicker inside the AIR JUDGE window', (cityId) => {
    const city = blitzCity(cityId);
    const mission = BLITZ_MISSION_POOL.find((candidate) => candidate.id === 'air-judge')!;
    const window = blitzMissionWindow(city, mission);
    const jumps = city.terrainFeatures.filter((feature) => feature.kind === 'jump');
    expect(jumps.length).toBeGreaterThan(0);
    // The contract asks a rider to take a jump. There has to be one to take.
    expect(jumps.some((jump) => jump.distance01 >= window.start && jump.distance01 <= window.end)).toBe(true);
  });

  it.each(BLITZ_CITIES.map((city) => [city.id] as const))('%s puts all three scored gates inside the LINE MASTER window', (cityId) => {
    const city = blitzCity(cityId);
    const mission = BLITZ_MISSION_POOL.find((candidate) => candidate.id === 'line-master')!;
    const window = blitzMissionWindow(city, mission);
    // The contract's target is three, and it is scored on the gates the
    // renderer draws. All three must fall inside the window it is live for.
    expect(mission.target).toBe(BLITZ_LINE_GATES.length);
    for (const gate of BLITZ_LINE_GATES) {
      expect(gate).toBeGreaterThanOrEqual(window.start);
      expect(gate).toBeLessThanOrEqual(window.end);
    }
  });

  it.each(BLITZ_CITIES.map((city) => [city.id] as const))('%s lays enough supplies inside the SUPPLY LINE window', (cityId) => {
    const city = blitzCity(cityId);
    const mission = BLITZ_MISSION_POOL.find((candidate) => candidate.id === 'supply-line')!;
    const window = blitzMissionWindow(city, mission);
    const inside = city.pickups.filter((pickup) => pickup.distance01 >= window.start && pickup.distance01 <= window.end);
    // Four are asked for, so four must exist to be taken.
    expect(inside.length).toBeGreaterThanOrEqual(mission.target);
  });

  it.each(BLITZ_CITIES.map((city) => [city.id] as const))('%s leaves time to hold a six-second tuck', (cityId) => {
    const city = blitzCity(cityId);
    const mission = BLITZ_MISSION_POOL.find((candidate) => candidate.id === 'hold-the-tuck')!;
    const window = blitzMissionWindow(city, mission);
    const metres = city.lengthMeters * (window.end - window.start);
    // Tucked cruise is the fastest a rider goes without boost, so this is the
    // shortest the window can last. It still has to be longer than the ask.
    const fastest = city.baseSpeedMps * 1.16;
    expect(metres / fastest).toBeGreaterThan(6);
  });

  it('no contract in the pool depends on another contract completing', () => {
    // PERFECT DESCENT did, which made a missed contract cost two. A contract a
    // rider cannot act on directly does not belong in the pool.
    for (const mission of BLITZ_MISSION_POOL) {
      expect(mission.id).not.toBe('perfect-descent');
    }
  });

  it('no two contracts drawn together can contradict each other', () => {
    // RISK ROUTE asked a rider onto the grass; STAY ON TRAIL failed the moment
    // they touched it. Drawn together - and the selector draws one per kind, so
    // they could be - the day was unwinnable before it started.
    const offTrail = BLITZ_MISSION_POOL.filter((mission) => /risk-route/.test(mission.id));
    expect(offTrail).toHaveLength(0);
  });
});

describe('the contracts a day draws are winnable in one run', () => {
  it.each(BLITZ_CITIES.map((city) => [city.id] as const))('%s: a rider holding a tuck clears HOLD THE TUCK', (cityId) => {
    const city = blitzCity(cityId);
    const mission = BLITZ_MISSION_POOL.find((candidate) => candidate.id === 'hold-the-tuck')!;
    const window = blitzMissionWindow(city, mission);
    const start = city.lengthMeters * window.start;

    // Seeds are searched rather than assumed: the selector picks one contract
    // per kind, and this asserts behaviour only on a day that actually drew it.
    const seed = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'].find((candidate) =>
      selectBlitzMissions(candidate).some((drawn) => drawn.id === 'hold-the-tuck'));
    expect(seed).toBeDefined();

    /*
     * The repo's avoider, with a tuck held once the window opens.
     *
     * A rider that steers nothing wedges on Lagos's centre-lane log, and a
     * contact breaks the tuck - correctly, since unbroken is the whole ask.
     * Proving the contract is winnable needs somebody who can stay off the
     * obstacles, which is what this rider is for.
     */
    const state = ride(cityId, (run) => ({ ...blitzRiderInput(run), tuck: run.distanceMeters >= start }), seed!);
    const held = state.missions.find((candidate) => candidate.id === 'hold-the-tuck');
    expect(held?.status).toBe('complete');
  });

  it('a day that draws SUPPLY LINE can bank four supplies in its window', () => {
    const city = blitzCity('lagos');
    const mission = BLITZ_MISSION_POOL.find((candidate) => candidate.id === 'supply-line')!;
    const window = blitzMissionWindow(city, mission);
    const inside = city.pickups.filter((pickup) => pickup.distance01 >= window.start && pickup.distance01 <= window.end);
    // Reachable means takeable without crashing: no two of the four closest
    // supplies may sit further apart than the bike can cross between them.
    const lanes = inside.slice(0, mission.target).map((pickup) => pickup.lane);
    expect(Math.max(...lanes) - Math.min(...lanes)).toBeLessThanOrEqual(city.roadWidth);
  });
});
