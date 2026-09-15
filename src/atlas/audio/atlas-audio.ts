import type { LanternEvidenceSource, LanternPhase } from '../../../shared/atlas/adventures/last-lantern';
import type { BlitzPhysicsEvent } from '../../../shared/atlas/blitz/types';

/*
 * The game is written in English and narrated by the browser's speech synthesis.
 *
 * Three call sites passed 'ja-JP' with English text, so a Japanese voice read
 * English aloud and playtesters reported hearing another language. The locale
 * now defaults here rather than being repeated at every call site, because a
 * locale is a property of the script, not of the sentence being spoken.
 */
export const ATLAS_NARRATION_LOCALE = 'en-US';
export type AtlasVoiceProfile = 'mara' | 'atlas' | 'nia' | 'oren' | 'tala' | 'ivo' | 'ada';

export type AtlasAudioBus = 'ambience' | 'events' | 'interface' | 'voice';
export type AtlasAudioCue = 'atlas-theme' | 'city-ambience' | 'harbor-waiting-ambience' | 'harbor-restored-ambience' | 'payment-pending' | 'payment-confirmed' | 'beacon-confirmation' | 'city-footstep' | 'city-interaction' | 'bike-engine' | 'bike-boost' | 'bike-skid' | 'bike-impact' | 'bike-landing' | 'bike-surface-change' | 'route-refused' | 'route-evidence' | 'route-repaired' | 'route-complete';

export interface AtlasAudioBackend {
  unlock(): void;
  play(cue: AtlasAudioCue, bus: AtlasAudioBus, loop: boolean): void;
  stop(cue: AtlasAudioCue): void;
  setVolume(bus: AtlasAudioBus, value: number): void;
  setEngineSpeed?(speedMps: number): void;
  visualCue(cue: AtlasAudioCue): void;
  narrate?(text: string, locale: string, speaker?: AtlasVoiceProfile): void;
  destroy(): void;
}

export interface AtlasAudioState {
  phase: LanternPhase;
  evidenceSource?: LanternEvidenceSource;
}

const WAITING_PHASES = new Set<LanternPhase>(['street', 'shop', 'selected', 'review']);

export function createAtlasAudio(backend: AtlasAudioBackend = createWebAudioBackend()): AtlasAudio {
  return new AtlasAudio(backend);
}

export class AtlasAudio {
  private unlocked = false;
  private current: AtlasAudioState | null = null;
  /*
   * Looping cues asked for before the unlock gesture.
   *
   * A play test on a phone reported the city as silent apart from footsteps.
   * Entering the city calls playCityAmbience() immediately, which lands before
   * the player has touched anything, so the browser is still locked and the
   * request was dropped on the floor. Nothing ever retried it, so the city
   * stayed silent for the whole session while one-shot cues — requested again
   * on every step — worked fine and hid the problem.
   *
   * The intent is remembered instead of discarded, and replayed on unlock.
   */
  private readonly pendingLoops = new Map<AtlasAudioCue, AtlasAudioBus>();

  constructor(private readonly backend: AtlasAudioBackend) {}

  unlock(): void {
    if (this.unlocked) return;
    try {
      this.backend.unlock();
      this.unlocked = true;
      if (this.current) this.sync(null, this.current);
      for (const [cue, bus] of this.pendingLoops) this.playCue(cue, bus, true);
      this.pendingLoops.clear();
    } catch {
      this.unlocked = false;
    }
  }

  setState(next: AtlasAudioState): void {
    const previous = this.current;
    this.current = { ...next };
    if (this.unlocked) this.sync(previous, next);
  }

  setVolume(bus: AtlasAudioBus, value: number): void {
    if (!Number.isFinite(value) || value < 0 || value > 1) throw new Error('Atlas audio volume must be between 0 and 1.');
    this.backend.setVolume(bus, value);
  }

  /*
   * The music bed and the city's environment layer.
   *
   * Both loop until something asks them to stop, and both are safe to call
   * repeatedly: playCue restarts the source rather than stacking a second copy.
   * Nothing here can run before the unlock gesture, which is what browsers
   * require and also what keeps a 1.4 MB download off first paint.
   */
  playTheme(): void {
    this.requestLoop('atlas-theme', 'ambience');
  }

  stopTheme(): void {
    this.pendingLoops.delete('atlas-theme');
    this.stopCue('atlas-theme');
  }

  playCityAmbience(): void {
    this.requestLoop('city-ambience', 'ambience');
  }

  stopCityAmbience(): void {
    this.pendingLoops.delete('city-ambience');
    this.stopCue('city-ambience');
  }

