import { describe, expect, it } from 'vitest';

import { createBlitzRun, stepBlitzRun } from '../shared/atlas/blitz/core';
import { sampleCourse } from '../shared/atlas/blitz/course';
import type { BlitzInput, BlitzRunState } from '../shared/atlas/blitz/types';
import { BlitzInputController } from '../src/atlas/blitz/blitz-input';

/*
 * Which way is right.
 *
 * Two riders reported this within an hour of the game going public: "sliding
 * to the right takes me left and vice versa". They were correct, on the stick
 * and on the keyboard, and it had been true from the first ride.
 *
 * The cause is that the simulation does not steer in screen space. A lane is
 * measured from the centre line along (cos h, -sin h), which is the rider's
 * LEFT, so a positive steer moved the bike to the left of the screen while the
 * input called rightward positive. The sim's convention is fine and the corner
 * physics already agree with it - a bend throws the rider to the outside - so
 * the fix is one negation where a gesture becomes a lane, and these tests pin
 * the whole path down: press, to steer, to lane, to pixels.
 */

/** The renderer's own frame: forward from the heading, right from forward x up. */
function screenOffset(state: BlitzRunState): number {
  const centre = sampleCourse(state.cityId, state.distanceMeters, 0);
  const bike = sampleCourse(state.cityId, state.distanceMeters, state.laneOffset);
  const forward = { x: Math.sin(centre.headingRadians), z: Math.cos(centre.headingRadians) };
  const right = { x: -forward.z, z: forward.x };
  return (bike.x - centre.x) * right.x + (bike.z - centre.z) * right.z;
}

function ride(steer: number, ticks = 45): BlitzRunState {
  const input: BlitzInput = { steer, drift: false, boost: false };
  let state = createBlitzRun({ cityId: 'lagos', seed: 'steering' });
  while (state.phase === 'countdown') state = stepBlitzRun(state, input);
  for (let tick = 0; tick < ticks; tick += 1) state = stepBlitzRun(state, input);
  return state;
}

/** A Window that only records listeners, so the controller runs without a DOM. */
function fakeWindow(): { target: Window; press: (code: string) => void; release: (code: string) => void } {
  const listeners = new Map<string, (event: KeyboardEvent) => void>();
  const target = {
    addEventListener: (name: string, listener: (event: KeyboardEvent) => void) => { listeners.set(name, listener); },
    removeEventListener: (name: string) => { listeners.delete(name); },
  } as unknown as Window;
  const fire = (name: string, code: string) => listeners.get(name)?.({ code, preventDefault: () => undefined } as unknown as KeyboardEvent);
  return { target, press: (code) => fire('keydown', code), release: (code) => fire('keyup', code) };
}

describe('steering handedness', () => {
  it('sends a rightward press to the right of the screen', () => {
    const { target, press, release } = fakeWindow();
    const input = new BlitzInputController(target);

    press('ArrowRight');
    const right = input.sample().steer;
    expect(screenOffset(ride(right))).toBeGreaterThan(0.5);

    release('ArrowRight');
    expect(input.sample().steer).toBe(0);

    press('KeyA');
    const left = input.sample().steer;
    expect(screenOffset(ride(left))).toBeLessThan(-0.5);
  });

  it('keeps the simulation steering in lane space, where a positive lane is the rider\'s left', () => {
    // The convention the course, the obstacles and the corner push all share.
    // If this ever flips, every authored lane in cities.ts means the mirror of
    // what it used to, so it is pinned here rather than left to be discovered.
    expect(screenOffset(ride(1))).toBeLessThan(0);
    expect(screenOffset(ride(-1))).toBeGreaterThan(0);
  });

  it('throws a rider to the outside of a bend, not the inside', () => {
    // The reason the fix belongs in the input and not in the course: hands off,
    // the physics is already correct on screen.
    const straight: BlitzInput = { steer: 0, drift: false, boost: false };
    let state = createBlitzRun({ cityId: 'lagos', seed: 'steering' });
    while (state.phase === 'countdown') state = stepBlitzRun(state, straight);
    let checked = 0;
    while (state.phase === 'running' && checked < 3) {
      const previous = state;
      state = stepBlitzRun(state, straight);
      const here = sampleCourse('lagos', state.distanceMeters, 0);
      if (Math.abs(here.bend) < 0.02) continue;
      const drift = state.laneOffset - previous.laneOffset;
      if (Math.abs(drift) < 0.002) continue;
      // Where the road ahead sits on screen: positive is a right-hand bend.
      const ahead = sampleCourse('lagos', state.distanceMeters + 60, 0);
      const forward = { x: Math.sin(here.headingRadians), z: Math.cos(here.headingRadians) };
      const rightVector = { x: -forward.z, z: forward.x };
      const turn = (ahead.x - here.x) * rightVector.x + (ahead.z - here.z) * rightVector.z;
      const pushed = screenOffset({ ...state, laneOffset: drift });
      // Outside of the bend: a road turning right pushes the rider left.
      expect(Math.sign(pushed)).toBe(-Math.sign(turn));
      checked += 1;
      for (let skip = 0; skip < 90 && state.phase === 'running'; skip += 1) state = stepBlitzRun(state, straight);
    }
    expect(checked).toBeGreaterThan(0);
  });
});
