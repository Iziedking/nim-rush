import { describe, expect, it } from 'vitest';

import { createBlitzRun, stepBlitzRun } from '../shared/atlas/blitz/core';
import { hashBlitzTrace, replayBlitzTrace } from '../shared/atlas/blitz/replay';
import type { BlitzInput, BlitzTraceFrame } from '../shared/atlas/blitz/types';

describe('Beacon Blitz replay', () => {
  it('reconstructs the exact authoritative run and hashes canonical input', async () => {
    const frames: BlitzTraceFrame[] = [];
    let state = createBlitzRun({ cityId: 'london', seed: 'ranked-44' });
    for (let tick = 0; tick < 900; tick += 1) {
      const input: BlitzInput = { steer: tick % 160 < 80 ? 0.35 : -0.35, drift: tick % 100 > 70, boost: tick % 150 < 18 };
      frames.push({ tick, input });
      state = stepBlitzRun(state, input);
    }
    const replayed = replayBlitzTrace({ cityId: 'london', seed: 'ranked-44', frames });
    expect(replayed).toEqual(state);
    expect(await hashBlitzTrace(frames)).toMatch(/^[a-f0-9]{64}$/);
  });

  it('changes the hash when a submitted control is changed', async () => {
    const frames: BlitzTraceFrame[] = [{ tick: 0, input: { steer: 0, drift: false, boost: false } }];
    const altered: BlitzTraceFrame[] = [{ tick: 0, input: { steer: 1, drift: false, boost: false } }];
    expect(await hashBlitzTrace(frames)).not.toBe(await hashBlitzTrace(altered));
  });

  it('rejects non-contiguous and out-of-range trace frames', () => {
    expect(() => replayBlitzTrace({ cityId: 'lagos', seed: 'bad', frames: [{ tick: 2, input: { steer: 0, drift: false, boost: false } }] })).toThrow(/contiguous/i);
    expect(() => replayBlitzTrace({ cityId: 'lagos', seed: 'bad', frames: [{ tick: 0, input: { steer: 2, drift: false, boost: false } }] })).toThrow(/input/i);
  });
});
