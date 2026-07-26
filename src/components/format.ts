// Tiny formatting helpers used across the wallet pages.

/**
 * Format a number for display: explicit en-US grouping, and TRUNCATED toward
 * zero — never rounded.
 *
 * Two separate defects lived in the one-line version this replaces.
 *
 * ROUNDING. `Intl` rounds, so `fmt(99.999, 2)` produced `"100.00"`. A display
 * that rounds UP overstates funds, and a figure the user then acts on can cross
 * an on-chain cap and revert. Money displays truncate; that is the wallet-wide
 * rule, and this helper was the one place still breaking it.
 *
 * AMBIENT LOCALE. `toLocaleString(undefined, …)` takes the operating system's
 * locale, so the same balance rendered `1,234.50` here and `1.234,50` on a
 * machine set to German — and any code that later split on "." mangled it. The
 * wallet pins one explicit format everywhere; a user-selectable separator, if it
 * ever ships, comes from a preference, never from the host.
 *
 * `null` / `undefined` / non-finite → the em-dash. An absence is not a zero.
 */
export function fmt(n: number | null | undefined, frac = 2): string {
  if (n === null || n === undefined) return "—";
  if (!Number.isFinite(n)) return "—";

  // Truncate toward zero at `frac` digits BEFORE formatting, so Intl has
  // nothing left to round.
  //
  // Truncation runs on `String(abs)` — JavaScript's shortest round-tripping
  // form — not on `toFixed(20)`. That distinction is the difference between
  // right and wrong here: 1234567.89 is stored as 1234567.88999999999…, so
  // truncating its expanded form silently drops a cent. The shortest form
  // recovers the decimal the value actually denotes.
  const negative = n < 0;
  const abs = Math.abs(n);
  // Beyond 1e21 JavaScript switches to exponential notation, which has no
  // fractional part to slice; the expanded form is the only option there.
  const decimal = abs < 1e21 ? String(abs) : abs.toFixed(20);
  const [intPart = "0", fracPart = ""] = decimal.split(".");
  const kept = fracPart.slice(0, frac);

  const grouped = Number(intPart).toLocaleString("en-US", {
    useGrouping: true,
    maximumFractionDigits: 0,
  });
  const body = frac > 0 ? `${grouped}.${kept.padEnd(frac, "0")}` : grouped;

  // No "-0.00": a truncated-to-nothing negative is zero, and a minus sign in
  // front of a zero reads as a loss that did not happen.
  const isZero = Number(`${intPart}.${kept || "0"}`) === 0;
  return negative && !isZero ? `-${body}` : body;
}

export function pct(x: number, d = 1): string {
  return `${(x * 100).toFixed(d)}%`;
}

export function shortHex(hex: string, head = 6, tail = 4): string {
  if (hex.length <= head + tail + 3) return hex;
  return `${hex.slice(0, head)}…${hex.slice(-tail)}`;
}
