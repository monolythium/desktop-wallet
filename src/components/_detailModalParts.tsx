// Shared parts for detail-style modals (currently `ActivityDetail`; any
// future "tap a row → see structured detail" surface can reuse these).
// Built on this wallet's design tokens (tokens.css / wallet.css): monospace
// label/value rows, the `.btn` family for the Monoscan CTA.
//
// The leading underscore in the filename follows the convention for shared
// internal building blocks that are not a page in their own right.

import { useEffect, useState } from "react";
import type { ReactNode } from "react";

import { monoscanAddressUrl, monoscanTxUrl } from "../sdk/monoscan";
import { loadReverseName } from "../sdk/reverse-name";
import { addressbookGetByAddress } from "../sdk/addressbook";
import {
  preferredAddressLabel,
  REGISTERED_CHIP_TEXT,
  REGISTERED_CHIP_TITLE,
} from "../sdk/address-label";
import { CategoryBadge, categoryOfName } from "./CategoryBadge";
import { ExternalLink } from "./ExternalLink";

// Re-exported so the existing component-layer importers keep one import site.
// The implementation lives in `sdk/truncate.ts` because `sdk/notifications.ts`
// must be able to import it without pulling in React — that constraint is
// exactly why a duplicate grew there.
export { truncMiddle } from "../sdk/truncate";

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
    <ExternalLink
      href={monoscanTxUrl(hash)}
      className="btn btn--ghost btn--full"
      style={{ marginTop: 12, textDecoration: "none", justifyContent: "center" }}
    >
      View on Monoscan
    </ExternalLink>
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
  /** Set when `name` is a quorum-verified registered name (chip + category
   *  badge). A contact label passes false — the chip is exclusively the
   *  chain-verified marker. */
  registered = false,
}: {
  addr: string;
  name?: string | null;
  registered?: boolean;
}) {
  const [copied, setCopied] = useState(false);
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
        <span style={{ display: "inline-flex", alignItems: "center" }}>
          <span
            style={{
              fontFamily: "var(--f-sans)",
              fontWeight: 600,
              color: registered ? "rgba(var(--gold-glow), 1)" : "var(--fg-100)",
            }}
          >
            {name}
          </span>
          {registered ? (
            <>
              <span
                data-testid="name-chip"
                title={REGISTERED_CHIP_TITLE}
                style={{
                  marginLeft: 6,
                  fontSize: 9,
                  fontWeight: 600,
                  textTransform: "uppercase",
                  letterSpacing: "0.08em",
                  padding: "1px 5px",
                  borderRadius: 4,
                  border: "1px solid rgba(var(--gold-glow), 0.5)",
                  color: "rgba(var(--gold-glow), 1)",
                }}
              >
                {REGISTERED_CHIP_TEXT}
              </span>
              <CategoryBadge category={categoryOfName(name)} />
            </>
          ) : null}
        </span>
      ) : null}
      <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
        {/* The FULL address — the label annotates, the address stands. */}
        <ExternalLink
          href={monoscanAddressUrl(addr)}
          title={addr}
          style={{
            fontFamily: "var(--f-mono)",
            color: "var(--w-blue)",
            wordBreak: "break-all",
            textAlign: "right",
          }}
        >
          {addr}
        </ExternalLink>
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

/** Subscribe a component to an address's registry reverse name (`lyth_nameOf`,
 *  cached). Returns null until resolved / when absent — the caller shows the
 *  bare address. Re-resolves when the address changes. */
export function useReverseName(address: string | null | undefined): string | null {
  const [name, setName] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    setName(null);
    if (!address) return;
    void loadReverseName(address).then((n) => {
      if (!cancelled) setName(n);
    });
    return () => {
      cancelled = true;
    };
  }, [address]);
  return name;
}

/** A {@link CopyableAddress} that also shows the address's registry name when it
 *  has one (honest fallback to the bare address otherwise). Use anywhere a bare
 *  counterparty/owner address is displayed. */
export function NamedAddress({ addr }: { addr: string }) {
  const reverseName = useReverseName(addr);
  const [contactName, setContactName] = useState<string | null>(null);

  // The contact tier. Without it a saved contact was invisible in Activity
  // detail while visible in the Send picker — one precedence, everywhere.
  useEffect(() => {
    let cancelled = false;
    setContactName(null);
    if (!addr) return;
    void addressbookGetByAddress(addr)
      .then((c) => {
        if (!cancelled) setContactName(c?.name ?? null);
      })
      .catch(() => {
        if (!cancelled) setContactName(null); // display-only; never throws up
      });
    return () => {
      cancelled = true;
    };
  }, [addr]);

  const label = preferredAddressLabel({ reverseName, contactName });
  return (
    <CopyableAddress
      addr={addr}
      name={label?.label ?? null}
      registered={label?.kind === "registered"}
    />
  );
}
