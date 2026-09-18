import type { LanternEvidenceSource, LanternPhase } from '../../../shared/atlas/adventures/last-lantern';
import type { BlitzPhysicsEvent, BlitzSurface } from '../../../shared/atlas/blitz/types';

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
export type AtlasAudioCue = 'atlas-theme' | 'city-ambience' | 'harbor-waiting-ambience' | 'harbor-restored-ambience' | 'payment-pending' | 'payment-confirmed' | 'beacon-confirmation' | 'city-footstep' | 'city-interaction' | 'bike-engine' | 'bike-boost' | 'bike-skid' | 'bike-impact' | 'bike-landing' | 'bike-surface-change' | 'bike-pickup' | 'route-refused' | 'route-evidence' | 'route-repaired' | 'route-complete';

export interface AtlasAudioBackend {
  debugSnapshot?(): { context: string; samples: string[]; bike: boolean };
  unlock(): void;
  play(cue: AtlasAudioCue, bus: AtlasAudioBus, loop: boolean): void;
  stop(cue: AtlasAudioCue): void;
  setVolume(bus: AtlasAudioBus, value: number): void;
  setEngineSpeed?(speedMps: number): void;
  setBikeContact?(surface: BlitzSurface, airborne: boolean, slip: number): void;
  physicsContact?(event: BlitzPhysicsEvent): void;
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
  private rideScene: 'menu' | 'riding' | 'paused' | 'silent' | null = null;
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
    try {
      this.backend.unlock();
      if (this.unlocked) return;
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
    if (this.rideScene !== null && this.rideScene !== 'menu') return;
    this.requestLoop('atlas-theme', 'ambience');
  }

  setRideScene(scene: 'menu' | 'riding' | 'paused' | 'silent', speedMps = 0): void {
    this.rideScene = scene;
    this.stopCityAmbience();
    if (scene === 'menu') {
      this.stopBikeEngine();
      this.playTheme();
    } else {
      this.stopTheme();
      if (scene === 'riding') this.playBikeEngine(speedMps);
      else this.stopBikeEngine();
    }
  }

  debugSnapshot(): object {
    return { scene: this.rideScene, ...this.backend.debugSnapshot?.() };
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
    if (this.backend.physicsContact) { this.backend.physicsContact(event); return; }
    let cue: Extract<AtlasAudioCue, `bike-${string}`>;
    switch (event.type) {
      case 'skid': cue = 'bike-skid'; break;
      case 'impact': cue = 'bike-impact'; break;
      case 'landing': cue = 'bike-landing'; break;
      case 'surface-change': cue = 'bike-surface-change'; break;
      case 'launch':
      case 'boost-start': cue = 'bike-boost'; break;
      case 'boost-end': cue = 'bike-surface-change'; break;
      // A supply has to be heard as well as seen: at racing speed a rider is
      // looking at the road ahead, not at the bottle they just crossed.
      case 'pickup': cue = 'bike-pickup'; break;
      default: assertNeverPhysicsEvent(event);
    }
    this.playCue(cue, 'events', false);
  }

  stopBikeEngine(): void {
    this.stopCue('bike-engine');
  }

  setBikeContact(surface: BlitzSurface, airborne: boolean, slip: number): void {
    this.backend.setBikeContact?.(surface, airborne, slip);
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
    this.pendingLoops.clear();
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
  // Bright and rising, so it reads as a gain against the engine underneath it.
  'bike-pickup': { from: 520, to: 880, duration: 0.14 },
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
  let rollingSource: AudioBufferSourceNode | null = null;
  let rollingFilter: BiquadFilterNode | null = null;
  let rollingGain: GainNode | null = null;
  let bikeSurface: BlitzSurface = 'dirt';
  let bikeAirborne = false;
  let bikeSlip = 0;
  let impactAt = -1;
  // Trail tokens sit 16 m apart, about 0.6 s at racing speed, so a window of
  // 1.1 s holds a streak through a clean line and breaks it on one missed coin.
  const COIN_STREAK_WINDOW = 1.1;
  const COIN_STREAK_STEPS = 12;
  let coinAt = -Infinity;
  let coinStreak = 0;
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
    engineSpeed = Math.max(0, Math.min(42, Number.isFinite(speedMps) ? speedMps : 0));
    if (!context || !engineOscillator || !engineHarmonic || !engineFilter || !engineGain) return;
    const normalized = Math.min(1, engineSpeed / 40);
    const now = context.currentTime;
    engineOscillator.frequency.setTargetAtTime(52 + normalized * 82, now, 0.045);
    engineHarmonic.frequency.setTargetAtTime(104 + normalized * 164, now, 0.045);
    engineFilter.frequency.setTargetAtTime(220 + normalized * 1_160, now, 0.06);
    // Audible. At .0015 against wind at .075 the bike itself could not be
  // heard at all, which is most of why the ride sounded thin.
    engineGain.gain.setTargetAtTime((.006 + normalized * .026), now, 0.08);
    windFilter?.frequency.setTargetAtTime(380 + normalized * 2_400, now, 0.12);
    windFilter?.Q.setTargetAtTime(0.4 + normalized * 0.9, now, 0.12);
    windGain?.gain.setTargetAtTime(normalized * normalized * .075, now, .16);
    rollingFilter?.frequency.setTargetAtTime(bikeSurface === 'grass' ? 430 : bikeSurface === 'gravel' ? 2100 : bikeSurface === 'wood' ? 330 : bikeSurface === 'pavement' ? 650 : 1200, now, .08);
    // Tyre on surface, louder than it was: this is the layer that tells a
  // rider what they are riding on.
    rollingGain?.gain.setTargetAtTime(bikeAirborne ? 0 : normalized * (.075 + Math.min(1, bikeSlip / 8) * .08) * (bikeSurface === 'grass' ? .6 : 1), now, .045);
    rollingSource?.playbackRate.setTargetAtTime(.65 + normalized * .6, now, .08);
  }

