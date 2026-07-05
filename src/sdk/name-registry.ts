// `.mono` name validation + the REAL registration quote.
// `checkName` wraps the Rust `name_check_availability` Tauri command for the
// offline structural check (category, labels, multipliers). The registration
// PRICE comes from the SDK's `quoteNameRegistration` (`loadNameQuote` below) —
// the byte-exact chain U-curve over the live block base fee — NOT the Rust
// module's fabricated placeholder (which is no longer read anywhere in TS).

import { invoke } from "@tauri-apps/api/core";
import {
  encodeNameRegisterCall,
  formatLyth,
  nameRegistryAddressHex,
} from "@monolythium/core-sdk";
import { getProvider } from "./client";
import { submitNativeTx, type SubmitNativeTxResult } from "./submit";

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

/** The real, chain-exact registration quote for a name. */
export interface NameQuote {
  /** Exact registration cost in lythoshi — the value a register tx MUST carry
   *  (the precompile reverts IncorrectFee on any mismatch). */
  costLythoshi: bigint;
  /** The same cost formatted as a LYTH decimal string (no unit) for display —
   *  full precision, the cost is tiny at the current base fee. */
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
    return {
      costLythoshi: quote.costLythoshi,
      costLyth: formatLyth(quote.costLythoshi.toString(), { includeUnit: false }),
    };
  } catch {
    return null;
  }
}

/** Live availability of a name, via `lyth_resolveName` (available ⇔ no owner).
 *  A convenience for the UI — the chain is authoritative at submit (a race
 *  reverts NameTaken). `error` on a malformed name / failed read (honest). */
export type NameAvailabilityStatus = "available" | "taken" | "error";

export async function loadNameAvailability(name: string): Promise<NameAvailabilityStatus> {
  try {
    const available = await getProvider().rpcClient.lythIsNameAvailable(name.trim().toLowerCase());
    return available ? "available" : "taken";
  } catch {
    return "error";
  }
}

/** The exact `register(name, owner)` submit inputs: to = the 0x110E registry,
 *  the SDK register calldata, and value = the EXACT quoted cost. `owner`
 *  defaults to the zero address so the CALLER (the signing wallet) becomes the
 *  owner (human/agent names). Pure. */
export interface NameRegisterTx {
  to: string;
  input: string;
  valueLythoshi: bigint;
  feeClass: "registry";
}

export function nameRegisterTx(name: string, costLythoshi: bigint): NameRegisterTx {
  return {
    to: nameRegistryAddressHex(),
    input: encodeNameRegisterCall(name.trim().toLowerCase()),
    valueLythoshi: costLythoshi,
    feeClass: "registry",
  };
}

export interface RegisterNameArgs {
  /** Wallet ML-DSA-65 seed, unlocked by the OperationsDrawer. */
  seed: Uint8Array;
  name: string;
  /** Exact registration cost in lythoshi (must equal the chain U-curve cost). */
  costLythoshi: bigint;
}

/** Submit a `register` tx through the shared plaintext seam with value = the
 *  exact cost. The caller becomes the owner. */
export async function submitNameRegistration(
  args: RegisterNameArgs,
): Promise<SubmitNativeTxResult> {
  const tx = nameRegisterTx(args.name, args.costLythoshi);
  return submitNativeTx({ seed: args.seed, ...tx });
}

/** True when the fresh submit-time quote exactly matches the reviewed one. A
 *  base-fee move between review and submit would make the reviewed value stale →
 *  the precompile reverts IncorrectFee, so we submit ONLY when they are equal
 *  (shown == submitted); a mismatch blocks with a "price changed" message. Pure. */
export function quoteUnchanged(shownCostLythoshi: bigint, freshCostLythoshi: bigint): boolean {
  return shownCostLythoshi === freshCostLythoshi;
}

/** For an agent name `<x>.agent.<parent>.mono`, the parent human name
 *  `<parent>.mono` the caller must own; null for any non-agent form. Pure. */
export function agentParentName(name: string): string | null {
  const parts = name.trim().toLowerCase().split(".");
  if (parts.length === 4 && parts[1] === "agent" && parts[3] === "mono" && parts[2]) {
    return `${parts[2]}.mono`;
  }
  return null;
}

/** Whether the caller may register an agent under its parent. `owned` only when
 *  the parent resolves to THIS wallet; the chain also enforces this and reverts
 *  otherwise, so this is the pre-sign guard + honest messaging. */
export type AgentParentVerdict = "owned" | "not_owned" | "parent_unregistered" | "error";

/** Pure verdict from the parent's resolved owner vs. the active address. */
export function agentParentVerdictFrom(
  resolvedParentAddress: string | null | undefined,
  ownerAddress: string,
): AgentParentVerdict {
  if (resolvedParentAddress === null || resolvedParentAddress === undefined) {
    return "parent_unregistered";
  }
  return resolvedParentAddress.toLowerCase() === ownerAddress.trim().toLowerCase()
    ? "owned"
    : "not_owned";
}

/** Resolve an agent name's parent and check the active wallet owns it. `error`
 *  for a non-agent name or a failed read (honest). */
export async function checkAgentParentOwnership(
  agentName: string,
  ownerAddress: string,
): Promise<AgentParentVerdict> {
  const parent = agentParentName(agentName);
  if (!parent || ownerAddress.trim() === "") return "error";
  try {
    const res = await getProvider().rpcClient.lythResolveName(parent);
    return agentParentVerdictFrom(res.address, ownerAddress);
  } catch {
    return "error";
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
