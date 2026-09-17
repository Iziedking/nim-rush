/**
 * Challenge links. This is the growth loop, so it stays simple and shareable.
 *
 * Deeplink format confirmed at https://nimiq.dev/mini-apps:
 *   nimiqpay://miniapp?url=your-app.com
 *
 * We hang our own challenge id off the app URL as a query param, so opening the
 * link inside Nimiq Pay lands the friend directly in the challenge.
 */

/**
 * Where this app lives, worked out when asked rather than when imported.
 *
 * It used to be a module constant, which meant importing this file at all
 * evaluated window.location. That is fine in a browser and throws everywhere
 * else, so anything on the Node side that pulled in a screen pulled in a
 * ReferenceError with it.
 *
 * It hid for a while because the fallback only runs when VITE_APP_ORIGIN is
 * unset, and a local .env sets it. So it passed on this machine and failed in
 * CI, which is the worst shape a break can have: the environment without the
 * secret is the one that tells the truth.
 */
function appOrigin(): string {
  const configured = import.meta.env.VITE_APP_ORIGIN;
  if (configured) return configured;
  // No window means no page to be relative to, and a link built from a guess
  // would be worse than an obviously empty one.
  return typeof window === 'undefined' ? '' : window.location.origin;
}

/** Build the nimiqpay:// link that opens this app at a specific challenge. */
export function challengeDeeplink(challengeId: string): string {
  const target = `${appOrigin()}/?c=${encodeURIComponent(challengeId)}`;
  return `nimiqpay://miniapp?url=${encodeURIComponent(target)}`;
}

/**
 * Open this app inside Nimiq Pay, on whatever page asked for it.
 *
 * Every money path in sFace needs a wallet, and a wallet means Nimiq Pay. In a
 * plain browser those paths used to end at a sentence, which told the player
 * what was wrong and nothing about what to do next: they were left holding a
 * correct explanation and no way to act on it. This is the way out.
 *
 * `query` carries the destination through, so somebody who tried to stake on a
 * challenge lands back on that challenge rather than on the home page having
 * lost their place.
 */
export function openInNimiqPay(query?: string): string {
  const target = query ? `${appOrigin()}/?${query}` : appOrigin();
  return `nimiqpay://miniapp?url=${encodeURIComponent(target)}`;
}

/** Read the challenge id when we were opened from a link. */
export function readChallengeId(): string | null {
  const params = new URLSearchParams(window.location.search);
  const id = params.get('c');
  return id && id.length > 0 ? id : null;
}

/** The same trick for a clan invite. Opens the app with the tag filled in. */
export function clanDeeplink(tag: string): string {
  const target = `${appOrigin()}/?clan=${encodeURIComponent(tag)}`;
  return `nimiqpay://miniapp?url=${encodeURIComponent(target)}`;
}

/**
 * Read a clan tag off an invite link.
 *
 * Shape-checked here rather than trusted, because it goes straight into the
 * join field and then into a request. Anything that is not a tag is treated as
 * no invite at all, which lands the player on the normal brief.
 */
export function readClanTag(): string | null {
  const params = new URLSearchParams(window.location.search);
  const tag = (params.get('clan') ?? '').trim().toUpperCase();
  return /^[A-Z0-9]{2,4}$/.test(tag) ? tag : null;
}

/**
 * X compose intent. No OAuth, no API key, no review. One line, works anywhere.
 * The deeplink goes in the url slot so tapping it in the post opens Nimiq Pay.
 */
export function shareToX(text: string, challengeId: string): string {
  // https, not the scheme. See shareableLink: X will not linkify nimiqpay://
  // and the post goes out looking broken.
  const url = challengeShareLink(challengeId);
  return `https://twitter.com/intent/tweet?text=${encodeURIComponent(text)}&url=${encodeURIComponent(url)}`;
}

/**
 * The same destinations as plain https, for anything that leaves the app.
 *
 * A nimiqpay:// URL is right for a button on our own page, where the OS holds
 * the scheme and the tap came from someone already here. It is wrong for a
 * post. X linkifies http and https and nothing else, so an invite went out as
 * dead text with the middle of it arbitrarily highlighted, and the one thing a
 * growth loop cannot afford is a link that looks broken to everybody who has
 * not already installed the wallet.
 *
 * Sharing the https link instead costs nothing and gains the handoff: the page
 * it opens knows the invite, knows whether it is inside Nimiq Pay, and can put
 * the wallet in front of the person itself rather than relying on a URL scheme
 * to have done it. The pitch happens where we control it.
 */
export function shareableLink(query: string): string {
  return `${appOrigin()}/?${query}`;
}

/** A clan invite, as something a stranger can actually tap. */
export function clanShareLink(tag: string): string {
  return shareableLink(`clan=${encodeURIComponent(tag)}`);
}

/** A challenge, likewise. */
export function challengeShareLink(challengeId: string): string {
  return shareableLink(`c=${encodeURIComponent(challengeId)}`);
}

const OPEN_CHALLENGE_KEY = 'sface.challenge';

/**
 * The last challenge this device was part of, so it survives a refresh.
 *
 * ## Why the client has to remember
 *
 * The service can answer "what is challenge X" and nothing else. There is no
 * route that lists a pilot's challenges, and adding one would mean an endpoint
 * that enumerates by device id, which is a worse trade than a single string in
 * local storage.
 *
 * Without it, closing the tab loses a staked challenge until the other player
 * sends the link again. Somebody who has just approved NIM against a wager and
 * then cannot find it does not conclude that the UI forgot.
 *
 * Only the id is kept. Everything else is re-read from the service on open, so
 * a stale local copy can never disagree with the real state of the wager.
 */
export function rememberChallenge(challenge: { id: string; status: string } | null): void {
  try {
    // Settled is finished. Keeping it would put a dead challenge on the tile
    // every launch, nagging about something already done.
    if (!challenge || challenge.status === 'settled') {
      localStorage.removeItem(OPEN_CHALLENGE_KEY);
      return;
    }
    localStorage.setItem(OPEN_CHALLENGE_KEY, challenge.id);
  } catch {
    // Private mode. The challenge still works for this session, and the link
    // is the durable copy either way.
  }
}

/** The remembered challenge id, or null. */
export function rememberedChallenge(): string | null {
  try {
    const id = localStorage.getItem(OPEN_CHALLENGE_KEY);
    return id && id.length > 0 ? id : null;
  } catch {
    return null;
  }
}

/**
 * The link that opens a private lobby inside Nimiq Pay.
 *
 * Same format as a challenge link, because it is the same mechanism: the app
 * URL carries the lobby id and the deeplink carries the app URL. Shared by a
 * rider who has just opened a lobby, so the friends who receive it land in the
 * mini app already pointed at the right race rather than at the front door.
 */
export function lobbyDeeplink(lobbyId: string): string {
  const target = `${appOrigin()}/?lobby=${encodeURIComponent(lobbyId)}`;
  return `nimiqpay://miniapp?url=${encodeURIComponent(target)}`;
}

/**
 * The same lobby as a plain web address.
 *
 * What actually goes in a message, because a nimiqpay:// link pasted into a
 * browser or a chat that does not know the scheme is a dead end. This opens in
 * anything, and the app decides whether to play or to offer Nimiq Pay.
 */
export function lobbyShareLink(lobbyId: string): string {
  return `${appOrigin()}/?lobby=${encodeURIComponent(lobbyId)}`;
}
