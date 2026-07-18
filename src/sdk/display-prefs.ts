// Display preferences — language + display currency.
//
// Joins the wallet's existing flat `wallet.*` localStorage family (`wallet.theme`,
// `wallet.layout`, `wallet.sidebarCollapsed`, `wallet.autoLockMinutes`): plain
// synchronous reads so a surface can seed its state at mount with no hydration
// flash, and the same validated-fallback posture as `theme.ts` — an unknown,
// corrupt, or absent value reads as the default, and a blocked localStorage never
// surfaces an error.
//
// HONESTY: the display-currency preference is a STORED PREFERENCE ONLY. The
// wallet has no LYTH→fiat price source, so nothing is converted and no fiat
// amount renders anywhere. The `decimals` (minor-unit) metadata is carried now so
// a future formatting layer can read per-currency precision without a data
// migration; nothing in this phase reads it. There is deliberately no symbol
// column — currency glyphs come from `Intl.NumberFormat` at format time, never
// from a hand-maintained table.

// ── Language ────────────────────────────────────────────────────────────────

export const LANGUAGE_STORAGE_KEY = "wallet.language";

/** The FULL set of shipped locales — one, truthfully. No phantom entries. */
export const LANGUAGE_VALUES = ["en-US"] as const;

export type LanguageValue = (typeof LANGUAGE_VALUES)[number];

export const LANGUAGE_DEFAULT: LanguageValue = "en-US";

/** Label carries a Unicode flag emoji (never an image asset) followed by TWO
 *  spaces before the locale name. */
export const LANGUAGE_LABELS: Record<LanguageValue, string> = {
  "en-US": "🇺🇸  English (US)",
};

export function isLanguageValue(value: unknown): value is LanguageValue {
  return typeof value === "string" && (LANGUAGE_VALUES as readonly string[]).includes(value);
}

export function readLanguage(): LanguageValue {
  try {
    const saved = localStorage.getItem(LANGUAGE_STORAGE_KEY);
    if (isLanguageValue(saved)) return saved;
  } catch {
    // localStorage can be blocked in hardened environments; use the default.
  }
  return LANGUAGE_DEFAULT;
}

/** Persist, validating on WRITE too — an invalid value is coerced to the default
 *  before it ever reaches storage. A persistence failure is swallowed (the
 *  in-session selection still applies visually). */
export function saveLanguage(value: string): void {
  const valid: LanguageValue = isLanguageValue(value) ? value : LANGUAGE_DEFAULT;
  try {
    localStorage.setItem(LANGUAGE_STORAGE_KEY, valid);
  } catch {
    // Blocked storage — the selection still applies for this session.
  }
}

// ── Display currency ────────────────────────────────────────────────────────

export const DISPLAY_CURRENCY_STORAGE_KEY = "wallet.displayCurrency";
export const DISPLAY_CURRENCY_DEFAULT = "USD";

export interface CurrencyEntry {
  code: string;
  name: string;
  /** ISO-4217 minor-unit count. Read by a future formatting layer only. */
  decimals: 0 | 2 | 3;
}

/** Curated ISO-4217 set. Render order = table order: majors first, then the
 *  0-decimal currencies, then the 3-decimal ones. */
export const ISO_4217_CURRENCIES: readonly CurrencyEntry[] = [
  { code: "USD", name: "US Dollar", decimals: 2 },
  { code: "EUR", name: "Euro", decimals: 2 },
  { code: "GBP", name: "British Pound", decimals: 2 },
  { code: "CHF", name: "Swiss Franc", decimals: 2 },
  { code: "CAD", name: "Canadian Dollar", decimals: 2 },
  { code: "AUD", name: "Australian Dollar", decimals: 2 },
  { code: "NZD", name: "New Zealand Dollar", decimals: 2 },
  { code: "CNY", name: "Chinese Yuan", decimals: 2 },
  { code: "HKD", name: "Hong Kong Dollar", decimals: 2 },
  { code: "SGD", name: "Singapore Dollar", decimals: 2 },
  { code: "INR", name: "Indian Rupee", decimals: 2 },
  { code: "BRL", name: "Brazilian Real", decimals: 2 },
  { code: "MXN", name: "Mexican Peso", decimals: 2 },
  { code: "ZAR", name: "South African Rand", decimals: 2 },
  { code: "TRY", name: "Turkish Lira", decimals: 2 },
  { code: "AED", name: "UAE Dirham", decimals: 2 },
  { code: "SEK", name: "Swedish Krona", decimals: 2 },
  { code: "NOK", name: "Norwegian Krone", decimals: 2 },
  { code: "PLN", name: "Polish Zloty", decimals: 2 },
  { code: "JPY", name: "Japanese Yen", decimals: 0 },
  { code: "KRW", name: "South Korean Won", decimals: 0 },
  { code: "VND", name: "Vietnamese Dong", decimals: 0 },
  { code: "KWD", name: "Kuwaiti Dinar", decimals: 3 },
  { code: "BHD", name: "Bahraini Dinar", decimals: 3 },
  { code: "OMR", name: "Omani Rial", decimals: 3 },
] as const;

/** Membership in the curated set — exact, case-sensitive. */
export function isCurrencyCode(value: unknown): boolean {
  return typeof value === "string" && ISO_4217_CURRENCIES.some((c) => c.code === value);
}

export function readDisplayCurrency(): string {
  try {
    const saved = localStorage.getItem(DISPLAY_CURRENCY_STORAGE_KEY);
    if (isCurrencyCode(saved)) return saved as string;
  } catch {
    // localStorage can be blocked in hardened environments; use the default.
  }
  return DISPLAY_CURRENCY_DEFAULT;
}

/** Persist, validating on WRITE too (see {@link saveLanguage}). */
export function saveDisplayCurrency(value: string): void {
  const valid = isCurrencyCode(value) ? value : DISPLAY_CURRENCY_DEFAULT;
  try {
    localStorage.setItem(DISPLAY_CURRENCY_STORAGE_KEY, valid);
  } catch {
    // Blocked storage — the selection still applies for this session.
  }
}
