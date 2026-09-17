import { describe, expect, it } from 'vitest';

import { BLITZ_TICK_RATE, createBlitzRun, stepBlitzRun } from '../shared/atlas/blitz/core';
import { replayBlitzTrace } from '../shared/atlas/blitz/replay';
import {
  BLITZ_RIVAL_SAMPLE_TICKS,
  blitzRivalAt,
  blitzRivalGaps,
  blitzRivalPathFrom,
  isBlitzRivalPath,
  type BlitzRivalPath,
} from '../shared/atlas/blitz/rivals';
import type { BlitzInput, BlitzRunState, BlitzTraceFrame } from '../shared/atlas/blitz/types';
import { blitzRiderInput } from './support/blitz-rider';

/*
 * The pack.
 *
 * A rival is a finished run replayed as a solid bike. The fun is overtaking
 * traffic; the danger is that a solid rival changes the physics, so a ranked
 * run replayed against a different pack would score differently and an honest
 * rider would be refused. Most of what is tested here is that second thing.
 */

/** A rival holding one lane at a steady speed, for however long is needed. */
function pacer(options: { lane: number; mps: number; from?: number; ticks?: number; runId?: string }): BlitzRivalPath {
  const ticks = options.ticks ?? BLITZ_TICK_RATE * 95;
  const distance: number[] = [];
  const lane: number[] = [];
  for (let tick = 0; tick <= ticks; tick += BLITZ_RIVAL_SAMPLE_TICKS) {
    distance.push((options.from ?? 0) + (options.mps * tick) / BLITZ_TICK_RATE);
    lane.push(options.lane);
  }
  return { runId: options.runId ?? 'rival-a', username: 'Pacer', distance, lane };
}

function ride(state: BlitzRunState, ticks: number, input: BlitzInput, rivals: readonly BlitzRivalPath[] = []): BlitzRunState {
  let current = state;
  for (let tick = 0; tick < ticks; tick += 1) current = stepBlitzRun(current, input, rivals);
  return current;
}

const straight: BlitzInput = { steer: 0, drift: false, boost: false, tuck: true };

describe('where a rival is', () => {
  it('interpolates between samples rather than stepping between them', () => {
    const path = pacer({ lane: 0, mps: 30 });
    const early = blitzRivalAt(path, 0)!;
    const between = blitzRivalAt(path, 3)!;
    const later = blitzRivalAt(path, 6)!;
    expect(early.distanceMeters).toBe(0);
    expect(later.distanceMeters).toBeCloseTo(6, 5);
    // Halfway between two samples is halfway down the road, not still at the
    // first one - a rival that jumped six metres every fifth of a second would
    // be impossible to ride against.
    expect(between.distanceMeters).toBeCloseTo(3, 5);
  });

  /*
   * A rider who has already finished is off the course. Holding their last
   * position would park an immovable bike across the finish straight of every
   * run that came after them.
   */
  it('takes a finished rival off the course', () => {
    const short = pacer({ lane: 0, mps: 30, ticks: 60 });
    expect(blitzRivalAt(short, 60)).not.toBeNull();
    expect(blitzRivalAt(short, 240)).toBeNull();
    expect(blitzRivalAt(short, -1)).toBeNull();
  });

  it('samples a finished run at 5 Hz and keeps the line', () => {
    const positions = Array.from({ length: 61 }, (_, tick) => ({ distanceMeters: tick, laneOffset: 1.234_5 }));
    const path = blitzRivalPathFrom({ runId: 'r', username: 'Rider', positions });
    expect(path.distance).toHaveLength(Math.ceil(61 / BLITZ_RIVAL_SAMPLE_TICKS));
    expect(path.distance[1]).toBe(BLITZ_RIVAL_SAMPLE_TICKS);
    // Rounded to the centimetre: below anything a rider can feel, and it keeps
    // a whole pack inside a few kilobytes.
    expect(path.lane[0]).toBe(1.23);
  });

  it('refuses a malformed path, because a rival arrives over the wire', () => {
    expect(isBlitzRivalPath(pacer({ lane: 0, mps: 30, ticks: 60 }))).toBe(true);
    expect(isBlitzRivalPath(null)).toBe(false);
    expect(isBlitzRivalPath({ runId: 'r', username: 'u', distance: [1], lane: [] })).toBe(false);
    expect(isBlitzRivalPath({ runId: 'r', username: 'u', distance: [Number.NaN], lane: [0] })).toBe(false);
    expect(isBlitzRivalPath({ runId: 'r', username: 'u', distance: Array(700).fill(0), lane: Array(700).fill(0) })).toBe(false);
  });
});

