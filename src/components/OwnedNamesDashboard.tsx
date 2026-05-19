// OwnedNamesDashboard — the "Your .mono names" list on the Names page.
//
// Rows show name + category badge + transfer state + a Manage menu
// (propose transfer / cancel pending transfer / view on Monoscan).
//
// Data comes from `listOwnedNames(address)`; on the v2 testnet that
// falls back to the primary-only row tagged with a chain-gap reason
// (see naming.ts and the Phase 3 GAP plan).

import { useEffect, useState } from "react";
import {
  listOwnedNames,
  type NameDetail,
  type NameCategory,
} from "../sdk/naming";
import { formatAddressShort } from "./format";

interface Props {
  /** Address whose owned names to render. */
  address: string;
  /** Open the propose-transfer drawer for `name`. */
  onProposeTransfer?: (name: string) => void;
  /** Open the cancel-pending-transfer drawer for `name`. */
  onCancelTransfer?: (name: string) => void;
  /** Refresh trigger — bump to re-fetch (e.g. after a successful submit). */
  refreshKey?: number;
}

type State =
  | { kind: "loading" }
  | { kind: "ready"; rows: NameDetail[] }
  | { kind: "error"; message: string };

const CATEGORY_LABEL: Record<NameCategory, string> = {
  human: "Human",
  agent: "Agent",
  cluster: "Cluster",
  contract: "Contract",
  system: "System",
};

const CATEGORY_COLOR: Record<NameCategory, string> = {
  human: "var(--w-text-1)",
  agent: "var(--accent)",
  cluster: "var(--ok)",
  contract: "var(--warn)",
  system: "var(--alert)",
};

export function OwnedNamesDashboard({
  address,
  onProposeTransfer,
  onCancelTransfer,
  refreshKey,
}: Props) {
  const [state, setState] = useState<State>({ kind: "loading" });

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setState({ kind: "loading" });
      const out = await listOwnedNames(address);
      if (cancelled) return;
      if (!out.ok || !out.value) {
        setState({ kind: "error", message: out.error ?? "lookup failed" });
        return;
      }
      setState({ kind: "ready", rows: out.value });
    })();
    return () => {
      cancelled = true;
    };
  }, [address, refreshKey]);

  if (state.kind === "loading") {
    return (
      <div style={{ padding: 16, color: "var(--w-text-3)", fontSize: 12.5 }}>
        Loading owned names…
      </div>
    );
  }
  if (state.kind === "error") {
    return (
      <div className="w-banner error" style={{ margin: 16 }}>
        <div style={{ fontWeight: 600, marginBottom: 4 }}>Couldn't load owned names</div>
        <div style={{ fontSize: 12, color: "var(--w-text-2)" }}>{state.message}</div>
      </div>
    );
  }
  if (state.rows.length === 0) {
    return (
      <div style={{ padding: 16, color: "var(--w-text-3)", fontSize: 13 }}>
        You don't own any .mono names yet. Register one above.
      </div>
    );
  }
  return (
    <div className="w-owned-names" role="list">
      {state.rows.map((row) => (
        <NameRow
          key={row.name}
          row={row}
          onProposeTransfer={onProposeTransfer}
          onCancelTransfer={onCancelTransfer}
        />
      ))}
    </div>
  );
}

