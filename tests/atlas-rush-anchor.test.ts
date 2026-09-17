import { describe, expect, it } from 'vitest';

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
