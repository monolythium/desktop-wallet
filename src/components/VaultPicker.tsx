// VaultPicker — dropdown that lists vaults and lets the user switch
// between them.
//
// Anchored to a Sidebar / Topbar element. Each row: label + truncated
// bech32m address via the Phase 3 <Identity> component + checkmark on
// active. Footer CTA opens the "Add vault" flow (Commit 7); secondary
// link routes to Settings → Vaults panel (Commit 8).
//
// Reactivity: subscribes to the `useVaults` hook. Refresh fires on
// every mutation (select / create / rename / delete) so the picker
// stays in sync without a separate event bus.

import { useEffect, useRef, useState } from "react";
import { Identity } from "./Identity";
import { useVaults } from "../sdk/useVaults";
import type { Route } from "./types";
import type { VaultSummary } from "../sdk/vault-multi";

interface Props {
  /** Routes the "Manage vaults" link. */
  goto?: (r: Route) => void;
  /** Opens the Add-vault flow (Commit 7 — wires this via Settings). */
  onAddVault?: () => void;
}

export function VaultPicker({ goto, onAddVault }: Props) {
  const { state, active, select } = useVaults();
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement | null>(null);

  // Click-outside to close.
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (!wrapRef.current) return;
      if (!wrapRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    window.addEventListener("mousedown", handler);
    return () => window.removeEventListener("mousedown", handler);
  }, [open]);

  // ESC to close.
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [open]);

  if (state.status === "loading") {
    return (
      <div className="cap" style={{ color: "var(--w-text-3)" }}>
        Loading vaults…
      </div>
    );
  }

  if (state.status === "error" || state.vaults.length === 0) {
    return (
      <button
        type="button"
        className="btn btn--sm btn--ghost"
        onClick={onAddVault}
        aria-label="Add a vault"
      >
        + Add vault
      </button>
    );
  }

  return (
    <div ref={wrapRef} style={{ position: "relative" }}>
      <button
        type="button"
        className="w-vault-picker__trigger"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 6,
          padding: "4px 10px",
          border: "1px solid var(--w-border)",
          borderRadius: 6,
          background: "var(--w-surface, transparent)",
          color: "var(--w-text-1)",
          fontSize: 12.5,
          cursor: "pointer",
        }}
      >
        <span style={{ fontWeight: 600 }}>{active?.label ?? "—"}</span>
        <span className="cap" style={{ color: "var(--w-text-3)" }}>▾</span>
      </button>
      {open ? (
        <div
          role="menu"
          aria-label="Vault picker"
          style={{
            position: "absolute",
            top: "calc(100% + 4px)",
            left: 0,
            minWidth: 260,
            background: "var(--w-surface)",
            border: "1px solid var(--w-border)",
            borderRadius: 6,
            padding: 4,
            boxShadow: "0 4px 16px rgba(0, 0, 0, 0.15)",
            zIndex: 20,
          }}
        >
          {state.vaults.map((vault) => (
            <VaultRow
              key={vault.id}
              vault={vault}
              onClick={async () => {
                setOpen(false);
                if (!vault.isActive) await select(vault.id);
              }}
            />
          ))}
          <div
            style={{
              borderTop: "1px solid var(--w-border)",
              margin: "4px 0",
            }}
          />
          <FooterButton
            onClick={() => {
              setOpen(false);
              onAddVault?.();
            }}
          >
            + Add vault
          </FooterButton>
          {goto ? (
            <FooterButton
              onClick={() => {
                setOpen(false);
                goto("settings");
              }}
            >
              Manage vaults…
            </FooterButton>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function VaultRow({
  vault,
  onClick,
}: {
  vault: VaultSummary;
  onClick: () => void | Promise<void>;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={() => void onClick()}
      aria-checked={vault.isActive}
      style={{
        display: "grid",
        gridTemplateColumns: "auto 1fr auto",
        gap: 8,
        alignItems: "center",
        width: "100%",
        padding: "8px 10px",
        background: "transparent",
        border: "none",
        cursor: "pointer",
        color: "var(--w-text-1)",
        textAlign: "left",
        borderRadius: 4,
      }}
    >
      <span style={{ width: 14 }}>{vault.isActive ? "✓" : ""}</span>
      <div>
        <div style={{ fontSize: 12.5, fontWeight: 600 }}>{vault.label}</div>
        <div className="cap" style={{ marginTop: 2 }}>
          <Identity addr={vault.address} />
        </div>
      </div>
      <span className="cap" style={{ color: "var(--w-text-3)" }}>
        {vault.isActive ? "active" : ""}
      </span>
    </button>
  );
}

function FooterButton({
  children,
  onClick,
}: {
  children: React.ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onClick}
      style={{
        display: "block",
        width: "100%",
        textAlign: "left",
        padding: "8px 10px",
        background: "transparent",
        border: "none",
        cursor: "pointer",
        color: "var(--w-text-2)",
        fontSize: 12.5,
        borderRadius: 4,
      }}
    >
      {children}
    </button>
  );
}
