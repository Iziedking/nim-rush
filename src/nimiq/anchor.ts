/**
 * Writing a finished run onto Nimiq.
 *
 * ## What this is for
 *
 * A ranked run is signed and the server replays it, which is what makes the
 * board honest. It is not permanent: all of that happens inside one service,
 * against one database, and a service can be switched off or quietly edited by
 * the people who run it. Anchoring is the rest of the answer. The rider sends
 * an ordinary Nimiq transaction carrying the run in its data field, and the
 * result becomes a public entry that outlives us and that nobody - including
 * us - can change.
 *
 * ## Why this is not `settle()`
 *
 * Same mechanism, different transaction. A settlement moves an agreed stake to
 * another player and refuses a zero amount, correctly. An anchor sends nothing
 * to anybody: the only cost is the network fee, and the payload is the point.
 * Sharing one function would have meant loosening the stake validation that
 * exists to stop a mistyped challenge sending zero NIM to a stranger.
 *
 * ## Why it sends one Luna rather than nothing
 *
 * A hundred-thousandth of a NIM, and it buys certainty. A zero-value transfer
 * is the kind of edge a wallet or a node is entitled to treat differently, and
 * finding out which on a rider's first anchor is not worth the saving. The
 * amount is invisible; being refused is not.
 */
import { getProvider, isProviderError } from './wallet';

/** What an anchor costs the rider, beyond the network fee. */
export const ANCHOR_VALUE_LUNA = 1;

export type AnchorSendResult =
  | { ok: true; serializedTx: string }
  | { ok: false; reason: string };

/** Where this deployment collects anchors, or null when it collects none. */
export function anchorAddress(): string | null {
  const configured = import.meta.env.VITE_ANCHOR_ADDRESS;
  return typeof configured === 'string' && configured.trim().length > 0 ? configured.trim() : null;
}

/**
 * Ask Nimiq Pay to send the run.
 *
 * Returns a plain result rather than throwing: every failure here has a
 * sentence a rider needs to read, and the provider reports its own errors by
 * resolving an envelope rather than rejecting, so a bare try/catch would miss
 * the ones that matter most.
 */
export async function anchorRun(data: string): Promise<AnchorSendResult> {
  const recipient = anchorAddress();
  if (!recipient) return { ok: false, reason: 'This build has nowhere to anchor runs.' };

  const nimiq = await getProvider();
  if (!nimiq) return { ok: false, reason: 'Open this in Nimiq Pay to anchor a run.' };

  try {
    // Never ask somebody to approve a transaction against a wallet that is
    // still catching up: the dialog appears and the send fails behind it.
    if (!(await nimiq.isConsensusEstablished())) {
      return { ok: false, reason: 'Wallet is still syncing. Try again shortly.' };
    }

    const result = await nimiq.sendBasicTransactionWithData({
      recipient,
      value: ANCHOR_VALUE_LUNA,
      data,
    });

    if (isProviderError(result)) return { ok: false, reason: result.error.message };
    if (typeof result !== 'string' || result.length === 0) {
      return { ok: false, reason: 'The wallet did not return a transaction.' };
    }
    return { ok: true, serializedTx: result };
  } catch (error) {
    return { ok: false, reason: error instanceof Error ? error.message : 'The anchor did not complete.' };
  }
}
