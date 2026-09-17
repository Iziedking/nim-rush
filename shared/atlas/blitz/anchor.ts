import type { BlitzCityId } from './types';

/**
 * What a NIM RUSH run carries when it is written onto Nimiq.
 *
 * ## Why a run goes on a chain at all
 *
 * A ranked run is already signed and already replayed by the server, which is
 * what makes the board honest. It is not, however, permanent: every one of
 * those checks happens inside this service, against this service's database,
 * and a service can be switched off, rewritten, or quietly edited by the people
 * who run it. Asked what the wallet was really for, the honest answer stopped
 * at "it proves who you are".
 *
 * An anchor is the rest of the answer. The rider sends an ordinary Nimiq
 * transaction carrying their run in its data field. That costs a real fee on
 * the real chain and produces an entry on a public explorer that nobody -
 * including us - can change afterwards. Delete this service tomorrow and the
 * anchored runs are still there, still attributable, still checkable by anyone
 * who never trusted us in the first place.
 *
 * ## Why this is not the message from attest.ts
 *
 * A basic Nimiq transaction carries at most 64 bytes of data, and a challenge
 * id alone is 46 of them. So this is its own deliberately short form rather
 * than the signed envelope reused: they are different objects with different
 * ceilings, and tying them together would mean a change made for one silently
 * rewriting what the other had already published on a chain.
 *
 * The trace hash prefix is what pins it to one exact run. Date, city and score
 * would collide between two riders who tied on the same day; eight hex
 * characters of the trace will not, and the transaction's own sender says who
 * rode it.
 */
export interface BlitzAnchorClaim {
  readonly challengeDate: string;
  readonly cityId: BlitzCityId;
  readonly score: number;
  readonly traceHash: string;
}

/** A basic Nimiq transaction carries at most this much data. */
export const BLITZ_ANCHOR_MAX_BYTES = 64;

export function blitzAnchorData(claim: BlitzAnchorClaim): string {
  return `nimrush:${claim.challengeDate}:${claim.cityId}:${claim.score}:${claim.traceHash.slice(0, 8)}`;
}

/** Whether a run can be anchored at all, before a wallet is ever opened. */
export function blitzAnchorFits(claim: BlitzAnchorClaim): boolean {
  return new TextEncoder().encode(blitzAnchorData(claim)).byteLength <= BLITZ_ANCHOR_MAX_BYTES;
}