function NameRow({
  row,
  onProposeTransfer,
  onCancelTransfer,
}: {
  row: NameDetail;
  onProposeTransfer?: (name: string) => void;
  onCancelTransfer?: (name: string) => void;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const transferLabel = transferStateLabel(row);
  return (
    <div
      role="listitem"
      tabIndex={0}
      aria-label={`${row.name} — ${row.category}, ${transferLabel.text}`}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          setMenuOpen((v) => !v);
        }
        if (e.key === "Escape") setMenuOpen(false);
      }}
      className="w-owned-names__row"
      style={{
        display: "grid",
        gridTemplateColumns: "1fr auto auto auto",
        alignItems: "center",
        gap: 12,
        padding: "10px 14px",
        borderBottom: "1px solid var(--w-border)",
      }}
    >
      <div>
        <div className="mono" style={{ fontSize: 13, fontWeight: 500 }}>
          {row.name}
        </div>
        {row.registeredAtHeight !== null ? (
          <div className="cap" style={{ marginTop: 2 }}>
            Registered at block #{row.registeredAtHeight.toString()}
          </div>
        ) : row.chainGap ? (
          <div className="cap" style={{ marginTop: 2, color: "var(--w-text-3)" }}>
            [mock] {row.chainGap}
          </div>
        ) : null}
      </div>
      <span
        className="cap"
        style={{
          padding: "2px 8px",
          borderRadius: 10,
          border: "1px solid var(--w-border)",
          color: CATEGORY_COLOR[row.category],
        }}
      >
        {CATEGORY_LABEL[row.category]}
      </span>
      <span
        className="cap"
        style={{ color: transferLabel.color, fontSize: 11.5 }}
        title={transferLabel.title}
      >
        {transferLabel.text}
      </span>
      <div style={{ position: "relative" }}>
        <button
          type="button"
          className="btn btn--sm btn--ghost"
          aria-haspopup="menu"
          aria-expanded={menuOpen}
          onClick={() => setMenuOpen((v) => !v)}
        >
          Manage ▾
        </button>
        {menuOpen ? (
          <div
            role="menu"
            className="w-owned-names__menu"
            style={{
              position: "absolute",
              top: "calc(100% + 4px)",
              right: 0,
              minWidth: 180,
              background: "var(--w-surface)",
              border: "1px solid var(--w-border)",
              borderRadius: 6,
              padding: 4,
              boxShadow: "0 4px 12px rgba(0,0,0,0.15)",
              zIndex: 10,
            }}
            onMouseLeave={() => setMenuOpen(false)}
          >
            {row.transferState.kind === "outgoing" ? (
              <MenuButton
                onClick={() => {
                  setMenuOpen(false);
                  onCancelTransfer?.(row.name);
                }}
              >
                Cancel pending transfer
              </MenuButton>
            ) : (
              <MenuButton
                onClick={() => {
                  setMenuOpen(false);
                  onProposeTransfer?.(row.name);
                }}
                disabled={row.transferState.kind !== "active"}
              >
                Propose transfer
              </MenuButton>
            )}
            <MenuButton
              onClick={() => {
                setMenuOpen(false);
                window.open(
                  `https://monoscan.io/name/${row.name}`,
                  "_blank",
                  "noopener,noreferrer",
                );
              }}
            >
              View on Monoscan
            </MenuButton>
          </div>
        ) : null}
      </div>
    </div>
  );
}

function MenuButton({
  children,
  onClick,
  disabled,
}: {
  children: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onClick}
      disabled={disabled}
      style={{
        display: "block",
        width: "100%",
        textAlign: "left",
        padding: "6px 10px",
        background: "transparent",
        border: "none",
        cursor: disabled ? "not-allowed" : "pointer",
        color: disabled ? "var(--w-text-3)" : "var(--w-text-1)",
        fontSize: 12.5,
      }}
    >
      {children}
    </button>
  );
}

function transferStateLabel(row: NameDetail): {
  text: string;
  color: string;
  title: string;
} {
  switch (row.transferState.kind) {
    case "active":
      return { text: "Active", color: "var(--ok)", title: "No pending transfers" };
    case "outgoing":
      return {
        text: `Outgoing → ${formatAddressShort(row.transferState.recipient)}`,
        color: "var(--warn)",
        title: `Proposed to ${row.transferState.recipient}; lapses at block #${row.transferState.expiresAtHeight}`,
      };
    case "incoming":
      return {
        text: `Incoming ← ${formatAddressShort(row.transferState.currentOwner)}`,
        color: "var(--accent)",
        title: `Proposed by ${row.transferState.currentOwner}; lapses at block #${row.transferState.expiresAtHeight}`,
      };
  }
}
