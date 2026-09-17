import { describe, expect, it } from 'vitest';
import { Address, KeyPair, TransactionBuilder } from '@nimiq/core';

import { verifyAnchor } from '../server/anchor';

import {
  BLITZ_ANCHOR_MAX_BYTES,
  blitzAnchorData,
  blitzAnchorFits,
  type BlitzAnchorClaim,
} from '../shared/atlas/blitz/anchor';

/*
 * The on-chain form of a run.
 *
 * Everything here is about the 64 byte ceiling and about one transaction never
 * standing for a different run. A data field that overflowed would be refused
 * by the wallet; one that was not specific enough would let a single cheap
 * transaction be presented as proof of every run a rider ever made.
 */
const claim: BlitzAnchorClaim = {
  challengeDate: '2026-09-17',
  cityId: 'lagos',
  score: 18_600,
  traceHash: 'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b2',
};

describe('writing a run onto Nimiq', () => {
  it('fits inside a basic transaction', () => {
    expect(blitzAnchorFits(claim)).toBe(true);
    expect(new TextEncoder().encode(blitzAnchorData(claim)).byteLength).toBeLessThanOrEqual(BLITZ_ANCHOR_MAX_BYTES);
  });

  it('still fits at the largest score the board accepts', () => {
    // The submission schema caps a claimed score at 1,000,000.
    expect(blitzAnchorFits({ ...claim, score: 1_000_000 })).toBe(true);
  });

  it('names the run rather than just the day', () => {
    const other = blitzAnchorData({ ...claim, traceHash: 'ffffffff'.repeat(8) });
    // Two riders can tie on the same day in the same city; the trace cannot.
    expect(other).not.toBe(blitzAnchorData(claim));
  });

  it('changes when any part of the result changes', () => {
    const original = blitzAnchorData(claim);
    expect(blitzAnchorData({ ...claim, score: 18_601 })).not.toBe(original);
    expect(blitzAnchorData({ ...claim, challengeDate: '2026-09-18' })).not.toBe(original);
    expect(blitzAnchorData({ ...claim, cityId: 'london' })).not.toBe(original);
  });

  it('is plain ASCII, so the byte count is the character count', () => {
    const data = blitzAnchorData(claim);
    expect(new TextEncoder().encode(data).byteLength).toBe(data.length);
  });
});

/*
 * The checks that make an anchor mean something.
 *
 * A hash proves nothing: a hash is a string and any string would do. What is
 * checked is the transaction itself - signed by the rider, sent to the anchor,
 * on the chain that counts, carrying this exact run - and only then is the
 * hash taken from the bytes. Each of these is a way to fake a record, and
 * leaving any one out makes the other four decorative.
 */
describe('verifying a run written onto Nimiq', () => {
  const NETWORK = 5;
  const ANCHOR = KeyPair.generate().toAddress().toUserFriendlyAddress();
  const expectedData = blitzAnchorData(claim);

  const tx = (over: { keys?: KeyPair; to?: string; data?: string; networkId?: number } = {}) => {
    const keys = over.keys ?? KeyPair.generate();
    const built = TransactionBuilder.newBasicWithData(
      keys.toAddress(),
      Address.fromUserFriendlyAddress(over.to ?? ANCHOR),
      new TextEncoder().encode(over.data ?? expectedData),
      BigInt(1),
      BigInt(0),
      1,
      over.networkId ?? NETWORK,
    );
    built.sign(keys, undefined);
    return { serialized: built.toHex(), sender: keys.toAddress().toUserFriendlyAddress() };
  };

  const check = (serialized: string) => verifyAnchor({
    serialized,
    claim: { date: claim.challengeDate, seed: 'unused-on-this-path', stage: 1, score: claim.score },
    anchorAddress: ANCHOR,
    networkId: NETWORK,
    expectedData,
  });

  it('accepts a run the rider actually sent, and names who sent it', () => {
    const sent = tx();
    const result = check(sent.serialized);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.strength).toBe('verified');
    expect(result.value.sender).toBe(sent.sender);
    // Derived from the bytes, never accepted from a caller.
    expect(result.value.hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('refuses a transaction carrying a different run', () => {
    const other = blitzAnchorData({ ...claim, score: claim.score + 1 });
    expect(check(tx({ data: other }).serialized).ok).toBe(false);
  });

  it('refuses a transaction sent to somebody else', () => {
    const elsewhere = KeyPair.generate().toAddress().toUserFriendlyAddress();
    expect(check(tx({ to: elsewhere }).serialized).ok).toBe(false);
  });

  it('refuses a transaction from another chain, and says which', () => {
    const result = check(tx({ networkId: 6 }).serialized);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    // Without this a free testnet anchor would sit on the board looking
    // exactly like one that cost real NIM.
    expect(result.observed).toBe(6);
  });
});