  playBikeEngine(speedMps = 0): void {
    if (!this.unlocked) return;
    this.playCue('bike-engine', 'events', true);
    this.backend.setEngineSpeed?.(speedMps);
  }

  setBikeSpeed(speedMps: number): void {
    if (!this.unlocked) return;
    this.backend.setEngineSpeed?.(speedMps);
  }

  playPhysicsCue(event: BlitzPhysicsEvent): void {
    if (!this.unlocked) return;
    let cue: Extract<AtlasAudioCue, `bike-${string}`>;
    switch (event.type) {
      case 'skid': cue = 'bike-skid'; break;
      case 'impact': cue = 'bike-impact'; break;
      case 'landing': cue = 'bike-landing'; break;
      case 'surface-change': cue = 'bike-surface-change'; break;
      case 'launch':
      case 'boost-start': cue = 'bike-boost'; break;
      case 'boost-end': cue = 'bike-surface-change'; break;
      default: assertNeverPhysicsEvent(event);
    }
    this.playCue(cue, 'events', false);
  }

  stopBikeEngine(): void {
    this.stopCue('bike-engine');
  }

  /** Start a loop, or remember to start it the moment a gesture unlocks audio. */
  private requestLoop(cue: AtlasAudioCue, bus: AtlasAudioBus): void {
    if (!this.unlocked) {
      this.pendingLoops.set(cue, bus);
      return;
    }
    this.playCue(cue, bus, true);
  }

  playWorldCue(cue: 'city-footstep' | 'city-interaction' | 'bike-boost' | 'route-refused' | 'route-evidence' | 'route-repaired' | 'route-complete'): void {
    if (!this.unlocked) return;
    this.playCue(cue, cue === 'city-footstep' ? 'interface' : 'events', false);
  }

  narrate(text: string, locale: string = ATLAS_NARRATION_LOCALE): void {
    if (!this.unlocked || !text.trim()) return;
    const safeLocale = englishNarrationLocale(locale);
    try { this.backend.narrate?.(text, safeLocale, 'atlas'); } catch { /* Voice is optional and never blocks play. */ }
  }

  narrateLine(line: { readonly text: string; readonly locale: string; readonly speaker: AtlasVoiceProfile }): void {
    if (!this.unlocked || !line.text.trim()) return;
    try { this.backend.narrate?.(line.text, englishNarrationLocale(line.locale), line.speaker); } catch { /* Voice is optional and never blocks play. */ }
  }

  destroy(): void {
    for (const cue of ['atlas-theme', 'city-ambience', 'harbor-waiting-ambience', 'payment-pending', 'harbor-restored-ambience', 'bike-engine'] as const) this.stopCue(cue);
    this.backend.destroy();
    this.current = null;
    this.unlocked = false;
  }

  private sync(previous: AtlasAudioState | null, next: AtlasAudioState): void {
    const wasWaiting = previous ? WAITING_PHASES.has(previous.phase) : false;
    const isWaiting = WAITING_PHASES.has(next.phase);
    if (isWaiting && !wasWaiting) this.playCue('harbor-waiting-ambience', 'ambience', true);
    if (!isWaiting) this.stopCue('harbor-waiting-ambience');

    const wasConfirming = previous?.phase === 'confirming';
    if (next.phase === 'confirming' && !wasConfirming) this.playCue('payment-pending', 'events', true);
    if (next.phase !== 'confirming') this.stopCue('payment-pending');

    const serverConfirmed = next.phase === 'verified' && next.evidenceSource === 'server-verified';
    const previouslyServerConfirmed = previous?.phase === 'verified' && previous.evidenceSource === 'server-verified';
    if (serverConfirmed && !previouslyServerConfirmed) this.playCue('payment-confirmed', 'events', false);

    if (next.phase === 'tower-lit' && previous?.phase !== 'tower-lit') {
      this.playCue('harbor-restored-ambience', 'ambience', true);
      this.playCue('beacon-confirmation', 'events', false);
    }
    if (next.phase !== 'tower-lit') this.stopCue('harbor-restored-ambience');
  }

  private playCue(cue: AtlasAudioCue, bus: AtlasAudioBus, loop: boolean): void {
    try {
      this.backend.play(cue, bus, loop);
    } catch {
      // The visual cue remains the honest fallback when decode or playback fails.
    } finally {
      this.backend.visualCue(cue);
    }
  }

  private stopCue(cue: AtlasAudioCue): void {
    try {
      this.backend.stop(cue);
    } catch {
      // Cleanup is best effort in a browser that has already reclaimed audio.
    }
  }
}

