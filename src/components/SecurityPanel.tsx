// SecurityPanel — Settings card for auto-lock preferences + manual
// lock CTA + two-tier policy + passkey signer enrollment.
//
// Phase 7 shipped the policy slider + toggle (still disabled until a
// passkey was enrolled). Phase 8 wires the actual passkey CRUD via
// `usePasskeys(vaultId)`: enrollment, rename, remove, last-passkey
// warning. Enrollment automatically flips `policy.enrolledForHighValue`
// so the policy toggle becomes live; removing the last passkey flips
// it back to false (and consequently `passkeyRequired` to false, since
// the policy cannot be satisfied without a credential).

import { useEffect, useMemo, useState } from "react";
import {
  AUTO_LOCK_INTERVALS,
  getAutoLockMinutes,
  setAutoLockMinutes,
} from "../sdk/auto-lock";
import {
  PasskeyCallError,
  type PasskeySummary,
  usePasskeys,
} from "../sdk/passkey";
import {
  getPolicy,
  POLICY_THRESHOLD_MAX_LYTH,
  POLICY_THRESHOLD_MIN_LYTH,
  setPolicy,
  type PolicyConfig,
} from "../sdk/policy";

interface Props {
  /** Optional handler for the "Lock now" CTA. */
  onLockNow?: () => void | Promise<void>;
  /** Active vault id — when provided, the panel surfaces the passkey
   *  signers section. The existing single-prop signature still works
   *  for callers that haven't wired vault context yet. */
  vaultId?: string | null;
}

export function SecurityPanel({ onLockNow, vaultId }: Props) {
  const [minutes, setMinutes] = useState<number>(() => getAutoLockMinutes());
  // `policyVersion` is bumped by the passkey section whenever it
  // flips `enrolledForHighValue` so the policy row re-reads.
  const [policyVersion, setPolicyVersion] = useState(0);

  useEffect(() => {
    setAutoLockMinutes(minutes);
  }, [minutes]);

  return (
    <div className="w-card">
      <div className="w-card__head">
        <h3>Security</h3>
      </div>
      <div className="w-card__body">
        <div className="w-setting-row">
          <div>
            <div className="row-label">Auto-lock interval</div>
            <div className="row-help">
              Lock the vault after this many minutes of inactivity. The
              in-memory MEK is wiped on lock; you'll re-enter the master
              password to unlock.
            </div>
          </div>
          <div className="w-chip-group" role="radiogroup" aria-label="Auto-lock interval">
            {AUTO_LOCK_INTERVALS.map((m) => (
              <button
                key={m}
                type="button"
                role="radio"
                aria-checked={minutes === m}
                className={`w-chip ${minutes === m ? "is-on" : ""}`}
                onClick={() => setMinutes(m)}
              >
                {m === 0 ? "Never" : `${m} min`}
              </button>
            ))}
          </div>
        </div>
        {onLockNow ? (
          <div className="w-setting-row">
            <div>
              <div className="row-label">Lock now</div>
              <div className="row-help">
                Wipe the in-memory MEK immediately. You'll need to enter
                your master password on the next operation.
              </div>
            </div>
            <button
              className="btn btn--sm"
              onClick={() => void onLockNow()}
            >
              Lock
            </button>
          </div>
        ) : null}

        <TwoTierPolicyRow version={policyVersion} />

        {vaultId ? (
          <PasskeySignersSection
            vaultId={vaultId}
            onPolicyChange={() => setPolicyVersion((v) => v + 1)}
          />
        ) : null}
      </div>
    </div>
  );
}

