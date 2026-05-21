// VaultsPanel — Settings card listing every vault with rename + delete
// actions per row.
//
// Rename: inline editable label (click "Rename" → label becomes an
// input → "Save" persists via vault_rename).
// Delete: opens a confirm modal that requires the last-4 chars of the
// lowercased address — matches the Rust-side `confirm_token` check.
// Last-vault protection is enforced both client-side (disabled button)
// and Rust-side (InvalidArgument). Active-vault deletion is allowed;
// the post-delete reload picks a new active automatically.

import { useState } from "react";
import { Identity } from "./Identity";
import { VaultCreateFlow } from "./VaultCreateFlow";
import { MultisigCreateFlow } from "./MultisigCreateFlow";
import { ChangeThresholdModal } from "./ChangeThresholdModal";
import { useVaults } from "../sdk/useVaults";
import { useMultisigs } from "../sdk/useMultisig";
import {
  MultiVaultCallError,
  type VaultSummary,
} from "../sdk/vault-multi";
import type { MultisigVaultSummary } from "../sdk/multisig";

export function VaultsPanel() {
  const vaults = useVaults();
  const multisigs = useMultisigs();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [showCreateMultisig, setShowCreateMultisig] = useState(false);

  if (vaults.state.status === "loading") {
    return (
      <div className="w-card">
        <div className="w-card__head">
          <h3>Vaults</h3>
        </div>
        <div className="w-card__body" style={{ color: "var(--w-text-3)", fontSize: 12.5 }}>
          Loading vaults…
        </div>
      </div>
    );
  }

  const vaultList = vaults.state.vaults;
  const multisigList = multisigs.state.multisigs;
  const onlyOne = vaultList.length <= 1;

  return (
    <div className="w-card">
      <div className="w-card__head">
        <h3>Vaults</h3>
        <span className="cap" style={{ color: "var(--w-text-3)" }}>
          {vaultList.length} {vaultList.length === 1 ? "vault" : "vaults"}
          {multisigList.length > 0
            ? ` · ${multisigList.length} multisig`
            : ""}
        </span>
        <span className="w-card__head__spacer" />
        <button className="btn btn--sm" onClick={() => setShowCreate(true)}>
          + Add vault
        </button>
        <button
          className="btn btn--sm"
          onClick={() => setShowCreateMultisig(true)}
          style={{ marginLeft: 6 }}
        >
          + Add multisig
        </button>
      </div>
      <div className="w-card__body" style={{ padding: 0 }}>
        {vaultList.length === 0 ? (
          <div style={{ padding: 16, color: "var(--w-text-3)", fontSize: 12.5 }}>
            No vaults yet. Add one to get started.
          </div>
        ) : (
          vaultList.map((vault) => (
            <VaultRow
              key={vault.id}
              vault={vault}
              isOnly={onlyOne}
              isEditing={editingId === vault.id}
              onStartRename={() => setEditingId(vault.id)}
              onCancelRename={() => setEditingId(null)}
              onCommitRename={async (newLabel) => {
                await vaults.rename(vault.id, newLabel);
                setEditingId(null);
              }}
              onStartDelete={() => setDeletingId(vault.id)}
            />
          ))
        )}
        {multisigList.length > 0 ? (
          <>
            <div
              className="cap"
              style={{
                padding: "12px 14px 6px",
                color: "var(--w-text-3)",
                borderTop: "1px solid var(--w-border)",
                background: "var(--w-surface, transparent)",
                fontSize: 10.5,
              }}
            >
              Multisig vaults
            </div>
            {multisigList.map((m) => (
              <MultisigPanelRow key={m.id} multisig={m} />
            ))}
          </>
        ) : null}
      </div>

      {showCreate ? (
        <ModalOverlay onDismiss={() => setShowCreate(false)}>
          <VaultCreateFlow
            isFirstVault={vaultList.length === 0}
            onClose={() => setShowCreate(false)}
          />
        </ModalOverlay>
      ) : null}

      {showCreateMultisig ? (
        <ModalOverlay onDismiss={() => setShowCreateMultisig(false)}>
          <MultisigCreateFlow onClose={() => setShowCreateMultisig(false)} />
        </ModalOverlay>
      ) : null}

      {deletingId ? (
        <DeleteConfirmModal
          vault={vaultList.find((v) => v.id === deletingId) ?? null}
          onClose={() => setDeletingId(null)}
          onConfirm={async (confirmToken) => {
            const id = deletingId;
            if (!id) return;
            await vaults.remove(id, confirmToken);
            setDeletingId(null);
          }}
        />
      ) : null}
    </div>
  );
}

