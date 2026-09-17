import { createRushLogo } from './blitz-brand';

/*
 * The door into the game.
 *
 * Booting straight into the live world meant the first thing a new player saw
 * was an empty screen for as long as WebGL, the city geometry and the textures
 * took to come up - which on a mid-range phone is several seconds of nothing.
 * A blank wait is where people leave.
 *
 * So the game opens on a picture. It paints immediately, because it is one
 * image and no 3D, and the world loads behind it. The rider chooses when to
 * go in.
 *
 * The click is doing real work besides pacing: browsers will not start audio
 * until a gesture, so the press that opens the game is also the press that
 * unlocks the engine, the wind and the race voice. Without a door here, the
 * first run is silent.
 */

export interface BlitzStartGate {
  readonly element: HTMLElement;
  /** The world is up. Turn the button from a loading state into an invitation. */
  ready(): void;
  /** Take the door off the screen. */
  dismiss(): void;
}

const ART = '/nim-rush/art/start-pack.jpg';

export function createBlitzStartGate(options: { onStart: () => void }): BlitzStartGate {
  const gate = document.createElement('section');
  gate.className = 'blitz-gate';
  gate.setAttribute('data-blitz-screen', 'gate');

  const art = document.createElement('img');
  art.className = 'blitz-gate-art';
  art.src = ART;
  art.alt = 'A pack of riders leaning hard through a dirt berm.';
  // Decoded off the main thread so it cannot hold up the first paint it exists
  // to provide, and eager because this is the one image that must not wait.
  art.decoding = 'async';
  art.fetchPriority = 'high';

  const panel = document.createElement('div');
  panel.className = 'blitz-gate-panel';
  panel.append(createRushLogo('hero'));

  const tagline = document.createElement('p');
  tagline.className = 'blitz-gate-tagline';
  tagline.textContent = 'Find your line. Ride the ridge. Prove your run.';

  const start = document.createElement('button');
  start.type = 'button';
  start.className = 'blitz-gate-start';
  start.textContent = 'LOADING THE RIDGE';
  start.disabled = true;

  const note = document.createElement('p');
  note.className = 'blitz-gate-note';
  note.textContent = 'Signed with Nimiq. Every ranked run is replay-verified.';

  panel.append(tagline, start, note);
  gate.append(art, panel);

  let started = false;
  const go = () => {
    if (started || start.disabled) return;
    started = true;
    options.onStart();
  };
  start.addEventListener('click', go);

  return {
    element: gate,
    ready() {
      start.disabled = false;
      start.textContent = 'TAP TO START';
    },
    dismiss() {
      gate.classList.add('is-gone');
      // Removed only after the fade so the world is never revealed through a
      // half-transparent door; a gate that lingers also swallows the first tap.
      const drop = () => gate.remove();
      gate.addEventListener('transitionend', drop, { once: true });
      setTimeout(drop, 700);
    },
  };
}
