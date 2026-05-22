// EmergencyBackupSection — Settings → Security → Emergency backup
// pane (Phase 8 §30.1).
//
// State machine inside the enrolment modal:
//   intro → recoveryPassword → mnemonicReveal → confirmReorder → done
//   |
//   `→ cancel → modal close (no on-disk side effect)
//
// On `done` the vault container already holds the sealed material;
// the user wrote down the mnemonic and confirmed it. The modal then
// closes and the status row refreshes.
//
// "Test recovery" is a separate non-destructive flow that just calls
// `slh_test_recovery` with the user-supplied password + mnemonic.

import { useMemo, useState } from "react";
import { EmergencyRecoveryFlow } from "./EmergencyRecoveryFlow";
import {
  SlhCallError,
  useSlhBackup,
  type SlhBackupStatus,
  type SlhEnrollResult,
} from "../sdk/slh-backup";

interface Props {
  vaultId: string;
}

export function EmergencyBackupSection({ vaultId }: Props) {
  const { status, backup, error, refresh, enroll, testRecovery, remove } =
    useSlhBackup(vaultId);
  const [showEnroll, setShowEnroll] = useState(false);
  const [showTest, setShowTest] = useState(false);
  const [showRemove, setShowRemove] = useState(false);
  const [showRecovery, setShowRecovery] = useState(false);
  const [bannerError, setBannerError] = useState<string | null>(null);

  return (
    <div className="w-setting-row" style={{ display: "block" }}>
      <div style={{ marginBottom: 12 }}>
        <div className="row-label">Emergency backup</div>
        <div className="row-help">
          SLH-DSA-SHA2-128s post-quantum signature backup
          (whitepaper §30.1). The fresh keypair is independent of the
          primary ML-DSA-65 vault key — a compromise of one does not
          imply a compromise of the other. Recovery requires both your
          written 24-word mnemonic AND the separate recovery password
          you set here.
        </div>
      </div>

      {bannerError ? (
        <div
          className="w-banner"
          style={{ marginBottom: 12, color: "var(--w-danger)" }}
        >
          {bannerError}
        </div>
      ) : null}

      <StatusRow status={status} backup={backup} error={error} />

      <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
        {backup.kind === "not_enrolled" ? (
          <button
            className="btn btn--sm btn--primary"
            onClick={() => {
              setBannerError(null);
              setShowEnroll(true);
            }}
          >
            Enroll emergency backup
          </button>
        ) : (
          <>
            <button
              className="btn btn--sm btn--ghost"
              onClick={() => {
                setBannerError(null);
                setShowTest(true);
              }}
            >
              Test recovery
            </button>
            {backup.kind === "enrolled" ? (
              <>
                <button
                  className="btn btn--sm btn--ghost"
                  onClick={() => {
                    setBannerError(null);
                    setShowRecovery(true);
                  }}
                >
                  Activate recovery
                </button>
                <button
                  className="btn btn--sm btn--ghost"
                  onClick={() => {
                    setBannerError(null);
                    setShowRemove(true);
                  }}
                >
                  Remove backup
                </button>
              </>
            ) : null}
          </>
        )}
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
          onEnroll={enroll}
          onDone={() => {
            setShowEnroll(false);
            void refresh();
          }}
          onError={(msg) => setBannerError(msg)}
        />
      ) : null}

      {showTest ? (
        <TestRecoveryModal
          onCancel={() => setShowTest(false)}
          onSubmit={async ({ recoveryPassword, mnemonic }) => {
            try {
              const ok = await testRecovery({ recoveryPassword, mnemonic });
              return ok;
            } catch (cause) {
              setBannerError((cause as SlhCallError).message);
              return false;
            }
          }}
        />
      ) : null}

      {showRecovery ? (
        <EmergencyRecoveryFlow
          vaultId={vaultId}
          onClose={() => {
            setShowRecovery(false);
            void refresh();
          }}
        />
      ) : null}

      {showRemove ? (
        <RemoveModal
          onCancel={() => setShowRemove(false)}
          onSubmit={async ({ masterPassword, recoveryPassword }) => {
            try {
              await remove({ masterPassword, recoveryPassword });
              setShowRemove(false);
            } catch (cause) {
              setBannerError((cause as SlhCallError).message);
            }
          }}
        />
      ) : null}
    </div>
  );
}

