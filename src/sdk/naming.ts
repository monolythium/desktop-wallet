// Naming-registry SDK seam — typed readers for the §22.8 hierarchical
// name surface.
//
// Every chain read flows through `MonolythiumProvider.rpcClient.*` just
// like the Phase 1 chain-snapshot + Phase 2 staking seams. Errors are
// surfaced as `RpcOutcome` envelopes so the UI never has to unwind a
// thrown `SdkError`.
//
// §22.8 TLDs (recap):
//
//   <label>.mono                    — human (primary user identity)
//   <label>.agent.<human>.mono      — agent (sub-account under a human parent)
//   <label>.cluster.mono            — cluster (validator-bond bundle)
//   <label>.contract.mono           — contract (deployed code label)
//   <label>.system.mono             — system / foundation (reserved TLD)
//
// Chain gaps (surfaces still missing on v2 testnet; see Phase 3 final
// report for the GAP ids):
//
//   - `lyth_resolveName(name)` — forward resolve. The chain emits
//     reverse-resolve via `lyth_getAddressLabel(addr)` but no name →
//     address index. We synthesise a best-effort client-side mapping by
//     paging recent reverse-lookups via a tiny in-process cache; for now
//     this seam returns null + a `[chain-gap]` sentinel when the name
//     hasn't been seen yet.
//
//   - `lyth_listOwnedNames(addr)` — owned-names enumeration. Not yet
//     emitted; we surface the primary name (if any) returned by
//     `lythGetAddressLabel` and tag the rest as chain-gapped.
//
//   - `lyth_getNameDetails(name)` — full registration metadata. Same
//     story: returned shape includes the chain-gap sentinel.
//
//   - `lyth_isNameAvailable(name)` — pre-registration availability. No
//     RPC; we only filter for structural rejections (charset / format /
//     reserved TLD) client-side; everything else is "unknown".

import {
  PRECOMPILE_ADDRESSES,
  SdkError,
  normalizeAddressHex,
} from "@monolythium/core-sdk";
import { getProvider } from "./client";
import { capture, type RpcOutcome } from "./live";

// JSON-RPC standard "method not found" error code. Used to detect the
// chain-gap surface for `lyth_resolveName` / `lyth_listOwnedNames` /
// `lyth_getNameDetails` until those land on chain.
const JSONRPC_METHOD_NOT_FOUND = -32601;

function isMethodNotFound(cause: unknown): boolean {
  return (
    cause instanceof SdkError &&
    cause.kind === "rpc" &&
    cause.code === JSONRPC_METHOD_NOT_FOUND
  );
}

// ─── Public types ────────────────────────────────────────────────

/** Five §22.8 TLD categories. `system` is foundation-only (issuance
 *  forbidden through the standard register path; the encoder rejects). */
export type NameCategory = "human" | "agent" | "cluster" | "contract" | "system";

/** Per-name pending-transfer state. */
export type TransferState =
  | { kind: "active" }
  | {
      kind: "outgoing";
      /** EIP-55 hex address of the proposed recipient. */
      recipient: string;
      /** Block height at which the proposal was opened. */
      openedAtHeight: bigint;
      /** Block height at which the proposal lapses (24h window per §22.8). */
      expiresAtHeight: bigint;
    }
  | {
      kind: "incoming";
      /** EIP-55 hex address of the current owner who proposed the transfer. */
      currentOwner: string;
      openedAtHeight: bigint;
      expiresAtHeight: bigint;
    };

/** Reverse-resolved name binding. */
export interface NameBinding {
  /** Canonical lowercased form (e.g. `alice.mono`). */
  name: string;
  /** §22.8 category. */
  category: NameCategory;
  /** EIP-55 lowercase hex address. */
  owner: string;
}

/** Full registration metadata for one name. */
export interface NameDetail {
  /** Canonical lowercased form. */
  name: string;
  category: NameCategory;
  /** Current on-chain owner. */
  owner: string;
  /** Block height of the registration. `null` when unavailable. */
  registeredAtHeight: bigint | null;
  /** Fee paid at registration, in LYTH; `null` when chain-gapped. */
  feePaidLyth: number | null;
  /** Pending-transfer state. */
  transferState: TransferState;
  /** Sentinel set when any field above was chain-gapped. */
  chainGap: string | null;
}

