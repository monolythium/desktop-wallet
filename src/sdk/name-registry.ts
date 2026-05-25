// `.mono` name validation + U-curve price estimation.
// Wraps the Rust `name_check_availability` Tauri command. Pure client-side
// check — does NOT touch the chain (live availability needs the RPC client
// wired). Use this for Onboarding name picker, Send recipient autocomplete,
// and Stele provider lookup.

import { invoke } from "@tauri-apps/api/core";

export type NameCategory = "human" | "agent" | "cluster" | "contract" | "system";

export interface NameAvailability {
  name: string;
  category: NameCategory;
  primary_label: string;
  primary_label_len: number;
  whole_len: number;
  price_lyth: number;
  length_multiplier: number;
  category_multiplier: number;
  on_chain_check_performed: boolean;
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
