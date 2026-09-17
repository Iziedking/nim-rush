/**
 * The attestation path, which is the first thing in this codebase that makes a
 * cryptographic claim. Every test here is an attempt to break it.
 */

import { describe, expect, it } from 'vitest';
import { KeyPair, PrivateKey, Signature } from '@nimiq/core';

import { claimMessage, encodeSignedMessage, envelopes, verifyClaim } from '../server/attest';

const CLAIM = { date: '2026-07-29', seed: '2026-07-29:pump:-6.70:fng29:x1', stage: 3, score: 14820 };

function signed(claim = CLAIM, keyPair = KeyPair.generate()) {
  const message = encodeSignedMessage(claimMessage(claim));
  const signature = keyPair.sign(message);
  return {
    keyPair,
    publicKey: keyPair.publicKey.toHex(),
    signature: signature.toHex(),
    address: keyPair.publicKey.toAddress().toUserFriendlyAddress(),
  };
}

describe('a genuine claim stands', () => {
  it('verifies and derives the signer', () => {
    const s = signed();
    const result = verifyClaim({ claim: CLAIM, publicKey: s.publicKey, signature: s.signature });

    expect(result).not.toBeNull();
    expect(result!.address).toBe(s.address);
    expect(result!.address).toMatch(/^NQ/);
  });

  it('derives the address rather than trusting one it was handed', () => {
    // The caller never supplies an address, so there is no field to lie in.
    const s = signed();
    const result = verifyClaim({ claim: CLAIM, publicKey: s.publicKey, signature: s.signature });
    expect(result!.address).toBe(s.keyPair.publicKey.toAddress().toUserFriendlyAddress());
  });
});

describe('every field is inside the signature', () => {
  it.each([
    ['score', { ...CLAIM, score: CLAIM.score + 1 }],
    ['stage', { ...CLAIM, stage: 7 }],
    ['seed', { ...CLAIM, seed: 'some-other-seed' }],
    ['date', { ...CLAIM, date: '2026-07-30' }],
  ])('rejects a swapped %s', (_what, tampered) => {
    const s = signed(CLAIM);
    expect(
      verifyClaim({ claim: tampered, publicKey: s.publicKey, signature: s.signature }),
    ).toBeNull();
  });
});

describe('forgery fails', () => {
  it('rejects another wallet claiming this signature', () => {
    const mine = signed();
    const theirs = KeyPair.generate();

    expect(
      verifyClaim({
        claim: CLAIM,
        publicKey: theirs.publicKey.toHex(),
        signature: mine.signature,
      }),
    ).toBeNull();
  });

  it('rejects garbage without throwing', () => {
    const s = signed();
    for (const bad of ['', 'zz', 'deadbeef', 'not-hex-at-all', s.signature.slice(0, -2)]) {
      expect(verifyClaim({ claim: CLAIM, publicKey: s.publicKey, signature: bad })).toBeNull();
      expect(verifyClaim({ claim: CLAIM, publicKey: bad, signature: s.signature })).toBeNull();
    }
  });
});