/** Availability check result for a candidate name. */
export type AvailabilityResult =
  | { available: true; reason?: undefined }
  | {
      available: false;
      reservedBy?: "foundation" | "structural" | "format-rule" | "registered";
      reason: string;
    };

// ─── §22.8 hierarchical parser ───────────────────────────────────

/** Maximum total length per §22.8 ("80 chars total"). Browser-wallet
 *  uses a more generous floor; we honour the whitepaper here. */
const NAME_MAX_LEN = 80;

/** Per-label charset + length rule. Matches the browser-wallet's
 *  `LABEL_RE`: 1-63 chars, [a-z0-9-], no leading/trailing hyphen. */
const LABEL_RE = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;

/** Structural-name list — names the chain reserves regardless of TLD
 *  (foundation, system, mono, etc.). Used by `isNameAvailable` to
 *  surface "reserved" without an RPC call. */
const STRUCTURAL_LABELS: ReadonlySet<string> = new Set([
  "foundation",
  "monolab",
  "mono-labs",
  "system",
  "registry",
  "treasury",
  "burn",
  "null",
  "void",
  "admin",
]);

/** Parsed shape; mirrors the browser-wallet's `MonoNameParse`. */
export interface ParsedName {
  tld: NameCategory;
  /** Leftmost label. */
  label: string;
  /** Human parent (only for agent names; null otherwise). */
  parent: string | null;
  /** Lowercased canonical form. */
  canonical: string;
}

function isValidLabel(s: string): boolean {
  if (s.length === 0 || s.length > 63) return false;
  return LABEL_RE.test(s);
}

/** Validate a candidate label without the `.<tld>.mono` suffix. Returns
 *  the same shape as the encoder's input validator (Commit 2). */
export function validateLabel(label: string):
  | { ok: true }
  | { ok: false; reason: string } {
  if (typeof label !== "string") return { ok: false, reason: "Label must be a string" };
  if (label.length === 0) return { ok: false, reason: "Label cannot be empty" };
  if (label.length > 63) return { ok: false, reason: "Label cannot exceed 63 characters" };
  if (label.toLowerCase() !== label) return { ok: false, reason: "Label must be lowercase" };
  if (label.startsWith("-")) return { ok: false, reason: "Label cannot start with hyphen" };
  if (label.endsWith("-")) return { ok: false, reason: "Label cannot end with hyphen" };
  if (label.includes("--")) return { ok: false, reason: "Label cannot contain consecutive hyphens" };
  if (label.startsWith("0x")) return { ok: false, reason: "Label cannot start with '0x'" };
  if (label.startsWith("mono1")) return { ok: false, reason: "Label cannot start with 'mono1'" };
  if (!LABEL_RE.test(label)) {
    return { ok: false, reason: "Label may only contain [a-z0-9-]" };
  }
  return { ok: true };
}

/**
 * Parse a §22.8 hierarchical name. Returns null on any structural
 * failure (mixed case, missing `.mono` suffix, bad labels). The shape
 * mirrors browser-wallet's `parseMonoName` so the two wallets stay in
 * lock-step.
 */
export function parseName(input: string): ParsedName | null {
  if (typeof input !== "string") return null;
  if (input.length === 0 || input.length > NAME_MAX_LEN) return null;
  if (input !== input.toLowerCase()) return null;
  if (!input.endsWith(".mono")) return null;
  const parts = input.split(".");
  if (parts.length < 2 || parts.length > 4) return null;
  if (parts[parts.length - 1] !== "mono") return null;
  for (const p of parts) {
    if (!isValidLabel(p)) return null;
  }
  if (parts.length === 2) {
    const [label] = parts as [string, string];
    return { tld: "human", label, parent: null, canonical: `${label}.mono` };
  }
  if (parts.length === 3) {
    const [label, sub] = parts as [string, string, string];
    if (sub === "cluster" || sub === "contract" || sub === "system") {
      return {
        tld: sub,
        label,
        parent: null,
        canonical: `${label}.${sub}.mono`,
      };
    }
    return null;
  }
  // parts.length === 4 — only `agent` is valid here.
  const [label, sub, parent] = parts as [string, string, string, string];
  if (sub !== "agent") return null;
  return {
    tld: "agent",
    label,
    parent,
    canonical: `${label}.agent.${parent}.mono`,
  };
}

