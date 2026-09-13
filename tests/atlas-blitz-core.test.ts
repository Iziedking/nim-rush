import { describe, expect, it } from 'vitest';

import { BLITZ_TICK_RATE, createBlitzRun, sampleBlitzRoute, stepBlitzRun } from '../shared/atlas/blitz/core';
import { BLITZ_CITIES, nextBlitzCity } from '../shared/atlas/blitz/cities';
import { selectBlitzMissions } from '../shared/atlas/blitz/missions';
import type { BlitzInput, BlitzRunState } from '../shared/atlas/blitz/types';

const idle: BlitzInput = { steer: 0, drift: false, boost: false };

function advance(state: BlitzRunState, ticks: number, input: BlitzInput = idle): BlitzRunState {
  let current = state;
  for (let tick = 0; tick < ticks; tick += 1) current = stepBlitzRun(current, input);
  return current;
}

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
    expect(first.every((mission) => mission.explanation.length <= 96)).toBe(true);
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

  it('projects a stable world position and heading along each authored route', () => {
    for (const city of BLITZ_CITIES) {
      const a = sampleBlitzRoute(city.id, city.lengthMeters * 0.35, -1.2);
      const b = sampleBlitzRoute(city.id, city.lengthMeters * 0.35, -1.2);
      expect(a).toEqual(b);
      expect(Number.isFinite(a.x) && Number.isFinite(a.z) && Number.isFinite(a.headingRadians)).toBe(true);
    }
  });

  it('opens relay gates on the road and rewards only the correct choice', () => {
    let state = createBlitzRun({ cityId: 'lagos', seed: 'relay-gate' });
    state = advance(state, BLITZ_TICK_RATE * 3);
    while (!state.activeRelay && state.phase === 'running') state = stepBlitzRun(state, idle);
    expect(state.activeRelay).not.toBeNull();
    const mission = state.missions[state.activeRelay!.missionIndex]!;
    const before = state.relayScore;
    state = stepBlitzRun(state, { ...idle, relayChoice: mission.correctChoice });
    expect(state.relayScore).toBeGreaterThan(before);
    expect(state.missions[0]?.resolved).toBe(true);
  });

  it('finishes every launch city in 55–75 seconds on a clean strong run', () => {
    for (const city of BLITZ_CITIES) {
      let state = createBlitzRun({ cityId: city.id, seed: `${city.id}-clean-finish` });
      for (let tick = 0; tick < BLITZ_TICK_RATE * 90 && state.phase !== 'finished'; tick += 1) {
        const relay = state.activeRelay;
        const choice = relay ? state.missions[relay.missionIndex]!.correctChoice : undefined;
        state = stepBlitzRun(state, { steer: 0, drift: false, boost: tick % 120 < 24, relayChoice: choice });
      }
      expect(state.phase, city.id).toBe('finished');
      expect(state.elapsedMs, city.id).toBeGreaterThanOrEqual(55_000);
      expect(state.elapsedMs, city.id).toBeLessThanOrEqual(75_000);
      expect(state.score, city.id).toBe(
        state.distanceScore + state.driftScore + state.relayScore + state.timeBonus - state.penaltyScore,
      );
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
