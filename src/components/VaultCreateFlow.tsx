// Vault-create flow — multi-step:
//
//   1. label    — name for this vault
//   2. mnemonic — generate-fresh or paste-existing PQM-1 mnemonic
//   3. password — first-vault path doubles as master-password setup
//   4. confirm  — review + commit via vault_create_multi
//
// First-vault path:
//   - User picks a master password here; the same password unlocks
//     every future vault.
//
// Subsequent-vault path:
//   - User enters the existing master password (one prompt). The
//     Rust side verifies it against the container before insert.
//
// Mnemonic generation reuses the existing PQM-1 path from the SDK
// (`generatePqm1Mnemonic` + `pqm1MnemonicToMlDsa65Seed`). The derived
// address is shown for review before commit so the user can confirm
// the right seed was used.

import { useEffect, useState } from "react";
import {
  generatePqm1Mnemonic,
  pqm1MnemonicToAddress,
  pqm1MnemonicToMlDsa65Seed,
} from "@monolythium/core-sdk/crypto";
import { Identity } from "./Identity";
import { formatAddress } from "./format";
import { useVaults } from "../sdk/useVaults";
import { MultiVaultCallError } from "../sdk/vault-multi";

interface Props {
  /** True iff this is the first vault on disk. Drives copy + UX
   *  (sets the master password, no "current master password" field). */
  isFirstVault: boolean;
  /** Closes the flow — fired on successful create or Cancel. */
  onClose: () => void;
  /** Optional callback after a successful create, with the new id. */
  onCreated?: (vaultId: string) => void;
}

type Step =
  | { kind: "label" }
  | { kind: "mnemonic"; label: string }
  | { kind: "password"; label: string; mnemonic: string; address: string }
  | {
      kind: "confirm";
      label: string;
      mnemonic: string;
      address: string;
      password: string;
    };

export function VaultCreateFlow({ isFirstVault, onClose, onCreated }: Props) {
  const { create, refresh } = useVaults();
  const [step, setStep] = useState<Step>({ kind: "label" });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  return (
    <div
      className="w-card"
      style={{
        marginBottom: 16,
        borderColor: "var(--gold-hi)",
      }}
    >
      <div className="w-card__head">
        <h3>{isFirstVault ? "Create your first vault" : "Add a new vault"}</h3>
        <span className="cap" style={{ color: "var(--w-text-3)" }}>
          {step.kind === "label"
            ? "Step 1 of 4"
            : step.kind === "mnemonic"
              ? "Step 2 of 4"
              : step.kind === "password"
                ? "Step 3 of 4"
                : "Step 4 of 4"}
        </span>
        <button className="btn btn--sm btn--ghost" onClick={onClose}>
          Cancel
        </button>
      </div>
      <div className="w-card__body">
        {step.kind === "label" ? (
          <LabelStep
            onNext={(label) => setStep({ kind: "mnemonic", label })}
          />
        ) : null}
        {step.kind === "mnemonic" ? (
          <MnemonicStep
            label={step.label}
            onBack={() => setStep({ kind: "label" })}
            onNext={(mnemonic) => {
              const address = pqm1MnemonicToAddress(mnemonic);
              setStep({ kind: "password", label: step.label, mnemonic, address });
            }}
          />
        ) : null}
        {step.kind === "password" ? (
          <PasswordStep
            isFirstVault={isFirstVault}
            address={step.address}
            onBack={() =>
              setStep({ kind: "mnemonic", label: step.label })
            }
            onNext={(password) =>
              setStep({
                kind: "confirm",
                label: step.label,
                mnemonic: step.mnemonic,
                address: step.address,
                password,
              })
            }
          />
        ) : null}
        {step.kind === "confirm" ? (
          <ConfirmStep
            label={step.label}
            address={step.address}
            isFirstVault={isFirstVault}
            busy={busy}
            error={error}
            onBack={() =>
              setStep({
                kind: "password",
                label: step.label,
                mnemonic: step.mnemonic,
                address: step.address,
              })
            }
            onSubmit={async () => {
              setBusy(true);
              setError(null);
              try {
                const seed = pqm1MnemonicToMlDsa65Seed(step.mnemonic);
                await create({
                  label: step.label,
                  password: step.password,
                  seed,
                  address: step.address,
                });
                seed.fill(0);
                await refresh();
                onCreated?.(step.label);
                onClose();
              } catch (cause) {
                const msg =
                  cause instanceof MultiVaultCallError
                    ? cause.message
                    : (cause as Error)?.message ?? String(cause);
                setError(msg);
              } finally {
                setBusy(false);
              }
            }}
          />
        ) : null}
      </div>
    </div>
  );
}