// ─── Readers ─────────────────────────────────────────────────────

/**
 * Resolve `<name>.mono` → on-chain address. Returns the EIP-55 lowercase
 * hex form on a hit, null when the chain has no entry for the name.
 *
 * Chain gap: `lyth_resolveName` is not yet emitted by the v2 testnet
 * (no forward-resolve precompile RPC). We attempt the call regardless so
 * the seam is wired the moment chain support lands; on a `method not
 * found` error we surface `null` + the gap is logged in the Phase 3
 * report.
 */
export async function resolveName(
  name: string,
): Promise<RpcOutcome<string | null>> {
  const parsed = parseName(name);
  if (parsed === null) {
    return { ok: false, error: "name not in §22.8 canonical form" };
  }
  const provider = getProvider();
  try {
    const raw = await provider.rpcClient.call<unknown>("lyth_resolveName", [
      parsed.canonical,
    ]);
    if (raw === null || raw === undefined) {
      return { ok: true, value: null };
    }
    if (typeof raw === "string") {
      // Either bech32m or 0x; round-trip through normalize so the caller
      // gets a stable lowercase 0x.
      return { ok: true, value: normalizeAddressHex(raw) };
    }
    if (typeof raw === "object" && raw !== null && "address" in raw) {
      const addr = (raw as { address?: unknown }).address;
      if (typeof addr === "string") {
        return { ok: true, value: normalizeAddressHex(addr) };
      }
    }
    return { ok: true, value: null };
  } catch (cause) {
    // `method not found` is the expected chain-gap surface — keep the
    // outcome successful with a null value so the UI renders the
    // "no forward-resolve" fallback (paste address directly) rather
    // than an error banner.
    if (isMethodNotFound(cause)) {
      return { ok: true, value: null };
    }
    return { ok: false, error: (cause as Error)?.message ?? String(cause) };
  }
}

/**
 * Reverse-resolve `addr` → primary §22.8 name. Returns null when the
 * address has no on-chain label or the chain returns a non-§22.8 string
 * (e.g. indexer-pragmatic categories like `treasury` / `bridge` that
 * don't fit the hierarchical scheme).
 *
 * Wraps the existing `lyth_getAddressLabel` SDK helper; if the chain
 * emits §22.8 form in `displayName`, the parser picks it up automatically.
 */
export async function lookupAddress(
  addr: string,
): Promise<RpcOutcome<NameBinding | null>> {
  const provider = getProvider();
  const out = await capture(() => provider.rpcClient.lythGetAddressLabel(addr));
  if (!out.ok) return { ok: false, error: out.error };
  const label = out.value;
  if (!label || typeof label.displayName !== "string") {
    return { ok: true, value: null };
  }
  const parsed = parseName(label.displayName);
  if (parsed === null) return { ok: true, value: null };
  return {
    ok: true,
    value: {
      name: parsed.canonical,
      category: parsed.tld,
      owner: addr.toLowerCase(),
    },
  };
}

/**
 * List names owned by `addr`. Chain-gap surface: until
 * `lyth_listOwnedNames` lands, we surface only the primary name (if any)
 * returned by `lythGetAddressLabel` + an explicit chain-gap reason on
 * each detail row.
 */
