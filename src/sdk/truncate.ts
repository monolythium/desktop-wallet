// The ONE middle-truncation helper.
//
// Four near-identical slicers existed before this module: one in
// `_detailModalParts.tsx`, one in `SendComposeModal.tsx`, one in
// `Activity.tsx`, and one in `notifications.ts`. Three used the same head/tail
// but two different length gates, and the fourth had its own. The OS-toast
// helper carried a comment promising it matched the in-app row "verbatim" —
// a promise no test enforced and which a one-character edit could break.
//
// That matters more than duplication usually does. The truncated form is what
// a user compares against when checking who they paid, and the SAME address
// appearing as two different strings — one in the row, one in the toast —
// reads as two different addresses.
//
// This module is deliberately DOM- and React-free so `notifications.ts` can
// import it without violating its own no-DOM invariant (which is why the
// duplicate lived there in the first place).
//
// TRUNCATION IS ONLY EVER PERMITTED AS AN EXPAND AFFORDANCE. Every caller must
// keep the full string reachable in place — a `title` at minimum — and every
// copy action must copy the FULL string, never this output. Money surfaces do
// not use this function at all: they render the address in full.

/** Head characters kept. */
export const TRUNC_HEAD = 10;
/** Tail characters kept. */
export const TRUNC_TAIL = 6;

/**
 * Middle-truncate a bech32m address or a hash for compact display.
 *
 * The gate is `len > head + tail + 1`: below it, the ellipsis would cost as
 * many characters as it saves, so the original is returned unchanged.
 *
 * Pure — never throws, even on a malformed value.
 */
export function truncMiddle(
  s: string,
  head: number = TRUNC_HEAD,
  tail: number = TRUNC_TAIL,
): string {
  return s.length > head + tail + 1 ? `${s.slice(0, head)}…${s.slice(-tail)}` : s;
}
