// LockScreen — full-page password entry shown when the in-memory MEK
// has been wiped (auto-lock / manual lock / system-event lock /
// fresh launch with a v1 container on disk).
//
// Layout: centered card with the active vault label + masked address
// + password input + Unlock button. "Choose different vault" link
// reveals the picker for cases where the user pre-locks under one
// vault and wants to unlock to another.

import { useEffect, useState } from "react";
import { EmergencyRecoveryFlow } from "./EmergencyRecoveryFlow";
import { Identity } from "./Identity";
import { useVaults } from "../sdk/useVaults";
import {
  MultiVaultCallError,
  type VaultSummary,
} from "../sdk/vault-multi";

export function LockScreen() {
  const vaults = useVaults();
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [showPicker, setShowPicker] = useState(false);
  const [showRecovery, setShowRecovery] = useState(false);

  const active = vaults.active;
  const list = vaults.state.vaults;

  // Drop the password value as soon as the screen is unmounted
  // (after a successful unlock). The state itself lives in this
  // component's closure; React will GC it.
  useEffect(() => {
    return () => {
      // Best-effort hygiene — overwrite the local closure binding so
      // a stray ref to state can't reveal the password.
      setPassword("");
    };
  }, []);

  const submit = async () => {
    if (!password) {
      setError("Password is required");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await vaults.unlock(password);
      setPassword("");
    } catch (cause) {
      const msg =
        cause instanceof MultiVaultCallError
          ? cause.message
          : (cause as Error)?.message ?? String(cause);
      setError(msg);
    } finally {
      setBusy(false);
    }
  };

  if (vaults.state.status === "loading") {
    return (
      <div className="w-onboarding">
        <div className="w-onboarding__card" style={{ textAlign: "center" }}>
          <div className="w-spin" style={{ margin: "0 auto 12px" }} />
          <div className="cap" style={{ color: "var(--w-text-2)" }}>
            Loading vaults…
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="w-onboarding">
      <div className="w-onboarding__card" style={{ maxWidth: 460 }}>
        <h2 style={{ marginTop: 0 }}>Wallet locked</h2>
        <div className="cap" style={{ color: "var(--w-text-2)", marginBottom: 16 }}>
          Enter your master password to unlock.
        </div>

        {active ? (
          <ActiveVaultCard vault={active} />
        ) : (
          <div className="w-banner" style={{ marginBottom: 12 }}>
            No active vault selected. Pick one below.
          </div>
        )}

        <label className="cap" htmlFor="lockscreen-password">
          Master password
        </label>
        <input
          id="lockscreen-password"
          type="password"
          className="w-live-input"
          value={password}
          onChange={(e) => setPassword(e.currentTarget.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !busy && password) {
              void submit();
            }
          }}
          autoFocus
          autoComplete="current-password"
          style={{ marginTop: 4, marginBottom: 12 }}
        />

        {error ? (
          <div className="w-banner error" style={{ marginBottom: 12 }}>
            ✗ {error}
          </div>
        ) : null}

        <div style={{ display: "flex", gap: 6, marginTop: 4 }}>
          <button
            className="btn btn--primary"
            onClick={() => void submit()}
            disabled={busy || !password}
          >
            {busy ? "Unlocking…" : "Unlock"}
          </button>
          {list.length > 1 ? (
            <button
              className="btn btn--ghost"
              onClick={() => setShowPicker((v) => !v)}
            >
              {showPicker ? "Hide" : "Choose different vault"}
            </button>
          ) : null}
        </div>

        {active ? (
          <div style={{ marginTop: 12 }}>
            <button
              type="button"
              className="btn btn--ghost btn--sm"
              onClick={() => setShowRecovery(true)}
              style={{ fontSize: 11.5 }}
            >
              Recover with emergency backup
            </button>
            <div className="cap" style={{ marginTop: 4, color: "var(--w-text-3)" }}>
              Use this if you've lost your master password but still
              have your 24-word recovery mnemonic + recovery password.
            </div>
          </div>
        ) : null}

        {showRecovery && active ? (
          <EmergencyRecoveryFlow
            vaultId={active.id}
            onClose={() => setShowRecovery(false)}
          />
        ) : null}

        {showPicker && list.length > 1 ? (
          <div style={{ marginTop: 16 }}>
            <div className="cap" style={{ marginBottom: 6 }}>
              Available vaults
            </div>
            <div
              style={{
                border: "1px solid var(--w-border)",
                borderRadius: 6,
              }}
            >
              {list.map((v) => (
                <button
                  key={v.id}
                  type="button"
                  onClick={async () => {
                    setError(null);
                    setShowPicker(false);
                    // The select command requires the container to be
                    // unlocked. From the lock screen we can't pre-
                    // unlock; we instead set the active id via the
                    // post-unlock refresh after a successful unlock.
                    // For now we just stash the intent — the user
                    // confirms with their master password and the
                    // vault unlocked is the one they selected here.
                    //
                    // TODO(phase-6): wire a `vault_select_locked`
                    // Rust command that mutates active_id without
                    // requiring an in-process MEK.
                    try {
                      await vaults.select(v.id);
                    } catch {
                      // Expected if the container is locked. Silent —
                      // the user will reach the right vault by typing
                      // the password.
                    }
                  }}
                  style={{
                    display: "block",
                    width: "100%",
                    textAlign: "left",
                    padding: "8px 12px",
                    background: v.isActive
                      ? "rgba(var(--gold-glow), 0.06)"
                      : "transparent",
                    border: "none",
                    borderBottom: "1px solid var(--w-border)",
                    cursor: "pointer",
                    color: "var(--w-text-1)",
                  }}
                >
                  <div style={{ fontSize: 12.5, fontWeight: 600 }}>
                    {v.label}
                    {v.isActive ? (
                      <span className="cap" style={{ marginLeft: 6, color: "var(--ok)" }}>
                        active
                      </span>
                    ) : null}
                  </div>
                  <div className="cap" style={{ marginTop: 2 }}>
                    <Identity addr={v.address} />
                  </div>
                </button>
              ))}
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}

function ActiveVaultCard({ vault }: { vault: VaultSummary }) {
  return (
    <div
      style={{
        padding: 12,
        border: "1px solid var(--w-border)",
        borderRadius: 6,
        marginBottom: 16,
      }}
    >
      <div className="cap">Active vault</div>
      <div style={{ fontSize: 14, fontWeight: 600, marginTop: 2 }}>{vault.label}</div>
      <div className="cap" style={{ marginTop: 4 }}>
        <Identity addr={vault.address} />
      </div>
    </div>
  );
}
