// Input parsing for the fund-relevant delegation fields — pure, React-free,
// unit-pinnable.
//
// Why this exists rather than `parseInt(raw, 10)` at each call site:
//
// `parseInt` reads a numeric PREFIX and stops at the first character it does not
// understand. It never reports that it stopped early, so a value the user typed
// and a value the wallet signs can differ silently. On these fields that
// difference is a different transaction:
//
//   parseInt("1e1", 10)   === 1      cluster 10 → cluster 1
//   parseInt("1e3", 10)   === 1      1000 bps (10%) → 1 bps (0.01%)
//   parseInt("12.9", 10)  === 12
//   parseInt("50abc", 10) === 50
//
// The exponent forms are not contrived: the delegation inputs are
// `type="number"`, for which `1e1` is a browser-legal value handed through
// verbatim. There is no <form> on the page, so native constraint validation
// never runs and this test is the only gate between the keystroke and the
// encoder.
//
// The rule is therefore FULL-STRING: the trimmed field must be nothing but
// digits, and must survive the round trip to a number exactly. Anything else is
// refused and explained, never quietly reinterpreted.

/** The anchored full-string parse for a non-negative integer field.
 *
 *  Returns the value only when the entire trimmed input is digits and the result
 *  is an exact safe integer; `null` for every other input, including a numeric
 *  prefix followed by anything else. Callers surface a bounded refusal — no
 *  caller may fall back to a looser parse.
 *
 *  Non-negative because every field it guards is: cluster ids start at 0 and
 *  weights at 1. Pure. */
export function parseExactNonNegativeInteger(
  raw: string | null | undefined,
): number | null {
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  // Anchored: digits and nothing else. Refuses "1e1", "12.9", "50abc", "-1",
  // "+1", "" and " " alike.
  if (!/^\d+$/.test(trimmed)) return null;
  const value = Number(trimmed);
  // Past the safe-integer range the parsed value no longer equals what was
  // typed, which is the very failure this function exists to prevent.
  return Number.isSafeInteger(value) ? value : null;
}