function MultisigPanelRow({ multisig }: { multisig: MultisigVaultSummary }) {
  const [thresholdOpen, setThresholdOpen] = useState(false);
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "1fr auto auto",
        gap: 12,
        alignItems: "center",
        padding: "10px 14px",
        borderBottom: "1px solid var(--w-border)",
      }}
    >
      <div>
        <div
          style={{
            fontSize: 13,
            fontWeight: 600,
            display: "flex",
            gap: 8,
            alignItems: "center",
          }}
        >
          <span>{multisig.label}</span>
          <span
            className="cap"
            style={{
              padding: "1px 6px",
              borderRadius: 8,
              border: "1px solid var(--w-border)",
              color: "var(--gold-hi, var(--w-text-2))",
            }}
          >
            {multisig.threshold} of {multisig.signerCount}
          </span>
          {multisig.isActive ? (
            <span
              className="cap"
              style={{
                padding: "1px 6px",
                borderRadius: 8,
                border: "1px solid var(--w-border)",
                color: "var(--ok)",
              }}
            >
              active
            </span>
          ) : null}
          {multisig.pendingProposalCount > 0 ? (
            <span
              className="cap"
              style={{
                padding: "1px 6px",
                borderRadius: 8,
                border: "1px solid var(--w-border)",
                color: "var(--alert)",
              }}
            >
              {multisig.pendingProposalCount} pending
            </span>
          ) : null}
        </div>
        <div className="cap" style={{ marginTop: 2 }}>
          <Identity addr={multisig.address} />
        </div>
      </div>
      <span className="cap" style={{ color: "var(--w-text-3)" }}>
        {multisig.signerCount} signers
      </span>
      <button
        className="btn btn--sm btn--ghost"
        onClick={() => setThresholdOpen(true)}
      >
        Change threshold
      </button>
      {thresholdOpen ? (
        <ChangeThresholdModal
          multisig={multisig}
          onClose={() => setThresholdOpen(false)}
        />
      ) : null}
    </div>
  );
}

// ─── Row ───────────────────────────────────────────────────────────

function VaultRow({
  vault,
  isOnly,
  isEditing,
  onStartRename,
  onCancelRename,
  onCommitRename,
  onStartDelete,
}: {
  vault: VaultSummary;
  isOnly: boolean;
  isEditing: boolean;
  onStartRename: () => void;
  onCancelRename: () => void;
  onCommitRename: (newLabel: string) => Promise<void>;
  onStartDelete: () => void;
}) {
  const [draftLabel, setDraftLabel] = useState(vault.label);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "1fr auto auto auto",
        gap: 12,
        alignItems: "center",
        padding: "10px 14px",
        borderBottom: "1px solid var(--w-border)",
      }}
    >
      <div>
        {isEditing ? (
          <input
            className="w-live-input"
            value={draftLabel}
            onChange={(e) => setDraftLabel(e.currentTarget.value)}
            autoFocus
            style={{ width: "100%", maxWidth: 240 }}
          />
        ) : (
          <div style={{ fontSize: 13, fontWeight: 600 }}>
            {vault.label}
            {vault.isActive ? (
              <span
                className="cap"
                style={{
                  marginLeft: 8,
                  padding: "1px 6px",
                  borderRadius: 8,
                  border: "1px solid var(--w-border)",
                  color: "var(--ok)",
                }}
              >
                active
              </span>
            ) : null}
          </div>
        )}
        <div className="cap" style={{ marginTop: 2 }}>
          <Identity addr={vault.address} />
        </div>
        {error ? (
          <div className="cap" style={{ color: "var(--alert)", marginTop: 4 }}>
            ✗ {error}
          </div>
        ) : null}
      </div>
      {isEditing ? (
        <>
          <button
            className="btn btn--sm btn--primary"
            onClick={async () => {
              setBusy(true);
              setError(null);
              try {
                if (draftLabel.trim().length === 0) {
                  setError("Label cannot be empty");
                  return;
                }
                await onCommitRename(draftLabel.trim());
              } catch (cause) {
                setError(
                  cause instanceof MultiVaultCallError
                    ? cause.message
                    : (cause as Error)?.message ?? String(cause),
                );
              } finally {
                setBusy(false);
              }
            }}
            disabled={busy}
          >
            Save
          </button>
          <button className="btn btn--sm btn--ghost" onClick={onCancelRename}>
            Cancel
          </button>
          <span />
        </>
      ) : (
        <>
          <button className="btn btn--sm btn--ghost" onClick={onStartRename}>
            Rename
          </button>
          <button
            className="btn btn--sm btn--ghost"
            onClick={onStartDelete}
            disabled={isOnly}
            title={
              isOnly ? "Add another vault before deleting this one" : undefined
            }
            style={{ color: isOnly ? "var(--w-text-3)" : "var(--alert)" }}
          >
            Delete
          </button>
          <span />
        </>
      )}
    </div>
  );
}