describe('what the envelope still guarantees', () => {
  /*
   * This used to refuse anything not signed over the documented Nimiq envelope,
   * on the grounds that the prefix is what stops a signed message being
   * replayed as a transaction. That reasoning is right and the rule was too
   * strict to ship: Nimiq Pay signs something this service does not build, so
   * every real signature was refused and not one row in production ever carried
   * one.
   *
   * Several message envelopes are accepted now, tried in order with the
   * documented one first. What that gives up, precisely, is the guarantee that
   * the exact prefix was used. What it does not give up is anything the mark on
   * the board rests on:
   *
   *   every candidate is a message envelope or the message itself, and none is
   *   a transaction, so no accepted signature can be replayed as one;
   *
   *   the date, seed, stage and score are inside whatever was signed, so a
   *   signature cannot be moved to a different run;
   *
   *   the address is still derived from the key that signed.
   *
   * All three are asserted below.
   */
  it('accepts a bare message signature rather than losing the run', () => {
    const keyPair = KeyPair.generate();
    const raw = new TextEncoder().encode(claimMessage(CLAIM));

    const result = verifyClaim({
      claim: CLAIM,
      publicKey: keyPair.publicKey.toHex(),
      signature: keyPair.sign(raw).toHex(),
    });

    expect(result?.address).toMatch(/^NQ/);
  });

  it('tries what a real wallet produces first', () => {
    /*
     * A correct wallet must never be judged by a looser rule, and this used to
     * assert that the unhashed prefixed message came first. That was the shape
     * this code believed in, not the shape Nimiq Pay signs: measured against a
     * real wallet on 2026-09-17, the signature verifies over the SHA-256 digest
     * of the prefixed message and over nothing else.
     *
     * So the order still puts the correct shape first. What changed is which
     * shape is correct, and the unhashed forms are now the fallbacks.
     */
    const order = envelopes(claimMessage(CLAIM)).map((candidate) => candidate.name);
    expect(order[0]).toBe('sha256-nimiq-byte-length');
    expect(order.indexOf('sha256-nimiq-byte-length')).toBeLessThan(order.indexOf('nimiq-byte-length'));
    expect(order.at(-1)).toBe('bare-message');
  });

  it('still refuses a signature over a different run, in every envelope', () => {
    /*
     * The property that actually protects the board. Widening which envelope is
     * accepted must not widen which CLAIM is accepted, or a signature earned on
     * stage one could be presented as a stage seven result.
     */
    const keyPair = KeyPair.generate();
    const other = { ...CLAIM, score: CLAIM.score + 1 };

    for (const candidate of envelopes(claimMessage(other))) {
      expect(
        verifyClaim({
          claim: CLAIM,
          publicKey: keyPair.publicKey.toHex(),
          signature: keyPair.sign(candidate.bytes).toHex(),
        }),
      ).toBeNull();
    }
  });

  it('still encodes the byte length in the documented envelope', () => {
    const text = claimMessage(CLAIM);
    const header = new TextDecoder().decode(encodeSignedMessage(text).slice(0, 30));

    expect(header).toContain(String(new TextEncoder().encode(text).byteLength));
  });
});

describe('anybody can check a published row', () => {
  const DATE = '2026-07-31';
  const SEED = '2026-07-31:m:-9.04:fng25:xzi56f9';

  /** What GET /board/:date returns for a signed row. */
  function publishedRow() {
    const keys = KeyPair.derive(PrivateKey.generate());
    const claim = { date: DATE, seed: SEED, stage: 6, score: 52_570 };
    const signature = Signature.create(
      keys.privateKey,
      keys.publicKey,
      encodeSignedMessage(claimMessage(claim)),
    ).toHex();

    return {
      name: 'a pilot',
      score: claim.score,
      address: keys.publicKey.toAddress().toUserFriendlyAddress(),
      proof: {
        publicKey: keys.publicKey.toHex(),
        signature,
        seed: claim.seed,
        stage: claim.stage,
      },
    };
  }

  it('verifies from the published fields alone', () => {
    const row = publishedRow();

    // Everything below comes from the row and the route's own date. A stranger
    // has no other input and needs none.
    const rebuilt = verifyClaim({
      claim: { date: DATE, seed: row.proof.seed, stage: row.proof.stage, score: row.score },
      publicKey: row.proof.publicKey,
      signature: row.proof.signature,
    });

    expect(rebuilt).not.toBeNull();
    // And the address they derive independently is the one the board displays,
    // which is what makes the mark meaningful rather than decorative.
    expect(rebuilt?.address).toBe(row.address);
  });

  it('catches a board that inflated a score under a real signature', () => {
    /*
     * The attack publishing the proof actually defends against.
     *
     * Without the signature on the row, a dishonest or compromised service
     * could show any number it liked beside a genuine address and nobody could
     * tell. With it, the arithmetic simply stops working.
     */
    const row = publishedRow();

    const tampered = verifyClaim({
      claim: { date: DATE, seed: row.proof.seed, stage: row.proof.stage, score: 999_999 },
      publicKey: row.proof.publicKey,
      signature: row.proof.signature,
    });

    expect(tampered).toBeNull();
  });

  it('catches the seed or stage being restated', () => {
    // Both are inside the signed string, so neither can be relabelled after.
    const row = publishedRow();

    for (const claim of [
      { date: DATE, seed: 'a different seed', stage: row.proof.stage, score: row.score },
      { date: DATE, seed: row.proof.seed, stage: 7, score: row.score },
      { date: '2026-08-01', seed: row.proof.seed, stage: row.proof.stage, score: row.score },
    ]) {
      expect(
        verifyClaim({
          claim,
          publicKey: row.proof.publicKey,
          signature: row.proof.signature,
        }),
      ).toBeNull();
    }
  });
});

