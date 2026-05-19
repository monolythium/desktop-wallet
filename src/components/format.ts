// Tiny formatting helpers used across the wallet pages.
//
// `formatAddress` and `formatAddressShort` are the canonical entry
// points for rendering any 20-byte EVM-shape address as the bech32m
// `mono1…` form mandated by whitepaper §22.7. Wire / RPC / IPC stays
// hex; only the display layer changes.
//
// Phase 3 adds `useIdentityLabel` + `formatIdentity` — the §22.8-aware
// unified display. Prefers a registered `.mono` name (via the
// `lookupAddress` SDK reader) when one exists; falls back to
// `formatAddressShort` (bech32m) otherwise. Names are display only —
// bech32m remains the hover-title + copy target so the user can always
// see / copy the canonical address form. A small in-process cache with
// 5-minute TTL keeps the resolution per-address (one RPC per unique
// counterparty per 5 minutes).
//
// The conversion delegates to `@monolythium/core-sdk`'s
// `addressToBech32` so the desktop wallet, browser wallet, monoscan,
// and any future surface share one source of truth for the codec.

import { useEffect, useState } from "react";
import { addressToBech32, AddressError, normalizeAddressHex } from "@monolythium/core-sdk";
import { lookupAddress, type NameBinding } from "../sdk/naming";

export function fmt(n: number | null | undefined, frac = 2): string {
  if (n === null || n === undefined) return "—";
  return n.toLocaleString(undefined, {
    minimumFractionDigits: frac,
    maximumFractionDigits: frac,
  });
}

export function pct(x: number, d = 1): string {
  return `${(x * 100).toFixed(d)}%`;
}

export function shortHex(hex: string, head = 6, tail = 4): string {
  if (hex.length <= head + tail + 3) return hex;
  return `${hex.slice(0, head)}…${hex.slice(-tail)}`;
}

/**
 * Convert a 20-byte EVM-shape hex address to the bech32m `mono1…`
 * form. Pass-through for anything that isn't a 0x-shaped address
 * (already-bech32m, demo strings, names) and for null/empty (renders
 * as an em-dash). Never throws — render sites must keep rendering
 * even if upstream hands us a malformed value; we'd rather show the
 * raw input than crash the page.
 */
export function formatAddress(addr: string | null | undefined): string {
  if (!addr) return "—";
  if (!(addr.startsWith("0x") || addr.startsWith("0X"))) return addr;
  // SDK's `addressToBech32` requires a lowercase 0x prefix. Normalize
  // before delegation so `0X…`-prefixed inputs (e.g. from a paste of
  // an uppercased explorer URL) still convert cleanly.
  const normalized = "0x" + addr.slice(2);
  try {
    return addressToBech32(normalized);
  } catch (cause) {
    // Malformed hex (wrong length, non-hex chars). Pass through so the
    // user can still see what was passed in — a render-time crash here
    // would hide the underlying bug.
    if (cause instanceof AddressError) return addr;
    return addr;
  }
}

/**
 * Send-recipient parser.
 *
 * Accepts either a 0x-prefixed hex address (EIP-55 checksum honoured
 * by the SDK's `normalizeAddressHex`) or a bech32m `mono1…` string
 * (checksum + HRP-checked by the SDK). Returns a discriminated value
 * so the caller doesn't have to wrap the SDK throw in a try/catch.
 *
 * The internal wire format is hex — every code path that hands off to
 * a signer or RPC pipes through the `hex` field. The bech32m form
 * exists purely as a user-input convenience.
 *
 * Error messages match what a paste-target field needs to display
 * directly:
 *
 *   "" / null                → "Recipient is required"
 *   not 0x / mono1            → "Address must start with 'mono1' or '0x'"
 *   bad mono1 checksum        → "Invalid mono1 address"
 *   bad hex shape / checksum  → "Invalid address"
 *
 * The discriminant is `ok: boolean` so TypeScript narrows reliably
 * across every caller (the `ok === true` branch carries `hex`, the
 * `ok === false` branch carries `error`).
 */