function TwoTierPolicyRow({ version: _version }: { version: number }) {
  // The `version` prop is read implicitly via the dependency array of
  // the useMemo below — every bump forces a fresh getPolicy() read.
  const initial = useMemo(() => getPolicy(), [_version]);
  const [policy, setLocalPolicy] = useState<PolicyConfig>(initial);
  // Re-sync local state if the parent bumps version (passkey
  // enrollment / removal flipped `enrolledForHighValue`).
  useEffect(() => {
    setLocalPolicy(getPolicy());
  }, [_version]);
  const enrolled = policy.enrolledForHighValue;
  const update = (next: Partial<PolicyConfig>) => {
    setLocalPolicy(setPolicy(next));
  };
  return (
    <div className="w-setting-row" style={{ display: "block" }}>
      <div style={{ marginBottom: 12 }}>
        <div className="row-label">Two-tier high-value policy</div>
        <div className="row-help">
          Operations at or above this LYTH threshold route through a
          passkey challenge before signing (§28.5 Q29–31). Below the
          threshold, the single-factor master-password flow stays
          unchanged. Default ≈ $500 USD equivalent (100 LYTH static
          fallback until the price oracle ships — see #D13).
        </div>
      </div>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 12,
          marginBottom: 12,
        }}
      >
        <input
          type="range"
          min={POLICY_THRESHOLD_MIN_LYTH}
          max={POLICY_THRESHOLD_MAX_LYTH}
          value={policy.triggerThresholdLyth}
          onChange={(e) =>
            update({ triggerThresholdLyth: Number(e.currentTarget.value) })
          }
          aria-label="High-value transaction threshold"
          style={{ flex: 1 }}
        />
        <span
          className="mono"
          style={{ minWidth: 100, textAlign: "right", fontWeight: 600 }}
        >
          {policy.triggerThresholdLyth.toLocaleString()} LYTH
        </span>
      </div>
      <div
        className="cap"
        style={{ marginBottom: 12, color: "var(--w-text-3)" }}
      >
        USD equivalent:{" "}
        {policy.usdEquivalent === null
          ? "[chain-gap] oracle pending"
          : `$${policy.usdEquivalent.toFixed(2)}`}
      </div>
      <label
        style={{
          display: "flex",
          gap: 8,
          alignItems: "center",
          marginBottom: 6,
          opacity: enrolled ? 1 : 0.55,
        }}
      >
        <input
          type="checkbox"
          checked={policy.passkeyRequired}
          onChange={(e) =>
            update({ passkeyRequired: e.currentTarget.checked })
          }
          disabled={!enrolled}
        />
        <span style={{ fontSize: 12.5, fontWeight: 600 }}>
          Require passkey for transactions above threshold
        </span>
      </label>
      <div className="row-help" style={{ marginTop: 0 }}>
        {enrolled
          ? "Toggle to gate every high-value transaction behind a passkey challenge."
          : "Enroll a passkey first (Phase 8) to enable this toggle. Until then, the policy threshold is informational + the unlock-mode badge surfaces \"single-factor\" posture."}
      </div>
    </div>
  );
}

// ─── Passkey signers section ────────────────────────────────────────

