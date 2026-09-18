import { BLITZ_LIMIT_SECONDS, BLITZ_TICK_RATE, createBlitzRun, stepBlitzRun } from './core';
import type { BlitzCityId, BlitzRunState, BlitzTraceFrame } from './types';
import type { BlitzRivalPath } from './rivals';

// Browser recording and Node verification share this input boundary. Hash the
// exact numbers the simulation consumes; rounding only the hash aliases runs.

/*
 * The longest trace a legitimate run can produce.
 *
 * This was the literal 3_000, written when a run was 90 seconds. The clock is
 * 120 now, which is 3,600 frames at 30 Hz, so every full-length ranked run
 * became unsaveable locally and rejectable by the server on the same day the
 * clock changed - and the rider was told their run "left the screen" rather
 * than that it was too long.
 *
 * Derived, so the next clock change carries the limit with it. The margin
 * covers the three-second countdown, which records frames like any other tick,
 * and a few seconds of overrun.
 */
export const BLITZ_TRACE_FRAME_LIMIT = (BLITZ_LIMIT_SECONDS + 15) * BLITZ_TICK_RATE;

export function replayBlitzTrace(input: {
  cityId: BlitzCityId;
  seed: string;
  frames: readonly BlitzTraceFrame[];
  /*
   * The pack the run was ridden against, as pinned to the ticket the server
   * issued. A solid rival changes the physics, so replaying without them would
   * compute a different score and refuse an honest run.
   */
  rivals?: readonly BlitzRivalPath[];
}): BlitzRunState {
  validateBlitzTrace(input.frames);
  const rivals = input.rivals ?? [];
  let state = createBlitzRun({ cityId: input.cityId, seed: input.seed, rivals });
  for (const frame of input.frames) {
    if (state.phase === 'finished' || state.phase === 'timeout') throw new Error('Beacon Blitz trace contains controls after its terminal state.');
    state = stepBlitzRun(state, frame.input, rivals);
  }
  return state;
}

export async function hashBlitzTrace(frames: readonly BlitzTraceFrame[]): Promise<string> {
  validateBlitzTrace(frames);
  // Every bit the simulation reads. Tuck changes both the speed and the grip,
  // so a hash that ignored it would let two different runs share one trace.
  const canonical = frames.map((frame) => ({ tick: frame.tick, steer: frame.input.steer, drift: frame.input.drift, boost: frame.input.boost, brake: frame.input.brake ?? false, tuck: frame.input.tuck ?? false, relayChoice: frame.input.relayChoice ?? null }));
  const bytes = new TextEncoder().encode(JSON.stringify(canonical));
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

export function validateBlitzTrace(frames: readonly BlitzTraceFrame[]): void {
  if (!Array.isArray(frames) || frames.length > BLITZ_TRACE_FRAME_LIMIT) throw new Error('Beacon Blitz trace is too long or malformed.');
  for (let index = 0; index < frames.length; index++) {
    const frame = frames[index];
    if (!frame || frame.tick !== index) throw new Error('Beacon Blitz trace ticks must be contiguous.');
    const input = frame.input;
    if (!input || !Number.isFinite(input.steer) || input.steer < -1 || input.steer > 1
      || typeof input.drift !== 'boolean' || typeof input.boost !== 'boolean'
      || (input.brake !== undefined && typeof input.brake !== 'boolean')
      || (input.tuck !== undefined && typeof input.tuck !== 'boolean')
      || (input.relayChoice !== undefined && input.relayChoice !== 'left' && input.relayChoice !== 'right')) {
      throw new Error('Beacon Blitz trace input is invalid.');
    }
  }
}

/**
 * Replay a trace and keep the line it drew.
 *
 * The server already re-simulates every ranked run to check the score. Doing
 * it once more to record where the bike went would double the work for no
 * reason, so this returns both: the verified state, and the position at every
 * tick ready to be sampled into a rival path.
 *
 * Positions rather than inputs, because a rival's line is fixed. Keeping the
 * trace would be eighteen times the payload for something nothing recomputes.
 */
export function replayBlitzTraceWithPath(input: {
  cityId: BlitzCityId;
  seed: string;
  frames: readonly BlitzTraceFrame[];
  rivals?: readonly BlitzRivalPath[];
}): { readonly state: BlitzRunState; readonly positions: readonly { distanceMeters: number; laneOffset: number }[] } {
  validateBlitzTrace(input.frames);
  const rivals = input.rivals ?? [];
  let state = createBlitzRun({ cityId: input.cityId, seed: input.seed, rivals });
  const positions: { distanceMeters: number; laneOffset: number }[] = [];
  for (const frame of input.frames) {
    if (state.phase === 'finished' || state.phase === 'timeout') throw new Error('Beacon Blitz trace contains controls after its terminal state.');
    state = stepBlitzRun(state, frame.input, rivals);
    positions.push({ distanceMeters: state.distanceMeters, laneOffset: state.laneOffset });
  }
  return { state, positions };
}
