// Phase 7 #D20 — vault export modal.
//
// Three-phase flow:
//   1. Input — user enters master password + a fresh export password.
//   2. Envelope — wallet renders the textual JSON envelope with a
//      copy-to-clipboard button.
//   3. Done — user closes after confirming they've saved the envelope.
//
// Plain text (no file dialog) — matches the off-band envelope pattern
// from Phase 6 and avoids adding a Tauri dialog plugin to the npm dep
// graph. The user saves to a `.mono-vault` file via their OS by
// pasting into a text editor.

import { useState } from "react";
import {
  VaultExportCallError,
  vaultExportBlob,
} from "../sdk/vault-export";
import type { VaultSummary } from "../sdk/vault-multi";

interface Props {
  vault: VaultSummary;
  onClose: () => void;
}

export function VaultExportModal({ vault, onClose }: Props) {
  const [masterPassword, setMasterPassword] = useState("");
  const [exportPassword, setExportPassword] = useState("");
  const [confirmExport, setConfirmExport] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [envelope, setEnvelope] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const submit = async () => {
    setError(null);
    if (!masterPassword) {
      setError("Master password required");
      return;
    }
    if (!exportPassword) {
      setError("Export password required");
      return;
    }
    if (exportPassword.length < 8) {
      setError("Export password must be at least 8 characters");
      return;
    }
    if (exportPassword !== confirmExport) {
      setError("Export password and confirmation don't match");
      return;
    }
    setBusy(true);
    try {
      const env = await vaultExportBlob({
        vaultId: vault.id,
        masterPassword,
        exportPassword,
      });
      setEnvelope(env);
      // Wipe passwords from React state as soon as the envelope is in
      // hand — best-effort hygiene; the GC will free the underlying
      // string at the next opportunity.
      setMasterPassword("");
      setExportPassword("");
      setConfirmExport("");
    } catch (cause) {
      const msg =
        cause instanceof VaultExportCallError
          ? cause.message
          : (cause as Error)?.message ?? String(cause);
      setError(msg);
    } finally {
      setBusy(false);
    }
  };

  return (
    <ModalOverlay onDismiss={onClose}>
      <div className="w-card">
        <div className="w-card__head">
          <h3>Export vault — {vault.label}</h3>
          <button className="btn btn--sm btn--ghost" onClick={onClose}>
            Close
          </button>
        </div>
        <div className="w-card__body">
          {envelope === null ? (
            <>
              <div className="w-banner" style={{ marginBottom: 12 }}>
                The export envelope contains the encrypted ML-DSA-65 seed
                of this vault, sealed under a fresh password you pick
                below. The wallet's master password is never written into
                the envelope.
              </div>
              <div className="cap" style={{ marginBottom: 4 }}>
                Master password (to unseal the vault)
              </div>
              <input
                type="password"
                className="w-live-input"
                value={masterPassword}
                onChange={(e) => setMasterPassword(e.currentTarget.value)}
                autoComplete="current-password"
                disabled={busy}
                style={{ marginBottom: 12 }}
              />
              <div className="cap" style={{ marginBottom: 4 }}>
                Export password (8+ chars, independent of master)
              </div>
              <input
                type="password"
                className="w-live-input"
                value={exportPassword}
                onChange={(e) => setExportPassword(e.currentTarget.value)}
                autoComplete="new-password"
                disabled={busy}
                style={{ marginBottom: 12 }}
              />
              <div className="cap" style={{ marginBottom: 4 }}>
                Confirm export password
              </div>
              <input
                type="password"
                className="w-live-input"
                value={confirmExport}
                onChange={(e) => setConfirmExport(e.currentTarget.value)}
                autoComplete="new-password"
                disabled={busy}
                style={{ marginBottom: 12 }}
              />
              {error ? (
                <div className="w-banner error" style={{ marginBottom: 12 }}>
                  ✗ {error}
                </div>
              ) : null}
              <div style={{ display: "flex", gap: 6 }}>
                <button
                  className="btn btn--sm btn--primary"
                  onClick={() => void submit()}
                  disabled={busy || !masterPassword || !exportPassword}
                >
                  {busy ? "Encrypting…" : "Export"}
                </button>
                <button
                  className="btn btn--sm btn--ghost"
                  onClick={onClose}
                  disabled={busy}
                >
                  Cancel
                </button>
              </div>
            </>
          ) : (
            <>
              <div className="row-help" style={{ marginBottom: 12 }}>
                Save this text to a secure location (encrypted notes app,
                password manager, air-gapped USB). Anyone with the export
                password can reconstruct this vault — keep both the
                envelope AND the password safe and separate.
              </div>
              <textarea
                className="w-live-input mono"
                value={envelope}
                readOnly
                rows={16}
                spellCheck={false}
                style={{
                  width: "100%",
                  fontFamily: "var(--f-mono)",
                  fontSize: 11,
                  marginBottom: 12,
                }}
              />
              <div style={{ display: "flex", gap: 6 }}>
                <button
                  className="btn btn--sm btn--primary"
                  onClick={async () => {
                    try {
                      await navigator.clipboard.writeText(envelope);
                      setCopied(true);
                      setTimeout(() => setCopied(false), 1500);
                    } catch {
                      setCopied(false);
                    }
                  }}
                >
                  {copied ? "Copied ✓" : "Copy to clipboard"}
                </button>
                <button className="btn btn--sm btn--ghost" onClick={onClose}>
                  Done
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </ModalOverlay>
  );
}

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
      <div style={{ width: "100%", maxWidth: 560 }}>{children}</div>
    </div>
  );
}
