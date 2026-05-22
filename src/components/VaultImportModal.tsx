// Phase 7 #D20 — vault import modal.
//
// Mirror to `VaultExportModal`: paste an envelope text, enter the
// export password (sealed it) + master password (re-seals it under
// the local container), optional label override, then submit. The
// Rust side validates the envelope shape + version tag, decrypts via
// Argon2id+AES-256-GCM, and pushes the seed into the local container
// as a fresh VaultRecord.

import { useState } from "react";
import {
  VaultExportCallError,
  vaultImportBlob,
} from "../sdk/vault-export";

interface Props {
  onClose: () => void;
  onImported?: (newVaultId: string) => void;
}

export function VaultImportModal({ onClose, onImported }: Props) {
  const [envelopeText, setEnvelopeText] = useState("");
  const [exportPassword, setExportPassword] = useState("");
  const [masterPassword, setMasterPassword] = useState("");
  const [labelOverride, setLabelOverride] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  const submit = async () => {
    setError(null);
    if (!envelopeText.trim()) {
      setError("Paste the export envelope text");
      return;
    }
    if (!exportPassword) {
      setError("Export password required");
      return;
    }
    if (!masterPassword) {
      setError("Master password required");
      return;
    }
    setBusy(true);
    try {
      const id = await vaultImportBlob({
        envelopeText: envelopeText.trim(),
        exportPassword,
        masterPassword,
        labelOverride: labelOverride.trim() || undefined,
      });
      setMasterPassword("");
      setExportPassword("");
      setEnvelopeText("");
      onImported?.(id);
      setDone(true);
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
          <h3>Import vault from envelope</h3>
          <button className="btn btn--sm btn--ghost" onClick={onClose}>
            Close
          </button>
        </div>
        <div className="w-card__body">
          {done ? (
            <>
              <div className="w-banner" style={{ marginBottom: 12 }}>
                Vault imported. It now appears in your local vault list
                with its address bound to the source seed; switch to it
                from the vault picker.
              </div>
              <div style={{ display: "flex", gap: 6 }}>
                <button className="btn btn--sm btn--primary" onClick={onClose}>
                  Done
                </button>
              </div>
            </>
          ) : (
            <>
              <div className="row-help" style={{ marginBottom: 12 }}>
                Paste the export envelope below. The wallet validates
                the envelope type and shape before any decryption is
                attempted; the seed is added to your local container
                only after both the export password (matches the
                envelope) and your master password (re-seals the seed
                locally) verify.
              </div>
              <div className="cap" style={{ marginBottom: 4 }}>
                Export envelope (JSON)
              </div>
              <textarea
                className="w-live-input mono"
                value={envelopeText}
                onChange={(e) => setEnvelopeText(e.currentTarget.value)}
                rows={10}
                placeholder='{"type":"monolythium.vault.export.v1",...}'
                spellCheck={false}
                style={{
                  width: "100%",
                  fontFamily: "var(--f-mono)",
                  fontSize: 11,
                  marginBottom: 12,
                }}
              />
              <div className="cap" style={{ marginBottom: 4 }}>
                Export password (from the wallet that produced the envelope)
              </div>
              <input
                type="password"
                className="w-live-input"
                value={exportPassword}
                onChange={(e) => setExportPassword(e.currentTarget.value)}
                autoComplete="off"
                disabled={busy}
                style={{ marginBottom: 12 }}
              />
              <div className="cap" style={{ marginBottom: 4 }}>
                Local master password (re-seals the seed under your
                wallet's MEK)
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
                Label override (optional)
              </div>
              <input
                className="w-live-input"
                value={labelOverride}
                onChange={(e) => setLabelOverride(e.currentTarget.value)}
                placeholder="Leave empty to use the envelope's original label"
                disabled={busy}
                style={{ marginBottom: 12 }}
                maxLength={32}
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
                  disabled={
                    busy ||
                    !envelopeText.trim() ||
                    !exportPassword ||
                    !masterPassword
                  }
                >
                  {busy ? "Importing…" : "Import"}
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
