// SecurityPanel — Settings card for auto-lock preferences + manual
// lock CTA (Commit 11).
//
// The auto-lock interval persists to localStorage; the timer itself
// lives in App.tsx (Commit 11 wires it). This panel is the read +
// write surface for the user-facing preference.

import { useEffect, useState } from "react";
import {
  AUTO_LOCK_INTERVALS,
  getAutoLockMinutes,
  setAutoLockMinutes,
} from "../sdk/auto-lock";
import {
  getPolicy,
  POLICY_THRESHOLD_MAX_LYTH,
  POLICY_THRESHOLD_MIN_LYTH,
  setPolicy,
  type PolicyConfig,
} from "../sdk/policy";

interface Props {
  /** Optional handler for the "Lock now" CTA — Commit 11 wires this. */
  onLockNow?: () => void | Promise<void>;
}

export function SecurityPanel({ onLockNow }: Props) {
  const [minutes, setMinutes] = useState<number>(() => getAutoLockMinutes());

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

        <TwoTierPolicyRow />
      </div>
    </div>
  );
}

function TwoTierPolicyRow() {
  const [policy, setLocalPolicy] = useState<PolicyConfig>(() => getPolicy());
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
