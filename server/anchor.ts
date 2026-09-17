/**
 * Writing a score onto the chain, and checking one that claims to be there.
 *
 * ## Why this exists
 *
 * A signed score proves who set it. It does not put anything on a chain: the
 * signature is an Ed25519 message signature, it costs nothing, sends nothing,
 * and lives in this service's own database. Asked, fairly, what a Nimiq wallet
 * was actually for in a game that never moved any NIM, and the honest answer
 * was that it was an identity badge.
 *
 * An anchor is the real version. The player sends an ordinary Nimiq
 * transaction carrying their score in its data field. That produces a hash, an
 * entry on a public explorer, and a record nobody, including us, can quietly
 * change afterwards. Delete this service tomorrow and the anchored runs are
 * still there.
 *
 * ## Why the service parses the transaction instead of trusting a hash
 *
 * The obvious version takes a transaction hash from the client and stores it.
 * That proves nothing at all: a hash is a string, any string will do, and the
 * board would be publishing claims dressed as receipts. The settlement path
 * already has this limitation and says so out loud, because there it has no
 * choice.
 *
 * Here there is a choice. The wallet hands back the serialized transaction, so
 * the service can take it apart and check every field that matters:
 *
 *   the signature   proves the sender authorised it
 *   the sender      proves whose wallet it was
 *   the recipient   proves it was sent to the anchor and not to a friend
 *   the data        proves it names this exact run and not another
 *   the network     proves it is mainnet NIM and not test NIM
 *
 * Only then is the hash computed, from the bytes, rather than accepted. Every
 * one of those is a way to fake an anchor, and each is checked because leaving
 * any of them out makes the other four decorative.
 *
 * ## What it still cannot do
 *
 * It cannot tell whether the transaction was ever broadcast, or whether it was
 * included in a block. This service has no Nimiq node, the same limitation the
 * settlement path documents. So an anchor proves a transaction was properly
 * built and signed for the anchor address, and the explorer link is what
 * settles whether it landed. That is a much stronger claim than a reported
 * hash, and it is still short of a confirmation, so the screen says which one
 * it is making.
 */

import { Address, Transaction } from '@nimiq/core';

export interface AnchorClaim {
  date: string;
  seed: string;
  stage: number;
  score: number;
}

/**
 * How strong the record is.
 *
 * `verified` means the service took the transaction apart and checked its
 * signature, sender, recipient, data and chain. `reported` means the wallet
 * handed back only an identifier, so the transaction exists but this service
 * has not seen its contents.
 *
 * Kept apart because they are different claims and the screen says which one it
 * is making. Collapsing them would be the same dishonesty as calling a reported
 * settlement hash a receipt.
 */
export type AnchorStrength = 'verified' | 'reported';

export interface Anchored {
  strength: AnchorStrength;
  /** Transaction hash, computed from the bytes rather than taken on trust. */
  hash: string;
  /** The wallet that signed it, derived from the transaction. */
  sender: string;
  /** Network id the transaction declares, so a refusal can name the real one. */
  networkId: number;
}

export type AnchorResult =
  | { ok: true; value: Anchored }
  | { ok: false; reason: string; observed?: number };

/**
 * The exact string an anchored run carries in its data field.
 *
 * Deliberately the same shape as the signed claim in attest.ts, and
 * deliberately not imported from it: that one is a message envelope for a
 * signature and this one is transaction data with a 64 byte ceiling. They agree
 * today because the fields are the same, and tying them together would mean a
 * change made for one silently rewrote what the other had already published on
 * a chain.
 */
export function anchorData(claim: AnchorClaim): string {
  return `sface:${claim.date}:${claim.seed}:s${claim.stage}:${claim.score}`;
}

/** A Nimiq basic transaction carries at most this much data. */
export const MAX_DATA_BYTES = 64;

/** Whether a run can be anchored at all, before a wallet is ever opened. */
export function fitsOnChain(claim: AnchorClaim): boolean {
  return new TextEncoder().encode(anchorData(claim)).byteLength <= MAX_DATA_BYTES;
}

/** One spelling for one address, so two formats never read as two wallets. */
function sameAddress(a: string, b: string): boolean {
  return a.replace(/[\s-]+/g, '').toUpperCase() === b.replace(/[\s-]+/g, '').toUpperCase();
}

/**
 * Check a transaction that claims to anchor a run.
 *
 * Everything is derived from the bytes. Nothing the caller says about the
 * transaction is believed, including which run it is for: the expected data is
 * built here from the run the board already holds, and the transaction has to
 * match it.
 */