function PasskeySignersSection({
  vaultId,
  onPolicyChange,
}: {
  vaultId: string;
  onPolicyChange: () => void;
}) {
  const { passkeys, status, error, refresh, enroll, rename, remove } =
    usePasskeys(vaultId);
  const [showEnroll, setShowEnroll] = useState(false);
  const [removeTarget, setRemoveTarget] = useState<PasskeySummary | null>(null);
  const [renameTarget, setRenameTarget] = useState<PasskeySummary | null>(null);
  const [topError, setTopError] = useState<string | null>(null);

  // Keep `policy.enrolledForHighValue` in sync with the live count.
  // Also clear `passkeyRequired` when the count drops to 0 so the
  // policy never enters an inconsistent "require passkey but none
  // enrolled" state.
  useEffect(() => {
    if (status !== "ready") return;
    const policy = getPolicy();
    const hasAny = passkeys.length > 0;
    const passkeyRequiredNext = hasAny ? policy.passkeyRequired : false;
    if (
      policy.enrolledForHighValue !== hasAny ||
      policy.passkeyRequired !== passkeyRequiredNext
    ) {
      setPolicy({
        enrolledForHighValue: hasAny,
        passkeyRequired: passkeyRequiredNext,
      });
      onPolicyChange();
    }
  }, [status, passkeys.length, onPolicyChange]);

  return (
    <div className="w-setting-row" style={{ display: "block" }}>
      <div style={{ marginBottom: 12 }}>
        <div className="row-label">Passkey signers</div>
        <div className="row-help">
          Enrolled passkeys gate the two-tier high-value policy above.
          The first passkey activates the policy toggle; removing the
          last one disables it again. Software-backed passkeys (this
          build) seal a fresh Ed25519 secret under the vault's VEK.
        </div>
      </div>

      {topError ? (
        <div
          className="w-banner"
          style={{ marginBottom: 12, color: "var(--w-danger)" }}
        >
          {topError}
        </div>
      ) : null}

      {status === "loading" ? (
        <div className="cap" style={{ color: "var(--w-text-3)" }}>
          Loading passkeys…
        </div>
      ) : status === "error" ? (
        <div
          className="w-banner"
          style={{ marginBottom: 12, color: "var(--w-danger)" }}
        >
          {error?.message ?? "Failed to load passkeys."}
        </div>
      ) : passkeys.length === 0 ? (
        <div
          className="cap"
          style={{ color: "var(--w-text-3)", marginBottom: 12 }}
        >
          No passkeys enrolled yet for this vault.
        </div>
      ) : (
        <table
          style={{
            width: "100%",
            marginBottom: 12,
            borderCollapse: "collapse",
          }}
        >
          <thead>
            <tr style={{ textAlign: "left", fontSize: 12, color: "var(--w-text-3)" }}>
              <th style={{ padding: "4px 8px" }}>Label</th>
              <th style={{ padding: "4px 8px" }}>Device</th>
              <th style={{ padding: "4px 8px" }}>Last used</th>
              <th style={{ padding: "4px 8px" }} />
            </tr>
          </thead>
          <tbody>
            {passkeys.map((p) => (
              <tr
                key={p.id}
                style={{ borderTop: "1px solid var(--w-border)" }}
              >
                <td style={{ padding: "8px 8px", fontWeight: 600 }}>
                  {p.label}
                </td>
                <td style={{ padding: "8px 8px", color: "var(--w-text-3)" }}>
                  {p.deviceName ?? "—"}
                </td>
                <td style={{ padding: "8px 8px", color: "var(--w-text-3)" }}>
                  {p.lastUsed === p.createdAt
                    ? "Never used"
                    : formatRelative(p.lastUsed)}
                </td>
                <td style={{ padding: "8px 8px", textAlign: "right" }}>
                  <button
                    className="btn btn--sm btn--ghost"
                    onClick={() => setRenameTarget(p)}
                    aria-label={`Rename ${p.label}`}
                  >
                    Rename
                  </button>
                  <button
                    className="btn btn--sm btn--ghost"
                    style={{ marginLeft: 4 }}
                    onClick={() => setRemoveTarget(p)}
                    aria-label={`Remove ${p.label}`}
                  >
                    Remove
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <div style={{ display: "flex", gap: 8 }}>
        <button
          className="btn btn--sm btn--primary"
          onClick={() => {
            setTopError(null);
            setShowEnroll(true);
          }}
        >
          Enroll new passkey
        </button>
        <button
          className="btn btn--sm btn--ghost"
          onClick={() => void refresh()}
        >
          Refresh
        </button>
      </div>

      {showEnroll ? (
        <EnrollModal
          onCancel={() => setShowEnroll(false)}
          onSubmit={async ({ label, deviceName }) => {
            try {
              await enroll({ label, deviceName });
              setShowEnroll(false);
            } catch (cause) {
              const err = cause as PasskeyCallError;
              setTopError(err.message);
            }
          }}
        />
      ) : null}

      {renameTarget ? (
        <RenameModal
          target={renameTarget}
          onCancel={() => setRenameTarget(null)}
          onSubmit={async (newLabel) => {
            try {
              await rename({
                credentialId: renameTarget.id,
                newLabel,
              });
              setRenameTarget(null);
            } catch (cause) {
              const err = cause as PasskeyCallError;
              setTopError(err.message);
            }
          }}
        />
      ) : null}

      {removeTarget ? (
        <RemoveModal
          target={removeTarget}
          isLastPasskeyWithActivePolicy={
            passkeys.length === 1 && getPolicy().passkeyRequired
          }
          onCancel={() => setRemoveTarget(null)}
          onSubmit={async (password) => {
            try {
              await remove({
                credentialId: removeTarget.id,
                password,
              });
              setRemoveTarget(null);
            } catch (cause) {
              const err = cause as PasskeyCallError;
              setTopError(err.message);
            }
          }}
        />
      ) : null}
    </div>
  );
}

// ─── Modals ─────────────────────────────────────────────────────────

function ModalShell({
  title,
  onDismiss,
  children,
}: {
  title: string;
  onDismiss: () => void;
  children: React.ReactNode;
}) {
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={title}
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
      <div className="w-card" style={{ width: "100%", maxWidth: 460 }}>
        <div className="w-card__head">
          <h3>{title}</h3>
          <button className="btn btn--sm btn--ghost" onClick={onDismiss}>
            Cancel
          </button>
        </div>
        <div className="w-card__body">{children}</div>
      </div>
    </div>
  );
}

function EnrollModal({
  onCancel,
  onSubmit,
}: {
  onCancel: () => void;
  onSubmit: (args: { label: string; deviceName?: string }) => Promise<void>;
}) {
  const [label, setLabel] = useState("");
  const [deviceName, setDeviceName] = useState("");
  const [busy, setBusy] = useState(false);
  const valid = label.trim().length >= 1 && label.trim().length <= 64;
  return (
    <ModalShell title="Enroll a new passkey" onDismiss={onCancel}>
      <div style={{ marginBottom: 12 }}>
        <label htmlFor="passkey-label" className="row-label">
          Label
        </label>
        <input
          id="passkey-label"
          type="text"
          maxLength={64}
          value={label}
          onChange={(e) => setLabel(e.currentTarget.value)}
          placeholder="My laptop Touch ID"
          className="w-input"
          style={{ width: "100%" }}
        />
        <div className="cap" style={{ marginTop: 4, color: "var(--w-text-3)" }}>
          1–64 characters. Shown in the passkeys list.
        </div>
      </div>
      <div style={{ marginBottom: 12 }}>
        <label htmlFor="passkey-device" className="row-label">
          Device name (optional)
        </label>
        <input
          id="passkey-device"
          type="text"
          maxLength={64}
          value={deviceName}
          onChange={(e) => setDeviceName(e.currentTarget.value)}
          placeholder="MacBook Pro 14&quot;"
          className="w-input"
          style={{ width: "100%" }}
        />
      </div>
      <div className="cap" style={{ marginBottom: 16, color: "var(--w-text-3)" }}>
        This build uses a software passkey — a fresh Ed25519 keypair is
        generated and the secret is sealed under your vault's VEK.
        Future builds will surface the OS-native passkey picker
        (Windows Hello / Touch ID / FIDO2 USB).
      </div>
      <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
        <button
          className="btn btn--sm btn--primary"
          disabled={!valid || busy}
          onClick={async () => {
            setBusy(true);
            try {
              await onSubmit({
                label: label.trim(),
                deviceName: deviceName.trim() || undefined,
              });
            } finally {
              setBusy(false);
            }
          }}
        >
          {busy ? "Enrolling…" : "Enroll"}
        </button>
      </div>
    </ModalShell>
  );
}

function RenameModal({
  target,
  onCancel,
  onSubmit,
}: {
  target: PasskeySummary;
  onCancel: () => void;
  onSubmit: (newLabel: string) => Promise<void>;
}) {
  const [label, setLabel] = useState(target.label);
  const [busy, setBusy] = useState(false);
  const valid = label.trim().length >= 1 && label.trim().length <= 64;
  return (
    <ModalShell title="Rename passkey" onDismiss={onCancel}>
      <div style={{ marginBottom: 12 }}>
        <label htmlFor="passkey-rename" className="row-label">
          New label
        </label>
        <input
          id="passkey-rename"
          type="text"
          maxLength={64}
          value={label}
          onChange={(e) => setLabel(e.currentTarget.value)}
          className="w-input"
          style={{ width: "100%" }}
        />
      </div>
      <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
        <button
          className="btn btn--sm btn--primary"
          disabled={!valid || busy}
          onClick={async () => {
            setBusy(true);
            try {
              await onSubmit(label.trim());
            } finally {
              setBusy(false);
            }
          }}
        >
          {busy ? "Saving…" : "Save"}
        </button>
      </div>
    </ModalShell>
  );
}

function RemoveModal({
  target,
  isLastPasskeyWithActivePolicy,
  onCancel,
  onSubmit,
}: {
  target: PasskeySummary;
  isLastPasskeyWithActivePolicy: boolean;
  onCancel: () => void;
  onSubmit: (password: string) => Promise<void>;
}) {
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <ModalShell title={`Remove passkey "${target.label}"`} onDismiss={onCancel}>
      <div className="row-help" style={{ marginBottom: 12 }}>
        This permanently removes the credential. You'll need to enroll
        a new passkey to use it again.
      </div>
      {isLastPasskeyWithActivePolicy ? (
        <div
          className="w-banner"
          style={{ marginBottom: 12, color: "var(--w-warning)" }}
          role="alert"
        >
          Removing the last passkey will disable the high-value
          transaction gate. The policy toggle in the row above will
          turn off automatically.
        </div>
      ) : null}
      <div style={{ marginBottom: 12 }}>
        <label htmlFor="passkey-remove-pw" className="row-label">
          Confirm with master password
        </label>
        <input
          id="passkey-remove-pw"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.currentTarget.value)}
          className="w-input"
          style={{ width: "100%" }}
        />
      </div>
      <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
        <button
          className="btn btn--sm btn--danger"
          disabled={!password || busy}
          onClick={async () => {
            setBusy(true);
            try {
              await onSubmit(password);
            } finally {
              setBusy(false);
            }
          }}
        >
          {busy ? "Removing…" : "Remove"}
        </button>
      </div>
    </ModalShell>
  );
}

// ─── Helpers ────────────────────────────────────────────────────────

function formatRelative(unixSeconds: number): string {
  const ms = Date.now() - unixSeconds * 1000;
  if (ms < 0) return "just now";
  const min = Math.floor(ms / 60_000);
  if (min < 1) return "just now";
  if (min < 60) return `${min} min ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr} hr ago`;
  const day = Math.floor(hr / 24);
  return `${day} day${day === 1 ? "" : "s"} ago`;
}
