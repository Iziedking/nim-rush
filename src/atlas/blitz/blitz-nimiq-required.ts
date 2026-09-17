import { NIMIQ_PAY_ANDROID, NIMIQ_PAY_IOS } from '../../ui/wallet-cta';
import { lobbyDeeplink } from '../../nimiq/deeplink';

/*
 * The door for somebody who arrived without Nimiq.
 *
 * An invite link travels through messages, so most of the people who follow
 * one will open it in whatever browser their chat app uses - not inside Nimiq
 * Pay. Sending them to a screen that says "connect your wallet" and then fails
 * is the worst version of this: they were invited, they did what the message
 * said, and the game told them no without telling them what to do.
 *
 * So this screen does three things in order: it says a seat is waiting, it
 * offers to open the invite inside Nimiq Pay for anybody who already has it,
 * and it points everybody else at the app. The store links live in
 * ui/wallet-cta.ts, which checked them against nimiq.com rather than typing
 * them from memory.
 */

function node(tag: string, className: string, text?: string): HTMLElement {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text !== undefined) element.textContent = text;
  return element;
}

function storeLink(className: string, label: string, href: string): HTMLAnchorElement {
  const link = document.createElement('a');
  link.className = className;
  link.textContent = label;
  link.href = href;
  link.rel = 'noreferrer';
  link.target = '_blank';
  return link;
}

export function createBlitzNimiqRequired(options: {
  /** The lobby this rider was invited to, if they followed an invite. */
  readonly lobbyId: string | null;
  readonly onBack: () => void;
}): HTMLElement {
  const screen = node('main', 'blitz-nimiq-required blitz-fullscreen-page');
  screen.setAttribute('data-blitz-screen', 'nimiq-required');

  const panel = node('section', 'blitz-intro-command');
  panel.append(node('span', 'blitz-mode-label', options.lobbyId ? 'YOU WERE INVITED' : 'NIMIQ NEEDED'));
  panel.append(node('p', 'blitz-nimiq-lead', options.lobbyId
    ? 'A seat is being held for you. NIM RUSH runs inside Nimiq Pay, which signs your identity so a race can be verified.'
    : 'NIM RUSH runs inside Nimiq Pay, which signs your identity so a race can be verified.'));

  /*
   * For anybody who already has the app: the deeplink reopens this exact
   * invite inside it, rather than dropping them on the app's home screen to
   * find their own way back.
   */
  if (options.lobbyId) {
    const open = storeLink('blitz-start blitz-open-nimiq', 'Open in Nimiq Pay', lobbyDeeplink(options.lobbyId));
    // A custom scheme must not open a tab: if nothing handles it the rider is
    // left staring at a blank page instead of at this screen.
    open.target = '_self';
    panel.append(open);
  }

  const stores = node('div', 'blitz-store-links');
  stores.append(
    storeLink('blitz-again blitz-store-ios', 'Get it on iPhone', NIMIQ_PAY_IOS),
    storeLink('blitz-again blitz-store-android', 'Get it on Android', NIMIQ_PAY_ANDROID),
  );
  panel.append(stores);

  // Both platforms are offered rather than guessed from the user agent, which
  // is wrong often enough to strand somebody on a store they cannot use.
  panel.append(node('p', 'blitz-rank-status', 'Free, and it takes a minute. The link will still work when you come back.'));

  const back = document.createElement('button');
  back.type = 'button';
  back.className = 'blitz-quiet blitz-lobby-leave';
  back.textContent = 'Back';
  back.addEventListener('click', options.onBack);
  panel.append(back);

  screen.append(panel);
  return screen;
}
