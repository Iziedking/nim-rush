import { describe, expect, it } from 'vitest';

import { BlitzFrameGovernor } from '../src/atlas/blitz/frame-governor';

describe('Beacon Blitz mobile frame governor', () => {
  it('caps a 120 Hz display near 60 visual frames without drifting', () => {
    const governor = new BlitzFrameGovernor(60);
    let renders = 0;
    for (let frame = 0; frame <= 120; frame += 1) {
      if (governor.shouldRender(frame * (1_000 / 120))) renders += 1;
    }
    expect(renders).toBeGreaterThanOrEqual(59);
    expect(renders).toBeLessThanOrEqual(61);
  });

  it('renders every frame on a 30 Hz display and resets after interruption', () => {
    const governor = new BlitzFrameGovernor(60);
    expect([0, 33, 66, 99].filter((time) => governor.shouldRender(time))).toHaveLength(4);
    governor.reset();
    expect(governor.shouldRender(4_000)).toBe(true);
  });
});