describe('riding in traffic', () => {
  const start = () => ride(createBlitzRun({ cityId: 'lagos', seed: 'pack' }), BLITZ_TICK_RATE * 5, straight);

  it('holds a rider up who rides into the back of a rival', () => {
    const before = start();
    // A slow rival parked on the racing line, just ahead.
    const blocker = pacer({ lane: before.laneOffset, mps: 6, from: before.distanceMeters + 8 });
    const blocked = ride(before, BLITZ_TICK_RATE * 2, straight, [blocker]);
    const clear = ride(before, BLITZ_TICK_RATE * 2, straight, []);
    expect(blocked.rivalContacts).toBeGreaterThan(0);
    expect(blocked.distanceMeters).toBeLessThan(clear.distanceMeters);
  });

  /*
   * One-way, and the test says so. A rival's line is data recorded before this
   * run existed; nothing the rider does can move it, and pretending otherwise
   * would make the replay a lie.
   */
  it('moves the rider and never the rival', () => {
    const before = start();
    const blocker = pacer({ lane: before.laneOffset, mps: 6, from: before.distanceMeters + 8 });
    const at = blitzRivalAt(blocker, before.tick + 30);
    ride(before, BLITZ_TICK_RATE * 2, straight, [blocker]);
    // The same query after the contact returns the same place.
    expect(blitzRivalAt(blocker, before.tick + 30)).toEqual(at);
  });

  it('pays for getting past traffic', () => {
    const before = start();
    const slower = pacer({ lane: before.laneOffset + 3, mps: 4, from: before.distanceMeters + 4 });
    const passed = ride(before, BLITZ_TICK_RATE * 3, straight, [slower]);
    expect(passed.overtakes).toBeGreaterThan(0);
    // Passed wide, so it is an overtake and not a shoulder.
    expect(passed.rivalContacts).toBe(0);
  });

  it('cannot farm an overtake by sitting alongside somebody', () => {
    const before = start();
    // A rival at exactly the rider's pace, never actually passed.
    const alongside = pacer({ lane: before.laneOffset + 3, mps: before.speedMps, from: before.distanceMeters + 30 });
    const after = ride(before, BLITZ_TICK_RATE * 3, straight, [alongside]);
    expect(after.overtakes).toBe(0);
  });
});

describe('the pack has to survive verification', () => {
  function tracedRun(rivals: readonly BlitzRivalPath[], style?: (state: BlitzRunState) => BlitzInput) {
    let state = createBlitzRun({ cityId: 'lagos', seed: 'verify-pack', rivals });
    const frames: BlitzTraceFrame[] = [];
    while (state.phase === 'countdown' || state.phase === 'running') {
      const input = style ? style(state) : blitzRiderInput(state);
      frames.push({ tick: frames.length, input });
      state = stepBlitzRun(state, input, rivals);
    }
    return { state, frames };
  }

  /*
   * The whole reason the rival set is pinned to the ticket: a run ridden
   * through traffic has to reproduce exactly when the server rides it again.
   */
  it('replays a run through traffic to the same score', () => {
    const rivals = [pacer({ lane: 0.4, mps: 22, from: 40, runId: 'a' }), pacer({ lane: -1.6, mps: 26, from: 120, runId: 'b' })];
    const { state, frames } = tracedRun(rivals);
    const verified = replayBlitzTrace({ cityId: 'lagos', seed: 'verify-pack', frames, rivals });
    expect(verified.score).toBe(state.score);
    expect(verified.rivalContacts).toBe(state.rivalContacts);
    expect(verified.overtakes).toBe(state.overtakes);
  });

  /*
   * And the failure it prevents. Replaying the same trace against no pack
   * scores differently, so a server that forgot the rivals would refuse an
   * honest rider - which is worse than the feature not existing.
   */
  it('scores differently when the pack is dropped, which is why it is pinned', () => {
    const rivals = [pacer({ lane: 0, mps: 14, from: 30, runId: 'a' })];
    // Held dead straight down the rival's lane, so the two bikes certainly
    // meet. The avoiding rider weaves around obstacles and can miss them.
    const { state, frames } = tracedRun(rivals, () => straight);
    const withoutPack = replayBlitzTrace({ cityId: 'lagos', seed: 'verify-pack', frames });
    expect(state.rivalContacts).toBeGreaterThan(0);
    expect(withoutPack.score).not.toBe(state.score);
  });

  it('leaves a solo run exactly as it was', () => {
    const { state, frames } = tracedRun([]);
    expect(replayBlitzTrace({ cityId: 'lagos', seed: 'verify-pack', frames }).score).toBe(state.score);
    expect(state.rivalContacts).toBe(0);
  });
});

describe('the gap list', () => {
  it('puts the rider actually being raced at the top', () => {
    const gaps = blitzRivalGaps({
      rivals: [
        pacer({ lane: 0, mps: 30, from: 300, runId: 'far' }),
        pacer({ lane: 0, mps: 30, from: 104, runId: 'near' }),
        pacer({ lane: 0, mps: 30, from: 90, runId: 'behind' }),
      ],
      tick: 0,
      distanceMeters: 100,
      speedMps: 20,
    });
    expect(gaps.map((gap) => gap.runId)).toEqual(['near', 'behind', 'far']);
    // Behind the rider reads as a negative gap, not as a positive one.
    expect(gaps[1]!.metres).toBeLessThan(0);
    expect(gaps[0]!.seconds).toBeCloseTo(4 / 20, 5);
  });

  it('drops riders who have already finished, and does not divide by a standstill', () => {
    const done = pacer({ lane: 0, mps: 30, ticks: 30, runId: 'done' });
    expect(blitzRivalGaps({ rivals: [done], tick: 600, distanceMeters: 10, speedMps: 20 })).toEqual([]);
    const stopped = blitzRivalGaps({ rivals: [pacer({ lane: 0, mps: 30 })], tick: 0, distanceMeters: 0, speedMps: 0 });
    expect(stopped[0]!.seconds).toBeNull();
  });
});
