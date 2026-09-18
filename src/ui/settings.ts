/**
 * Everything you would change about the app, rather than about your pilot.
 *
 * ## Why the toggles moved here after all
 *
 * This file used to argue the opposite: that sound and fullscreen should stay
 * on the home page because they are one-tap toggles you reach for mid-session,
 * and burying them would be a worse app arranged more neatly.
 *
 * The argument was right about the toggles and wrong about the total. Four
 * quiet buttons under six tiles under two sign-in actions under a primary
 * button is not a home page a stranger can read, and the cost of the tidying
 * is one tap on controls nobody uses more than once a session. Sound is set
 * once. Fullscreen is set once. The intro is replayed almost never.
 *
 * What is genuinely mid-run lives in the pause menu, which is where a player
 * actually reaches for it, and that has not moved.
 *
 * The split with Profile is state versus preference. Rank, Face, balance, clan
 * and gun are things you have, and they are next door. Everything here is a
 * thing you decide.
 */

import { networkLabel, onTestnet, setNetwork, TESTNET_FAUCET } from '../core/network';
import { claimFaucet, faucetInfo, type FaucetInfo } from '../net/faucet';
import { button, el, mount } from './dom';
import {
  SCHEME_LABEL,
  SCHEME_SAY,
  scheme,
  setScheme,
  touchCapable,
  type Scheme,
} from '../core/scheme';

export interface SettingsOptions {
  onBack: () => void;
  /** Re-render, so the chosen row updates under the thumb that chose it. */
  onChange: () => void;
  /** Current sound state, for the toggle's label. */
  soundOn: boolean;
  onToggleSound: () => void;
  /**
   * Null where the browser has no Fullscreen API, or where it would do nothing.
   *
   * Android Chrome has it. iOS Safari does not, and the wallet draws its own
   * header that no web API can remove, so a button there would name something
   * it cannot do.
   */
  onFullscreen: (() => void) | null;
  fullscreen: boolean;
  /**
   * True where fullscreen is impossible but installing to the home screen is
   * not, which in practice means iOS Safari.
   *
   * The helper for this existed and was wired to nothing, so an iPhone showed
   * no way to get rid of the browser chrome and no explanation of why. Reported
   * as no fullscreen at all on mobile.
   */
  canInstall: boolean;
  /**
   * What the speech engine turned out to be on this device.
   *
   * Only ever shown when it is known to produce nothing, so a phone where the
   * narrator works says nothing about it at all.
   */
  voiceState: 'unknown' | 'audible' | 'silent';
  onReplayIntro: () => void;
  /** The illustrated how-to-play guide, which is a document, not a setting. */
  onControls: () => void;
  /**
   * Whether this device has already been through the in-run tour.
   *
   * Decides both the label and whether the row does anything, so a player who
   * has not seen it yet is told it is coming rather than offered a replay of
   * something that has not happened.
   */
  tourDone: boolean;
  /** Arms the tour again for the next run. See core/tour.ts. */
  onReplayTour: () => void;
  /**
   * The connected wallet's address, when there is one.
   *
   * Prefilled into the faucet field so the common case is one tap. Somebody
   * playing in a browser can still paste an address in by hand, which is the
   * whole reason the field is a field and not a label.
   */
  address?: string | null;
}

const ORDER: Scheme[] = ['touch', 'analog', 'dpad'];