/*
 * Cues backed by a real recording.
 *
 * Everything used to be a synthesised oscillator ramp, including the three ogg
 * files that shipped in public/atlas/audio and were never loaded, so a
 * playtester reported no music on the start screen and no environment sound
 * while playing. A cue listed here plays its file; anything else still gets a
 * tone, which is right for short interface feedback and wrong for a music bed.
 *
 * Files load lazily on first play, after the unlock gesture, so none of this is
 * on the path to first paint. theme.mp3 is 1.4 MB and would be if it were not.
 */
const SAMPLES: Partial<Record<AtlasAudioCue, string>> = {
  'atlas-theme': '/audio/theme.mp3',
  'city-ambience': '/atlas/audio/harbor-waiting-ambience.ogg',
  'harbor-waiting-ambience': '/atlas/audio/harbor-waiting-ambience.ogg',
  'harbor-restored-ambience': '/atlas/audio/harbor-restored-ambience.ogg',
  'beacon-confirmation': '/atlas/audio/beacon-confirmation.ogg',
};

interface ToneRecipe { from: number; to: number; duration: number; }

const TONES: Record<AtlasAudioCue, ToneRecipe> = {
  'route-refused': { from: 240, to: 140, duration: 0.16 },
  'route-evidence': { from: 350, to: 700, duration: 0.16 },
  'route-repaired': { from: 260, to: 780, duration: 0.42 },
  'route-complete': { from: 520, to: 1040, duration: 0.5 },
  'atlas-theme': { from: 196, to: 262, duration: 1.1 },
  'city-ambience': { from: 146, to: 174, duration: 0.9 },
  'harbor-waiting-ambience': { from: 164, to: 196, duration: 0.7 },
  'harbor-restored-ambience': { from: 220, to: 440, duration: 0.9 },
  'payment-pending': { from: 196, to: 180, duration: 0.24 },
  'payment-confirmed': { from: 440, to: 660, duration: 0.2 },
  'beacon-confirmation': { from: 660, to: 990, duration: 0.35 },
  'city-footstep': { from: 105, to: 78, duration: 0.08 },
  'city-interaction': { from: 330, to: 520, duration: 0.18 },
  'bike-engine': { from: 55, to: 120, duration: 0.12 },
  'bike-boost': { from: 180, to: 640, duration: 0.28 },
  'bike-skid': { from: 92, to: 54, duration: 0.18 },
  'bike-impact': { from: 78, to: 38, duration: 0.22 },
  'bike-landing': { from: 120, to: 66, duration: 0.2 },
  'bike-surface-change': { from: 150, to: 90, duration: 0.12 },
};

function assertNeverPhysicsEvent(value: never): never {
  throw new Error(`Unknown Blitz physics event: ${String(value)}`);
}

const VOICE_PROFILES: Record<AtlasVoiceProfile, { readonly rate: number; readonly pitch: number }> = {
  mara: { rate: 0.88, pitch: 0.94 },
  atlas: { rate: 0.82, pitch: 1.02 },
  nia: { rate: 0.96, pitch: 1.08 },
  oren: { rate: 0.9, pitch: 0.98 },
  tala: { rate: 0.86, pitch: 0.9 },
  ivo: { rate: 0.94, pitch: 1.0 },
  ada: { rate: 0.88, pitch: 1.06 },
};

function englishNarrationLocale(locale: string): string {
  return locale.toLowerCase().startsWith('en-') ? locale : ATLAS_NARRATION_LOCALE;
}

