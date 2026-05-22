// EmergencyRecoveryFlow — full-screen recovery modal accessible from
// LockScreen (master password lost) and from Settings → Security
// (rehearsal + intentional activation).
//
// State machine:
//   intro → input → activating → result(success | failure)
//
// On success the backup is marked `activated = true` on disk; the
// SLH-DSA pubkey becomes the active backup signer. Phase 8 v1 does
// NOT re-key the vault's ML-DSA-65 sealed_payload under a new
// master password — that's a Phase 9 carry-over noted in the
// report. Chain-side acceptance via the emergency-key precompile
// at 0x1100 is the remaining GAP.

import { useState } from "react";
import { slhActivateRecovery, SlhCallError } from "../sdk/slh-backup";

type Step =
  | { kind: "intro" }
  | { kind: "input" }
  | { kind: "activating" }
  | { kind: "success"; activatedAt: number }
  | { kind: "failure"; message: string };

interface Props {
  vaultId: string;
  onClose: () => void;
}

export function EmergencyRecoveryFlow({ vaultId, onClose }: Props) {
  const [step, setStep] = useState<Step>({ kind: "intro" });
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Emergency recovery"
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.55)",
        display: "flex",
        alignItems: "flex-start",
        justifyContent: "center",
        zIndex: 200,
        padding: 40,
        overflowY: "auto",
      }}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && step.kind !== "activating") {
          onClose();
        }
      }}
    >
      <div
        className="w-card"
        style={{ width: "100%", maxWidth: 560 }}
      >
        <div className="w-card__head">
          <h3>Emergency recovery</h3>
          {step.kind !== "activating" ? (
            <button
              className="btn btn--sm btn--ghost"
              onClick={onClose}
              aria-label="Cancel recovery"
            >
              Cancel
            </button>
          ) : null}
        </div>
        <div className="w-card__body">
          {step.kind === "intro" ? (
            <IntroStep onContinue={() => setStep({ kind: "input" })} />
          ) : null}
          {step.kind === "input" ? (
            <InputStep
              onBack={() => setStep({ kind: "intro" })}
              onSubmit={async ({ recoveryPassword, mnemonic }) => {
                setStep({ kind: "activating" });
                try {
                  const status = await slhActivateRecovery({
                    vaultId,
                    recoveryPassword,
                    mnemonic,
                  });
                  if (status.kind === "activated") {
                    setStep({
                      kind: "success",
                      activatedAt: status.activatedAt,
                    });
                  } else {
                    setStep({
                      kind: "failure",
                      message:
                        "Recovery completed but status did not update — try again or re-check inputs.",
                    });
                  }
                } catch (cause) {
                  const err = cause as SlhCallError;
                  setStep({ kind: "failure", message: err.message });
                }
              }}
            />
          ) : null}
          {step.kind === "activating" ? <ActivatingStep /> : null}
          {step.kind === "success" ? (
            <SuccessStep activatedAt={step.activatedAt} onDone={onClose} />
          ) : null}
          {step.kind === "failure" ? (
            <FailureStep
              message={step.message}
              onRetry={() => setStep({ kind: "input" })}
              onClose={onClose}
            />
          ) : null}
        </div>
      </div>
    </div>
  );
}

function IntroStep({ onContinue }: { onContinue: () => void }) {
  return (
    <>
      <div className="row-help" style={{ marginBottom: 12 }}>
        Use this flow when you have lost your master password but
        still have BOTH:
      </div>
      <ul style={{ paddingLeft: 18, fontSize: 12.5, lineHeight: 1.6 }}>
        <li>Your separate <strong>recovery password</strong></li>
        <li>The 24-word <strong>recovery mnemonic</strong> you wrote down at enrolment</li>
      </ul>
      <div
        className="w-banner"
        style={{ marginTop: 12, fontSize: 12 }}
      >
        After recovery, the SLH-DSA backup key becomes your active
        signing key. Chain-side acceptance depends on the emergency-
        key precompile at <span className="mono">0x1100</span>; this
        wallet generates a valid proof regardless. The original
        ML-DSA-65 vault key remains sealed on disk but is no longer
        the canonical signer.
      </div>
      <div className="cap" style={{ marginTop: 12, color: "var(--w-text-3)" }}>
        Phase 8 caveat: this activation marks the backup as the
        signing key but does NOT re-key the vault's sealed_payload
        under a new master password. That re-keying lands in a
        follow-up phase.
      </div>
      <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 16 }}>
        <button className="btn btn--sm btn--primary" onClick={onContinue}>
          Continue
        </button>
      </div>
    </>
  );
}

