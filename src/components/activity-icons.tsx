// The ONE kind→glyph mapping, for every surface that renders a wallet event.
//
// A user triages a feed by shape before reading a word, so per-kind visuals ARE
// semantics. Two surfaces drawing different glyphs for the same verb is a
// comprehension bug, not a styling inconsistency — and the Activity page and the
// Notifications page render the same transactions.
//
// This module previously served only the Notifications surface while the
// Activity page hand-drew its own badge glyphs, which is exactly the drift the
// module exists to prevent. Both surfaces now consume these glyphs, through two
// adapters over one glyph set:
//
//   iconForKind(TxOpKind)          — tracked / recorded operations
//   iconForActivityKind(ActivityKind) — indexed activity rows
//
// The two vocabularies name the same real operations, so both adapters resolve
// to the SAME element for the same operation: a send is one glyph, wherever it
// is drawn. A behavioural test asserts that rather than trusting this comment.
//
// No icon package is installed and none should be added. These are inline SVG
// on the wallet's own convention — 24×24 viewBox, `currentColor`, stroke 2,
// round caps and joins — the same convention `nav-config` and the refresh
// control use. Colour always arrives from the wrapping element.
//
// Changing a glyph is a deliberate diff: the mapping is test-pinned.

import type { ReactElement } from "react";
import type { ActivityKind } from "../sdk/activity-kind";
import type { TxOpKind } from "../sdk/notifications";

/** One size for every row glyph, on both surfaces.
 *
 *  Sized down from the behaviour specification's 18px because this wallet's
 *  badge also carries a corner status mark; 16 keeps the kind glyph dominant
 *  while leaving that mark legible inside a 28px circle. Both surfaces read
 *  this constant rather than repeating a number. */
export const ACTIVITY_ICON_SIZE = 16;

function svg(children: ReactElement): ReactElement {
  return (
    <svg
      width={ACTIVITY_ICON_SIZE}
      height={ACTIVITY_ICON_SIZE}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {children}
    </svg>
  );
}

const GLYPH_SEND = svg(
  <>
    <path d="m22 2-7 20-4-9-9-4Z" />
    <path d="M22 2 11 13" />
  </>,
);

const GLYPH_RECEIVE = svg(
  <>
    <path d="M12 5v14" />
    <path d="m19 12-7 7-7-7" />
  </>,
);

/** Two opposed arrows — a token movement, which may be either way or neither.
 *  Deliberately symmetric: this glyph must not imply a direction, because a
 *  token transfer the chain gave no direction for renders directionless. */
const GLYPH_SWAP = svg(
  <>
    <path d="M4 9h13l-3-3" />
    <path d="M20 15H7l3 3" />
  </>,
);

// ── The delegation family ────────────────────────────────────────────────────
//
// One frame, three centres. The four satellites are the cluster and are
// IDENTICAL across all three, so the operations read as related; the centre mark
// is what differs, so they read apart at a glance.
//
// The centre marks are +, − and a turn arrow rather than the behaviour
// specification's "centre replaced by a down arrow" for undelegate. A down arrow
// is the receive glyph. Beside a delegation row's deliberately UNSIGNED weight
// figure it would read as value arriving — reintroducing precisely the
// implication the direction work reasoned its way out of. Plus/minus states what
// actually changed (weight committed, weight withdrawn) and claims nothing about
// which way funds moved, and both are unambiguous at 16px where a small arrow's
// heading is not.

const CLUSTER_SATELLITES = (
  <>
    <circle cx="5" cy="5" r="1.9" />
    <circle cx="19" cy="5" r="1.9" />
    <circle cx="5" cy="19" r="1.9" />
    <circle cx="19" cy="19" r="1.9" />
  </>
);

const GLYPH_DELEGATE = svg(
  <>
    {CLUSTER_SATELLITES}
    <path d="M12 8.5v7M8.5 12h7" />
  </>,
);

const GLYPH_UNDELEGATE = svg(
  <>
    {CLUSTER_SATELLITES}
    <path d="M8.5 12h7" />
  </>,
);