describe('a bad signature must not cost a score', () => {
  /*
   * The failure this exists to stop happened in production. A player finished a
   * real run, signed it in good faith, and the service answered 422: the score,
   * the Face and the board row all refused because the signature did not
   * verify.
   *
   * The reasoning behind that refusal was sound and the price was not. A bad
   * signature is worth refusing; a real run is not, and the two arrived in one
   * request so the second died with the first.
   *
   * The server-side crypto is proven above. What no test here can reach is what
   * Nimiq Pay's wallet actually signs, since headless Chrome has no wallet, so
   * that hop stays unverified however careful the rest is. Which is exactly why
   * the score must not depend on it.
   */
  it('still refuses to attest a signature that does not verify', () => {
    // The half that was right. Nothing below weakens this.
    const claim = { date: '2026-08-01', seed: 'seed-one', stage: 1, score: 18_064 };
    const s = signed({ ...claim, score: 1 });

    expect(verifyClaim({ claim, publicKey: s.publicKey, signature: s.signature })).toBeNull();
  });

  it('verifies the claim the score route actually builds', () => {
    /*
     * The message is assembled in two places: the client before signing and the
     * service before verifying. They agree here, so a mismatch in production is
     * the wallet's envelope rather than these two drifting apart, which is
     * worth being able to rule out.
     */
    const claim = { date: '2026-08-01', seed: 'seed-one', stage: 6, score: 18_064 };
    const s = signed(claim);

    const attested = verifyClaim({ claim, publicKey: s.publicKey, signature: s.signature });

    expect(attested).not.toBeNull();
    expect(attested?.address).toMatch(/^NQ/);
  });
});

describe('what the ladder can honestly claim', () => {
  /*
   * The all-time board had no verification of any kind. Every row looked the
   * same whether a wallet stood behind it or nobody did, which on a board whose
   * whole argument is that claims are checkable is the weakest place to be.
   *
   * The reason is real: a daily row is one run and one run can be signed.
   * Lifetime Face is the sum of dozens, so no signature covers it. The fix is
   * to make the weaker claim rather than none, and to say it is the weaker one.
   */
  it('binds only an address the service derived from a signature', () => {
    /*
     * The property that makes the mark mean anything. An address in a request
     * is a claim; an address derived from a working signature is its author.
     * verifyClaim is the only thing that produces one, and it returns null
     * rather than an address when the signature does not hold.
     */
    const claim = { date: '2026-08-02', seed: 'seed-one', stage: 3, score: 4_200 };
    const good = signed(claim);
    const attested = verifyClaim({
      claim,
      publicKey: good.publicKey,
      signature: good.signature,
    });

    expect(attested?.address).toMatch(/^NQ/);

    // Same claim, a signature over a different score. No address to bind.
    const wrong = signed({ ...claim, score: 1 });
    expect(
      verifyClaim({ claim, publicKey: wrong.publicKey, signature: wrong.signature }),
    ).toBeNull();
  });
});