  /** Filtered noise with a swept cutoff: the shape of most bike sounds. */
  function noiseBurst(now: number, options: { output: GainNode; type: BiquadFilterType; from: number; to: number; peak: number; duration: number; q?: number; offset?: number }): void {
    if (!context || !windSource?.buffer) return;
    const source = context.createBufferSource();
    const filter = context.createBiquadFilter();
    const gain = context.createGain();
    source.buffer = windSource.buffer;
    filter.type = options.type;
    filter.frequency.setValueAtTime(options.from, now);
    filter.frequency.exponentialRampToValueAtTime(Math.max(40, options.to), now + options.duration);
    if (options.q !== undefined) filter.Q.value = options.q;
    gain.gain.setValueAtTime(0.0001, now);
    // A 12ms attack rather than a step, which would click on every event.
    gain.gain.exponentialRampToValueAtTime(options.peak, now + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + options.duration);
    source.connect(filter); filter.connect(gain); gain.connect(options.output);
    source.start(now, (options.offset ?? 0) * Math.max(0, source.buffer.duration - options.duration - 0.05));
    source.stop(now + options.duration + 0.02);
    source.onended = () => { source.disconnect(); filter.disconnect(); gain.disconnect(); };
  }

  /** A falling pitch with a body to it: the weight under an impact. */
  function thud(now: number, output: GainNode, from: number, to: number, peak: number, duration: number, type: OscillatorType = 'sine'): void {
    if (!context) return;
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.type = type;
    oscillator.frequency.setValueAtTime(from, now);
    oscillator.frequency.exponentialRampToValueAtTime(Math.max(20, to), now + duration);
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(peak, now + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);
    oscillator.connect(gain); gain.connect(output);
    oscillator.start(now);
    oscillator.stop(now + duration + 0.02);
    oscillator.onended = () => { oscillator.disconnect(); gain.disconnect(); };
  }

