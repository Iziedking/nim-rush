/**
 * The way out of a money path in a browser that has no wallet.
 *
 * Everything involving NIM in sFace happens in Nimiq Pay against the player's
 * own wallet: staking a challenge, settling one, unlocking a deep CT Signals
 * read. In a plain browser there is no provider, so all of those correctly
 * refuse.
 *
 * Refusing was where it used to stop. The player got an accurate sentence and
 * then had to work out for themselves what it meant, where to get the app, and
 * how to get back to what they were doing. That is a dead end with good manners.
 *
 * ## Three exits, because there are three situations
 *
 *   On a phone with Nimiq Pay      the deeplink opens it. One tap, done.
 *   On a desktop                   the deeplink does NOTHING. A custom scheme
 *                                  with no handler fails silently, so a lone
 *                                  button is a dead button for anybody judging
 *                                  this on a laptop. They get a QR to scan.
 *   No Nimiq Pay at all            the stores, named, not a bare URL.
 *
 * That middle case is the one that matters most right now: the people most
 * likely to open sFace on a desktop are exactly the people whose opinion of it
 * counts, and handing them a link their machine cannot follow is the difference
 * between "this works" and "this is broken".
 */

import { button, el } from './dom';
import { openInNimiqPay } from '../nimiq/deeplink';
import { qrSvg } from './qr';

/** Confirmed against nimiq.com/nimiq-pay rather than typed from memory. */
export const NIMIQ_PAY_IOS = 'https://apps.apple.com/us/app/nimiq-pay/id6471844738';
export const NIMIQ_PAY_ANDROID = 'https://play.google.com/store/apps/details?id=com.nimiq.pay';
const IOS = NIMIQ_PAY_IOS;
const ANDROID = NIMIQ_PAY_ANDROID;

export interface WalletCtaOptions {
  /**
   * What they were trying to do, as a sentence.
   *
   * Optional, because the panel is used two ways. Where the wallet is required
   * and the player did not ask for it, saying why is the entire point. Where
   * they pressed a button that says open the wallet, an explanation is a wall
   * in front of the door they just chose.
   */
  reason?: string;
  /**
   * Query string carried into the mini app so they land back here, e.g.
   * `c=<challengeId>`. Omit for the home page.
   */
  query?: string;
  /**
   * Overrides the eyebrow. Defaults to WALLET NEEDED, which is right when a
   * money path just refused, and wrong on the front door where nothing has
   * been refused yet and this is an explanation rather than an obstacle.
   */
  head?: string;
  /** An extra line under the reason. Used to state the mobile-only fact. */
  note?: string;
}

export function walletCta(options: WalletCtaOptions): HTMLElement {
  const target = openInNimiqPay(options.query);

  // Built once and revealed, rather than built on demand. Generating a QR is
  // fast but not free, and a panel that pops in half a beat after the tap reads
  // as jank on a slow phone.
  const code = el(
    'div',
    { class: 'wallet-cta__qr', hidden: 'hidden' },
    qrSvg(target),
    el('p', {
      class: 'wallet-cta__qr-say',
      text: 'Scan it with the phone that has Nimiq Pay. It opens sFace on this exact screen.',
    }),
  );

  const toggle = el(
    'button',
    { class: 'wallet-cta__toggle', type: 'button' },
    document.createTextNode('On a computer? Show a QR code'),
  );

  toggle.addEventListener('click', () => {
    const showing = !code.hasAttribute('hidden');
    if (showing) {
      code.setAttribute('hidden', 'hidden');
      toggle.textContent = 'On a computer? Show a QR code';
    } else {
      code.removeAttribute('hidden');
      toggle.textContent = 'Hide the QR code';
    }
  });

  return el(
    'div',
    { class: 'wallet-cta' },

    /*
     * The head and the reason are optional now, and usually absent.
     *
     * On the front door this carried a paragraph explaining what is on the
     * other side: Face, the board, clans, staked challenges. Somebody looking
     * at that panel has already decided to open the wallet, and a sales pitch
     * between them and the button is a wall in front of a door. The one line of
     * context and the button are enough.
     *
     * They stay available because the same panel is used where the wallet is
     * genuinely required and the player did not ask for it, and there a reason
     * is the entire point.
     */
    options.head ? el('p', { class: 'wallet-cta__head', text: options.head }) : null,
    options.reason ? el('p', { class: 'wallet-cta__why', text: options.reason }) : null,
    options.note ? el('p', { class: 'wallet-cta__note', text: options.note }) : null,

    button('Open in Nimiq Pay', () => {
      /*
       * Assigned rather than opened in a tab. A custom scheme in window.open
       * leaves an orphaned blank tab behind on the browsers that refuse it, and
       * the player is then looking at about:blank wondering what broke.
       */
      window.location.href = target;
    }),

    toggle,
    code,

    el(
      'p',
      { class: 'wallet-cta__stores' },
      document.createTextNode('No Nimiq Pay yet? '),
      store('iOS', IOS),
      document.createTextNode(' · '),
      store('Android', ANDROID),
    ),
  );
}

function store(label: string, href: string): HTMLElement {
  return el('a', {
    class: 'wallet-cta__store',
    href,
    target: '_blank',
    rel: 'noopener noreferrer',
    text: label,
  });
}