export function verifyAnchor(input: {
  /** Serialized transaction, as the wallet's provider returned it. */
  serialized: string;
  /** The run this is supposed to be about, from the board rather than the client. */
  claim: AnchorClaim;
  /** Where anchors are supposed to be sent on this chain. */
  anchorAddress: string;
  /**
   * Which chain this deployment counts.
   *
   * Configured rather than hardcoded because the numeric ids are not in the
   * library's type definitions, and a guessed constant here would accept test
   * NIM as though it were real. A mismatch reports the id the transaction
   * actually carried, so setting it correctly is one refusal away.
   */
  networkId: number;
  /** The exact data this run should carry, when the caller owns the format. */
  expectedData?: string;
}): AnchorResult {
  let tx: Transaction;
  try {
    tx = Transaction.fromAny(input.serialized);
  } catch {
    return { ok: false, reason: 'That is not a Nimiq transaction.' };
  }

  /*
   * The signature first, because every other field is only meaningful once we
   * know the sender authorised these exact bytes.
   */
  try {
    tx.verify(tx.networkId);
  } catch {
    return { ok: false, reason: 'That transaction is not correctly signed.' };
  }

  if (tx.networkId !== input.networkId) {
    return {
      ok: false,
      reason: 'That transaction is on a different chain.',
      observed: tx.networkId,
    };
  }

  if (!sameAddress(tx.recipient.toUserFriendlyAddress(), input.anchorAddress)) {
    // Otherwise anybody could send themselves a transaction saying anything and
    // present it as an anchor.
    return { ok: false, reason: 'That transaction was not sent to the sFace anchor.' };
  }

  /*
   * NIM RUSH writes its own short form, because a basic transaction carries 64
   * bytes and a blitz challenge id alone is 46 of them. Passing the exact
   * string keeps that decision with the caller that owns the format, and the
   * legacy board keeps building its own from the claim exactly as before.
   */
  const expected = input.expectedData ?? anchorData(input.claim);
  const carried = new TextDecoder().decode(tx.data);
  if (carried !== expected) {
    // The one that matters most: without it a single cheap transaction could be
    // replayed as proof of every run a player ever flew.
    return { ok: false, reason: 'That transaction does not carry this run.' };
  }

  return {
    ok: true,
    value: {
      strength: 'verified',
      hash: tx.hash(),
      sender: tx.sender.toUserFriendlyAddress(),
      networkId: tx.networkId,
    },
  };
}

/** A bare transaction hash: 32 bytes of hex, however the wallet spells it. */
const HASH = /^(0x)?[0-9a-fA-F]{64}$/;

export function looksLikeHash(receipt: string): boolean {
  return HASH.test(receipt.trim());
}

/**
 * Record an anchor the wallet only gave us an identifier for.
 *
 * ## Why this exists at all
 *
 * The strong path needs the serialized transaction, because that is the only
 * thing the service can check. Whether a wallet returns one is the wallet's
 * decision: the SDK forwards the call and hands back whatever comes out, so the
 * shape is Nimiq Pay's to choose and its type definition is a claim about it
 * rather than a promise.
 *
 * When it returns a hash instead, the transaction still exists. Refusing it
 * would mean taking a player's fee and then telling them nothing happened,
 * which is exactly the failure this whole path was rebuilt to stop.
 *
 * ## What it is worth
 *
 * Less, and it is labelled as less. The service has not seen the contents, so
 * it cannot say the transaction carries this run or went to the anchor. What it
 * can say is that a wallet reported one, and the anchor address is public: the
 * explorer settles it, and a hash that leads nowhere is a lie with a permanent
 * receipt attached to a named account.
 */
export function reportedAnchor(receipt: string, sender: string | null): AnchorResult {
  const hash = receipt.trim().replace(/^0x/, '').toLowerCase();
  if (!HASH.test(hash)) {
    return { ok: false, reason: 'The wallet did not return anything we can record.' };
  }

  return {
    ok: true,
    value: { strength: 'reported', hash, sender: sender ?? '', networkId: 0 },
  };
}

/** Whether a configured anchor address is usable, checked at boot. */
export function isAnchorAddress(value: string | undefined | null): value is string {
  if (!value) return false;
  try {
    Address.fromUserFriendlyAddress(value);
    return true;
  } catch {
    return false;
  }
}