// ─── Delete confirm modal ──────────────────────────────────────────

function DeleteConfirmModal({
  vault,
  onClose,
  onConfirm,
}: {
  vault: VaultSummary | null;
  onClose: () => void;
  onConfirm: (confirmToken: string) => Promise<void>;
}) {
  const [token, setToken] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  if (!vault) return null;
  const expected = vault.address.slice(-4).toLowerCase();
  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      await onConfirm(token.trim());
    } catch (cause) {
      setError(
        cause instanceof MultiVaultCallError
          ? cause.message
          : (cause as Error)?.message ?? String(cause),
      );
    } finally {
      setBusy(false);
    }
  };
  return (
    <ModalOverlay onDismiss={onClose}>
      <div className="w-card" style={{ borderColor: "var(--alert)" }}>
        <div className="w-card__head">
          <h3>Delete vault — {vault.label}</h3>
          <button className="btn btn--sm btn--ghost" onClick={onClose}>
            Cancel
          </button>
        </div>
        <div className="w-card__body">
          <div className="w-banner error" style={{ marginBottom: 12 }}>
            This is irreversible. The sealed key material is purged on
            commit; without the original recovery phrase the funds in
            this vault become unrecoverable.
          </div>
          <div className="cap" style={{ marginBottom: 4 }}>
            Address
          </div>
          <div className="mono" style={{ fontSize: 12.5, marginBottom: 12 }}>
            {vault.address}
          </div>
          <label className="cap">
            Type the last 4 characters of the address to confirm:
            <span className="mono" style={{ marginLeft: 6 }}>
              {expected}
            </span>
          </label>
          <input
            className="w-live-input mono"
            value={token}
            onChange={(e) => setToken(e.currentTarget.value.toLowerCase())}
            placeholder={expected}
            autoFocus
            style={{ marginTop: 4 }}
            spellCheck={false}
            autoCapitalize="off"
          />
          {error ? (
            <div className="cap" style={{ color: "var(--alert)", marginTop: 8 }}>
              ✗ {error}
            </div>
          ) : null}
          <div style={{ display: "flex", gap: 6, marginTop: 16 }}>
            <button
              className="btn btn--sm"
              style={{ background: "var(--alert)", color: "white" }}
              onClick={submit}
              disabled={busy || token !== expected}
            >
              {busy ? "Deleting…" : "Delete this vault"}
            </button>
            <button className="btn btn--sm btn--ghost" onClick={onClose}>
              Cancel
            </button>
          </div>
        </div>
      </div>
    </ModalOverlay>
  );
}

// ─── Shared modal overlay ──────────────────────────────────────────

function ModalOverlay({
  children,
  onDismiss,
}: {
  children: React.ReactNode;
  onDismiss: () => void;
}) {
  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.45)",
        display: "flex",
        alignItems: "flex-start",
        justifyContent: "center",
        zIndex: 100,
        padding: 40,
        overflowY: "auto",
      }}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onDismiss();
      }}
    >
      <div style={{ width: "100%", maxWidth: 520 }}>{children}</div>
    </div>
  );
}