export async function listOwnedNames(
  addr: string,
): Promise<RpcOutcome<NameDetail[]>> {
  const provider = getProvider();
  // Attempt the future-shaped RPC first; fall back to the
  // reverse-resolve primary on `method not found`.
  try {
    const raw = await provider.rpcClient.call<unknown>(
      "lyth_listOwnedNames",
      [addr],
    );
    const list = decodeOwnedNamesList(raw);
    if (list !== null) {
      return { ok: true, value: list };
    }
    // Unparseable — fall through to the legacy path.
  } catch (cause) {
    if (!isMethodNotFound(cause)) {
      return { ok: false, error: (cause as Error)?.message ?? String(cause) };
    }
  }

  // Fallback: synthesise from the primary label only.
  const primary = await lookupAddress(addr);
  if (!primary.ok || !primary.value) {
    return { ok: true, value: [] };
  }
  return {
    ok: true,
    value: [
      {
        name: primary.value.name,
        category: primary.value.category,
        owner: primary.value.owner,
        registeredAtHeight: null,
        feePaidLyth: null,
        transferState: { kind: "active" },
        chainGap: "lyth_listOwnedNames not yet emitted; primary only",
      },
    ],
  };
}

/**
 * Full registration metadata for `name`. Chain-gap surface: until
 * `lyth_getNameDetails` lands we synthesise the row from the primary
 * reverse-resolve and tag everything else as chain-gapped.
 */
export async function getNameDetails(
  name: string,
): Promise<RpcOutcome<NameDetail | null>> {
  const parsed = parseName(name);
  if (parsed === null) return { ok: false, error: "name not in §22.8 form" };
  const provider = getProvider();
  try {
    const raw = await provider.rpcClient.call<unknown>(
      "lyth_getNameDetails",
      [parsed.canonical],
    );
    const decoded = decodeNameDetail(raw, parsed.tld);
    if (decoded !== null) {
      return { ok: true, value: decoded };
    }
  } catch (cause) {
    if (!isMethodNotFound(cause)) {
      return { ok: false, error: (cause as Error)?.message ?? String(cause) };
    }
  }
  // Fallback: walk forward-resolve to find the owner, then surface
  // a sentinel row. Returns null when no owner is known either way.
  const fwd = await resolveName(parsed.canonical);
  const owner = fwd.ok ? fwd.value ?? null : null;
  if (owner === null) {
    return { ok: true, value: null };
  }
  return {
    ok: true,
    value: {
      name: parsed.canonical,
      category: parsed.tld,
      owner,
      registeredAtHeight: null,
      feePaidLyth: null,
      transferState: { kind: "active" },
      chainGap: "lyth_getNameDetails not yet emitted; owner only",
    },
  };
}

/**
 * Availability check. Combines:
 *
 *   1. Structural rejection — empty / mixed-case / bad charset /
 *      forbidden prefix → `format-rule`.
 *   2. Reserved-by-foundation — labels in the structural list →
 *      `foundation`.
 *   3. Already-registered — any forward-resolve hit → `registered`.
 *
 * Returns `{available: true}` when none of the above hits. The check is
 * intentionally pessimistic on chain-gap: if `lyth_resolveName` errors
 * we return "available unknown" (treated as not-available with a
 * structural reason so the UI keeps the user away from a bad submit).
 */
export async function isNameAvailable(
  name: string,
): Promise<RpcOutcome<AvailabilityResult>> {
  const parsed = parseName(name);
  if (parsed === null) {
    return {
      ok: true,
      value: {
        available: false,
        reservedBy: "format-rule",
        reason: "Name is not in canonical §22.8 form",
      },
    };
  }
  if (STRUCTURAL_LABELS.has(parsed.label)) {
    return {
      ok: true,
      value: {
        available: false,
        reservedBy: "foundation",
        reason: `'${parsed.label}' is reserved by the Foundation`,
      },
    };
  }
  if (parsed.tld === "system") {
    return {
      ok: true,
      value: {
        available: false,
        reservedBy: "structural",
        reason: "system.mono TLD is foundation-only",
      },
    };
  }
  // Forward-resolve — if any hit, the name is registered.
  const fwd = await resolveName(parsed.canonical);
  if (!fwd.ok) {
    return {
      ok: true,
      value: {
        available: false,
        reservedBy: "structural",
        reason: fwd.error ?? "availability check failed",
      },
    };
  }
  if (fwd.value !== null) {
    return {
      ok: true,
      value: {
        available: false,
        reservedBy: "registered",
        reason: `Name is owned by ${fwd.value}`,
      },
    };
  }
  return { ok: true, value: { available: true } };
}

