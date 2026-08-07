// First-time-recipient classification for the Send flow.
//
// Honest (no fabrication): "known" only when backed by real data — a prior
// OUTGOING send to this address from this account (confirmed history or an
// in-flight pending tx), or a verified sent-log entry. "new" only when the
// CONFIRMED send history was readable and shows no such prior send. When the
// recipient isn't a valid address, or the confirmed history couldn't be read,
// we return "unknown" and assert nothing.
//
// SCOPE: this classifier judges CHAIN EVIDENCE. A saved contact is not chain
// evidence — it is the user's own declaration — so it never reaches here: the
// Send surface short-circuits to "known" before calling this, and the reasoning
// (plus where a contact-integrity check would belong) is recorded at that seam
// in `SendComposeModal.tsx`.

export type RecipientFamiliarity = "known" | "new" | "unknown";

interface ActivityLike {
  counterparty: string | null;
  direction: string | null;
}
interface PendingLike {
  counterparty: string;
  addressLower: string;
}

export interface ClassifyRecipientArgs {
  /** Lowercased typed recipient; "" when empty/invalid (caller pre-validates). */
  recipientLower: string;
  /** Lowercased active sending account. */
  fromLower: string;
  /**
   * Confirmed activity rows, or null when none were readable.
   *
   * ONLY rows the caller obtained from the chain this session belong here. The
   * cached copy on disk used to be unioned in, which made a single planted row
   * `{direction:"out", counterparty:<attacker>}` sufficient to report "known" —
   * one of the three stores that could each suppress the warning independently.
   * The cache is a rendering aid; it is not evidence that a payment happened.
   */
  rows: ReadonlyArray<ActivityLike> | null;
  /** Tracked pending txs, or null when unreadable. */
  pending: ReadonlyArray<PendingLike> | null;
  /** True when an HMAC-verified sent-recipients log entry exists for this
   *  recipient. Adds "known" evidence ONLY — its absence never implies "new". */
  verifiedSentLogHit?: boolean;
}

/** A confirmed row counts as a prior send only when it is an explicit OUTGOING
 *  row to this exact address — never an incoming or reward/delegate row — so the
 *  warning is never falsely suppressed. */
function hasPriorConfirmedSend(
  rows: ReadonlyArray<ActivityLike> | null,
  recipientLower: string,
): boolean {
  if (!rows) return false;
  return rows.some(
    (row) =>
      row.direction === "out" &&
      (row.counterparty ?? "").toLowerCase() === recipientLower,
  );
}

function hasPendingSend(
  pending: ReadonlyArray<PendingLike> | null,
  recipientLower: string,
  fromLower: string,
): boolean {
  if (!pending) return false;
  return pending.some(
    (p) => p.addressLower === fromLower && p.counterparty.toLowerCase() === recipientLower,
  );
}

export function classifyRecipient(args: ClassifyRecipientArgs): RecipientFamiliarity {
  if (args.recipientLower === "") return "unknown";
  // "known" evidence: a verified sent-log entry, a confirmed outgoing send, or
  // an in-flight pending send. The sent-log bit only ever ADDS "known" — its
  // absence falls through to the history logic below (never forces "new").
  if (
    args.verifiedSentLogHit === true ||
    hasPriorConfirmedSend(args.rows, args.recipientLower) ||
    hasPendingSend(args.pending, args.recipientLower, args.fromLower)
  ) {
    return "known";
  }
  // No prior interaction found. "new" asserts "never sent here before", which
  // only the CONFIRMED send history (cache ∪ live) can establish — an in-flight
  // `pending` set never holds historical sends, so an empty/readable pending
  // can't justify "new". Require the confirmed history to have been readable;
  // otherwise we honestly don't know → "unknown" (the caller shows a neutral
  // verify caution rather than a fabricated "first-time" claim).
  const confirmedHistoryReadable = args.rows !== null;
  return confirmedHistoryReadable ? "new" : "unknown";
}