const GLYPH_REDELEGATE = svg(
  <>
    {CLUSTER_SATELLITES}
    <path d="M8.8 13.4a3.4 3.4 0 0 1 5.9-2.3" />
    <path d="M15 8.4v3h-3" />
  </>,
);

/** Gift box — a settled delegation reward. Deliberately NOT the receive glyph: a
 *  claim rendered as an inbound arrow would misdescribe where the LYTH came
 *  from, since a reward is settled rather than received from a counterparty. */
const GLYPH_REWARD = svg(
  <>
    <rect x="3" y="8" width="18" height="4" rx="1" />
    <path d="M5 12v9h14v-9" />
    <path d="M12 8v13" />
    <path d="M12 8a3 3 0 1 1 4 0M12 8a3 3 0 1 0-4 0" />
  </>,
);

const GLYPH_SETTINGS = svg(
  <>
    <circle cx="12" cy="12" r="3" />
    <path d="M12 2v3M12 19v3M2 12h3M19 12h3M5 5l2 2M17 17l2 2M19 5l-2 2M7 17l-2 2" />
  </>,
);

const GLYPH_CONTRACT = svg(
  <>
    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z" />
    <path d="M14 2v6h6M9 13h6M9 17h6" />
  </>,
);

/** A row the wallet could not classify. A plain dot states no operation and no
 *  direction — the honest mark for "we do not know what this was". */
const GLYPH_UNCLASSIFIED = svg(<circle cx="12" cy="12" r="3.5" />);

/**
 * Per-kind glyph for a TRACKED or RECORDED operation's badge.
 *
 * One distinct glyph per kind so the row reads at a glance: delegate,
 * undelegate and redelegate stay visually apart while reading as one family,
 * and a reward claim is a gift box rather than an inbound arrow.
 *
 * Keeps a `default` branch on purpose: this is reached with a literal read back
 * from a persisted record, so an unrecognised value must render something
 * rather than throw while painting a row.
 */
export function iconForKind(kind: TxOpKind): ReactElement {
  switch (kind) {
    case "send":
      return GLYPH_SEND;
    case "receive":
      return GLYPH_RECEIVE;
    case "delegate":
      return GLYPH_DELEGATE;
    case "undelegate":
      return GLYPH_UNDELEGATE;
    case "redelegate":
      return GLYPH_REDELEGATE;
    case "claim":
      return GLYPH_REWARD;
    case "set-auto-compound":
      // Auto-compound re-delegates settled rewards, so it wears the redelegate
      // glyph rather than the generic contract mark it used to fall through to.
      return GLYPH_REDELEGATE;
    case "agent-policy":
      return GLYPH_SETTINGS;
    case "contract_call":
    default:
      return GLYPH_CONTRACT;
  }
}

/**
 * Per-kind glyph for an INDEXED activity row's badge.
 *
 * Resolves to the same elements as {@link iconForKind} for the same real
 * operation — a send is one glyph whether it arrived as a tracked transaction or
 * as an indexed row. Exhaustive over `ActivityKind` with no default, so a new
 * kind cannot be added without choosing its glyph.
 */
export function iconForActivityKind(kind: ActivityKind): ReactElement {
  switch (kind) {
    case "tx_send":
      return GLYPH_SEND;
    case "tx_receive":
      return GLYPH_RECEIVE;
    case "token_transfer":
      return GLYPH_SWAP;
    case "delegate":
      return GLYPH_DELEGATE;
    case "undelegate":
      return GLYPH_UNDELEGATE;
    case "redelegate":
      return GLYPH_REDELEGATE;
    case "claim":
      return GLYPH_REWARD;
    case "unclassified":
      return GLYPH_UNCLASSIFIED;
  }
}

/**
 * Status colour for the badge ring AND the glyph.
 *
 * Reinforcement only — never the sole carrier of the status. A distinct mark
 * carries that, because a distinction made by colour alone is no distinction
 * for a colour-blind user or in a forced-colours mode.
 */
export function badgeRingColor(status: "confirmed" | "failed"): string {
  return status === "failed" ? "var(--err)" : "var(--ok)";
}
