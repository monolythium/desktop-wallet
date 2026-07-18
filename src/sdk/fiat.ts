// The wallet's fiat display layer — honest by construction.
//
// Every fiat slot renders the selected currency's symbol followed by an em-dash
// — "$—", "€—", "¥—", "KWD—" — the honest "no value yet" form, NEVER "$0"
// (which would assert a false value). No network, no mock, no fabricated number
// anywhere in this file.
//
// ORACLE STATUS (verified 2026-07-18 against @monolythium/core-sdk 0.6.7 and
// mono-core): the SDK DOES expose a generic multi-signer price oracle —
// precompile 0x1009, read via `lythOracleLatestPrice` / `lythOracleFeedConfig` /
// `lythOracleWriters` / `lythOracleSigners`, with `deriveFeedId(name, decimals)`
// bridging a pair name to a feed id. What does NOT exist is a registered
// LYTH/USD feed: `OracleGenesisBundle` carries only `admin` + `writers` (there
// is no feeds field, so genesis seeds who may write, never what feeds exist),
// and no LYTH/USD feed name appears anywhere in mono-core. A read today would
// return `round: 0, finalized: false, median: null`. So no LYTH→fiat rate is
// obtainable and this module fabricates none. Wiring the oracle is a separate
// decision with its own honesty questions (staleness vs `heartbeatSeconds`,
// writer-roster disclosure, the unfinalized/indexer-unavailable posture) — it is
// deliberately NOT taken here.

import { formatLyth } from "@monolythium/core-sdk";
import { ISO_4217_CURRENCIES } from "./display-prefs";

/** The wallet's standing honest-absence glyph — U+2014, never a hyphen. */
const EM_DASH = "—";

/** Guard against a pathological exponent turning into a giant bigint pow. A
 *  finite JS number stringifies within e±324, so this never rejects a real rate. */
const MAX_EXPONENT = 10_000;

/**
 * The SINGLE LYTH→fiat rate source. No LYTH/USD price feed is registered on
 * this chain (see the ORACLE STATUS note above), so this always returns null.
 * When a real price feed lands it attaches HERE and every fiat slot lights up
 * with no other change. It never returns a fabricated rate.
 */
export function getLythFiatRate(currency: string): number | null {
  // `currency` is accepted so a future per-currency feed (or a cross-rate table)
  // attaches without changing a single call site. Referenced so the parameter is
  // not merely decorative.
  void currency;
  return null;
}

// ── Intl-derived symbol + precision ─────────────────────────────────────────

/** The currency formatter, or null when the code is not well-formed ISO-4217.
 *  Never throws. */
function intlFor(currency: string): Intl.NumberFormat | null {
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency,
      currencyDisplay: "narrowSymbol",
    });
  } catch {
    return null;
  }
}

/** The glyph Intl will use for this currency — so the symbol in the empty form
 *  is byte-identical to the one a populated value will later render. Where no
 *  narrow glyph exists Intl yields the code itself (KWD/BHD/OMR/CHF); a code
 *  Intl rejects outright falls back to the raw string. Never throws. */
function symbolOf(currency: string): string {
  const nf = intlFor(currency);
  if (nf === null) return currency;
  try {
    const part = nf.formatToParts(0).find((p) => p.type === "currency");
    return part === undefined || part.value === "" ? currency : part.value;
  } catch {
    return currency;
  }
}

/** Fraction digits for the currency: Intl first, then the stored ISO-4217
 *  metadata, then 2. The Intl-vs-table agreement is test-pinned for all 25 as an
 *  engine-drift guard. */
function targetFractionDigits(currency: string): number {
  const nf = intlFor(currency);
  if (nf !== null) {
    try {
      const max = nf.resolvedOptions().maximumFractionDigits;
      if (typeof max === "number" && Number.isInteger(max) && max >= 0) return max;
    } catch {
      // fall through to the stored metadata
    }
  }
  const entry = ISO_4217_CURRENCIES.find((c) => c.code === currency);
  return entry === undefined ? 2 : entry.decimals;
}

/** The honest "amount known, no rate exists" form: symbol + em-dash, no digit. */
function emptyForm(currency: string): string {
  return `${symbolOf(currency)}${EM_DASH}`;
}

// ── Exact fixed-point parsing (no float ever carries an amount) ──────────────

/** A decimal parsed exactly: value = (neg ? -1 : 1) · digits / 10^scale. */
interface Fixed {
  neg: boolean;
  digits: bigint;
  scale: number;
}

/**
 * Parse a decimal string to exact bigint fixed-point: optional sign, integer
 * part, optional fraction, optional exponent (rates arrive via Number→String
 * round-trips, which can emit "1e-7").
 *
 * `allowGrouping` accepts en-US three-digit grouping in the INTEGER part,
 * because the wallet's canonical `formatLyth` output is comma-grouped. Any other
 * comma placement ("12,34") is unparseable — the caller then renders the empty
 * form rather than guessing. Integer parts above 2^53 keep full magnitude.
 */