function StatusRow({
  status,
  backup,
  error,
}: {
  status: "idle" | "loading" | "ready" | "error";
  backup: SlhBackupStatus;
  error: SlhCallError | null;
}) {
  if (status === "loading") {
    return (
      <div className="cap" style={{ color: "var(--w-text-3)" }}>
        Loading backup status…
      </div>
    );
  }
  if (status === "error") {
    return (
      <div
        className="w-banner"
        style={{ color: "var(--w-danger)" }}
        role="status"
      >
        {error?.message ?? "Failed to load backup status."}
      </div>
    );
  }
  if (backup.kind === "not_enrolled") {
    return (
      <div className="cap" style={{ color: "var(--w-text-3)" }}>
        Status: <strong>Not enrolled</strong>. Enrol a backup to
        protect this vault against ML-DSA-65 compromise.
      </div>
    );
  }
  if (backup.kind === "enrolled") {
    return (
      <div className="cap">
        Status: <strong>Enrolled</strong> ·{" "}
        <span className="mono">created {formatDate(backup.createdAt)}</span>
      </div>
    );
  }
  return (
    <div className="cap">
      Status: <strong>Activated</strong> ·{" "}
      <span className="mono">
        created {formatDate(backup.createdAt)} · activated{" "}
        {formatDate(backup.activatedAt)}
      </span>
    </div>
  );
}

// ─── Enrolment modal — multi-step flow ────────────────────────────

type EnrollStep =
  | { kind: "intro" }
  | { kind: "recoveryPassword" }
  | { kind: "mnemonicReveal"; result: SlhEnrollResult }
  | { kind: "confirmReorder"; result: SlhEnrollResult }
  | { kind: "done" };

function EnrollModal({
  onCancel,
  onEnroll,
  onDone,
  onError,
}: {
  onCancel: () => void;
  onEnroll: (recoveryPassword: string) => Promise<SlhEnrollResult>;
  onDone: () => void;
  onError: (message: string) => void;
}) {
  const [step, setStep] = useState<EnrollStep>({ kind: "intro" });
  return (
    <ModalShell title="Emergency backup — enrolment" onDismiss={onCancel}>
      {step.kind === "intro" ? (
        <IntroStep onContinue={() => setStep({ kind: "recoveryPassword" })} />
      ) : null}
      {step.kind === "recoveryPassword" ? (
        <RecoveryPasswordStep
          onBack={() => setStep({ kind: "intro" })}
          onSubmit={async (pw) => {
            try {
              const result = await onEnroll(pw);
              setStep({ kind: "mnemonicReveal", result });
            } catch (cause) {
              onError((cause as SlhCallError).message);
            }
          }}
        />
      ) : null}
      {step.kind === "mnemonicReveal" ? (
        <MnemonicRevealStep
          result={step.result}
          onContinue={() =>
            setStep({ kind: "confirmReorder", result: step.result })
          }
        />
      ) : null}
      {step.kind === "confirmReorder" ? (
        <ConfirmReorderStep
          mnemonic={step.result.mnemonic}
          onBack={() =>
            setStep({ kind: "mnemonicReveal", result: step.result })
          }
          onDone={() => {
            setStep({ kind: "done" });
            onDone();
          }}
        />
      ) : null}
    </ModalShell>
  );
}

function IntroStep({ onContinue }: { onContinue: () => void }) {
  return (
    <>
      <div className="row-help" style={{ marginBottom: 12 }}>
        The emergency backup is a hash-based post-quantum signature
        key independent of your primary vault key. Use cases:
      </div>
      <ul style={{ paddingLeft: 18, fontSize: 12.5, lineHeight: 1.6 }}>
        <li>
          <strong>ML-DSA-65 compromise</strong> — if the lattice-
          based primary signer is later broken, your backup still
          signs valid transactions (SLH-DSA is conjectured
          quantum-secure under different assumptions).
        </li>
        <li>
          <strong>Lost master password</strong> — combined with the
          recovery password you set here AND the 24-word mnemonic you
          write down, you can re-key the vault.
        </li>
        <li>
          <strong>Vault-file loss</strong> — even with this device
          gone, the 24 words + recovery password let you reconstruct
          the backup key on a fresh wallet install.
        </li>
      </ul>
      <div
        className="w-banner"
        style={{ marginTop: 12, fontSize: 12 }}
      >
        The keypair is generated with fresh OS CSPRNG entropy — NOT
        derived from your primary mnemonic. The two keys' independence
        is the whole point.
      </div>
      <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 16 }}>
        <button className="btn btn--sm btn--primary" onClick={onContinue}>
          Continue
        </button>
      </div>
    </>
  );
}

