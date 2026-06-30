// First-time-recipient classification for the Send flow.
//
// Honest (no fabrication): "known" only when backed by real data — a saved
// contact, or a prior OUTGOING send to this address from this account (confirmed
// history or an in-flight pending tx). "new" only when history WAS readable and
// shows no such prior send. When the recipient isn't a valid address, or no
// history source could be read, we return "unknown" and assert nothing.

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
  /** True when the recipient resolves to a saved contact. */
  isContact: boolean;
  /** Confirmed activity rows (cache ∪ live), or null when none were readable. */
  rows: ReadonlyArray<ActivityLike> | null;
  /** Tracked pending txs, or null when unreadable. */
  pending: ReadonlyArray<PendingLike> | null;
}

/** A confirmed row counts as a prior send only when it is an explicit OUTGOING
 *  row to this exact address — never an incoming or reward/stake row — so the
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
  if (args.isContact) return "known";
  if (
    hasPriorConfirmedSend(args.rows, args.recipientLower) ||
    hasPendingSend(args.pending, args.recipientLower, args.fromLower)
  ) {
    return "known";
  }
  // No prior interaction found. Only call it "new" if history was actually
  // readable; if neither source could be read, we genuinely don't know.
  const historyReadable = args.rows !== null || args.pending !== null;
  return historyReadable ? "new" : "unknown";
}
