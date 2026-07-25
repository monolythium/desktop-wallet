// The ONE kind→glyph mapping, and the status colouring that rides on it.
//
// A user triages a feed by shape and colour before reading a word, so per-kind
// visuals ARE semantics. Two surfaces drawing different glyphs for the same
// verb is a comprehension bug, not a styling inconsistency — and the Activity
// page and the Notifications page render the same transactions.
//
// The glyphs previously lived page-local in Notifications.tsx, which meant
// nothing stopped a second page from inventing its own. They live here now; a
// test asserts MODULE IDENTITY rather than lookalike JSX, because two
// hand-copied SVGs that render alike today are exactly what drifts tomorrow.
//
// Changing a glyph is a deliberate diff: the mapping is test-pinned.
//
// CONSOLIDATION IS INCOMPLETE, and this comment used to claim otherwise. Only
// the Notifications page imports this module. The Activity page still
// hand-draws its own badge glyphs inline — a spinner, a check, a clock and an
// X for its pending / bridged / stalled / failed rows — so the drift this
// module exists to prevent has partly re-occurred. That is a known gap owned by
// the icon pass, not an oversight: the two surfaces also disagree on the failed
// treatment, where this module rings the badge and keeps the kind glyph legible
// while the Activity page substitutes an X and loses the kind. Do not read the
// module's existence as proof the glyphs are already shared.

import type { ReactElement } from "react";
import type { TxOpKind } from "../sdk/notifications";

const ICON_SEND = (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="m22 2-7 20-4-9-9-4Z" />
    <path d="M22 2 11 13" />
  </svg>
);
const ICON_RECEIVE = (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M12 5v14" />
    <path d="m19 12-7 7-7-7" />
  </svg>
);
const ICON_DELEGATE = (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="6" cy="12" r="2.5" />
    <circle cx="18" cy="6" r="2.5" />
    <circle cx="18" cy="18" r="2.5" />
    <path d="M8.2 11.2l7.6-3.8M8.2 12.8l7.6 3.8" />
  </svg>
);
// The cluster releasing its center weight downward — undelegate. The same four
// satellites as the delegate glyph so the pair reads as opposites; the center
// is a down arrow (weight leaving) instead of the delegated node.
const ICON_UNDELEGATE = (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="5" cy="7" r="2" />
    <circle cx="19" cy="7" r="2" />
    <circle cx="5" cy="17" r="2" />
    <circle cx="19" cy="17" r="2" />
    <path d="M12 7v8M9 13l3 3 3-3" />
  </svg>
);
// Two-way arrows — weight moving between clusters (redelegate).
const ICON_REDELEGATE = (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M7 10h14l-4-4M17 14H3l4 4" />
  </svg>
);
// Gift box (lid + ribbon + bow) — a claimed delegation reward. Distinct from the
// receive glyph (a plain down arrow) so a claim never reads as an inbound send.
const ICON_REWARD = (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="3" y="8" width="18" height="4" rx="1" />
    <path d="M5 12v9h14v-9" />
    <path d="M12 8v13" />
    <path d="M12 8a3 3 0 1 1 4 0M12 8a3 3 0 1 0-4 0" />
  </svg>
);
const ICON_SETTINGS = (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="3" />
    <path d="M12 2v3M12 19v3M2 12h3M19 12h3M5 5l2 2M17 17l2 2M19 5l-2 2M7 17l-2 2" />
  </svg>
);
const ICON_CONTRACT = (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z" />
    <path d="M14 2v6h6M9 13h6M9 17h6" />
  </svg>
);

/**
 * Per-kind glyph for a row's leading badge.
 *
 * One distinct glyph per kind so the row reads at a glance: delegate,
 * undelegate and redelegate stay visually apart, and a reward claim is a gift
 * box rather than the inbound arrow — a claim that looked like a receive would
 * misdescribe where the LYTH came from.
 */
export function iconForKind(kind: TxOpKind): ReactElement {
  switch (kind) {
    case "send":
      return ICON_SEND;
    case "receive":
      return ICON_RECEIVE;
    case "delegate":
      return ICON_DELEGATE;
    case "undelegate":
      return ICON_UNDELEGATE;
    case "redelegate":
      return ICON_REDELEGATE;
    case "claim":
      return ICON_REWARD;
    case "agent-policy":
      return ICON_SETTINGS;
    case "contract_call":
    default:
      return ICON_CONTRACT;
  }
}

/**
 * Status colour for the badge ring AND the glyph.
 *
 * Failed is red on BOTH: a failed redelegate is a red swap glyph, so the kind
 * stays legible while the failure is unmistakable. Colouring only the ring
 * leaves the glyph reading as a normal operation at a glance, which is the
 * moment triage happens.
 *
 * Pending is never green — green is reserved for an observed confirmation, and
 * a premature green is the wallet claiming something it has not seen.
 */
export function badgeRingColor(status: "confirmed" | "failed"): string {
  return status === "failed" ? "var(--err)" : "var(--ok)";
}
