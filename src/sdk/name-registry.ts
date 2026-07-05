// `.mono` name validation + the REAL registration quote.
// `checkName` wraps the Rust `name_check_availability` Tauri command for the
// offline structural check (category, labels, multipliers). The registration
// PRICE comes from the SDK's `quoteNameRegistration` (`loadNameQuote` below) —
// the byte-exact chain U-curve over the live block base fee — NOT the Rust
// module's fabricated placeholder (which is no longer read anywhere in TS).

import { invoke } from "@tauri-apps/api/core";
import { formatLyth } from "@monolythium/core-sdk";
import { getProvider } from "./client";

export type NameCategory = "human" | "agent" | "cluster" | "contract" | "system";

export interface NameAvailability {
  name: string;
  category: NameCategory;
  primary_label: string;
  primary_label_len: number;
  whole_len: number;
  length_multiplier: number;
  category_multiplier: number;
  on_chain_check_performed: boolean;
}

/** The real, chain-exact registration quote for a name, in LYTH (full
 *  precision — the cost is tiny at the current base fee). */
export interface NameQuote {
  /** Registration cost formatted as a LYTH decimal string (no unit). */
  costLyth: string;
}

/** Load the REAL registration price via the SDK's `quoteNameRegistration`
 *  (`base × lengthModX10 × feeUnit / 10`, `feeUnit` = the live block base fee) —
 *  the exact value a `register` tx must carry. Returns null on any failure
 *  (malformed name, RPC error) so the UI shows an honest "—", never the old
 *  placeholder and never a fabricated number. */
export async function loadNameQuote(name: string): Promise<NameQuote | null> {
  try {
    const quote = await getProvider().rpcClient.quoteNameRegistration(name.trim().toLowerCase());
    return { costLyth: formatLyth(quote.costLythoshi.toString(), { includeUnit: false }) };
  } catch {
    return null;
  }
}

export type NameErrorCode =
  | "empty"
  | "whole_too_long"
  | "label_empty"
  | "label_too_long"
  | "invalid_charset"
  | "hyphen_edge"
  | "double_dot"
  | "missing_mono_tld"
  | "structural_reserve"
  | "visual_impersonation"
  | "system_category_reserved"
  | "agent_missing_parent";

export interface NameError {
  code: NameErrorCode;
  message?: string;
}

function isTauri(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

export type NameCheckResult =
  | { kind: "ok"; availability: NameAvailability }
  | { kind: "invalid"; error: NameError }
  | { kind: "not_tauri" };

/**
 * Validate a `.mono` name and estimate its registration price. Returns
 * `not_tauri` in browser preview (no backend); otherwise resolves to
 * `ok` with the availability + price, or `invalid` with the failing
 * rule code.
 */
export async function checkName(name: string): Promise<NameCheckResult> {
  if (!isTauri()) return { kind: "not_tauri" };
  try {
    const availability = await invoke<NameAvailability>("name_check_availability", { name });
    return { kind: "ok", availability };
  } catch (cause) {
    if (cause && typeof cause === "object" && "code" in cause) {
      return { kind: "invalid", error: cause as NameError };
    }
    return {
      kind: "invalid",
      error: { code: "empty", message: typeof cause === "string" ? cause : String(cause) },
    };
  }
}
