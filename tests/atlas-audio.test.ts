import { describe, expect, it } from 'vitest';

import { createAtlasAudio, type AtlasAudioBackend, type AtlasAudioState } from '../src/atlas/audio/atlas-audio';

function fakeBackend() {
  const events: Array<{ type: string; cue?: string; bus?: string; loop?: boolean; value?: number; text?: string; locale?: string; speaker?: string }> = [];
  const backend: AtlasAudioBackend = {
    unlock: () => { events.push({ type: 'unlock' }); },
    play: (cue, bus, loop) => { events.push({ type: 'play', cue, bus, loop }); },
    stop: (cue) => { events.push({ type: 'stop', cue }); },
    setVolume: (bus, value) => { events.push({ type: 'volume', bus, value }); },
    setEngineSpeed: (value) => { events.push({ type: 'engine-speed', value }); },
    visualCue: (cue) => { events.push({ type: 'visual', cue }); },
    narrate: (text, locale, speaker) => { events.push({ type: 'narrate', text, locale, speaker }); },
    destroy: () => { events.push({ type: 'destroy' }); },
  };
  return { backend, events };
}

const state = (phase: AtlasAudioState['phase'], evidenceSource?: AtlasAudioState['evidenceSource']): AtlasAudioState => ({ phase, evidenceSource });