export function renderSettings(root: HTMLElement, options: SettingsOptions): void {
  const active = scheme();

  mount(
    root,
    el(
      'div',
      { class: 'screen settings' },

      el('p', { class: 'eyebrow', text: 'Settings' }),
      el('h1', { text: 'How you fly' }),

      /*
       * The one-tap switches, above the scheme rows.
       *
       * First because they are what somebody opening Settings most often came
       * for, and the control scheme is a thing you set once and forget. The
       * guide is in the same row rather than in a section of its own: it is one
       * link, and a heading over a single link is a category pretending to be
       * one.
       */
      el(
        'div',
        { class: 'settings__switches' },
        button(options.soundOn ? 'Sound on' : 'Sound off', options.onToggleSound, 'quiet'),
        options.onFullscreen
          ? button(
              options.fullscreen ? 'Exit fullscreen' : 'Fullscreen',
              options.onFullscreen,
              'quiet',
            )
          : null,
        button('Replay intro', options.onReplayIntro, 'quiet'),
        button('How to play', options.onControls, 'quiet'),
        /*
         * The in-run tour again, on the next run.
         *
         * It runs once on a device and then never, which is right for a
         * tutorial and wrong for the two people who need it back: somebody who
         * skipped it by accident, and somebody showing the game to a friend.
         * The label says when it will happen, because a button that appears to
         * do nothing is worse than no button.
         */
        button(
          options.tourDone ? 'Replay the tour' : 'Tour runs next game',
          options.onReplayTour,
          'quiet',
          { disabled: !options.tourDone },
        ),
      ),

      /*
       * Said when the narrator cannot be heard, and not otherwise.
       *
       * A WebView reports that speech synthesis exists whether or not the host
       * has a voice behind it, so the feature test says yes and the speaking
       * says nothing. Inside a wallet that is what happens, and until now the
       * only signal was that the opening played in silence, which reads as
       * broken rather than as unavailable.
       *
       * Nothing is lost by it. Every line the narrator reads is written on the
       * screen it belongs to, which is the rule the voice was built under: the
       * text is the story and the voice is decoration.
       */
      options.voiceState === 'silent'
        ? el(
            'div',
            { class: 'settings__install' },
            el('p', { class: 'settings__installhead', text: 'NARRATION' }),
            el('p', {
              class: 'settings__installsay',
              text: 'This app has no voice available, which happens inside some wallets and in-app browsers. Every line the narrator would read is written on the screen it belongs to, so nothing is missing. Open nim-rush.xyz in Chrome or Safari to hear it.',
            }),
          )
        : null,

      /*
       * What to do when there is no fullscreen button.
       *
       * iOS has no Fullscreen API at all, so the honest answer is not a button
       * that fails: it is the one route that does work there. Installed from
       * the share sheet the app opens standalone, with no address bar and no
       * toolbar, which is the thing being asked for.
       */
      options.canInstall
        ? el(
            'div',
            { class: 'settings__install' },
            el('p', { class: 'settings__installhead', text: 'FULL SCREEN ON IPHONE' }),
            el('p', {
              class: 'settings__installsay',
              text: 'Safari has no fullscreen for web apps. Tap Share, then Add to Home Screen, and open sFace from the icon. It runs with no address bar and no toolbar, which is the whole screen.',
            }),
          )
        : null,

      el('p', { class: 'settings__group', text: 'CONTROLS' }),
      el('p', {
        class: 'guide__lead',
        text: 'Both schemes are always available on a phone. This only decides which one is listening.',
      }),

      /*
       * Said plainly rather than hiding the rows.
       *
       * Hiding them on a desktop would leave somebody who set pads on their
       * phone unable to find the setting they know exists, and would make the
       * screen look like it had lost something. The choice is still saved and
       * still applies the moment they pick the phone back up.
       */
      !touchCapable()
        ? el('div', {
            class: 'notice',
            text: 'You are on a keyboard, so the pads stay off and WASD flies. Pick one anyway and it will be waiting on your phone.',
          })
        : null,

      el(
        'div',
        { class: 'schemes' },
        ...ORDER.map((id) => schemeRow(id, id === active, options)),
      ),

      /*
       * The landscape note.
       *
       * Not enforced. Locking orientation in a WebView is unreliable and
       * fighting the player's rotation lock is worse than a sentence. The game
       * is playable in portrait and better in landscape, so say that and let
       * them decide.
       */
      el('p', {
        class: 'settings__note',
        text: 'Turn the phone sideways if you can. The level runs left to right, so landscape shows you more of what is coming and puts both controls under your thumbs.',
      }),

      /*
       * Which network this is, said in words rather than left to a chip.
       *
       * The chip in the bar is four characters and a dot, which is enough to
       * notice and not enough to explain. Somebody who wants to know what the
       * difference actually means comes here, and the difference matters: it
       * decides whether the NIM in a stake is real.
       */
      el(
        'div',
        { class: 'settings__net' },
        el('p', { class: 'settings__nethead', text: `NETWORK: ${networkLabel().toUpperCase()}` }),
        el('p', {
          class: 'settings__netsay',
          text: onTestnet()
            ? 'Testnet. Same game, same you: your name, clan and friends come with you. NIM here is worth nothing, Face and the board are kept separate from mainnet, and anything needing a live read is off. Rehearse a challenge without spending anything.'
            : 'Mainnet. Real NIM, the real daily board, and live reads of crypto X. This is the game.',
        }),
        onTestnet() ? faucetCard(options.address ?? null) : null,
        button(
          onTestnet() ? 'Switch to Mainnet' : 'Switch to Testnet',
          () => setNetwork(onTestnet() ? 'main' : 'test'),
          'ghost',
        ),
      ),

      el('div', { class: 'actions' }, button('Done', options.onBack)),
    ),
  );
}