// ─── Steps ─────────────────────────────────────────────────────────

function LabelStep({ onNext }: { onNext: (label: string) => void }) {
  const [label, setLabel] = useState("");
  return (
    <>
      <label className="cap">Vault label</label>
      <input
        className="w-live-input"
        value={label}
        onChange={(e) => setLabel(e.currentTarget.value)}
        placeholder="e.g. Personal, Work, Ops"
        autoFocus
        style={{ marginTop: 4, marginBottom: 12 }}
      />
      <div className="row-help">
        Pick a short label you'll recognize in the vault picker.
      </div>
      <div style={{ display: "flex", gap: 6, marginTop: 12 }}>
        <button
          className="btn btn--sm btn--primary"
          onClick={() => onNext(label.trim())}
          disabled={label.trim().length === 0}
        >
          Continue
        </button>
      </div>
    </>
  );
}

function MnemonicStep({
  label,
  onBack,
  onNext,
}: {
  label: string;
  onBack: () => void;
  onNext: (mnemonic: string) => void;
}) {
  const [mode, setMode] = useState<"generate" | "import">("generate");
  const [generated, setGenerated] = useState<string | null>(null);
  const [imported, setImported] = useState("");
  const [reviewedGenerated, setReviewedGenerated] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (mode === "generate" && generated === null) {
      try {
        setGenerated(generatePqm1Mnemonic());
        setError(null);
      } catch (cause) {
        setError((cause as Error).message);
      }
    }
  }, [mode, generated]);

  const submit = () => {
    setError(null);
    try {
      if (mode === "generate") {
        if (generated === null) {
          setError("Failed to generate mnemonic");
          return;
        }
        if (!reviewedGenerated) {
          setError("Tick the box to confirm you've written down the recovery phrase");
          return;
        }
        onNext(generated);
      } else {
        const trimmed = imported.trim();
        if (trimmed.split(/\s+/).length < 12) {
          setError("PQM-1 mnemonic must be at least 12 words");
          return;
        }
        // Probe — if the seed-derive throws, the mnemonic is malformed.
        pqm1MnemonicToMlDsa65Seed(trimmed);
        onNext(trimmed);
      }
    } catch (cause) {
      setError((cause as Error).message ?? String(cause));
    }
  };

  return (
    <>
      <div className="cap" style={{ marginBottom: 6 }}>
        Vault: {label}
      </div>
      <div style={{ display: "flex", gap: 6, marginBottom: 12 }}>
        {(["generate", "import"] as const).map((m) => (
          <button
            key={m}
            type="button"
            className={`btn btn--sm ${
              mode === m ? "btn--primary" : "btn--ghost"
            }`}
            onClick={() => {
              setMode(m);
              setError(null);
            }}
          >
            {m === "generate" ? "Generate fresh" : "Import existing"}
          </button>
        ))}
      </div>

      {mode === "generate" ? (
        <>
          <div className="cap">PQM-1 recovery phrase</div>
          <div
            className="mono"
            style={{
              marginTop: 4,
              padding: 12,
              border: "1px solid var(--w-border)",
              borderRadius: 6,
              fontSize: 12.5,
              lineHeight: 1.7,
              wordSpacing: 2,
              background: "var(--w-surface-2, var(--w-surface))",
              userSelect: "text",
            }}
          >
            {generated ?? "generating…"}
          </div>
          <label
            style={{
              display: "block",
              marginTop: 12,
              fontSize: 12.5,
            }}
          >
            <input
              type="checkbox"
              checked={reviewedGenerated}
              onChange={(e) => setReviewedGenerated(e.currentTarget.checked)}
              style={{ marginRight: 8 }}
            />
            I've written this phrase down. The wallet does NOT back it up.
          </label>
        </>
      ) : (
        <>
          <label className="cap">Paste your PQM-1 recovery phrase</label>
          <textarea
            className="w-live-input mono"
            value={imported}
            onChange={(e) => setImported(e.currentTarget.value)}
            rows={3}
            style={{
              width: "100%",
              marginTop: 4,
              marginBottom: 8,
              resize: "vertical",
              fontFamily: "var(--f-mono)",
            }}
            placeholder="twelve to twenty-four words separated by spaces"
            autoCapitalize="off"
            autoCorrect="off"
            spellCheck={false}
          />
        </>
      )}

      {error ? (
        <div className="cap" style={{ color: "var(--alert)", marginTop: 8 }}>
          ✗ {error}
        </div>
      ) : null}

      <div style={{ display: "flex", gap: 6, marginTop: 16 }}>
        <button className="btn btn--sm btn--primary" onClick={submit}>
          Continue
        </button>
        <button className="btn btn--sm btn--ghost" onClick={onBack}>
          Back
        </button>
      </div>
    </>
  );
}

