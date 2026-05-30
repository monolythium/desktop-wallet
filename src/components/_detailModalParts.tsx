// Shared parts for detail-style modals (currently `ActivityDetail`; any
// future "tap a row → see structured detail" surface can reuse these).
// Ported from the browser-wallet's `_detailModalParts.tsx` with the visual
// language adapted to the desktop design tokens (tokens.css / wallet.css):
// monospace label/value rows, the `.btn` family for the Monoscan CTA.
//
// The leading underscore in the filename follows the convention for shared
// internal building blocks that are not a page in their own right.

import { useState } from "react";
import type { ReactNode } from "react";

import { monoscanAddressUrl, monoscanTxUrl } from "../sdk/monoscan";

/** Middle-truncate any string (bech32m address or hash) for compact
 *  display. Pure — never throws. */
export function truncMiddle(s: string, head = 10, tail = 6): string {
  return s.length > head + tail + 1 ? `${s.slice(0, head)}…${s.slice(-tail)}` : s;
}

/** Relative timestamp ("Ns / Nm / Nh ago"). Bounded — beyond a few hours the
 *  absolute date is more informative; callers that need finer granularity
 *  pass an explicit formatted string instead. */
export function relativeMs(ms: number): string {
  const delta = Math.max(0, Date.now() - ms);
  if (delta < 60_000) return `${Math.floor(delta / 1000)}s ago`;
  if (delta < 3_600_000) return `${Math.floor(delta / 60_000)}m ago`;
  return `${Math.floor(delta / 3_600_000)}h ago`;
}

/** Two-column label/value row, monospace, used inside any detail modal. */
export function DRow({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div
      style={{
        display: "flex",
        justifyContent: "space-between",
        alignItems: "baseline",
        gap: 12,
        padding: "6px 0",
      }}
    >
      <div
        style={{
          fontFamily: "var(--f-mono)",
          fontSize: 9.5,
          color: "var(--fg-500)",
          letterSpacing: "0.1em",
          textTransform: "uppercase",
        }}
      >
        {label}
      </div>
      <div
        style={{
          fontFamily: "var(--f-mono)",
          fontSize: 11,
          color: "var(--fg-100)",
          textAlign: "right",
          wordBreak: "break-all",
          minWidth: 0,
        }}
      >
        {value}
      </div>
    </div>
  );
}

/** "View on Monoscan" CTA → the tx page. Rendered only by callers that
 *  actually know the canonical hash (honest absence otherwise). */
export function MonoscanTxButton({ hash }: { hash: string }) {
  return (
    <a
      href={monoscanTxUrl(hash)}
      target="_blank"
      rel="noopener noreferrer"
      className="btn btn--ghost btn--full"
      style={{ marginTop: 12, textDecoration: "none" }}
    >
      View on Monoscan
    </a>
  );
}

/** Truncated bech32m address → Monoscan address page, with a copy button.
 *  Takes an already-bech32m address (the desktop indexer hands counterparties
 *  as `mono…` and the wallet's own address is bech32m too). Defensive: the
 *  link/copy use the raw string and the truncation is plain slicing, so a
 *  malformed value still renders rather than crashing the view. Renders the
 *  registered/contact name when present. */
export function CopyableAddress({
  addr,
  name,
}: {
  addr: string;
  name?: string | null;
}) {
  const [copied, setCopied] = useState(false);
  const short = truncMiddle(addr);
  const onCopy = () => {
    void navigator.clipboard.writeText(addr).then(
      () => {
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      },
      () => {
        // Clipboard denied — silent; the address text is still selectable.
      },
    );
  };
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 2 }}>
      {name ? (
        <span style={{ fontFamily: "var(--f-sans)", fontWeight: 600, color: "var(--fg-100)" }}>
          {name}
        </span>
      ) : null}
      <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
        <a
          href={monoscanAddressUrl(addr)}
          target="_blank"
          rel="noopener noreferrer"
          title={addr}
          style={{ fontFamily: "var(--f-mono)", color: "var(--w-blue)" }}
        >
          {short}
        </a>
        <button
          type="button"
          onClick={onCopy}
          aria-label="Copy address"
          style={{
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            width: 18,
            height: 18,
            padding: 0,
            background: "transparent",
            border: "none",
            color: copied ? "var(--ok)" : "var(--fg-400)",
            cursor: "pointer",
            flexShrink: 0,
            fontSize: 11,
            fontFamily: "var(--f-mono)",
          }}
        >
          {copied ? "✓" : "⧉"}
        </button>
      </span>
    </div>
  );
}
