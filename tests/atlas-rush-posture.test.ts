import { describe, expect, it } from 'vitest';

import { BLITZ_CITIES } from '../shared/atlas/blitz/cities';
import { BLITZ_TICK_RATE, createBlitzRun, stepBlitzRun } from '../shared/atlas/blitz/core';
import { hashBlitzTrace, replayBlitzTrace, validateBlitzTrace } from '../shared/atlas/blitz/replay';
import type { BlitzInput, BlitzRunState, BlitzTraceFrame } from '../shared/atlas/blitz/types';
import { blitzRacingLine, blitzRiderInput } from './support/blitz-rider';

/*
 * Riding position.
 *
 * The bike used to hold its own speed whatever the rider did, so a run was
 * steering and nothing else: a rider who touched no other control arrived at
 * the same time as one who worked the whole descent. Tuck makes speed and
 * costs grip, sitting up does the opposite, and neither is free.
 */

function ride(cityId: BlitzRunState['cityId'], style: (state: BlitzRunState) => BlitzInput, seed = 'posture') {
  let state = createBlitzRun({ cityId, seed });
  let top = 0;
  for (let tick = 0; tick < BLITZ_TICK_RATE * 95 && (state.phase === 'running' || state.phase === 'countdown'); tick += 1) {
    state = stepBlitzRun(state, style(state));
    top = Math.max(top, state.speedMps);
  }
  return { state, top };
}

const coasting = (state: BlitzRunState) => blitzRiderInput(state, { tuck: false });
const tucking = (state: BlitzRunState) => blitzRiderInput(state, { tuck: true });

describe('the bike no longer rides itself', () => {
  it.each(BLITZ_CITIES.map((city) => [city.id] as const))('%s rewards a rider who works the descent', (cityId) => {
    const coast = ride(cityId, coasting);
    const tuck = ride(cityId, tucking);
    // Several seconds, not a rounding difference: posture has to be worth
    // learning or it is another button nobody presses.
    expect(tuck.state.elapsedMs).toBeLessThan(coast.state.elapsedMs - 8_000);
    expect(tuck.top).toBeGreaterThan(coast.top + 5);
  });

  /*
   * And it has to cost something, or tuck is simply the correct input at every
   * moment and the choice disappears again.
   */
  it('makes a permanent tuck expensive in contacts', () => {
    const held = ride('lagos', tucking);
    const ridden = ride('lagos', (state) => blitzRiderInput(state));
    expect(held.state.collisions).toBeGreaterThan(ridden.state.collisions);
  });

  it('turns harder sat up than tucked, from the same speed and steering', () => {
    let base = createBlitzRun({ cityId: 'lagos', seed: 'grip' });
    for (let tick = 0; tick < BLITZ_TICK_RATE * 6; tick += 1) base = stepBlitzRun(base, { steer: 0, drift: false, boost: false });
    let tucked = base;
    let satUp = base;
    for (let tick = 0; tick < 20; tick += 1) {
      tucked = stepBlitzRun(tucked, { steer: 1, drift: false, boost: false, tuck: true });
      satUp = stepBlitzRun(satUp, { steer: 1, drift: false, boost: false, tuck: false });
    }
    expect(Math.abs(satUp.laneOffset)).toBeGreaterThan(Math.abs(tucked.laneOffset));
  });

  it('will not let a rider brake and tuck at once', () => {
    let state = createBlitzRun({ cityId: 'lagos', seed: 'both' });
    for (let tick = 0; tick < BLITZ_TICK_RATE * 6; tick += 1) state = stepBlitzRun(state, { steer: 0, drift: false, boost: false, tuck: true });
    const flying = state.speedMps;
    for (let tick = 0; tick < BLITZ_TICK_RATE * 2; tick += 1) state = stepBlitzRun(state, { steer: 0, drift: false, boost: false, tuck: true, brake: true });
    expect(state.speedMps).toBeLessThan(flying);
  });

  /*
   * A rider who never finds the tuck button must still get down the hill.
   * Losing to the clock before understanding why is the worst first run a
   * game can give somebody.
   */
  it.each(BLITZ_CITIES.map((city) => [city.id] as const))('%s can still be finished by a rider who only steers', (cityId) => {
    expect(ride(cityId, coasting).state.phase).toBe('finished');
  });
});

describe('the trace carries posture', () => {
  /*
   * Tuck changes both the speed and the grip, so a hash that ignored it would
   * let two runs that played out completely differently share one trace - and
   * the server would happily verify the wrong one.
   */
  it('hashes tuck, so two different runs cannot share a trace', async () => {
    const frame = (tuck: boolean): BlitzTraceFrame[] => [{ tick: 0, input: { steer: 0, drift: false, boost: false, tuck } }];
    expect(await hashBlitzTrace(frame(true))).not.toBe(await hashBlitzTrace(frame(false)));
  });

  it('accepts a posture trace and refuses a malformed one', () => {
    expect(() => validateBlitzTrace([{ tick: 0, input: { steer: 0, drift: false, boost: false, tuck: true } }])).not.toThrow();
    expect(() => validateBlitzTrace([{ tick: 0, input: { steer: 0, drift: false, boost: false, tuck: 'yes' } }] as unknown as BlitzTraceFrame[])).toThrow();
  });

  it('replays a ridden run exactly', () => {
    let honest = createBlitzRun({ cityId: 'lagos', seed: 'posture-replay' });
    const frames: BlitzTraceFrame[] = [];
    while (honest.phase === 'countdown' || honest.phase === 'running') {
      const input = { ...blitzRiderInput(honest), brake: Math.abs(blitzRacingLine(honest)) > 0.8 };
      frames.push({ tick: frames.length, input });
      honest = stepBlitzRun(honest, input);
    }
    const verified = replayBlitzTrace({ cityId: 'lagos', seed: 'posture-replay', frames });
    expect(verified.score).toBe(honest.score);
    expect(verified.elapsedMs).toBe(honest.elapsedMs);
  });
});
