import { describe, expect, it } from 'vitest';

import { BLITZ_LIMIT_SECONDS, createBlitzRun } from '../shared/atlas/blitz/core';
import { BlitzVoice, blitzCallout } from '../src/atlas/blitz/blitz-callouts';
import type { BlitzRunState } from '../shared/atlas/blitz/types';

/*
 * The voice over the run.
 *
 * A downhill race is loud with commentary, and the reason is not decoration:
 * at this speed a rider is looking at the road, not at the HUD. What is tested
 * here is the part that decides whether that helps or grates - what earns a
 * line, which line wins when two things happen at once, and what happens to a
 * line that cannot be spoken yet.
 */

describe('the race voice', () => {
  const run = (overrides: Partial<BlitzRunState>) => ({ ...createBlitzRun({ cityId: 'lagos', seed: 'voice' }), ...overrides } as BlitzRunState);

  it('says nothing when nothing happened', () => {
    const state = run({});
    expect(blitzCallout(state, state)).toBeNull();
    expect(blitzCallout(null, state)).toBeNull();
  });

  it('calls a contact, and calls trouble before praise', () => {
    const before = run({ collisions: 0, nearMisses: 0 });
    const after = run({ collisions: 1, nearMisses: 4 });
    const callout = blitzCallout(before, after);
    expect(callout?.id).toBe('contact');
  });

  it('warns when the last gearbox goes and when the tank runs dry', () => {
    expect(blitzCallout(run({ driftCharges: 1 }), run({ driftCharges: 0 }))?.id).toBe('gearless');
    expect(blitzCallout(run({ boostEnergy: 4 }), run({ boostEnergy: 0 }))?.id).toBe('dry');
  });

  it('calls the clock once, on the way past ten seconds', () => {
    const before = run({ phase: 'running', elapsedMs: (BLITZ_LIMIT_SECONDS - 11) * 1_000 });
    const after = run({ phase: 'running', elapsedMs: (BLITZ_LIMIT_SECONDS - 9.5) * 1_000 });
    expect(blitzCallout(before, after)?.id).toBe('ten');
    // Already past it: not again on every tick that follows.
    expect(blitzCallout(after, run({ phase: 'running', elapsedMs: (BLITZ_LIMIT_SECONDS - 8) * 1_000 }))).toBeNull();
  });

  /*
   * The channel. A queued callout would describe a part of the hill the rider
   * has already left, so a line that cannot be spoken now is dropped.
   */
  it('speaks one line at a time and drops what it cannot say now', () => {
    const spoken: string[] = [];
    let clock = 0;
    const voice = new BlitzVoice((callout) => spoken.push(callout.text), () => clock);
    expect(voice.offer({ id: 'a', text: 'Contact.', urgency: 1, holdMs: 2_000 })).toBe(true);
    clock = 500;
    expect(voice.offer({ id: 'b', text: 'Contract clear.', urgency: 1, holdMs: 2_000 })).toBe(false);
    clock = 2_600;
    expect(voice.offer({ id: 'b', text: 'Contract clear.', urgency: 1, holdMs: 2_000 })).toBe(true);
    expect(spoken).toEqual(['Contact.', 'Contract clear.']);
  });

  it('never stutters the same line twice in a row', () => {
    const spoken: string[] = [];
    let clock = 0;
    const voice = new BlitzVoice((callout) => spoken.push(callout.text), () => clock);
    voice.offer({ id: 'a', text: 'Contact.', urgency: 1, holdMs: 10 });
    clock = 5_000;
    expect(voice.offer({ id: 'a', text: 'Contact.', urgency: 1, holdMs: 10 })).toBe(false);
    expect(spoken).toHaveLength(1);
  });

  it('survives a speech engine that throws, because voice never blocks a run', () => {
    const voice = new BlitzVoice(() => { throw new Error('no speech synthesis here'); });
    expect(() => voice.offer({ id: 'a', text: 'Contact.', urgency: 1, holdMs: 10 })).not.toThrow();
  });

  it('forgets the last run when a new one starts', () => {
    const spoken: string[] = [];
    const voice = new BlitzVoice((callout) => spoken.push(callout.text), () => 0);
    voice.offer({ id: 'a', text: 'Finish!', urgency: 1, holdMs: 9_000 });
    voice.reset();
    expect(voice.offer({ id: 'a', text: 'Finish!', urgency: 1, holdMs: 9_000 })).toBe(true);
    expect(spoken).toHaveLength(2);
  });
});
