import { lobbyShareLink } from '../../nimiq/deeplink';
import type { BlitzLobbyView, BlitzSeatSummary } from '../api';

/*
 * The lobby.
 *
 * A rider opens one, sends the link to friends, and the first seven people
 * through the door are the field. The screen has one job at a time: before you
 * are seated it is a door, and once you are seated it is a list of who else
 * turned up.
 *
 * THE LINK IS THE CREDENTIAL
 *
 * There is no password and no guest list. Whoever holds the link is invited,
 * which is why the id is twenty-four random bytes and why this screen never
 * asks who somebody is beyond the wallet the seat was claimed with.
 *
 * WHY WALLETS AND NOT NAMES
 *
 * A seat is attributed to a wallet that proved it owns itself. Showing a
 * chosen display name here would let a rider present themselves as somebody
 * else in a race that pays out, so the list shows the address, shortened.
 */

export interface BlitzLobbyScreen {
  readonly element: HTMLElement;
  /** Redraw against a fresher view, e.g. after somebody else joins. */
  update(view: BlitzLobbyView, you: string | null): void;
}

function shortWallet(address: string): string {
  const compact = address.replace(/\s/g, '');
  return compact.length <= 12 ? compact : `${compact.slice(0, 6)}…${compact.slice(-4)}`;
}

function node(tag: string, className: string, text?: string): HTMLElement {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text !== undefined) element.textContent = text;
  return element;
}

export function createBlitzLobbyScreen(options: {
  readonly view: BlitzLobbyView;
  readonly you: string | null;
  readonly onJoin: () => void;
  readonly onRide: () => void;
  readonly onLeave: () => void;
}): BlitzLobbyScreen {
  const screen = node('main', 'blitz-lobby blitz-fullscreen-page');
  screen.setAttribute('data-blitz-screen', 'lobby');

  const panel = node('section', 'blitz-intro-command');
  const label = node('span', 'blitz-mode-label', 'PRIVATE LOBBY');
  const meta = node('p', 'blitz-trail-meta', '');
  const seats = node('ol', 'blitz-seat-list');
  const action = document.createElement('button');
  action.type = 'button';
  action.className = 'blitz-start';

  /*
   * The link, copyable in one tap.
   *
   * A web address rather than a nimiqpay:// link, because a custom scheme
   * pasted into a chat that does not know it is a dead end. This one opens
   * anywhere, and the app decides whether to seat the rider or offer Nimiq.
   */
  const share = document.createElement('button');
  share.type = 'button';
  share.className = 'blitz-again blitz-share-link';
  share.textContent = 'Copy invite link';

  const status = node('p', 'blitz-rank-status', '');

  const back = document.createElement('button');
  back.type = 'button';
  back.className = 'blitz-quiet blitz-lobby-leave';
  back.textContent = 'Back';
  back.addEventListener('click', () => options.onLeave());

  panel.append(label, meta, seats, action, share, status, back);
  screen.append(panel);

  function render(view: BlitzLobbyView, you: string | null): void {
    const normalised = (you ?? '').replace(/\s/g, '').toUpperCase();
    const seated = view.seats.find((seat) => seat.walletAddress.replace(/\s/g, '').toUpperCase() === normalised) ?? null;
    const full = view.seats.length >= view.lobby.capacity;

    meta.textContent = `${view.seats.length} OF ${view.lobby.capacity} SEATS · CLOSES ${new Date(view.lobby.expiresAt).toISOString().slice(11, 16)}Z`;

    seats.replaceChildren();
    for (let index = 0; index < view.lobby.capacity; index += 1) {
      const held: BlitzSeatSummary | undefined = view.seats.find((seat) => seat.seat === index + 1);
      const row = node('li', `blitz-seat${held ? ' is-taken' : ''}${held && held === seated ? ' is-you' : ''}`);
      row.append(node('b', 'blitz-seat-number', String(index + 1)));
      // An empty seat says it is open rather than being blank, so the field
      // reads as a grid with room in it and not as a rendering failure.
      row.append(node('span', 'blitz-seat-rider', held ? shortWallet(held.walletAddress) : 'Open'));
      if (held === seated) row.append(node('span', 'blitz-seat-you', 'YOU'));
      seats.append(row);
    }

    if (seated) {
      action.textContent = 'Ride this lobby';
      action.disabled = false;
      action.onclick = () => options.onRide();
      status.textContent = `You have seat ${seated.seat}.`;
    } else if (full) {
      // Stated plainly rather than by a greyed-out button with no reason.
      action.textContent = 'Lobby full';
      action.disabled = true;
      action.onclick = null;
      status.textContent = 'Every seat is taken. Ask the host to open another.';
    } else {
      action.textContent = 'Take a seat';
      action.disabled = false;
      action.onclick = () => options.onJoin();
      status.textContent = '';
    }

    share.onclick = () => {
      const link = lobbyShareLink(view.lobby.id);
      const copied = navigator.clipboard?.writeText(link);
      if (copied && typeof copied.then === 'function') {
        copied.then(() => { status.textContent = 'Invite link copied.'; })
          // Clipboard access can be refused, and a silent failure would have a
          // rider paste nothing into a message and wonder why nobody joined.
          .catch(() => { status.textContent = link; });
      } else {
        status.textContent = link;
      }
    };
  }

  render(options.view, options.you);
  return { element: screen, update: render };
}
