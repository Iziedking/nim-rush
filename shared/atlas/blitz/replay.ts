import { createBlitzRun, stepBlitzRun } from './core';
import type { BlitzCityId, BlitzRunState, BlitzTraceFrame } from './types';

export function replayBlitzTrace(input: { cityId: BlitzCityId; seed: string; frames: readonly BlitzTraceFrame[] }): BlitzRunState {
  if (input.frames.length > 3_000) throw new Error('Beacon Blitz trace is too long.');
  let state = createBlitzRun({ cityId: input.cityId, seed: input.seed });
  for (const [index, frame] of input.frames.entries()) {
    if (frame.tick !== index) throw new Error('Beacon Blitz trace ticks must be contiguous.');
    state = stepBlitzRun(state, frame.input);
  }
  return state;
}

export async function hashBlitzTrace(frames: readonly BlitzTraceFrame[]): Promise<string> {
  const canonical = frames.map((frame, index) => {
    if (frame.tick !== index) throw new Error('Beacon Blitz trace ticks must be contiguous.');
    const steer = frame.input.steer;
    if (!Number.isFinite(steer) || steer < -1 || steer > 1) throw new Error('Beacon Blitz trace input is invalid.');
    return { tick: frame.tick, steer: Math.round(steer * 1_000) / 1_000, drift: frame.input.drift, boost: frame.input.boost, relayChoice: frame.input.relayChoice ?? null };
  });
  const bytes = new TextEncoder().encode(JSON.stringify(canonical));
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}