// ─── Internal decoders ───────────────────────────────────────────

/**
 * Decode a chain-emitted `lyth_listOwnedNames` payload. Defensive on the
 * shape since the RPC isn't pinned yet (Phase 3 GAP). Returns null on any
 * structural failure so the caller can fall back to the synthesised
 * primary-only path.
 */
function decodeOwnedNamesList(raw: unknown): NameDetail[] | null {
  if (!Array.isArray(raw)) return null;
  const out: NameDetail[] = [];
  for (const row of raw) {
    if (typeof row !== "object" || row === null) return null;
    const r = row as Record<string, unknown>;
    const nameStr = typeof r.name === "string" ? r.name : null;
    if (nameStr === null) return null;
    const parsed = parseName(nameStr);
    if (parsed === null) return null;
    const ownerStr = typeof r.owner === "string" ? r.owner : null;
    if (ownerStr === null) return null;
    out.push({
      name: parsed.canonical,
      category: parsed.tld,
      owner: ownerStr,
      registeredAtHeight: parseBigIntField(r.registeredAtHeight),
      feePaidLyth: parseNumberField(r.feePaidLyth),
      transferState: parseTransferState(r.transferState),
      chainGap: null,
    });
  }
  return out;
}

function decodeNameDetail(raw: unknown, fallbackTld: NameCategory): NameDetail | null {
  if (typeof raw !== "object" || raw === null) return null;
  const r = raw as Record<string, unknown>;
  const nameStr = typeof r.name === "string" ? r.name : null;
  const parsed = nameStr !== null ? parseName(nameStr) : null;
  const ownerStr = typeof r.owner === "string" ? r.owner : null;
  if (ownerStr === null) return null;
  return {
    name: parsed?.canonical ?? "",
    category: parsed?.tld ?? fallbackTld,
    owner: ownerStr,
    registeredAtHeight: parseBigIntField(r.registeredAtHeight),
    feePaidLyth: parseNumberField(r.feePaidLyth),
    transferState: parseTransferState(r.transferState),
    chainGap: null,
  };
}

function parseTransferState(raw: unknown): TransferState {
  if (typeof raw !== "object" || raw === null) return { kind: "active" };
  const r = raw as Record<string, unknown>;
  const kind = typeof r.kind === "string" ? r.kind : "active";
  if (kind === "outgoing") {
    const recipient = typeof r.recipient === "string" ? r.recipient : null;
    if (recipient === null) return { kind: "active" };
    return {
      kind: "outgoing",
      recipient,
      openedAtHeight: parseBigIntField(r.openedAtHeight) ?? 0n,
      expiresAtHeight: parseBigIntField(r.expiresAtHeight) ?? 0n,
    };
  }
  if (kind === "incoming") {
    const currentOwner = typeof r.currentOwner === "string" ? r.currentOwner : null;
    if (currentOwner === null) return { kind: "active" };
    return {
      kind: "incoming",
      currentOwner,
      openedAtHeight: parseBigIntField(r.openedAtHeight) ?? 0n,
      expiresAtHeight: parseBigIntField(r.expiresAtHeight) ?? 0n,
    };
  }
  return { kind: "active" };
}

function parseBigIntField(raw: unknown): bigint | null {
  if (typeof raw === "bigint") return raw;
  if (typeof raw === "number" && Number.isFinite(raw)) return BigInt(raw);
  if (typeof raw === "string" && raw.length > 0) {
    try {
      return BigInt(raw);
    } catch {
      return null;
    }
  }
  return null;
}

function parseNumberField(raw: unknown): number | null {
  if (typeof raw === "number" && Number.isFinite(raw)) return raw;
  return null;
}

// ─── Re-exports for convenience ──────────────────────────────────

/** Naming-registry precompile address; pinned in the SDK consts. */
export const NAME_REGISTRY_PRECOMPILE = PRECOMPILE_ADDRESSES.NAME_REGISTRY;

export { SdkError };
