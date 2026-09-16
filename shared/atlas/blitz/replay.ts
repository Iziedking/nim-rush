import { createBlitzRun, stepBlitzRun } from './core';
import type { BlitzCityId, BlitzRunState, BlitzTraceFrame } from './types';

// Browser recording and Node verification share this input boundary. Hash the
// exact numbers the simulation consumes; rounding only the hash aliases runs.
export const BLITZ_TRACE_FRAME_LIMIT = 3_000;

export function replayBlitzTrace(input: { cityId: BlitzCityId; seed: string; frames: readonly BlitzTraceFrame[] }): BlitzRunState {
  validateBlitzTrace(input.frames);
  let state = createBlitzRun({ cityId: input.cityId, seed: input.seed });
  for (const frame of input.frames) {
    if (state.phase === 'finished' || state.phase === 'timeout') throw new Error('Beacon Blitz trace contains controls after its terminal state.');
    state = stepBlitzRun(state, frame.input);
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