function parseFixed(input: string, allowGrouping: boolean): Fixed | null {
  if (typeof input !== "string") return null;
  const s = input.trim();
  if (s === "") return null;

  const m = /^([+-]?)([0-9,]+)(?:\.([0-9]+))?(?:[eE]([+-]?[0-9]+))?$/.exec(s);
  if (m === null) return null;
  // Groups 1–2 always participate when the pattern matches; the defaults keep
  // this total under `noUncheckedIndexedAccess` without a non-null assertion.
  const sign = m[1] ?? "";
  const rawInt = m[2] ?? "";
  const frac = m[3] ?? "";
  const exp = m[4];

  let intPart: string;
  if (rawInt.includes(",")) {
    // Valid en-US grouping only: 1–3 leading digits then groups of exactly 3.
    if (!allowGrouping || !/^[0-9]{1,3}(,[0-9]{3})+$/.test(rawInt)) return null;
    intPart = rawInt.replace(/,/g, "");
  } else {
    intPart = rawInt;
  }
  if (intPart === "") return null;

  let digits: bigint;
  try {
    digits = BigInt(intPart + frac);
  } catch {
    return null;
  }

  let scale = frac.length;
  if (exp !== undefined) {
    const e = Number(exp);
    if (!Number.isInteger(e) || Math.abs(e) > MAX_EXPONENT) return null;
    scale -= e;
  }
  // Normalise a negative scale by scaling the digits up, so `scale >= 0` holds
  // for the multiply below.
  if (scale < 0) {
    digits *= 10n ** BigInt(-scale);
    scale = 0;
  }

  return { neg: sign === "-", digits, scale };
}

/** Render a non-negative minor-unit count through Intl so the symbol placement,
 *  grouping and separator come from the engine, with the EXACT fraction digits
 *  substituted into the fraction slot. */
function renderCurrency(
  units: bigint,
  targetDigits: number,
  currency: string,
): string {
  const divisor = 10n ** BigInt(targetDigits);
  const intUnits = targetDigits === 0 ? units : units / divisor;
  const fracDigits =
    targetDigits === 0
      ? ""
      : (units % divisor).toString().padStart(targetDigits, "0");

  const nf = intlFor(currency);
  if (nf === null) {
    // Intl rejected the code entirely — code-as-symbol, plain grouping.
    let grouped: string;
    try {
      grouped = new Intl.NumberFormat("en-US").format(intUnits);
    } catch {
      grouped = intUnits.toString();
    }
    return fracDigits === ""
      ? `${currency}${grouped}`
      : `${currency}${grouped}.${fracDigits}`;
  }

  let out = "";
  let sawFraction = false;
  for (const part of nf.formatToParts(intUnits)) {
    if (part.type === "fraction") {
      out += fracDigits;
      sawFraction = true;
    } else {
      out += part.value;
    }
  }
  // Defensive: a formatter that emitted no fraction slot while we owe digits.
  if (!sawFraction && fracDigits !== "") out += `.${fracDigits}`;
  return out;
}

// ── The formatter ───────────────────────────────────────────────────────────

/**
 * `lythAmount` is a decimal-LYTH string (the rate is per-LYTH). Amounts are
 * strings only — there is no float overload, because a float feed silently
 * loses precision above 2^53. Never throws.
 *
 * Empty form (`{symbol}—`) whenever the rate is null/non-finite OR the amount is
 * absent/blank/unparseable. Populated form is "≈ " + sign + the Intl currency
 * string; the "≈ " prefix appears ONLY with a real value, and the symbol leads
 * in BOTH forms so the glyph position does not move when a rate later lands.
 *
 * The math is exact: amount and rate become bigint fixed-point, the product is
 * scaled to the currency's fraction digits with a SINGLE half-away-from-zero
 * rounding (the mode Intl uses), and a result that rounds to zero drops the sign
 * — never "-$0.00".
 */
export function formatFiat(
  lythAmount: string,
  currency: string,
  rate: number | null,
): string {
  try {
    if (rate === null || typeof rate !== "number" || !Number.isFinite(rate)) {
      return emptyForm(currency);
    }
    const amount = parseFixed(lythAmount, true);
    if (amount === null) return emptyForm(currency);
    const factor = parseFixed(String(rate), false);
    if (factor === null) return emptyForm(currency);

    const targetDigits = targetFractionDigits(currency);

    // magnitude = (aDigits · rDigits · 10^target) / 10^(aScale + rScale),
    // with ONE half-away-from-zero rounding at the end.
    const num = amount.digits * factor.digits * 10n ** BigInt(targetDigits);
    const den = 10n ** BigInt(amount.scale + factor.scale);
    let units = num / den;
    const rem = num % den;
    if (rem * 2n >= den) units += 1n;

    const negative = amount.neg !== factor.neg && units !== 0n;
    return `≈ ${negative ? "-" : ""}${renderCurrency(units, targetDigits, currency)}`;
  } catch {
    // A formatter contract: degrade to the honest absence, never throw upward.
    return emptyForm(currency);
  }
}

/**
 * Feed helper: raw lythoshi → the fiat string. Feeds the FULL-PRECISION exact
 * decimal (`formatLyth`, up to 18 dp) rather than a display-truncated figure, so
 * the estimate describes the real amount, not the 2-dp/4-dp number shown beside
 * it; the formatter's single end rounding is the only precision loss.
 *
 * An absent/blank/undecodable amount degrades to the empty form. That is defence
 * in depth only — a slot that KNOWS its amount is missing must render its
 * amount-absent presentation (a plain "—" or nothing at all) and not call here,
 * because "{symbol}—" asserts "the amount is known; no rate exists".
 */
export function formatFiatFromLythoshi(
  lythoshi: bigint | string | null | undefined,
  currency: string,
  rate: number | null,
): string {
  if (lythoshi === null || lythoshi === undefined) return emptyForm(currency);
  const raw = typeof lythoshi === "bigint" ? lythoshi.toString() : lythoshi;
  if (typeof raw !== "string" || raw.trim() === "") return emptyForm(currency);
  let lythAmount: string;
  try {
    lythAmount = formatLyth(raw.trim(), { includeUnit: false });
  } catch {
    return emptyForm(currency);
  }
  return formatFiat(lythAmount, currency, rate);
}