export type ParsedRecipient =
  | { ok: true; hex: string }
  | { ok: false; error: string };

export function parseRecipient(input: string | null | undefined): ParsedRecipient {
  if (input === null || input === undefined) {
    return { ok: false, error: "Recipient is required" };
  }
  const trimmed = input.trim();
  if (trimmed.length === 0) {
    return { ok: false, error: "Recipient is required" };
  }
  // Format dispatch — unambiguous because bech32m's body charset
  // (`qpzry9x8gf2tvdw0s3jn54khce6mua7l`) doesn't include the prefix
  // characters of `0x`, and bech32m strings always carry their HRP
  // (lowercase or uppercase, but not mixed) in front of the first `1`.
  if (trimmed.startsWith("0x") || trimmed.startsWith("0X")) {
    try {
      // SDK requires lowercase 0x prefix; honour the EIP-55 checksum
      // on mixed-case input as well.
      const hex = normalizeAddressHex("0x" + trimmed.slice(2));
      return { ok: true, hex };
    } catch (cause) {
      if (cause instanceof AddressError) return { ok: false, error: "Invalid address" };
      return { ok: false, error: "Invalid address" };
    }
  }
  if (trimmed.toLowerCase().startsWith("mono1")) {
    try {
      const hex = normalizeAddressHex(trimmed);
      return { ok: true, hex };
    } catch (cause) {
      if (cause instanceof AddressError) return { ok: false, error: "Invalid mono1 address" };
      return { ok: false, error: "Invalid mono1 address" };
    }
  }
  return { ok: false, error: "Address must start with 'mono1' or '0x'" };
}

/**
 * Compact bech32m form for cramped UI (sidebars, table cells). Keeps
 * the `mono1` prefix visible so the user always sees the network, and
 * the last 4 charset chars of the body so the user can compare a
 * recipient at a glance. Mirrors browser-wallet's `shortBech32m`
 * shape (8-char prefix · ellipsis · 4-char suffix).
 *
 * Falls back to plain `shortHex` for any input that isn't a 0x-shaped
 * address — bech32m strings stay full-length (they're already short),
 * names stay full-length, everything else gets `shortHex`-truncated.
 */
export function formatAddressShort(addr: string | null | undefined, prefixChars = 8): string {
  if (!addr) return "—";
  if (!(addr.startsWith("0x") || addr.startsWith("0X"))) {
    // Already bech32m or a name — display as-is up to a reasonable cap.
    if (addr.length <= 32) return addr;
    return shortHex(addr, 14, 4);
  }
  const normalized = "0x" + addr.slice(2);
  try {
    const full = addressToBech32(normalized);
    // bech32m for a 20-byte address is "mono1" + 32 body + 6 checksum
    // = 43 chars. The compact form keeps the HRP + prefix + last 4
    // body chars visible.
    const hrp = "mono1";
    const body = full.slice(hrp.length);
    if (prefixChars <= 0 || body.length <= prefixChars + 4 + 1) return full;
    return `${hrp}${body.slice(0, prefixChars)}…${body.slice(-4)}`;
  } catch {
    return shortHex(addr);
  }
}

// ─── Unified identity display (§22.8 names + §22.7 bech32m) ──────

/** Per-address cache entry. `binding === null` means "we asked and the
 *  chain said no name registered" — distinct from "we haven't asked
 *  yet" (entry absent from the map). */
interface IdentityCacheEntry {
  binding: NameBinding | null;
  cachedAtMs: number;
}

/** 5-minute TTL — long enough to avoid hammering the RPC on every
 *  re-render of a long activity list, short enough that a freshly
 *  registered name surfaces within a few minutes of registration. */
const IDENTITY_TTL_MS = 5 * 60 * 1000;

/** In-process identity cache. Module-level so it survives across
 *  component re-mounts but is wiped on full page reload. Address keys
 *  are stored lowercased. */
