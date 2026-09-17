import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const app = readFileSync(new URL('../src/atlas/blitz/blitz-app.ts', import.meta.url), 'utf8');
const lobby = readFileSync(new URL('../src/atlas/blitz/blitz-lobby-screen.ts', import.meta.url), 'utf8');
const required = readFileSync(new URL('../src/atlas/blitz/blitz-nimiq-required.ts', import.meta.url), 'utf8');
const deeplink = readFileSync(new URL('../src/nimiq/deeplink.ts', import.meta.url), 'utf8');
const walletCta = readFileSync(new URL('../src/ui/wallet-cta.ts', import.meta.url), 'utf8');
const css = readFileSync(new URL('../src/atlas/blitz/blitz.css', import.meta.url), 'utf8');

/*
 * Invites.
 *
 * An invite link travels through messages, so most people who follow one open
 * it in whatever browser their chat app uses. Every failure here is silent and
 * looks like the game is broken: a blank screen, a dead custom-scheme link, a
 * store page for the wrong platform, a "wallet unavailable" message to
 * somebody who has done nothing wrong.
 */
describe('following an invite', () => {
  it('reads the lobby from the address, because an invite arrives cold', () => {
    expect(app).toContain('invitedLobbyId');
    expect(app).toContain("new URLSearchParams(window.location.search).get('lobby')");
    // The same shape the server accepts, so a mistyped link is refused here
    // rather than becoming a 400 the rider has to interpret.
    expect(app).toContain('/^[A-Za-z0-9_-]{16,64}$/');
  });

  /*
   * The invite is the reason most people will ever see the front door. A
   * stranger met by a generic connect panel has no idea a seat is waiting.
   */
  it('says a seat is waiting before asking a stranger to connect', () => {
    expect(app).toContain('YOU WERE INVITED');
    expect(app).toContain('Connect and take your seat');
    expect(app).toContain('A seat is being held for you.');
  });

  it('follows the invite after connecting, and on a later visit', () => {
    expect(app).toContain('const invited = this.invitedLobbyId();');
    expect(app).toContain('if (invited) { void this.renderLobby(invited); return; }');
    expect(app).toContain('if (invited && this.connectedWallet) void this.renderLobby(invited);');
  });

  /*
   * A stale or mistyped invite is an ordinary thing to follow, and the rider
   * has to end up somewhere rather than on a blank page.
   */
  it('puts a rider back on the front door when the lobby is gone', () => {
    expect(app).toContain('if (!view) {');
    expect(lobby).toBeTruthy();
    expect(app).toContain('clearInvite');
  });

  it('shares a web link, not a custom scheme', () => {
    // nimiqpay:// pasted into a chat that does not know the scheme is a dead
    // end, so the copyable link is an ordinary address.
    expect(lobby).toContain('lobbyShareLink');
    // The share button builds a web link; the deeplink belongs to the screen
    // for people who do not have the app yet.
    expect(lobby).not.toContain('lobbyDeeplink');
    expect(deeplink).toContain('export function lobbyShareLink');
    expect(deeplink).toContain('export function lobbyDeeplink');
    // The deeplink format is the one confirmed at nimiq.dev/mini-apps.
    expect(deeplink).toContain('nimiqpay://miniapp?url=');
  });

  it('tells a rider when the clipboard refuses instead of failing silently', () => {
    // A silent failure has somebody paste nothing into a message and wonder
    // why nobody joined.
    expect(lobby).toContain('.catch(() =>');
    expect(lobby).toContain('status.textContent = link');
  });
});

describe('arriving without Nimiq', () => {
  /*
   * They were invited, they did what the message said. Telling them the wallet
   * is unavailable is true and useless; they need the app.
   */
  it('offers the app rather than reporting an error', () => {
    expect(app).toContain('renderNimiqRequired');
    expect(app).toContain("if (initialized.reason !== 'timeout') { this.renderNimiqRequired(); return; }");
    expect(required).toContain('YOU WERE INVITED');
    expect(required).toContain('A seat is being held for you');
  });

  it('reopens the exact invite inside Nimiq Pay for anybody who has it', () => {
    expect(required).toContain('lobbyDeeplink(options.lobbyId)');
    // A custom scheme must not open a tab: if nothing handles it the rider is
    // left on a blank page instead of on this screen.
    expect(required).toContain("open.target = '_self'");
  });

  /*
   * Both stores, never a guess from the user agent - a wrong guess strands
   * somebody on a store they cannot install from.
   */
  it('offers both platforms, from the links verified against nimiq.com', () => {
    expect(required).toContain('NIMIQ_PAY_IOS');
    expect(required).toContain('NIMIQ_PAY_ANDROID');
    expect(required).not.toMatch(/userAgent|navigator\.platform/);
    expect(walletCta).toContain('Confirmed against nimiq.com/nimiq-pay rather than typed from memory.');
    expect(walletCta).toContain("export const NIMIQ_PAY_IOS = 'https://apps.apple.com/us/app/nimiq-pay/id6471844738'");
    expect(walletCta).toContain("export const NIMIQ_PAY_ANDROID = 'https://play.google.com/store/apps/details?id=com.nimiq.pay'");
  });
});

describe('the lobby screen', () => {
  it('shows every seat, including the empty ones', () => {
    // A blank row reads as a rendering failure; "Open" reads as room.
    expect(lobby).toContain("'Open'");
    expect(lobby).toContain('index < view.lobby.capacity');
    expect(css).toContain('.blitz-seat.is-you');
  });

  /*
   * A seat is attributed to a wallet that proved it owns itself. A chosen
   * display name here would let a rider present as somebody else in a race
   * that pays out.
   */
  it('identifies riders by wallet and never by a chosen name', () => {
    expect(lobby).toContain('shortWallet(held.walletAddress)');
    expect(lobby).not.toContain('username');
  });

  it('says why a full lobby cannot be joined', () => {
    expect(lobby).toContain("action.textContent = 'Lobby full'");
    expect(lobby).toContain('Ask the host to open another');
  });

  /*
   * A lobby whose creator has to remember to join starts with an empty first
   * seat and a host who looks absent from their own race.
   */
  it('seats the host when they open one', () => {
    expect(app).toContain('await this.joinLobby(opened.value.id)');
  });

  it('re-reads the field after joining rather than trusting its own copy', () => {
    // Somebody else may have taken a seat in the same second.
    expect(app).toContain('await this.renderLobby(lobbyId);');
  });
});
