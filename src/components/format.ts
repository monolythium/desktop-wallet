// Tiny formatting helpers used across the wallet pages.
//
// `formatAddress` and `formatAddressShort` are the canonical entry
// points for rendering any 20-byte EVM-shape address as the bech32m
// `mono1…` form mandated by whitepaper §22.7. Wire / RPC / IPC stays
// hex; only the display layer changes.
//
// The conversion delegates to `@monolythium/core-sdk`'s
// `addressToBech32` so the desktop wallet, browser wallet, monoscan,
// and any future surface share one source of truth for the codec.

import { addressToBech32, AddressError } from "@monolythium/core-sdk";

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