const identityCache = new Map<string, IdentityCacheEntry>();

/** Reset the identity cache. Test-only; production code never calls
 *  this. */
export function _resetIdentityCacheForTest(): void {
  identityCache.clear();
}

/**
 * Hook: resolve `addr` to its registered .mono name (if any) and
 * surface the result as a sync render value. Returns:
 *
 *   - `{ name: "alice.mono", isName: true }` on a hit
 *   - `{ name: "mono1…", isName: false }` on a confirmed miss
 *   - `{ name: "mono1…", isName: false, pending: true }` while the
 *     first resolution is in-flight (initial render)
 *
 * The cache is shared across every component that uses this hook, so
 * the same address resolves once per 5-minute window regardless of
 * how many sites it renders at.
 */
export function useIdentityLabel(addr: string | null | undefined): {
  /** What to render — either the .mono name or the bech32m short form. */
  name: string;
  /** True iff the rendered value is a §22.8 name. */
  isName: boolean;
  /** True while the first resolution is in-flight (renders the
   *  bech32m fallback immediately, refines once the chain answers). */
  pending: boolean;
} {
  // Stable bech32m fallback. Computed sync so the first render is
  // never an empty string.
  const fallback = formatAddressShort(addr);
  const [resolved, setResolved] = useState<{
    name: string;
    isName: boolean;
    pending: boolean;
  }>(() => initialFromCache(addr, fallback));

  useEffect(() => {
    if (!addr || typeof addr !== "string") {
      setResolved({ name: fallback, isName: false, pending: false });
      return;
    }
    // Normalize to lowercased hex for cache keying; if the input is
    // bech32m or anything else, skip the cache (we can't reverse-resolve
    // a non-hex without the SDK roundtrip).
    let hexKey: string;
    try {
      if (addr.toLowerCase().startsWith("0x")) {
        hexKey = normalizeAddressHex("0x" + addr.slice(2)).toLowerCase();
      } else {
        // bech32m or other — fall back without trying to cache.
        setResolved({ name: fallback, isName: false, pending: false });
        return;
      }
    } catch {
      setResolved({ name: fallback, isName: false, pending: false });
      return;
    }
    const now = Date.now();
    const cached = identityCache.get(hexKey);
    if (cached && now - cached.cachedAtMs < IDENTITY_TTL_MS) {
      setResolved({
        name: cached.binding ? cached.binding.name : fallback,
        isName: cached.binding !== null,
        pending: false,
      });
      return;
    }
    // Cache miss / expired — show fallback immediately, kick off the
    // resolution.
    setResolved({ name: fallback, isName: false, pending: true });
    let cancelled = false;
    (async () => {
      const out = await lookupAddress(hexKey);
      if (cancelled) return;
      const binding = out.ok ? out.value ?? null : null;
      identityCache.set(hexKey, { binding, cachedAtMs: Date.now() });
      setResolved({
        name: binding ? binding.name : fallback,
        isName: binding !== null,
        pending: false,
      });
    })();
    return () => {
      cancelled = true;
    };
  }, [addr, fallback]);

  return resolved;
}

function initialFromCache(
  addr: string | null | undefined,
  fallback: string,
): { name: string; isName: boolean; pending: boolean } {
  if (!addr || typeof addr !== "string") {
    return { name: fallback, isName: false, pending: false };
  }
  if (!addr.toLowerCase().startsWith("0x")) {
    return { name: fallback, isName: false, pending: false };
  }
  try {
    const hexKey = normalizeAddressHex("0x" + addr.slice(2)).toLowerCase();
    const cached = identityCache.get(hexKey);
    if (cached && Date.now() - cached.cachedAtMs < IDENTITY_TTL_MS) {
      return {
        name: cached.binding ? cached.binding.name : fallback,
        isName: cached.binding !== null,
        pending: false,
      };
    }
  } catch {
    // fall through
  }
  return { name: fallback, isName: false, pending: true };
}

