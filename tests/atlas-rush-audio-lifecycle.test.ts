import { afterEach, describe, expect, it, vi } from 'vitest';
import { createAtlasAudio } from '../src/atlas/audio/atlas-audio';

// Exercise the real browser backend with controllable platform timing. This
// proves source lifecycle, not speaker output or subjective sound quality.
function platform() {
  const sources: Array<{ started: boolean; stopped: boolean; buffer: unknown }> = [];
  const param = () => ({ value: 0, setTargetAtTime() {}, setValueAtTime() {}, exponentialRampToValueAtTime() {} });
  const node = () => ({ connect() {}, disconnect() {}, gain: param(), frequency: param(), Q: param() });
  class Context {
    static latest: Context;
    state = 'suspended';
    currentTime = 0;
    sampleRate = 100;
    destination = {};
    resume = vi.fn(async () => { this.state = 'running'; });
    close = vi.fn(async () => { this.state = 'closed'; });
    constructor() { Context.latest = this; }
    createGain = node;
    createBiquadFilter = node;
    createOscillator = () => ({ ...node(), start() {}, stop() {}, type: '' });
    createBuffer = () => ({ getChannelData: () => new Float32Array(200) });
    decodeAudioData = async () => ({ sample: 'decoded-theme' });
    createBufferSource() {
      const source = { ...node(), started: false, stopped: false, buffer: null as unknown,
        playbackRate: param(), loop: false, onended: null,
        start() { this.started = true; }, stop() { this.stopped = true; } };
      sources.push(source);
      return source;
    }
  }
  vi.stubGlobal('window', { AudioContext: Context });
  let complete!: (value: Response) => void;
  vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>(resolve => { complete = resolve; })));
  return { sources, context: () => Context.latest, complete: () => complete(new Response(new Uint8Array([1, 2]))) };
}

afterEach(() => vi.unstubAllGlobals());

describe('Rush sampled music lifecycle', () => {
  it('a theme download finishing during a ride cannot start music or silence the tyres', async () => {
    const p = platform(), audio = createAtlasAudio();
    audio.setRideScene('menu'); audio.unlock();
    audio.setRideScene('riding', 12);
    p.complete();
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
    await new Promise(resolve => setTimeout(resolve, 10));
    expect(audio.debugSnapshot()).toMatchObject({ scene: 'riding', samples: [], bike: true });
    expect(p.sources.filter(s => s.started && !s.stopped)).toHaveLength(2);
    audio.setRideScene('paused');
    expect(p.sources.every(s => s.stopped)).toBe(true);
    audio.unlock();
    expect(p.context().resume).toHaveBeenCalledOnce();
    audio.setRideScene('menu');
    expect(audio.debugSnapshot()).toMatchObject({ samples: ['atlas-theme'], bike: false });
    audio.setRideScene('riding', 0);
    expect(audio.debugSnapshot()).toMatchObject({ samples: [], bike: true });
    audio.destroy();
    expect(p.sources.every(s => s.stopped)).toBe(true);
  });

  it('hidden-page cancellation wins over a pending menu decode', async () => {
    const p = platform(), audio = createAtlasAudio();
    audio.unlock(); audio.setRideScene('menu'); audio.setRideScene('silent');
    p.complete();
    await new Promise(resolve => setTimeout(resolve, 10));
    expect(p.sources).toHaveLength(0);
    audio.setRideScene('menu');
    expect(audio.debugSnapshot()).toMatchObject({ samples: ['atlas-theme'] });
    audio.destroy();
  });
});
