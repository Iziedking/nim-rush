/*
 * Recorded race callouts.
 *
 * The browser's own speech engine is a screen reader: even, patient, and
 * completely wrong over an engine at forty metres a second. These are real
 * recordings, rendered ahead of time by scripts/make-voice-lines.mjs and
 * shipped as static files, so playing one costs nothing, needs no network and
 * cannot stall a run.
 *
 * Nothing here holds an API key. The key lives on the machine that renders the
 * lines and never reaches a browser, because a key in a browser is a key
 * everybody has.
 *
 * The bank is always optional. If the lines were never rendered, every call
 * simply reports that it could not play and the caller falls back to speech
 * synthesis - a game must not go quiet because an art step was skipped.
 */

const MANIFEST_URL = '/nim-rush/voice/lines.json';

interface VoiceManifest {
  readonly lines: Record<string, { readonly text: string }>;
}

export interface BlitzVoiceBank {
  /** Start loading the manifest. Safe to call more than once. */
  prime(): void;
  /** Play a line. False means it is not available and the caller should speak. */
  play(id: string, volume: number): boolean;
}

export function createBlitzVoiceBank(options: { fetchImpl?: typeof fetch } = {}): BlitzVoiceBank {
  const fetchImpl = options.fetchImpl ?? (typeof fetch === 'function' ? fetch : null);
  /** Decoded once per line and rewound to replay, so a lap costs no downloads. */
  const players = new Map<string, HTMLAudioElement>();
  let available: Set<string> | null = null;
  let priming = false;

  function prime(): void {
    if (priming || available || !fetchImpl) return;
    priming = true;
    void fetchImpl(MANIFEST_URL)
      .then((response) => (response.ok ? response.json() : null))
      .then((manifest: VoiceManifest | null) => {
        available = new Set(manifest?.lines ? Object.keys(manifest.lines) : []);
        // Warm the elements now rather than on the first contact of a run,
        // when the rider is least able to wait for a decode.
        for (const id of available) {
          const audio = new Audio(`/nim-rush/voice/${id}.mp3`);
          audio.preload = 'auto';
          players.set(id, audio);
        }
      })
      .catch(() => { available = new Set(); });
  }

  return {
    prime,
    play(id, volume) {
      if (!available) { prime(); return false; }
      const audio = players.get(id);
      if (!audio || volume <= 0) return false;
      try {
        audio.currentTime = 0;
        audio.volume = Math.max(0, Math.min(1, volume));
        const started = audio.play();
        // A refused autoplay is not a failure worth falling back on: speaking
        // the same line through synthesis would be refused for the same reason.
        if (started && typeof started.catch === 'function') started.catch(() => undefined);
        return true;
      } catch {
        return false;
      }
    },
  };
}