function RecoveryPasswordStep({
  onBack,
  onSubmit,
}: {
  onBack: () => void;
  onSubmit: (password: string) => Promise<void>;
}) {
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const strength = useMemo(() => measureStrength(password), [password]);
  const longEnough = password.length >= 12;
  const matches = password === confirm;
  const valid = longEnough && matches && strength >= 3;
  return (
    <>
      <div className="row-help" style={{ marginBottom: 12 }}>
        Set a recovery password — independent of your master password.
        You'll need it (along with the 24-word mnemonic on the next
        screen) to recover. Minimum 12 characters; aim for a long
        passphrase with mixed character classes.
      </div>
      <label className="row-label" htmlFor="rec-pw">
        Recovery password
      </label>
      <input
        id="rec-pw"
        type="password"
        value={password}
        onChange={(e) => setPassword(e.currentTarget.value)}
        className="w-input"
        style={{ width: "100%" }}
        autoFocus
      />
      <StrengthMeter strength={strength} />
      <label className="row-label" htmlFor="rec-pw-confirm" style={{ marginTop: 10 }}>
        Confirm recovery password
      </label>
      <input
        id="rec-pw-confirm"
        type="password"
        value={confirm}
        onChange={(e) => setConfirm(e.currentTarget.value)}
        className="w-input"
        style={{ width: "100%" }}
      />
      {confirm && !matches ? (
        <div className="cap" style={{ color: "var(--w-danger)", marginTop: 4 }}>
          Passwords do not match.
        </div>
      ) : null}
      <div style={{ display: "flex", gap: 8, justifyContent: "space-between", marginTop: 16 }}>
        <button className="btn btn--sm btn--ghost" onClick={onBack}>
          Back
        </button>
        <button
          className="btn btn--sm btn--primary"
          disabled={!valid || busy}
          onClick={async () => {
            setBusy(true);
            try {
              await onSubmit(password);
            } finally {
              setBusy(false);
            }
          }}
        >
          {busy ? "Generating…" : "Generate backup"}
        </button>
      </div>
    </>
  );
}

function MnemonicRevealStep({
  result,
  onContinue,
}: {
  result: SlhEnrollResult;
  onContinue: () => void;
}) {
  const words = result.mnemonic.split(" ");
  return (
    <>
      <div className="row-help" style={{ marginBottom: 12 }}>
        Write these 24 words down on paper, in order. Store them
        somewhere physically safe. The wallet never writes them in
        cleartext — your written copy is the only durable record. The
        next screen verifies you copied them correctly.
      </div>
      <div
        className="w-banner"
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(4, 1fr)",
          gap: 6,
          fontFamily: "var(--f-mono)",
          fontSize: 12,
          padding: 12,
        }}
      >
        {words.map((w, i) => (
          <div key={i} style={{ display: "flex", alignItems: "center", gap: 4 }}>
            <span style={{ color: "var(--w-text-3)", minWidth: 22, textAlign: "right" }}>
              {(i + 1).toString().padStart(2, "0")}
            </span>
            <strong>{w}</strong>
          </div>
        ))}
      </div>
      <div className="cap" style={{ marginTop: 12, color: "var(--w-text-3)" }}>
        Public key:{" "}
        <span className="mono" style={{ wordBreak: "break-all" }}>
          {result.publicKey}
        </span>
      </div>
      <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 16 }}>
        <button className="btn btn--sm btn--primary" onClick={onContinue}>
          I have written them down
        </button>
      </div>
    </>
  );
}