function createWebAudioBackend(): AtlasAudioBackend {
  let context: AudioContext | null = null;
  const buses = new Map<AtlasAudioBus, GainNode>();
  const volumes: Record<AtlasAudioBus, number> = { ambience: 0.25, events: 0.7, interface: 0.5, voice: 0.85 };

  /*
   * Decoded samples, and the sources currently playing them.
   *
   * Kept per cue so stop() can silence a loop that has no natural end: the
   * music bed and the city layer both run until the screen changes.
   */
  const decoded = new Map<AtlasAudioCue, AudioBuffer>();
  const playing = new Map<AtlasAudioCue, AudioBufferSourceNode>();
  const loading = new Set<AtlasAudioCue>();
  const wanted = new Set<AtlasAudioCue>();
  let engineOscillator: OscillatorNode | null = null;
  let engineHarmonic: OscillatorNode | null = null;
  let engineFilter: BiquadFilterNode | null = null;
  let engineGain: GainNode | null = null;
  let windSource: AudioBufferSourceNode | null = null;
  let windFilter: BiquadFilterNode | null = null;
  let windGain: GainNode | null = null;
  let engineSpeed = 0;
  let pendingNarration: { text: string; locale: string; speaker: AtlasVoiceProfile } | null = null;
  let voiceListenerInstalled = false;

  function speakPendingNarration(): void {
    const pending = pendingNarration;
    if (!pending) return;
    const synth = globalThis.speechSynthesis;
    const Utterance = globalThis.SpeechSynthesisUtterance;
    if (!synth || !Utterance || volumes.voice === 0) return;
    const voices = synth.getVoices();
    const requestedLocale = pending.locale.toLowerCase();
    const voice = voices.find((candidate) => candidate.lang.toLowerCase() === requestedLocale)
      ?? voices.find((candidate) => candidate.lang.toLowerCase().startsWith('en-'));
    // Some WebViews expose speechSynthesis before their voice list is ready.
    // Keep the English line pending until voiceschanged instead of allowing a
    // device default (which may be an unrelated language) to speak it.
    if (!voice) return;
    pendingNarration = null;
    synth.cancel();
    const utterance = new Utterance(pending.text);
    utterance.lang = pending.locale;
    utterance.volume = volumes.voice;
    const profile = VOICE_PROFILES[pending.speaker];
    utterance.rate = profile.rate;
    utterance.pitch = profile.pitch;
    utterance.voice = voice;
    synth.speak(utterance);
  }

  function startSample(cue: AtlasAudioCue, buffer: AudioBuffer, bus: AtlasAudioBus, loop: boolean): void {
    if (!context) return;
    const output = buses.get(bus);
    if (!output) return;
    /*
     * Asking for a loop that is already running is a no-op.
     *
     * Screens repaint often — every panel screen calls screenPanel on each
     * render — so restarting the source here would make the music stutter back
     * to bar one whenever anything on screen changed. A one-shot still
     * retriggers, which is what a one-shot is for.
     */
    if (loop && playing.has(cue)) return;
    playing.get(cue)?.stop();
    const source = context.createBufferSource();
    source.buffer = buffer;
    source.loop = loop;
    source.connect(output);
    source.onended = () => { if (playing.get(cue) === source) playing.delete(cue); };
    source.start();
    playing.set(cue, source);
  }

  function playSampled(cue: AtlasAudioCue, url: string, bus: AtlasAudioBus, loop: boolean): void {
    wanted.add(cue);
    const buffer = decoded.get(cue);
    if (buffer) {
      startSample(cue, buffer, bus, loop);
      return;
    }
    if (loading.has(cue)) return;
    loading.add(cue);
    void fetch(url)
      .then((response) => (response.ok ? response.arrayBuffer() : Promise.reject(new Error(`${response.status}`))))
      .then((bytes) => context?.decodeAudioData(bytes))
      .then((buffered) => {
        loading.delete(cue);
        if (!buffered) return;
        decoded.set(cue, buffered);
        if (wanted.has(cue)) startSample(cue, buffered, bus, loop);
      })
      .catch(() => {
        // A missing or undecodable file must never take the game down; the cue
        // simply stays silent and the visual cue still fires.
        loading.delete(cue);
      });
  }

  function setEngineSpeed(speedMps: number): void {
    engineSpeed = Math.max(0, Math.min(32, Number.isFinite(speedMps) ? speedMps : 0));
    if (!context || !engineOscillator || !engineHarmonic || !engineFilter || !engineGain) return;
    const normalized = Math.min(1, engineSpeed / 30);
    const now = context.currentTime;
    engineOscillator.frequency.setTargetAtTime(52 + normalized * 82, now, 0.045);
    engineHarmonic.frequency.setTargetAtTime(104 + normalized * 164, now, 0.045);
    engineFilter.frequency.setTargetAtTime(220 + normalized * 1_160, now, 0.06);
    engineGain.gain.setTargetAtTime(0.012 + normalized * 0.075, now, 0.08);
    windFilter?.frequency.setTargetAtTime(380 + normalized * 2_400, now, 0.12);
    windFilter?.Q.setTargetAtTime(0.4 + normalized * 0.9, now, 0.12);
    windGain?.gain.setTargetAtTime(0.0002 + normalized * 0.028, now, 0.16);
  }

  function startEngine(): void {
    if (!context || engineOscillator) return;
    const output = buses.get('events');
    if (!output) return;
    engineOscillator = context.createOscillator();
    engineHarmonic = context.createOscillator();
    engineFilter = context.createBiquadFilter();
    engineGain = context.createGain();
    engineOscillator.type = 'sawtooth';
    engineHarmonic.type = 'square';
    engineFilter.type = 'lowpass';
    engineFilter.Q.value = 1.1;
    engineGain.gain.value = 0.0001;
    engineOscillator.connect(engineFilter);
    engineHarmonic.connect(engineFilter);
    engineFilter.connect(engineGain);
    engineGain.connect(output);
    engineOscillator.start();
    engineHarmonic.start();

    // A filtered noise bed makes speed audible even when the engine note is
    // subtle. It is generated locally so it adds no download weight and can
    // react continuously to the same authoritative speed value as the HUD.
    const windBuffer = context.createBuffer(1, context.sampleRate * 2, context.sampleRate);
    const windData = windBuffer.getChannelData(0);
    for (let index = 0; index < windData.length; index += 1) windData[index] = Math.random() * 2 - 1;
    windSource = context.createBufferSource();
    windFilter = context.createBiquadFilter();
    windGain = context.createGain();
    windSource.buffer = windBuffer;
    windSource.loop = true;
    windFilter.type = 'bandpass';
    windGain.gain.value = 0.0001;
    windSource.connect(windFilter);
    windFilter.connect(windGain);
    windGain.connect(output);
    windSource.start();
    setEngineSpeed(engineSpeed);
  }

  function stopEngine(): void {
    engineOscillator?.stop();
    engineHarmonic?.stop();
    engineOscillator = null;
    engineHarmonic = null;
    engineFilter = null;
    engineGain = null;
    windSource?.stop();
    windSource = null;
    windFilter = null;
    windGain = null;
  }

  return {
    unlock: () => {
      if (context) return;
      const Constructor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Constructor) return;
      context = new Constructor();
      for (const bus of ['ambience', 'events', 'interface', 'voice'] as const) {
        const gain = context.createGain();
        gain.gain.value = volumes[bus];
        gain.connect(context.destination);
        buses.set(bus, gain);
      }
    },
    play: (cue, bus, loop) => {
      if (!context) return;
      const output = buses.get(bus);
      if (!output) return;
      if (cue === 'bike-engine') {
        startEngine();
        return;
      }
      const sample = SAMPLES[cue];
      if (sample) {
        playSampled(cue, sample, bus, loop);
        return;
      }
      const now = context.currentTime;
      const recipe = TONES[cue];
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      oscillator.type = cue === 'payment-pending' || cue === 'city-footstep' ? 'sine' : 'triangle';
      oscillator.frequency.setValueAtTime(recipe.from, now);
      oscillator.frequency.exponentialRampToValueAtTime(recipe.to, now + recipe.duration);
      gain.gain.setValueAtTime(0.08, now);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + recipe.duration);
      oscillator.connect(gain);
      gain.connect(output);
      oscillator.start(now);
      oscillator.stop(now + recipe.duration + 0.02);
    },
    stop: (cue) => {
      if (cue === 'bike-engine') {
        wanted.delete(cue);
        stopEngine();
        return;
      }
      wanted.delete(cue);
      const source = playing.get(cue);
      if (!source) return;
      playing.delete(cue);
      source.stop();
    },
    setVolume: (bus, value) => {
      if (bus === 'voice' && value === 0) globalThis.speechSynthesis?.cancel();
      volumes[bus] = value;
      const gain = buses.get(bus);
      if (gain) gain.gain.value = value;
    },
    narrate: (text, locale, speaker = 'atlas') => {
      if (volumes.voice === 0) return;
      const synth = globalThis.speechSynthesis;
      const Utterance = globalThis.SpeechSynthesisUtterance;
      if (!synth || !Utterance) return;
      const safeLocale = englishNarrationLocale(locale);
      pendingNarration = { text, locale: safeLocale, speaker };
      if (!voiceListenerInstalled) {
        synth.addEventListener?.('voiceschanged', speakPendingNarration);
        voiceListenerInstalled = true;
      }
      speakPendingNarration();
    },
    visualCue: () => undefined,
    destroy: () => {
      wanted.clear();
      stopEngine();
      for (const source of playing.values()) source.stop();
      playing.clear();
      decoded.clear();
      pendingNarration = null;
      if (voiceListenerInstalled) globalThis.speechSynthesis?.removeEventListener?.('voiceschanged', speakPendingNarration);
      voiceListenerInstalled = false;
      globalThis.speechSynthesis?.cancel();
      if (context) void context.close().catch(() => undefined);
      context = null;
      buses.clear();
    },
  };
}
