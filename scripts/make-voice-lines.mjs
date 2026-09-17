/**
 * Renders the NIM RUSH race callouts to audio with ElevenLabs.
 *
 * WHY PRE-RENDER, AND NOT CALL THE API FROM THE GAME
 *
 * An API key shipped to a browser is a public API key. Every player would hold
 * it, and anybody could spend the account. There is no client-side way around
 * that - not obfuscation, not a build-time inline, not a same-origin check.
 *
 * The callout set is also fixed and small: a dozen short lines that never
 * change during a run. So they are rendered once, here, into static files that
 * ship with the game. That means the key stays on the machine that runs this
 * script, a line costs nothing to play, it works with no network, and it
 * cannot stall a run waiting on a request. The browser's own speech engine
 * stays as the fallback for anyone who has not rendered the files.
 *
 * Run with:
 *   ELEVENLABS_API_KEY=... npm run voice
 *   ELEVENLABS_API_KEY=... npm run voice -- --voice=<voiceId> --force
 *
 * The key is read from the environment and never written to disk or logged.
 */

import { mkdirSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'nim-rush', 'voice');

/*
 * Every line the race voice can say, keyed by the callout id in
 * src/atlas/blitz/blitz-callouts.ts. The ids are the contract between this
 * script and the game: a file named after an id is the recording for it.
 */
const LINES = {
  contact: 'Contact.',
  'contact-two': 'That is two.',
  'contact-many': 'Keep it upright!',
  timeout: 'Out of time.',
  finish: 'Finish!',
  'finish-clean': 'Finish! Not a mark on it.',
  ten: 'Ten seconds!',
  gearless: 'Last gear gone.',
  dry: 'Tank is dry.',
  contract: 'Contract clear.',
  'contract-all': 'All three contracts. Clean.',
  threaded: 'Threaded it!',
  landing: 'Landed it.',
};

/*
 * A race voice, not an audiobook narrator. Low stability keeps the delivery
 * varied and urgent rather than evenly-paced, and high similarity keeps it the
 * same person from line to line - the two settings that decide whether this
 * sounds like commentary or like a menu reading itself out.
 */
const VOICE_SETTINGS = { stability: 0.32, similarity_boost: 0.85, style: 0.55, use_speaker_boost: true };
const MODEL = 'eleven_multilingual_v2';
/** Default is "Josh": a firm, mid-range delivery that cuts through engine noise. */
const DEFAULT_VOICE = 'TxGEqnHWrfWFTfGW9XjX';

const argument = (name, fallback) => process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3) ?? fallback;
const force = process.argv.includes('--force');

async function main() {
  const key = process.env.ELEVENLABS_API_KEY;
  if (!key) {
    console.error('ELEVENLABS_API_KEY is not set. Nothing was requested and nothing was written.');
    console.error('Run: ELEVENLABS_API_KEY=... npm run voice');
    process.exitCode = 1;
    return;
  }
  const voiceId = argument('voice', DEFAULT_VOICE);
  mkdirSync(OUT_DIR, { recursive: true });

  const manifest = {};
  let rendered = 0;
  let skipped = 0;

  for (const [id, text] of Object.entries(LINES)) {
    const file = join(OUT_DIR, `${id}.mp3`);
    // Re-rendering a line that already exists spends money for an identical
    // file, so it is opt-in.
    if (existsSync(file) && !force) {
      manifest[id] = { text, bytes: readFileSync(file).length };
      skipped += 1;
      continue;
    }
    const response = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`, {
      method: 'POST',
      headers: { 'xi-api-key': key, 'content-type': 'application/json', accept: 'audio/mpeg' },
      body: JSON.stringify({ text, model_id: MODEL, voice_settings: VOICE_SETTINGS }),
    });
    if (!response.ok) {
      // The body can carry a quota or voice-id message worth seeing, but it is
      // read as text so a key echoed back could never be printed as JSON.
      const detail = (await response.text()).slice(0, 300);
      throw new Error(`ElevenLabs refused "${id}" (${response.status}): ${detail}`);
    }
    const audio = Buffer.from(await response.arrayBuffer());
    writeFileSync(file, audio);
    manifest[id] = { text, bytes: audio.length };
    rendered += 1;
    console.log(`${id.padEnd(16)} ${text.padEnd(30)} ${(audio.length / 1024).toFixed(1)} kB`);
  }

  /*
   * The manifest is what the game loads. It lists the lines that exist, so the
   * client never requests a file that was not rendered and never has to guess.
   */
  writeFileSync(join(OUT_DIR, 'lines.json'), `${JSON.stringify({ voiceId, model: MODEL, lines: manifest }, null, 2)}\n`);
  console.log(`\n${rendered} rendered, ${skipped} already present. Manifest written to public/nim-rush/voice/lines.json`);
}

await main();