function ConfirmReorderStep({
  mnemonic,
  onBack,
  onDone,
}: {
  mnemonic: string;
  onBack: () => void;
  onDone: () => void;
}) {
  const target = useMemo(() => mnemonic.split(" "), [mnemonic]);
  const [shuffled, setShuffled] = useState(() => stableShuffle(target));
  const [picked, setPicked] = useState<number[]>([]);
  const reconstructed = picked.map((i) => target[i]);
  const correct =
    picked.length === target.length &&
    reconstructed.every((w, i) => w === target[i]);
  const error =
    picked.length > 0 && reconstructed[picked.length - 1] !== target[picked.length - 1];
  const pickedSet = new Set(picked);
  return (
    <>
      <div className="row-help" style={{ marginBottom: 12 }}>
        Click the words in the right order to confirm you wrote them
        down correctly. The order matters — start with word #1.
      </div>
      <div
        style={{
          minHeight: 56,
          marginBottom: 12,
          padding: 8,
          background: "var(--w-surface)",
          border: "1px solid var(--w-border)",
          borderRadius: 6,
          fontFamily: "var(--f-mono)",
          fontSize: 12,
          color: error ? "var(--w-danger)" : "var(--w-text-1)",
        }}
        role="status"
        aria-label="Reconstructed mnemonic"
      >
        {reconstructed.length > 0 ? reconstructed.join(" ") : <em>(click words below in order)</em>}
      </div>
      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          gap: 6,
          marginBottom: 12,
        }}
      >
        {shuffled.map((w, idx) => {
          const wordOriginalIndex = w.originalIndex;
          const isPicked = pickedSet.has(wordOriginalIndex);
          return (
            <button
              key={`${w.word}-${idx}`}
              type="button"
              className={`w-chip ${isPicked ? "is-on" : ""}`}
              disabled={isPicked}
              onClick={() => {
                setPicked([...picked, wordOriginalIndex]);
              }}
              aria-label={`Pick ${w.word}`}
            >
              {w.word}
            </button>
          );
        })}
      </div>
      <div style={{ display: "flex", gap: 8, justifyContent: "space-between" }}>
        <button
          className="btn btn--sm btn--ghost"
          onClick={() => {
            setPicked([]);
            setShuffled(stableShuffle(target));
          }}
        >
          Reset
        </button>
        <div style={{ display: "flex", gap: 8 }}>
          <button className="btn btn--sm btn--ghost" onClick={onBack}>
            Back
          </button>
          <button
            className="btn btn--sm btn--primary"
            disabled={!correct}
            onClick={onDone}
          >
            Confirm and finish
          </button>
        </div>
      </div>
    </>
  );
}

// ─── Test recovery modal ─────────────────────────────────────────

function TestRecoveryModal({
  onCancel,
  onSubmit,
}: {
  onCancel: () => void;
  onSubmit: (args: {
    recoveryPassword: string;
    mnemonic: string;
  }) => Promise<boolean>;
}) {
  const [password, setPassword] = useState("");
  const [mnemonic, setMnemonic] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<"idle" | "ok" | "fail">("idle");
  return (
    <ModalShell title="Test recovery (non-destructive)" onDismiss={onCancel}>
      <div className="row-help" style={{ marginBottom: 12 }}>
        Type your recovery password + 24-word mnemonic to verify you
        can still recover. This rehearses the path without activating
        the backup. The vault remains unchanged either way.
      </div>
      <label className="row-label" htmlFor="test-pw">
        Recovery password
      </label>
      <input
        id="test-pw"
        type="password"
        value={password}
        onChange={(e) => setPassword(e.currentTarget.value)}
        className="w-input"
        style={{ width: "100%", marginBottom: 10 }}
      />
      <label className="row-label" htmlFor="test-mnemonic">
        24-word recovery mnemonic
      </label>
      <textarea
        id="test-mnemonic"
        value={mnemonic}
        onChange={(e) => setMnemonic(e.currentTarget.value)}
        className="w-input"
        rows={3}
        style={{ width: "100%", fontFamily: "var(--f-mono)" }}
      />
      {result === "ok" ? (
        <div
          className="w-banner"
          style={{ marginTop: 12, color: "var(--ok)" }}
          role="status"
        >
          ✓ Recovery verified. Your written mnemonic and recovery
          password match the on-disk backup.
        </div>
      ) : result === "fail" ? (
        <div
          className="w-banner"
          style={{ marginTop: 12, color: "var(--w-danger)" }}
          role="alert"
        >
          ✗ Recovery did not verify. Re-check the mnemonic spelling
          and recovery password and try again.
        </div>
      ) : null}
      <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 16 }}>
        <button
          className="btn btn--sm btn--primary"
          disabled={busy || !password || !mnemonic}
          onClick={async () => {
            setBusy(true);
            setResult("idle");
            try {
              const ok = await onSubmit({
                recoveryPassword: password,
                mnemonic,
              });
              setResult(ok ? "ok" : "fail");
            } finally {
              setBusy(false);
            }
          }}
        >
          {busy ? "Verifying…" : "Verify"}
        </button>
      </div>
    </ModalShell>
  );
}

