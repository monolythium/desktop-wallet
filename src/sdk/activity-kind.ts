// The activity taxonomy — the ONE place an indexed row becomes an operation
// kind, and the ONE place a kind becomes a direction.
//
// Before this module the feed carried a three-value presentation bucket
// (transfer / reward / delegate) plus a separate `direction` field that
// DEFAULTED TO OUTGOING when the chain reported none. A row the indexer gave no
// direction for therefore drew an outgoing arrow and a minus sign — the wallet
// asserting a fund movement the chain never stated. The richer classification
// already existed, but only as a display label that was computed and thrown
// away. This module promotes that classification to a real value and derives
// direction FROM it, so direction is resolved once, at classify time.
//
// The renderer never compares addresses. It does not need to: by the time a row
// reaches it, which way the value moved is a property of the kind.
//
// ── Why substring matching, and why it must stay ────────────────────────────
//
// The behaviour specification this work maps against transcribes an EXACT-match
// operand table for the wire's sub-label field, with a drop-anything-else rule.
// That is wrong for this chain. The installed SDK declares the field as:
//
//     /** Kind-specific sub-label such as delegated, unstake, or stake. */
//     subKind: string | null;
//
// — free text, typed `string`, not a union, and carrying spellings ("unstake",
// "stake") that the exact table does not list. Applying that table would
// silently drop every row of those types, which is precisely the failure the
// specification warns about elsewhere. The substring matching here is
// compensation for a free-text wire field, not sloppiness, and it is pinned by
// test so it cannot be quietly "corrected" back.
//
// (The delegation-HISTORY stream's `kind` is a different field and IS declared
// as the three exact operands. That one may be relied on as written.)

import { isNativeLythTokenId } from "./lyth-display";

/** The operations a row can be. Closed: every switch over it is exhaustive with
 *  no default, so adding a member is a compile error at each decision point
 *  rather than a silent mislabel.
 *
 *  Deliberately ABSENT: an auto-rebalance kind and a private-crossing kind. No
 *  chain emits either today, so giving them row kinds, glyph overlays and detail
 *  views would build render surfaces no user can reach. The type-label path
 *  still recognises both, so if either ever lands it names itself honestly. */
export type ActivityKind =
  | "tx_send"
  | "tx_receive"
  | "token_transfer"
  | "delegate"
  | "undelegate"
  | "redelegate"
  | "claim"
  | "unclassified";

/** Which way the value moved. `"none"` is a first-class answer, not a failure:
 *  a row whose movement the chain did not state renders directionless rather
 *  than picking a side. */
export type ActivityDirection = "in" | "out" | "none";

/** The match operands, exported as ONE shared set.
 *
 *  The kind classifier below and the type-label classifier (`tx-type-label.ts`)
 *  must agree on what counts as each family. Sharing these constants is what
 *  makes that structural instead of a promise in a comment — a family added to
 *  one is added to both.
 *
 *  ORDER IS LOAD-BEARING and the arrays are consumed in the order declared:
 *  "redelegated" contains "delegated", and "unstake" contains "stake", so a
 *  matcher that tested the shorter operand first would bucket every
 *  redelegation as a delegation and every unstake as a stake. */
export const DELEGATION_OPERANDS = {
  /** Checked FIRST — a claim carries no real delegation target, and matching the
   *  delegation family ahead of it would lose the reward reading entirely. */
  claim: ["reward", "claim"],
  redelegate: ["redeleg"],
  undelegate: ["undeleg", "unstake"],
  delegate: ["deleg", "stake"],
} as const;

/** The free-text haystack a row is classified against — the outer kind plus the
 *  sub-label, lowercased. Both are free text on the wire. */
export function activityMatchText(row: {
  kind: string;
  subKind?: string | null;
}): string {
  return `${row.kind} ${row.subKind ?? ""}`.toLowerCase();
}

function matchesAny(haystack: string, operands: readonly string[]): boolean {
  return operands.some((op) => haystack.includes(op));
}

