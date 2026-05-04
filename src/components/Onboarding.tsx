// Onboarding — first-run wallet setup. Prompts for a password, mints a
// PQM-1 24-word recovery phrase, derives the ML-DSA-65 seed with the
// TypeScript SDK, and stores only the encrypted seed in the OS keychain.
//
// Stage 4 keeps this UI minimal on purpose. Future passes will:
// - Add a confirm-back step.
// - Add hardware-bound storage (Secure Enclave / TPM).
// - Add password-strength meter once we settle on a heuristic that's
//   honest (zxcvbn-ts) rather than performative.
//
// The contract for now: this screen only renders if `keychain_unlock`
// returns `not_found` for the primary account. Once the vault is stored,
// the caller flips `done` and the main shell takes over.

import { useState } from "react";
import {
  KeychainCallError,
  PRIMARY_ACCOUNT,
  createAndStoreVault,
} from "../sdk/keychain";
import { VaultCallError } from "../sdk/vault";

interface Props {
  onDone: () => void;
}

export function Onboarding({ onDone }: Props) {
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mnemonic, setMnemonic] = useState<string | null>(null);

  const canSubmit =
    !busy && password.length >= 8 && password === confirm;

  const submit = async () => {
    if (!canSubmit) return;
    setBusy(true);
    setError(null);
    try {
      const result = await createAndStoreVault(PRIMARY_ACCOUNT, password);
      setMnemonic(result.mnemonic);
      setBusy(false);
    } catch (cause) {
      if (cause instanceof KeychainCallError || cause instanceof VaultCallError) {
        setError(cause.message);
      } else {
        setError(String(cause));
      }
      setBusy(false);
    }
  };

  return (
    <div className="w-onboarding">
      <div className="w-onboarding__card">
        {mnemonic ? (
          <>
            <div className="cap" style={{ marginBottom: 8 }}>Recovery phrase</div>
            <h1 style={{ margin: "0 0 8px" }}>Write this down</h1>
            <p style={{ margin: "0 0 18px", color: "var(--w-text-2)", fontSize: 13 }}>
              This PQM-1 phrase is the only recovery path for the encrypted
              local vault. It will not be shown again.
            </p>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "1fr 1fr",
                gap: "8px 14px",
                padding: 14,
                border: "1px solid var(--w-border)",
                borderRadius: 8,
                background: "rgba(255,255,255,0.035)",
                fontFamily: "var(--w-mono)",
                fontSize: 12,
              }}
            >
              {mnemonic.split(/\s+/).map((word, i) => (
                <div key={`${word}-${i}`} style={{ display: "grid", gridTemplateColumns: "28px 1fr", gap: 8 }}>
                  <span style={{ color: "var(--w-text-3)", textAlign: "right" }}>{i + 1}</span>
                  <span>{word}</span>
                </div>
              ))}
            </div>
            <div style={{ display: "flex", marginTop: 24 }}>
              <button
                className="btn btn--primary"
                style={{ marginLeft: "auto" }}
                onClick={onDone}
              >
                I have backed it up
              </button>
            </div>
          </>
        ) : (
          <>
        <div className="cap" style={{ marginBottom: 8 }}>First-run setup</div>
        <h1 style={{ margin: "0 0 8px" }}>Set a wallet password</h1>
        <p style={{ margin: "0 0 24px", color: "var(--w-text-2)", fontSize: 13 }}>
          The password unwraps a signing key encrypted with Argon2id and
          AES-256-GCM. We never store the password itself, only the
          encrypted vault. Pick at least 8 characters.
        </p>

        <label className="w-onboarding__field">
          <span className="cap">Password</span>
          <input
            type="password"
            autoFocus
            autoComplete="new-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void submit();
            }}
          />
        </label>

        <label className="w-onboarding__field">
          <span className="cap">Confirm</span>
          <input
            type="password"
            autoComplete="new-password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void submit();
            }}
          />
        </label>

        {password && password.length < 8 ? (
          <div className="w-banner" style={{ marginTop: 12 }}>
            Password must be at least 8 characters.
          </div>
        ) : null}
        {confirm && password !== confirm ? (
          <div className="w-banner" style={{ marginTop: 12 }}>
            Passwords do not match.
          </div>
        ) : null}
        {error ? (
          <div className="w-banner error" style={{ marginTop: 12 }}>
            {error}
          </div>
        ) : null}

        <div style={{ display: "flex", marginTop: 24 }}>
          <button
            className="btn btn--primary"
            style={{ marginLeft: "auto" }}
            disabled={!canSubmit}
            onClick={() => void submit()}
          >
            {busy ? "Sealing vault…" : "Create vault"}
          </button>
        </div>
          </>
        )}
      </div>
    </div>
  );
}