function PasswordStep({
  isFirstVault,
  address,
  onBack,
  onNext,
}: {
  isFirstVault: boolean;
  address: string;
  onBack: () => void;
  onNext: (password: string) => void;
}) {
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);

  const submit = () => {
    setError(null);
    if (!password) {
      setError("Password is required");
      return;
    }
    if (isFirstVault) {
      if (password.length < 8) {
        setError("Master password must be at least 8 characters");
        return;
      }
      if (password !== confirm) {
        setError("Passwords don't match");
        return;
      }
    }
    onNext(password);
  };

  return (
    <>
      <div className="cap" style={{ marginBottom: 6 }}>
        Address for this vault: <Identity addr={address} />
      </div>

      {isFirstVault ? (
        <div
          className="w-banner"
          style={{
            marginBottom: 12,
            background: "rgba(var(--gold-glow), 0.05)",
            border: "1px solid var(--w-border)",
          }}
        >
          <div style={{ fontWeight: 600, marginBottom: 4 }}>
            Set your master password
          </div>
          <div style={{ fontSize: 12.5, color: "var(--w-text-2)" }}>
            One password unlocks every vault in this wallet. Pick something
            you'll remember — there's no recovery if you forget it.
          </div>
        </div>
      ) : (
        <div
          className="w-banner"
          style={{
            marginBottom: 12,
            background: "rgba(var(--gold-glow), 0.05)",
            border: "1px solid var(--w-border)",
          }}
        >
          <div style={{ fontWeight: 600, marginBottom: 4 }}>
            Enter your master password
          </div>
          <div style={{ fontSize: 12.5, color: "var(--w-text-2)" }}>
            The same password you use for your existing vaults.
          </div>
        </div>
      )}

      <label className="cap">
        {isFirstVault ? "New master password" : "Master password"}
      </label>
      <input
        type="password"
        className="w-live-input"
        value={password}
        onChange={(e) => setPassword(e.currentTarget.value)}
        autoFocus
        style={{ marginTop: 4, marginBottom: 12 }}
        autoComplete={isFirstVault ? "new-password" : "current-password"}
      />

      {isFirstVault ? (
        <>
          <label className="cap">Confirm password</label>
          <input
            type="password"
            className="w-live-input"
            value={confirm}
            onChange={(e) => setConfirm(e.currentTarget.value)}
            style={{ marginTop: 4, marginBottom: 12 }}
            autoComplete="new-password"
          />
        </>
      ) : null}

      {error ? (
        <div className="cap" style={{ color: "var(--alert)", marginTop: 4 }}>
          ✗ {error}
        </div>
      ) : null}

      <div style={{ display: "flex", gap: 6, marginTop: 12 }}>
        <button className="btn btn--sm btn--primary" onClick={submit}>
          Continue
        </button>
        <button className="btn btn--sm btn--ghost" onClick={onBack}>
          Back
        </button>
      </div>
    </>
  );
}

function ConfirmStep({
  label,
  address,
  isFirstVault,
  busy,
  error,
  onBack,
  onSubmit,
}: {
  label: string;
  address: string;
  isFirstVault: boolean;
  busy: boolean;
  error: string | null;
  onBack: () => void;
  onSubmit: () => void;
}) {
  return (
    <>
      <div className="w-kv">
        <span className="k">Label</span>
        <span className="v">{label}</span>
      </div>
      <div className="w-kv">
        <span className="k">Address</span>
        <span className="v mono" title={address}>
          {formatAddress(address)}
        </span>
      </div>
      <div className="w-kv">
        <span className="k">Master password</span>
        <span className="v">
          {isFirstVault ? "Set fresh" : "Existing"}
        </span>
      </div>
      <div
        className="cap"
        style={{ marginTop: 12, color: "var(--w-text-3)" }}
      >
        On commit the wallet generates a per-vault VEK, seals the
        ML-DSA-65 seed under it, wraps the VEK under the
        Argon2id-derived MEK, and persists the updated container.
      </div>
      {error ? (
        <div
          className="w-banner error"
          style={{ marginTop: 12 }}
        >
          ✗ {error}
        </div>
      ) : null}
      <div style={{ display: "flex", gap: 6, marginTop: 16 }}>
        <button
          className="btn btn--sm btn--primary"
          onClick={onSubmit}
          disabled={busy}
        >
          {busy ? "Saving…" : "Create vault"}
        </button>
        <button
          className="btn btn--sm btn--ghost"
          onClick={onBack}
          disabled={busy}
        >
          Back
        </button>
      </div>
    </>
  );
}