  /** A clean note. Triangle rather than sine so it carries over the wind. */
  function chime(at: number, output: GainNode, frequency: number, peak: number, duration: number): void {
    if (!context) return;
    const now = Math.max(at, context.currentTime);
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.type = 'triangle';
    oscillator.frequency.setValueAtTime(frequency, now);
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(peak, now + 0.008);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);
    oscillator.connect(gain); gain.connect(output);
    oscillator.start(now);
    oscillator.stop(now + duration + 0.02);
    oscillator.onended = () => { oscillator.disconnect(); gain.disconnect(); };
  }

  function startEngine(): void {
    if (!context || engineOscillator) return;
    const output = buses.get('events');
    if (!output) return;
    engineOscillator = context.createOscillator();
    engineHarmonic = context.createOscillator();
    engineFilter = context.createBiquadFilter();
    engineGain = context.createGain();
    engineOscillator.type = 'sine';
    engineHarmonic.type = 'sine';
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
    rollingSource = context.createBufferSource();
    rollingSource.buffer = windBuffer; rollingSource.loop = true;
    rollingFilter = context.createBiquadFilter(); rollingFilter.type = 'lowpass';
    rollingGain = context.createGain(); rollingGain.gain.value = 0;
    rollingSource.connect(rollingFilter); rollingFilter.connect(rollingGain); rollingGain.connect(output);
    rollingSource.start(0, .73);
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
    rollingSource?.stop(); rollingSource = null; rollingFilter = null; rollingGain = null;
  }

  return {
    debugSnapshot: () => ({ context: context?.state ?? 'unavailable', samples: [...playing.keys()], bike: engineOscillator !== null }),
    setBikeContact: (surface, airborne, slip) => { bikeSurface = surface; bikeAirborne = airborne; bikeSlip = Math.abs(slip); },
    /*
     * Every physics event gets a voice.
     *
     * This used to answer impact and landing and return for everything else -
     * and because playPhysicsCue hands the event to this backend and returns,
     * the oscillator fallback never ran. Skids, launches, boosts and pickups
     * were silent. A racing game that goes quiet when the rider does something
     * well is the wrong way round.
     *
     * Noise through a filter, not a tone sweep: a bike on dirt is broadband,
     * and a sine pitch-slide reads as a menu beep.
     */
    physicsContact: (event) => {
      if (!context || !windSource?.buffer) return;
      const output = buses.get('events');
      if (!output) return;
      const now = context.currentTime;

      if (event.type === 'impact' || event.type === 'landing') {
        // Two impacts a tenth of a second apart are one impact to an ear.
        if (now - impactAt < .14) return;
        impactAt = now;
        noiseBurst(now, {
          output,
          type: 'lowpass',
          from: event.type === 'landing' ? 340 : 1100,
          to: event.type === 'landing' ? 150 : 260,
          peak: .12 + event.intensity * .34,
          duration: .1 + event.intensity * .2,
          offset: (event.tick % 40) / 40,
        });
        // The body of the hit. Noise alone reads as a hiss, not a collision.
        thud(now, output, event.type === 'landing' ? 78 : 104, event.type === 'landing' ? 44 : 38, .16 + event.intensity * .2, .22);
        return;
      }

      if (event.type === 'skid') {
        // Resonant and mid-band: rubber letting go, not a crash.
        noiseBurst(now, { output, type: 'bandpass', from: 1500, to: 900, peak: .05 + event.intensity * .12, duration: .2, q: 5.5, offset: (event.tick % 40) / 40 });
        return;
      }

      if (event.type === 'launch') {
        // Rising, because the bike is leaving the ground.
        noiseBurst(now, { output, type: 'bandpass', from: 380, to: 2400, peak: .1, duration: .26, q: 1.2, offset: .2 });
        return;
      }

      if (event.type === 'boost-start') {
        // A whoosh with a note underneath it, so boost is felt as thrust.
        noiseBurst(now, { output, type: 'bandpass', from: 260, to: 3200, peak: .13, duration: .34, q: 0.9, offset: .05 });
        thud(now, output, 120, 300, .05, .3, 'sawtooth');
        return;
      }

      if (event.type === 'boost-end') {
        noiseBurst(now, { output, type: 'lowpass', from: 2200, to: 400, peak: .06, duration: .22, offset: .3 });
        return;
      }

      if (event.type === 'surface-change') {
        // A short tick, the width of a tyre crossing an edge.
        noiseBurst(now, { output, type: 'bandpass', from: 900, to: 520, peak: .05, duration: .09, q: 2.4, offset: .45 });
        return;
      }

      /*
       * A supply. Two notes, because one is a blip and three is a jingle - and
       * the two kinds take different intervals so a rider can tell what they
       * picked up without looking down at the HUD.
       */
      if (event.pickup === 'token') {
        /*
         * NIM off the trail. It used to share the gearbox chime - two quiet
         * notes falling - which under the engine read as nothing, or as a loss.
         * A coin rings upward, and a run of coins climbs: each one taken inside
         * the streak window lands a semitone higher, so holding the trail is
         * heard as a rising ladder and missing a coin drops back to the bottom.
         */
        coinStreak = now - coinAt < COIN_STREAK_WINDOW ? Math.min(coinStreak + 1, COIN_STREAK_STEPS) : 0;
        coinAt = now;
        const lift = 2 ** (coinStreak / 12);
        chime(now, output, 988 * lift, .11, .07);
        chime(now + .06, output, 1319 * lift, .1, .16);
        return;
      }
      const nitro = event.pickup === 'nitro';
      chime(now, output, nitro ? 784 : 523, .055, .07);
      chime(now + .075, output, nitro ? 1175 : 392, .05, .1);
    },
    unlock: () => {
      // Native Web Audio, MDN best practices read 2026-09-15. Autoplay may
      // suspend an existing context; subsequent gestures must retry resume.
      // https://developer.mozilla.org/en-US/docs/Web/API/Web_Audio_API/Best_practices
      if (context) {
        if (context.state === 'suspended') void context.resume().catch(() => undefined);
        return;
      }
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
