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
import { useMultisigs } from "../sdk/useMultisig";
import type { Route } from "./types";
import type { VaultSummary } from "../sdk/vault-multi";
import type { MultisigVaultSummary } from "../sdk/multisig";

interface Props {
  /** Routes the "Manage vaults" link. */
  goto?: (r: Route) => void;
  /** Opens the Add-vault flow (Commit 7 — wires this via Settings). */
  onAddVault?: () => void;
  /** Opens the Create-multisig flow. */
  onAddMultisig?: () => void;
}

export function VaultPicker({ goto, onAddVault, onAddMultisig }: Props) {
  const { state, active, select } = useVaults();
  const multisigs = useMultisigs();
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

  const multisigList = multisigs.state.multisigs;
  const activeMultisig = multisigs.active;

  if (state.status === "error" || (state.vaults.length === 0 && multisigList.length === 0)) {
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

  // Header label tracks whichever surface holds active_id.
  const headerLabel = activeMultisig?.label ?? active?.label ?? "—";

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
        <span style={{ fontWeight: 600 }}>{headerLabel}</span>
        {activeMultisig ? (
          <span
            className="cap"
            aria-label={`Multisig ${activeMultisig.threshold} of ${activeMultisig.signerCount}`}
            style={{
              padding: "1px 5px",
              borderRadius: 6,
              border: "1px solid var(--w-border)",
              color: "var(--gold-hi, var(--w-text-2))",
              fontSize: 10.5,
            }}
          >
            {activeMultisig.threshold}/{activeMultisig.signerCount}
          </span>
        ) : null}
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
            minWidth: 280,
            background: "var(--w-surface)",
            border: "1px solid var(--w-border)",
            borderRadius: 6,
            padding: 4,
            boxShadow: "0 4px 16px rgba(0, 0, 0, 0.15)",
            zIndex: 20,
          }}
        >
          {state.vaults.length > 0 ? (
            <div
              className="cap"
              style={{
                padding: "6px 10px 2px",
                color: "var(--w-text-3)",
                fontSize: 10.5,
              }}
            >
              Single-signer
            </div>
          ) : null}
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
          {multisigList.length > 0 ? (
            <>
              <div
                style={{
                  borderTop: "1px solid var(--w-border)",
                  margin: "4px 0",
                }}
              />
              <div
                className="cap"
                style={{
                  padding: "6px 10px 2px",
                  color: "var(--w-text-3)",
                  fontSize: 10.5,
                }}
              >
                Multisig
              </div>
              {multisigList.map((ms) => (
                <MultisigRow
                  key={ms.id}
                  multisig={ms}
                  onClick={async () => {
                    setOpen(false);
                    if (!ms.isActive) await multisigs.select(ms.id);
                  }}
                />
              ))}
            </>
          ) : null}
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
          {onAddMultisig ? (
            <FooterButton
              onClick={() => {
                setOpen(false);
                onAddMultisig();
              }}
            >
              + Create multisig vault
            </FooterButton>
          ) : null}
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

function MultisigRow({
  multisig,
  onClick,
}: {
  multisig: MultisigVaultSummary;
  onClick: () => void | Promise<void>;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={() => void onClick()}
      aria-checked={multisig.isActive}
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
      <span style={{ width: 14 }}>{multisig.isActive ? "✓" : ""}</span>
      <div>
        <div
          style={{
            fontSize: 12.5,
            fontWeight: 600,
            display: "flex",
            gap: 6,
            alignItems: "center",
          }}
        >
          <span>{multisig.label}</span>
          <span
            className="cap"
            style={{
              padding: "1px 5px",
              borderRadius: 6,
              border: "1px solid var(--w-border)",
              color: "var(--gold-hi, var(--w-text-2))",
              fontSize: 10.5,
            }}
          >
            {multisig.threshold} of {multisig.signerCount}
          </span>
        </div>
        <div className="cap" style={{ marginTop: 2 }}>
          <Identity addr={multisig.address} />
        </div>
      </div>
      <span className="cap" style={{ color: "var(--w-text-3)" }}>
        {multisig.isActive ? "active" : ""}
      </span>
    </button>
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
