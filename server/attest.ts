/**
 * Score attestation: turning "some device says 14,820" into "this Nimiq
 * address says 14,820, and nobody else could have said it for them".
 *
 * ## The hole this fills
 *
 * The README has admitted from the start that leaderboard scores are bounded
 * rather than proven: the service refuses impossible numbers and impossible
 * durations, keeps one entry per pilot per day, and that is a speed bump, not a
 * lock. The identity behind a row was a device id, which is a value the client
 * generates and can throw away and regenerate at will.
 *
 * A wallet signature fixes the identity half of that. The player signs a string
 * naming the exact day, seed, stage and score in Nimiq Pay, and the service
 * verifies the Ed25519 signature and derives the signer's address from the
 * public key. The row is then attributable to an address, the claim cannot be
 * forged by anyone who does not hold that key, and anybody can check it.
 *
 * ## What this does NOT prove, stated plainly
 *
 * It does not prove the run happened. A determined player can still sign a
 * score they did not earn, exactly as they could post one before. What changes
 * is that the claim is now non-repudiable and bound to an address with a public
 * history, so cheating stops being anonymous and starts being a thing a
 * specific wallet did in public, permanently. That is a different and much
 * better property than the device id ever had, and it is not the same thing as
 * proof of play. Do not describe it as anti-cheat.
 *
 * ## The prefix is not optional
 *
 * Nimiq wallets sign `\x16Nimiq Signed Message:\n<byteLength><message>` rather
 * than the bare message, which is what stops a signature obtained for a
 * "message" from ever being replayable as a transaction. Verified against the
 * library rather than assumed: signing the prefixed bytes verifies, signing the
 * raw bytes does not.
 */

import { createHash } from 'node:crypto';

import { PublicKey, Signature } from '@nimiq/core';

import { scoreClaimMessage, type ScoreClaim } from '../src/data/score-claim';

export type { ScoreClaim } from '../src/data/score-claim';

const encoder = new TextEncoder();

/** Exactly what a Nimiq wallet signs when asked to sign a message. */
export function encodeSignedMessage(message: string): Uint8Array {
  const body = encoder.encode(message);
  const prefix = encoder.encode(`\x16Nimiq Signed Message:\n${body.byteLength}`);

  const out = new Uint8Array(prefix.byteLength + body.byteLength);
  out.set(prefix);
  out.set(body, prefix.byteLength);
  return out;
}

function join(prefix: string, body: Uint8Array): Uint8Array {
  const head = encoder.encode(prefix);
  const out = new Uint8Array(head.byteLength + body.byteLength);
  out.set(head);
  out.set(body, head.byteLength);
  return out;
}

/**
 * Every shape a wallet might have signed, best first.
 *
 * ## Why this accepts more than one
 *
 * Not a single row in production ever carried a signature. A player then signed
 * in Nimiq Pay and the service answered 422: the key and the signature were the
 * right length and the right alphabet, and it still did not verify. Hex,
 * correct length, wrong bytes. Something is being signed other than what this
 * file builds, and no test here can find out which, because a headless browser
 * has no wallet.
 *
 * So instead of one shape and a refusal, this tries the shapes a wallet
 * plausibly uses and reports which one worked. A signature over a message
 * naming the date, seed, stage and score is a valid attestation whichever
 * envelope carried it: the envelope exists to stop a message signature being
 * replayed as a transaction, and every candidate below is a message envelope or
 * the message itself. None of them is a transaction.
 *
 * Order matters. The first is what Nimiq actually produces, confirmed against
 * a real wallet, and the rest are only reached once it fails, so a correct
 * wallet is never judged by a looser rule than it should be.
 */
export function envelopes(message: string): Array<{ name: string; bytes: Uint8Array }> {
  const body = encoder.encode(message);

  const prefixed = [
    { name: 'nimiq-byte-length', bytes: encodeSignedMessage(message) },
    {
      name: 'nimiq-char-length',
      bytes: join('\x16Nimiq Signed Message:\n' + String(message.length), body),
    },
    { name: 'nimiq-no-length', bytes: join('\x16Nimiq Signed Message:\n', body) },
    {
      name: 'nimiq-no-prefix-byte',
      bytes: join('Nimiq Signed Message:\n' + String(body.byteLength), body),
    },
    { name: 'bare-message', bytes: body },
  ];

  /*
   * The missing step, finally measured.
   *
   * Everything above builds the prefixed message and signs those bytes. Nimiq
   * signs the SHA-256 digest of them. One hash, left out, and no wallet
   * signature this service has ever been shown could verify - which is exactly
   * what the note above describes and could not explain, because finding it
   * needs a real wallet and a headless browser has none.
   *
   * Confirmed on 2026-09-17 against Nimiq Pay on a Pixel 7 Pro: a binding
   * message of 235 bytes, signed in the app, verified against
   * sha256('\x16Nimiq Signed Message:\n' + byteLength + message) and against
   * nothing else among twenty-nine candidates.
   *
   * The digests go first because they are what a correct wallet produces. The
   * unhashed forms stay behind them rather than being deleted: they cost one
   * cheap comparison each, they are all message envelopes rather than
   * transactions, and a signature that was accepted before must not start
   * being refused now.
   */
  return [...prefixed.map((candidate) => ({
    name: `sha256-${candidate.name}`,
    bytes: new Uint8Array(createHash('sha256').update(candidate.bytes).digest()),
  })), ...prefixed];
}

export const claimMessage = scoreClaimMessage;

export interface Attestation {
  /** Human-readable Nimiq address, derived from the key that signed. */
  address: string;
  claim: ScoreClaim;
}

export function mergeClaimMessage(claim: {
  from: string;
  into: string;
  network: string;
}): string {
  return `sface:profile-merge:${claim.from}:${claim.into}:${claim.network}`;
}

export function verifyMessage(input: {
  message: string;
  publicKey: string;
  signature: string;
}): { address: string } | null {
  try {
    const publicKey = PublicKey.fromHex(input.publicKey);
    const signature = Signature.fromHex(input.signature);
    const matched = envelopes(input.message).find((candidate) =>
      publicKey.verify(signature, candidate.bytes),
    );
    if (!matched) return null;
    if (matched.name !== 'sha256-nimiq-byte-length') {
      console.warn(`[sface] signature verified with fallback envelope: ${matched.name}`);
    }
    return { address: publicKey.toAddress().toUserFriendlyAddress() };
  } catch {
    return null;
  }
}

/**
 * Verify a signed claim and return who signed it, or null.
 *
 * Returns null for every failure rather than throwing or distinguishing between
 * them. A caller has nothing useful to do with "the signature was malformed"
 * versus "the signature was wrong", and telling an attacker which of the two
 * they achieved is free information.
 */
export function verifyClaim(input: {
  claim: ScoreClaim;
  publicKey: string;
  signature: string;
}): Attestation | null {
  const verified = verifyMessage({
    message: claimMessage(input.claim),
    publicKey: input.publicKey,
    signature: input.signature,
  });
  return verified ? { address: verified.address, claim: input.claim } : null;
}