describe('NIM Atlas adaptive audio', () => {
  it('never restarts menu music from a late gesture while riding or paused', () => {
    const fake = fakeBackend(), audio = createAtlasAudio(fake.backend);
    audio.setRideScene('menu');
    audio.setRideScene('riding');
    audio.unlock();
    audio.playTheme();
    audio.setRideScene('paused');
    audio.unlock();
    audio.playTheme();
    expect(fake.events.some(e => e.type === 'play' && e.cue === 'atlas-theme')).toBe(false);
    audio.setRideScene('menu');
    expect(fake.events.some(e => e.type === 'play' && e.cue === 'atlas-theme')).toBe(true);
  });

  it('retries backend resume after an initial autoplay attempt without replaying queued loops', () => {
    const fake = fakeBackend(), audio = createAtlasAudio(fake.backend);
    audio.playTheme(); audio.unlock(); audio.unlock();
    expect(fake.events.filter(e => e.type === 'unlock')).toHaveLength(2);
    expect(fake.events.filter(e => e.type === 'play' && e.cue === 'atlas-theme')).toHaveLength(1);
  });
  /*
   * A phone play test reported the city as silent apart from footsteps.
   * Entering the city asks for the ambience loop immediately, before the
   * player has touched anything, so the browser was still locked and the
   * request was discarded with nothing to retry it. One-shot cues are asked
   * for again on every step, so they worked and hid the problem for weeks.
   */
  it('starts a loop asked for before the unlock gesture, once the gesture arrives', () => {
    const fake = fakeBackend();
    const audio = createAtlasAudio(fake.backend);
    audio.playCityAmbience();
    expect(fake.events.filter((event) => event.type === 'play')).toEqual([]);
    audio.unlock();
    expect(fake.events).toContainEqual({ type: 'play', cue: 'city-ambience', bus: 'ambience', loop: true });
  });

  it('does not start a loop that was cancelled while still locked', () => {
    const fake = fakeBackend();
    const audio = createAtlasAudio(fake.backend);
    audio.playCityAmbience();
    audio.stopCityAmbience();
    audio.unlock();
    expect(fake.events.some((event) => event.type === 'play' && event.cue === 'city-ambience')).toBe(false);
  });

  it('still plays a loop asked for after unlock', () => {
    const fake = fakeBackend();
    const audio = createAtlasAudio(fake.backend);
    audio.unlock();
    audio.playCityAmbience();
    expect(fake.events).toContainEqual({ type: 'play', cue: 'city-ambience', bus: 'ambience', loop: true });
  });

  it('keeps a continuous bike engine responsive to speed and stops it cleanly', () => {
    const fake = fakeBackend();
    const audio = createAtlasAudio(fake.backend);
    audio.unlock();
    audio.playBikeEngine(8);
    audio.setBikeSpeed(20);
    audio.stopBikeEngine();
    expect(fake.events).toContainEqual({ type: 'play', cue: 'bike-engine', bus: 'events', loop: true });
    expect(fake.events.filter((event) => event.type === 'engine-speed').map((event) => event.value)).toEqual([8, 20]);
    expect(fake.events).toContainEqual({ type: 'stop', cue: 'bike-engine' });
  });

  it('does not emit audio before a user gesture unlocks the backend', () => {
    const fake = fakeBackend();
    const audio = createAtlasAudio(fake.backend);
    audio.setState(state('street'));
    audio.setState(state('confirming'));
    expect(fake.events).toEqual([]);
    audio.unlock();
    expect(fake.events.some((event) => event.type === 'unlock')).toBe(true);
  });

  it('keeps provider lookup silent and uses one pending pulse during confirming', () => {
    const fake = fakeBackend();
    const audio = createAtlasAudio(fake.backend);
    audio.unlock();
    audio.setState(state('review'));
    audio.setState(state('confirming'));
    audio.setState(state('confirming'));
    expect(fake.events.filter((event) => event.type === 'play' && event.cue === 'payment-confirmed')).toHaveLength(0);
    expect(fake.events.filter((event) => event.type === 'play' && event.cue === 'payment-pending')).toHaveLength(1);
  });

  it('plays confirmation only for server evidence and never for local practice evidence', () => {
    const fake = fakeBackend();
    const audio = createAtlasAudio(fake.backend);
    audio.unlock();
    audio.setState(state('verified', 'local-simulation'));
    audio.setState(state('review'));
    audio.setState(state('verified', 'server-verified'));
    expect(fake.events.filter((event) => event.type === 'play' && event.cue === 'payment-confirmed')).toHaveLength(1);
  });

  it('adds restoration layers only after tower-lit and mirrors every sound with a visual cue', () => {
    const fake = fakeBackend();
    const audio = createAtlasAudio(fake.backend);
    audio.unlock();
    audio.setState(state('review'));
    audio.setState(state('tower-lit', 'server-verified'));
    const played = fake.events.filter((event) => event.type === 'play');
    expect(played.some((event) => event.cue === 'harbor-restored-ambience' && event.bus === 'ambience' && event.loop)).toBe(true);
    expect(played.some((event) => event.cue === 'beacon-confirmation' && event.bus === 'events')).toBe(true);
    expect(fake.events.filter((event) => event.type === 'visual')).toHaveLength(played.length);
  });

  it('keeps ambience, events, and interface volume buses independent', () => {
    const fake = fakeBackend();
    const audio = createAtlasAudio(fake.backend);
    audio.setVolume('ambience', 0.2);
    audio.setVolume('events', 0.8);
    audio.setVolume('interface', 0.4);
    expect(fake.events.filter((event) => event.type === 'volume')).toEqual([
      { type: 'volume', bus: 'ambience', value: 0.2 },
      { type: 'volume', bus: 'events', value: 0.8 },
      { type: 'volume', bus: 'interface', value: 0.4 },
    ]);
  });

  it('routes story lines through explicit English speaker profiles', () => {
    const fake = fakeBackend();
    const audio = createAtlasAudio(fake.backend);
    audio.unlock();
    audio.narrateLine({ speaker: 'mara', locale: 'en-US', text: 'The harbor is listening.' });
    expect(fake.events.find((event) => event.type === 'narrate')).toEqual({ type: 'narrate', text: 'The harbor is listening.', locale: 'en-US', speaker: 'mara' });
  });

  it('normalizes legacy non-English narration metadata to English', () => {
    const fake = fakeBackend();
    const audio = createAtlasAudio(fake.backend);
    audio.unlock();
    audio.narrateLine({ speaker: 'atlas', locale: 'ja-JP', text: 'The route is open.' });
    expect(fake.events.find((event) => event.type === 'narrate')?.locale).toBe('en-US');
  });
});
