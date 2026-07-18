// The one ordered ladder every native-balance surface resolves through.
//
// It exists to make ONE state structurally unreachable: a literal "0.00" (or
// "0") rendered while the balance is actually unknown. A fabricated zero reads
// as "your funds are gone" — the most alarming thing the wallet could say, and
// it would be saying it about a value it never read.
//
// The three outcomes are deliberately distinct facts:
//   hidden  — the chain isn't live: the wallet cannot stand behind ANY figure,
//             so it shows none. This branch always wins, even over a remembered
//             value, because a figure read from an operator we no longer trust
//             (or cannot reach) must not display.
//   value   — a real figure exists: a live read, or a previously confirmed
//             last-known record. `stale` marks the latter so the surface can
//             LABEL it. A genuine live 0 is a value, not a loading state.
//   loading — nothing to show yet; the surface renders a skeleton.
//
// Pure and exported so the ladder is table-testable rather than tangled into a
// component's render branches.

export type BalanceDisplayState =
  | { kind: "hidden" }
  | { kind: "value"; lythoshi: string; stale: boolean }
  | { kind: "loading" };

/**
 * Resolve which of the three presentations a balance surface shows.
 *
 * Order is binding — first match wins:
 *   1. `chainNotLive` → hidden (beats a seeded value; see above).
 *   2. a live value → value, fresh.
 *   3. a seeded value → value, stale.
 *   4. otherwise → loading.
 *
 * `liveLythoshi` / `seededLythoshi` are exact decimal lythoshi integer strings.
 * A blank string counts as absent, so an empty read can never present as a
 * value.
 */
export function balanceDisplayState(
  chainNotLive: boolean,
  liveLythoshi: string | null,
  seededLythoshi: string | null,
): BalanceDisplayState {
  if (chainNotLive) return { kind: "hidden" };
  if (liveLythoshi !== null && liveLythoshi.trim() !== "") {
    return { kind: "value", lythoshi: liveLythoshi, stale: false };
  }
  if (seededLythoshi !== null && seededLythoshi.trim() !== "") {
    return { kind: "value", lythoshi: seededLythoshi, stale: true };
  }
  return { kind: "loading" };
}

/** The stale label, shown under a figure the wallet remembers but has not
 *  re-confirmed this session. Stale is a LABEL, never a change to the value. */
export const STALE_BALANCE_LABEL = "last known · couldn't reach the chain";

/** Accessible name for the loading placeholder. */
export const BALANCE_LOADING_LABEL = "Balance loading";