function InputStep({
  onBack,
  onSubmit,
}: {
  onBack: () => void;
  onSubmit: (args: {
    recoveryPassword: string;
    mnemonic: string;
  }) => Promise<void>;
}) {
  const [password, setPassword] = useState("");
  const [mnemonic, setMnemonic] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <>
      <label className="row-label" htmlFor="rec-password">
        Recovery password
      </label>
      <input
        id="rec-password"
        type="password"
        value={password}
        onChange={(e) => setPassword(e.currentTarget.value)}
        className="w-input"
        style={{ width: "100%", marginBottom: 10 }}
        autoFocus
      />
      <label className="row-label" htmlFor="rec-mnemonic">
        24-word recovery mnemonic
      </label>
      <textarea
        id="rec-mnemonic"
        value={mnemonic}
        onChange={(e) => setMnemonic(e.currentTarget.value)}
        className="w-input"
        rows={4}
        style={{ width: "100%", fontFamily: "var(--f-mono)" }}
        placeholder="abandon ability able …"
      />
      <div className="cap" style={{ marginTop: 4, color: "var(--w-text-3)" }}>
        Paste or type the 24 words separated by single spaces.
      </div>
      <div style={{ display: "flex", gap: 8, justifyContent: "space-between", marginTop: 16 }}>
        <button className="btn btn--sm btn--ghost" onClick={onBack}>
          Back
        </button>
        <button
          className="btn btn--sm btn--primary"
          disabled={busy || !password || !mnemonic.trim()}
          onClick={async () => {
            setBusy(true);
            try {
              await onSubmit({
                recoveryPassword: password,
                mnemonic: mnemonic.trim(),
              });
            } finally {
              setBusy(false);
            }
          }}
        >
          {busy ? "Activating…" : "Activate recovery"}
        </button>
      </div>
    </>
  );
}

function ActivatingStep() {
  return (
    <div style={{ textAlign: "center", padding: "32px 0" }}>
      <div className="w-spin" />
      <div className="cap" style={{ marginTop: 14, color: "var(--w-text-3)" }}>
        Verifying recovery inputs + activating backup…
      </div>
    </div>
  );
}

function SuccessStep({
  activatedAt,
  onDone,
}: {
  activatedAt: number;
  onDone: () => void;
}) {
  return (
    <div style={{ textAlign: "center", padding: "16px 0" }}>
      <div
        className="w-check"
        aria-hidden="true"
        style={{ margin: "0 auto" }}
      >
        <svg
          width="22"
          height="22"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
        >
          <path d="m5 12 5 5 9-11" />
        </svg>
      </div>
      <h3 style={{ marginTop: 14 }}>Recovery activated</h3>
      <div
        className="cap"
        style={{ color: "var(--w-text-3)", marginTop: 4 }}
      >
        Activated at{" "}
        <span className="mono">
          {new Date(activatedAt * 1000).toISOString().replace("T", " ").slice(0, 19)}
        </span>
      </div>
      <div
        className="w-banner"
        style={{ marginTop: 14, fontSize: 12, textAlign: "left" }}
      >
        The SLH-DSA backup key is now the active signing key. Set a
        new master password from Settings → Security to re-key the
        vault container (Phase 9 carry-over).
      </div>
      <div style={{ display: "flex", justifyContent: "center", marginTop: 16 }}>
        <button className="btn btn--sm btn--primary" onClick={onDone}>
          Done
        </button>
      </div>
    </div>
  );
}

function FailureStep({
  message,
  onRetry,
  onClose,
}: {
  message: string;
  onRetry: () => void;
  onClose: () => void;
}) {
  return (
    <div style={{ padding: "16px 0" }}>
      <div
        className="w-banner error"
        role="alert"
        style={{ marginBottom: 12 }}
      >
        <strong>Recovery failed</strong>
        <div style={{ marginTop: 4, fontSize: 12 }}>{message}</div>
      </div>
      <div className="cap" style={{ color: "var(--w-text-3)" }}>
        Common causes — typo in a mnemonic word, wrong recovery
        password, the backup hasn't been enrolled, or a word
        substitution that produces a valid BIP-39 checksum but a
        different entropy. Try again carefully.
      </div>
      <div style={{ display: "flex", gap: 8, justifyContent: "space-between", marginTop: 16 }}>
        <button className="btn btn--sm btn--ghost" onClick={onClose}>
          Close
        </button>
        <button className="btn btn--sm btn--primary" onClick={onRetry}>
          Try again
        </button>
      </div>
    </div>
  );
}