/**
 * Classify one indexed row.
 *
 * Evaluation order is normative:
 *   1. claim — ahead of the delegation families (see the operand note above);
 *   2. redelegate, then undelegate, then delegate — longest-first;
 *   3. a non-native token id ⇒ token_transfer, whatever the direction;
 *   4. a native movement the chain gave a direction for ⇒ send / receive;
 *   5. otherwise unclassified.
 *
 * Step 4 uses the indexer's own `direction` even on a kind string we do not
 * recognise. That is reporting what the chain said, not guessing: the
 * fabrication being removed here was defaulting an ABSENT direction to
 * outgoing, and step 5 is where that now lands.
 */
export function activityKindOf(row: {
  kind: string;
  subKind?: string | null;
  direction?: string | null;
  tokenId?: string | null;
}): ActivityKind {
  const text = activityMatchText(row);
  if (matchesAny(text, DELEGATION_OPERANDS.claim)) return "claim";
  if (matchesAny(text, DELEGATION_OPERANDS.redelegate)) return "redelegate";
  if (matchesAny(text, DELEGATION_OPERANDS.undelegate)) return "undelegate";
  if (matchesAny(text, DELEGATION_OPERANDS.delegate)) return "delegate";
  if (!isNativeLythTokenId(row.tokenId ?? null)) return "token_transfer";
  if (row.direction === "out") return "tx_send";
  if (row.direction === "in") return "tx_receive";
  return "unclassified";
}

/**
 * The direction table. Exhaustive over {@link ActivityKind} with no default, so
 * a new kind cannot be added without deciding which way its value moves.
 *
 * The rule per kind:
 *   • tx_send / tx_receive — the KIND itself. Direction was resolved upstream
 *     from the indexer's own field and baked in; nothing re-derives it here.
 *   • token_transfer — the row's own direction, re-read, because a token
 *     movement can legitimately be either and the chain may state neither.
 *   • delegate / undelegate / redelegate — the kind alone, always outgoing.
 *   • claim — the kind alone, always incoming: a reward moves TO the wallet.
 *   • unclassified — none, even when the raw field is set, because we do not
 *     know what operation that direction is describing.
 *
 * ── The undelegate judgement ────────────────────────────────────────────────
 *
 * Stake returns to the user on an undelegation, so "outgoing" looks like it
 * contradicts where the money went. It does not, and the reason is that the row
 * is not the money.
 *
 * An undelegate row is a ZERO-VALUE instruction to the delegation module. It
 * carries a weight percentage, never a token amount, and that figure renders
 * UNSIGNED — so no "+"/"−" claim is made either way, and there is no signed
 * amount to be wrong about. What the badge communicates is the direction of the
 * instruction the user sent. The principal's actual return arrives later as its
 * own incoming row, with its own amount and its own "+".
 *
 * Marking the row incoming would put a green inbound arrow beside an unsigned
 * weight, implying value landed in THIS row, which it did not. So outgoing is
 * kept — but the guard that makes it honest is that delegation figures stay
 * unsigned, and that is asserted by test rather than left to convention.
 */
export function activityDirectionOf(
  kind: ActivityKind,
  rawDirection: string | null,
): ActivityDirection {
  switch (kind) {
    case "tx_send":
      return "out";
    case "tx_receive":
      return "in";
    case "token_transfer":
      return rawDirection === "in" ? "in" : rawDirection === "out" ? "out" : "none";
    case "delegate":
    case "undelegate":
    case "redelegate":
      return "out";
    case "claim":
      return "in";
    case "unclassified":
      return "none";
  }
}

/** True for the kinds whose figure is a delegation WEIGHT rather than a token
 *  amount. Those render unsigned — the sign would be a claim about a fund
 *  movement the row does not represent (see the undelegate note above). */
export function activityKindIsUnsigned(kind: ActivityKind): boolean {
  return kind === "delegate" || kind === "undelegate" || kind === "redelegate";
}