// ─── Remove modal ─────────────────────────────────────────────────

function RemoveModal({
  onCancel,
  onSubmit,
}: {
  onCancel: () => void;
  onSubmit: (args: {
    masterPassword: string;
    recoveryPassword: string;
  }) => Promise<void>;
}) {
  const [master, setMaster] = useState("");
  const [recovery, setRecovery] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <ModalShell title="Remove emergency backup" onDismiss={onCancel}>
      <div className="row-help" style={{ marginBottom: 12 }}>
        Destructive. The keypair material is wiped from the container.
        You'll need to re-enrol to restore the backup posture. Both
        passwords required.
      </div>
      <label className="row-label" htmlFor="rm-master">
        Master password
      </label>
      <input
        id="rm-master"
        type="password"
        value={master}
        onChange={(e) => setMaster(e.currentTarget.value)}
        className="w-input"
        style={{ width: "100%", marginBottom: 10 }}
      />
      <label className="row-label" htmlFor="rm-recovery">
        Recovery password
      </label>
      <input
        id="rm-recovery"
        type="password"
        value={recovery}
        onChange={(e) => setRecovery(e.currentTarget.value)}
        className="w-input"
        style={{ width: "100%" }}
      />
      <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 16 }}>
        <button
          className="btn btn--sm btn--danger"
          disabled={busy || !master || !recovery}
          onClick={async () => {
            setBusy(true);
            try {
              await onSubmit({ masterPassword: master, recoveryPassword: recovery });
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

// ─── Shared modal shell ──────────────────────────────────────────

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
      <div className="w-card" style={{ width: "100%", maxWidth: 560 }}>
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

// ─── Helpers ─────────────────────────────────────────────────────

function formatDate(unixSeconds: number): string {
  const d = new Date(unixSeconds * 1000);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function measureStrength(password: string): number {
  let score = 0;
  if (password.length >= 8) score++;
  if (password.length >= 12) score++;
  if (password.length >= 20) score++;
  if (/[A-Z]/.test(password) && /[a-z]/.test(password)) score++;
  if (/[0-9]/.test(password)) score++;
  if (/[^a-zA-Z0-9]/.test(password)) score++;
  return Math.min(score, 5);
}

function StrengthMeter({ strength }: { strength: number }) {
  const color =
    strength >= 4
      ? "var(--ok)"
      : strength >= 3
        ? "var(--gold-hi, var(--w-text-2))"
        : "var(--w-danger)";
  const label =
    strength >= 4 ? "Strong" : strength >= 3 ? "OK" : "Weak";
  return (
    <div
      style={{
        marginTop: 6,
        display: "flex",
        alignItems: "center",
        gap: 6,
      }}
      aria-label="Recovery password strength"
    >
      <div
        style={{
          flex: 1,
          height: 4,
          background: "var(--w-surface)",
          borderRadius: 2,
        }}
      >
        <div
          style={{
            width: `${(strength / 5) * 100}%`,
            height: "100%",
            background: color,
            borderRadius: 2,
            transition: "width 200ms ease",
          }}
        />
      </div>
      <span
        className="cap"
        style={{ minWidth: 50, color, fontWeight: 600 }}
      >
        {label}
      </span>
    </div>
  );
}

interface ShuffledEntry {
  word: string;
  originalIndex: number;
}

function stableShuffle(words: string[]): ShuffledEntry[] {
  const entries = words.map((word, originalIndex) => ({ word, originalIndex }));
  // Fisher-Yates with Math.random — fine for UI shuffling, not
  // crypto. The user has the right answer to compare against; this
  // is just to make the challenge non-trivial.
  for (let i = entries.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const tmp = entries[i]!;
    entries[i] = entries[j]!;
    entries[j] = tmp;
  }
  return entries;
}
