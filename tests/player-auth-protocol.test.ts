import { describe, expect, it } from 'vitest';

import {
  encodeChallenge,
  encodeMergeClaim,
  mergeBodyDigest,
  bodyDigest,
  type Challenge,
  type MergeClaim,
} from '../src/net/player-auth-protocol';

const claim: MergeClaim = { from: 'a'.repeat(64), into: 'b'.repeat(64), network: 'main' };
const challenge: Challenge = {
  id: 'challenge-1',
  action: 'profile.merge',
  playerId: 'a'.repeat(64),
  bodyDigest: 'c'.repeat(64),
  nonce: 'd'.repeat(32),
  expiresAt: 1_700_000_000_000,
};

describe('player auth protocol', () => {
  it('encodes the same merge claim deterministically', async () => {
    expect(Array.from(encodeMergeClaim(claim))).toEqual(Array.from(encodeMergeClaim({ ...claim })));
    expect(await mergeBodyDigest(claim)).toBe(await mergeBodyDigest({ ...claim }));
  });

  it('changes the merge digest when any claim field changes', async () => {
    const original = await mergeBodyDigest(claim);
    expect(await mergeBodyDigest({ ...claim, into: 'c'.repeat(64) })).not.toBe(original);
    expect(await mergeBodyDigest({ ...claim, network: 'test' })).not.toBe(original);
  });

  it('changes the challenge bytes when action, nonce, or expiry changes', () => {
    const original = Array.from(encodeChallenge(challenge));
    expect(Array.from(encodeChallenge({ ...challenge, action: 'player.register' }))).not.toEqual(original);
    expect(Array.from(encodeChallenge({ ...challenge, nonce: 'e'.repeat(32) }))).not.toEqual(original);
    expect(Array.from(encodeChallenge({ ...challenge, expiresAt: challenge.expiresAt + 1 }))).not.toEqual(original);
  });

  it('hashes equivalent object bodies identically', async () => {
    expect(await bodyDigest({ b: 2, a: 1 })).toBe(await bodyDigest({ a: 1, b: 2 }));
    expect(await bodyDigest({ a: 1, b: 3 })).not.toBe(await bodyDigest({ a: 1, b: 2 }));
  });

  /*
   * The bug that made every ranked run unverifiable.
   *
   * A body is signed on the client, sent through JSON.stringify, and hashed
   * again on the server. JSON.stringify drops an undefined property, so the
   * server can only ever see the shorter object - and the digest has to agree
   * with that, or nothing carrying an unset optional field can be authorised.
   *
   * The first case is the whole failure: a ranked submission passes
   * challengeId, challengeDate and rulesetVersion straight off the ticket, and
   * a ticket without them produced a signature the server could never match.
   */
  it('treats an undefined property as absent, the way transport does', async () => {
    expect(await bodyDigest({ runId: 'r1', challengeId: undefined }))
      .toBe(await bodyDigest({ runId: 'r1' }));
    expect(await bodyDigest({ runId: 'r1', challengeId: undefined }))
      .toBe(await bodyDigest(JSON.parse(JSON.stringify({ runId: 'r1', challengeId: undefined }))));
  });

  it('still separates an absent field from a present one', async () => {
    expect(await bodyDigest({ runId: 'r1' })).not.toBe(await bodyDigest({ runId: 'r1', challengeId: 'c' }));
    expect(await bodyDigest({ runId: 'r1', challengeId: null })).not.toBe(await bodyDigest({ runId: 'r1' }));
  });

  it('matches transport for an undefined array element', async () => {
    const body = { frames: [1, undefined, 3] };
    expect(await bodyDigest(body)).toBe(await bodyDigest(JSON.parse(JSON.stringify(body))));
  });
});