function schemeRow(id: Scheme, active: boolean, options: SettingsOptions): HTMLElement {
  const node = el(
    'button',
    {
      class: active ? 'scheme scheme--on' : 'scheme',
      type: 'button',
      // Announced as a choice within a set, not as three unrelated buttons.
      role: 'radio',
      'aria-checked': active ? 'true' : 'false',
    },
    el(
      'div',
      { class: 'scheme__body' },
      el('p', { class: 'scheme__name', text: SCHEME_LABEL[id] }),
      el('p', { class: 'scheme__say', text: SCHEME_SAY[id] }),
    ),
    el('span', { class: 'scheme__mark', text: active ? 'ON' : '' }),
  );

  node.addEventListener('click', () => {
    setScheme(id);
    options.onChange();
  });

  return node;
}

/**
 * Claim testnet NIM without leaving the game.
 *
 * This replaced a link out to the faucet's own page, which serves a twelve byte
 * body and renders blank. Following our own link and finding nothing is worse
 * than not offering it, so the claim happens here against the same API that
 * page would have used. See net/faucet.ts.
 */
function faucetCard(address: string | null): HTMLElement {
  const field = el('input', {
    class: 'settings__faucetfield',
    type: 'text',
    spellcheck: 'false',
    autocomplete: 'off',
    placeholder: 'NQ...',
    value: address ?? '',
    'aria-label': 'Address to receive testnet NIM',
  }) as HTMLInputElement;

  const status = el('p', { class: 'settings__faucetsay', text: 'Checking the faucet...' });
  const action = button('Claim testnet NIM', () => void claim(), 'ghost');

  const card = el(
    'div',
    { class: 'settings__faucet' },
    el('p', { class: 'settings__faucethead', text: 'TESTNET NIM' }),
    field,
    action,
    status,
    /*
     * Their page is still linked, quietly, at the bottom.
     *
     * It is broken today and may not be tomorrow, and it is their faucet: if
     * this stops working, the honest thing is that the player can still go
     * straight to the source rather than being stuck behind our copy of it.
     */
    el(
      'a',
      {
        class: 'settings__faucetlink',
        href: TESTNET_FAUCET,
        target: '_blank',
        rel: 'noopener noreferrer',
      },
      'Or open the Nimiq faucet directly',
    ),
  );

  /*
   * What the faucet has left, asked once when the card is built.
   *
   * Worth showing rather than hiding: a faucet runs dry, and "none left today"
   * is a completely different problem from "your address was refused". Someone
   * who can see the difference stops debugging their own wallet.
   */
  let dispenseNim: number | null = null;

  void faucetInfo().then((info: FaucetInfo | null) => {
    if (!info) {
      status.textContent = 'Could not reach the faucet just now. The link below still works.';
      return;
    }
    if (!info.available) {
      status.textContent = 'The faucet is not serving this region.';
      return;
    }
    dispenseNim = info.dispenseNim;
    status.textContent = `Pays ${info.dispenseNim} NIM. ${info.remaining.toLocaleString()} claims left.`;
  });

  async function claim(): Promise<void> {
    action.setAttribute('disabled', 'true');
    status.textContent = 'Asking the faucet...';

    const result = await claimFaucet(field.value);

    /*
     * The amount comes from whichever source actually knows it.
     *
     * The faucet's success body is usually just `{ success: true }`, so the
     * figure comes from the dispense amount it published a moment ago. If
     * neither is available the sentence simply does not carry a number, which
     * is better than the "Sent 0 NIM" this used to print when it read a missing
     * field as zero.
     */
    const sent = result.ok ? (result.nim ?? dispenseNim) : null;

    // Its own words when it refused. The faucet knows why far better than we
    // can guess, and its reasons are specific enough to act on.
    status.textContent = result.ok
      ? sent === null
        ? 'Sent. It lands in a moment.'
        : `Sent ${sent} NIM. It lands in a moment.`
      : result.reason;

    action.removeAttribute('disabled');
  }

  return card;
}
