// Multisig vault creation flow — Phase 6 §28.5 Q70.
//
// 4-step wizard:
//   1. Label + threshold visualization
//   2. Add signers (pick local vault OR paste external pubkey)
//   3. Set threshold (slider, defaults to ceil(M*2/3))
//   4. Review + commit
//
// Local-signer constraint (v1): the wallet must hold the local signer's
// ML-DSA-65 keypair to be able to sign on their behalf. To register the
// pubkey, the wallet briefly unseals the vault's seed and derives the
// 1952-byte ML-DSA-65 public key via the SDK's MlDsa65Backend. We
// require the active vault (already unlocked) as the only local-signer
// option — picking other local vaults would require a second unlock
// prompt; deferred to Phase 7.
//
// External signers: user pastes the 0x + 3904 hex pubkey. The wallet
// derives the EIP-55 address Rust-side from the pubkey via keccak256.

import { useEffect, useMemo, useState } from "react";
import { MlDsa65Backend } from "@monolythium/core-sdk/crypto";
import { Identity } from "./Identity";
import { useVaults } from "../sdk/useVaults";
import { useMultisigs } from "../sdk/useMultisig";
import { MultisigInvokeError, type SignerInput } from "../sdk/multisig";
import { fetchAndUnlockVault } from "../sdk/keychain";
import { PRIMARY_ACCOUNT } from "../sdk/keychain";

interface Props {
  /** Closes the flow — fired on successful create or Cancel. */
  onClose: () => void;
  /** Optional callback after a successful create. */
  onCreated?: (multisigId: string) => void;
}

type Step =
  | { kind: "label" }
  | { kind: "signers"; label: string }
  | { kind: "threshold"; label: string; signers: SignerInputWithPreview[] }
  | {
      kind: "review";
      label: string;
      signers: SignerInputWithPreview[];
      threshold: number;
    };

/** Signer entry as the wizard tracks it — adds a preview address so
 *  the UI can show it before the final Rust derivation. */
interface SignerInputWithPreview extends SignerInput {
  /** UI-rendered short address derived from pubkey, for review. May be
   *  empty when the pubkey is the all-zero placeholder. */
  previewAddress: string;
}

export function MultisigCreateFlow({ onClose, onCreated }: Props) {
  const multisigs = useMultisigs();
  const [step, setStep] = useState<Step>({ kind: "label" });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [password, setPassword] = useState("");

  return (
    <div className="w-card" style={{ marginBottom: 16, borderColor: "var(--gold-hi)" }}>
      <div className="w-card__head">
        <h3>Create multisig vault</h3>
        <span className="cap" style={{ color: "var(--w-text-3)" }}>
          {step.kind === "label"
            ? "Step 1 of 4"
            : step.kind === "signers"
              ? "Step 2 of 4"
              : step.kind === "threshold"
                ? "Step 3 of 4"
                : "Step 4 of 4"}
        </span>
        <button className="btn btn--sm btn--ghost" onClick={onClose}>
          Cancel
        </button>
      </div>
      <div className="w-card__body">
        {step.kind === "label" ? (
          <LabelStep onNext={(label) => setStep({ kind: "signers", label })} />
        ) : null}
        {step.kind === "signers" ? (
          <SignersStep
            label={step.label}
            onBack={() => setStep({ kind: "label" })}
            onNext={(signers) =>
              setStep({ kind: "threshold", label: step.label, signers })
            }
          />
        ) : null}
        {step.kind === "threshold" ? (
          <ThresholdStep
            label={step.label}
            signers={step.signers}
            onBack={() =>
              setStep({ kind: "signers", label: step.label })
            }
            onNext={(threshold) =>
              setStep({
                kind: "review",
                label: step.label,
                signers: step.signers,
                threshold,
              })
            }
          />
        ) : null}
        {step.kind === "review" ? (
          <ReviewStep
            label={step.label}
            signers={step.signers}
            threshold={step.threshold}
            password={password}
            setPassword={setPassword}
            busy={busy}
            error={error}
            onBack={() =>
              setStep({
                kind: "threshold",
                label: step.label,
                signers: step.signers,
              })
            }
            onSubmit={async () => {
              setBusy(true);
              setError(null);
              try {
                const created = await multisigs.create({
                  label: step.label,
                  signers: step.signers.map(({ previewAddress: _p, ...rest }) => {
                    void _p;
                    return rest;
                  }),
                  threshold: step.threshold,
                  password,
                });
                onCreated?.(created.id);
                onClose();
              } catch (cause) {
                const msg =
                  cause instanceof MultisigInvokeError
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

// ─── Step 1: label ────────────────────────────────────────────────

function LabelStep({ onNext }: { onNext: (label: string) => void }) {
  const [label, setLabel] = useState("");
  return (
    <>
      <label className="cap">Vault label</label>
      <input
        className="w-live-input"
        value={label}
        onChange={(e) => setLabel(e.currentTarget.value)}
        placeholder="e.g. Treasury, DAO Multisig, Hardware Backup"
        autoFocus
        style={{ marginTop: 4, marginBottom: 12 }}
      />
      <div className="row-help">
        A short label you'll recognize in the vault picker. The multisig
        vault gets its own deterministic address derived from the
        signers + threshold (no separate seed).
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

// ─── Step 2: signers ──────────────────────────────────────────────

function SignersStep({
  label,
  onBack,
  onNext,
}: {
  label: string;
  onBack: () => void;
  onNext: (signers: SignerInputWithPreview[]) => void;
}) {
  const vaults = useVaults();
  const [signers, setSigners] = useState<SignerInputWithPreview[]>([]);
  const [addOpen, setAddOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const activeVault = vaults.active;

  // The "active vault as local signer" affordance is offered when the
  // active vault isn't already in the signers list. Phase 7 will lift
  // the single-active-vault constraint.
  const canAddLocal =
    activeVault !== null &&
    !signers.some((s) => s.kind === "local" && s.vaultId === activeVault.id);

  const removeSigner = (idx: number) =>
    setSigners((arr) => arr.filter((_, i) => i !== idx));

  const submit = () => {
    if (signers.length === 0) {
      setError("Add at least one signer");
      return;
    }
    if (signers.length > 15) {
      setError("Maximum 15 signers per multisig");
      return;
    }
    setError(null);
    onNext(signers);
  };

  return (
    <>
      <div className="cap" style={{ marginBottom: 8 }}>
        Vault: {label}
      </div>
      <div className="row-help" style={{ marginBottom: 12 }}>
        Add signers — at least one. Each signer's ML-DSA-65 pubkey is
        stored so the wallet can collect M-of-N signatures.
      </div>

      {signers.length === 0 ? (
        <div
          style={{
            padding: 12,
            border: "1px dashed var(--w-border)",
            borderRadius: 6,
            color: "var(--w-text-3)",
            fontSize: 12.5,
            marginBottom: 12,
          }}
        >
          No signers yet. Use the buttons below to add one.
        </div>
      ) : (
        <div style={{ marginBottom: 12 }}>
          {signers.map((s, idx) => (
            <div
              key={idx}
              style={{
                display: "grid",
                gridTemplateColumns: "auto 1fr auto auto",
                gap: 8,
                alignItems: "center",
                padding: "8px 0",
                borderBottom: "1px solid var(--w-border)",
              }}
            >
              <span
                className="cap"
                style={{
                  padding: "2px 6px",
                  borderRadius: 6,
                  border: "1px solid var(--w-border)",
                  color: s.kind === "local" ? "var(--ok)" : "var(--w-text-2)",
                }}
              >
                {s.kind}
              </span>
              <div>
                <div style={{ fontSize: 12.5, fontWeight: 600 }}>{s.label}</div>
                <div className="cap" style={{ marginTop: 2 }}>
                  {s.previewAddress ? (
                    <Identity addr={s.previewAddress} />
                  ) : (
                    "pending derivation"
                  )}
                </div>
              </div>
              <span />
              <button
                className="btn btn--sm btn--ghost"
                onClick={() => removeSigner(idx)}
                style={{ color: "var(--alert)" }}
              >
                Remove
              </button>
            </div>
          ))}
        </div>
      )}

      {!addOpen ? (
        <div style={{ display: "flex", gap: 6 }}>
          <button
            className="btn btn--sm"
            onClick={() => setAddOpen(true)}
          >
            + Add signer
          </button>
        </div>
      ) : (
        <AddSignerForm
          canAddLocal={canAddLocal}
          activeVault={activeVault}
          onCancel={() => setAddOpen(false)}
          onAdd={(signer) => {
            setSigners((arr) => [...arr, signer]);
            setAddOpen(false);
            setError(null);
          }}
        />
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

function AddSignerForm({
  canAddLocal,
  activeVault,
  onCancel,
  onAdd,
}: {
  canAddLocal: boolean;
  activeVault: { id: string; label: string; address: string } | null;
  onCancel: () => void;
  onAdd: (signer: SignerInputWithPreview) => void;
}) {
  const [mode, setMode] = useState<"local" | "external">(
    canAddLocal ? "local" : "external",
  );
  const [externalLabel, setExternalLabel] = useState("");
  const [externalPubkey, setExternalPubkey] = useState("");
  const [localPassword, setLocalPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setError(null);
    setBusy(true);
    try {
      if (mode === "local") {
        if (!activeVault) {
          setError("No active vault");
          return;
        }
        if (!localPassword) {
          setError("Master password required to derive the local signer's pubkey");
          return;
        }
        // Briefly unseal the active vault, derive ML-DSA pubkey hex,
        // then drop the seed.
        const seed = await fetchAndUnlockVault(PRIMARY_ACCOUNT, localPassword);
        try {
          const backend = MlDsa65Backend.fromSeed(seed);
          const pubkeyBytes = backend.publicKey();
          const pubkeyHex =
            "0x" +
            Array.from(pubkeyBytes, (b) => b.toString(16).padStart(2, "0")).join("");
          onAdd({
            label: activeVault.label || "Local signer",
            pubkey: pubkeyHex,
            kind: "local",
            vaultId: activeVault.id,
            previewAddress: activeVault.address,
          });
        } finally {
          seed.fill(0);
        }
      } else {
        const trimmedLabel = externalLabel.trim();
        if (!trimmedLabel) {
          setError("Label is required");
          return;
        }
        const pubkey = externalPubkey.trim().toLowerCase();
        if (!/^0x[0-9a-f]{3904}$/i.test(pubkey)) {
          setError("Pubkey must be 0x + 3904 hex chars (1952 bytes)");
          return;
        }
        const previewAddress = await deriveAddressFromPubkey(pubkey);
        onAdd({
          label: trimmedLabel,
          pubkey,
          kind: "external",
          previewAddress,
        });
      }
    } catch (cause) {
      setError((cause as Error)?.message ?? String(cause));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      style={{
        padding: 12,
        border: "1px solid var(--w-border)",
        borderRadius: 6,
        background: "var(--w-surface, transparent)",
      }}
    >
      <div className="cap" style={{ marginBottom: 8 }}>
        Add signer
      </div>
      <div style={{ display: "flex", gap: 6, marginBottom: 12 }}>
        <button
          type="button"
          className={`btn btn--sm ${mode === "local" ? "btn--primary" : "btn--ghost"}`}
          onClick={() => setMode("local")}
          disabled={!canAddLocal}
          title={
            canAddLocal ? undefined : "Active vault is already a signer, or no local vault available"
          }
        >
          Local (active vault)
        </button>
        <button
          type="button"
          className={`btn btn--sm ${mode === "external" ? "btn--primary" : "btn--ghost"}`}
          onClick={() => setMode("external")}
        >
          External (pubkey)
        </button>
      </div>

      {mode === "local" && activeVault ? (
        <>
          <div
            style={{
              padding: 8,
              border: "1px solid var(--w-border)",
              borderRadius: 4,
              marginBottom: 12,
              fontSize: 12.5,
            }}
          >
            <div style={{ fontWeight: 600 }}>{activeVault.label}</div>
            <div className="cap" style={{ marginTop: 2 }}>
              <Identity addr={activeVault.address} />
            </div>
          </div>
          <label className="cap">Master password</label>
          <input
            type="password"
            className="w-live-input"
            value={localPassword}
            onChange={(e) => setLocalPassword(e.currentTarget.value)}
            style={{ marginTop: 4, marginBottom: 8 }}
            autoComplete="current-password"
          />
          <div className="row-help">
            The wallet briefly unseals the vault to read its ML-DSA-65
            public key. The seed is wiped immediately after.
          </div>
        </>
      ) : null}

      {mode === "external" ? (
        <>
          <label className="cap">Signer label</label>
          <input
            className="w-live-input"
            value={externalLabel}
            onChange={(e) => setExternalLabel(e.currentTarget.value)}
            placeholder="e.g. Cofounder A, Cold backup"
            style={{ marginTop: 4, marginBottom: 12 }}
            maxLength={32}
          />
          <label className="cap">ML-DSA-65 public key (1952 bytes)</label>
          <textarea
            className="w-live-input mono"
            value={externalPubkey}
            onChange={(e) => setExternalPubkey(e.currentTarget.value)}
            placeholder="0x… (3904 hex chars)"
            rows={3}
            style={{
              marginTop: 4,
              marginBottom: 8,
              width: "100%",
              fontFamily: "var(--f-mono)",
              fontSize: 11,
            }}
            spellCheck={false}
            autoCapitalize="off"
            autoCorrect="off"
          />
          <div className="row-help">
            The external signer's wallet exports their 1952-byte ML-DSA-65
            public key. The address is derived deterministically.
          </div>
        </>
      ) : null}

      {error ? (
        <div className="cap" style={{ color: "var(--alert)", marginTop: 8 }}>
          ✗ {error}
        </div>
      ) : null}

      <div style={{ display: "flex", gap: 6, marginTop: 12 }}>
        <button
          className="btn btn--sm btn--primary"
          onClick={() => void submit()}
          disabled={busy}
        >
          {busy ? "Adding…" : "Add signer"}
        </button>
        <button className="btn btn--sm btn--ghost" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </div>
  );
}

// ─── Step 3: threshold ────────────────────────────────────────────

function ThresholdStep({
  label,
  signers,
  onBack,
  onNext,
}: {
  label: string;
  signers: SignerInputWithPreview[];
  onBack: () => void;
  onNext: (threshold: number) => void;
}) {
  const n = signers.length;
  const defaultThreshold = useMemo(() => Math.floor(n / 2) + 1, [n]);
  const [threshold, setThreshold] = useState<number>(defaultThreshold);

  useEffect(() => {
    setThreshold(defaultThreshold);
  }, [defaultThreshold]);

  return (
    <>
      <div className="cap" style={{ marginBottom: 8 }}>
        Vault: {label} · {n} signers
      </div>
      <label className="cap">
        Threshold (M) — how many signers must approve each transaction
      </label>
      <div style={{ marginTop: 8, display: "flex", alignItems: "center", gap: 12 }}>
        <input
          type="range"
          min={1}
          max={n}
          value={threshold}
          onChange={(e) => setThreshold(Number(e.currentTarget.value))}
          style={{ flex: 1 }}
        />
        <span
          className="mono"
          style={{ fontWeight: 600, minWidth: 60, textAlign: "right" }}
        >
          {threshold} of {n}
        </span>
      </div>
      <div className="row-help" style={{ marginTop: 8 }}>
        Default is a simple majority (⌊N/2⌋ + 1 = {defaultThreshold}). Use
        a higher value for more security, lower for faster coordination.
      </div>
      <div style={{ display: "flex", gap: 6, marginTop: 16 }}>
        <button className="btn btn--sm btn--primary" onClick={() => onNext(threshold)}>
          Continue
        </button>
        <button className="btn btn--sm btn--ghost" onClick={onBack}>
          Back
        </button>
      </div>
    </>
  );
}

// ─── Step 4: review ───────────────────────────────────────────────

function ReviewStep({
  label,
  signers,
  threshold,
  password,
  setPassword,
  busy,
  error,
  onBack,
  onSubmit,
}: {
  label: string;
  signers: SignerInputWithPreview[];
  threshold: number;
  password: string;
  setPassword: (s: string) => void;
  busy: boolean;
  error: string | null;
  onBack: () => void;
  onSubmit: () => void | Promise<void>;
}) {
  return (
    <>
      <div className="w-kv">
        <span className="k">Label</span>
        <span className="v">{label}</span>
      </div>
      <div className="w-kv">
        <span className="k">Threshold</span>
        <span className="v">
          {threshold} of {signers.length}
        </span>
      </div>
      <div className="cap" style={{ marginTop: 12, marginBottom: 8 }}>
        Signers ({signers.length})
      </div>
      <div
        style={{
          border: "1px solid var(--w-border)",
          borderRadius: 6,
          padding: 8,
          marginBottom: 12,
        }}
      >
        {signers.map((s, idx) => (
          <div
            key={idx}
            style={{
              display: "grid",
              gridTemplateColumns: "auto 1fr auto",
              gap: 8,
              alignItems: "center",
              padding: "4px 0",
              borderBottom:
                idx < signers.length - 1 ? "1px solid var(--w-border)" : "none",
            }}
          >
            <span
              className="cap"
              style={{
                padding: "1px 6px",
                borderRadius: 6,
                border: "1px solid var(--w-border)",
                color: s.kind === "local" ? "var(--ok)" : "var(--w-text-2)",
              }}
            >
              {s.kind}
            </span>
            <div style={{ fontSize: 12.5, fontWeight: 600 }}>{s.label}</div>
            <Identity addr={s.previewAddress} />
          </div>
        ))}
      </div>
      <div className="cap" style={{ marginBottom: 4 }}>
        Master password (verifies your wallet before committing)
      </div>
      <input
        type="password"
        className="w-live-input"
        value={password}
        onChange={(e) => setPassword(e.currentTarget.value)}
        autoComplete="current-password"
        style={{ marginBottom: 12 }}
      />
      {error ? (
        <div className="w-banner error" style={{ marginBottom: 12 }}>
          ✗ {error}
        </div>
      ) : null}
      <div className="cap" style={{ color: "var(--w-text-3)", marginBottom: 12 }}>
        On commit the wallet computes the multisig vault's deterministic
        address (keccak256 over sorted signer pubkeys + threshold) and
        persists the record alongside your single-signer vaults.
      </div>
      <div style={{ display: "flex", gap: 6 }}>
        <button
          className="btn btn--sm btn--primary"
          onClick={() => void onSubmit()}
          disabled={busy || !password}
        >
          {busy ? "Creating…" : "Create multisig vault"}
        </button>
        <button className="btn btn--sm btn--ghost" onClick={onBack} disabled={busy}>
          Back
        </button>
      </div>
    </>
  );
}

// ─── Helpers ───────────────────────────────────────────────────────

/** Derive the EIP-55-shaped address from a hex pubkey via
 *  keccak256(pubkey)[12..32]. Returns "" on malformed input — the UI
 *  shows "pending derivation" in that case. */
async function deriveAddressFromPubkey(pubkeyHex: string): Promise<string> {
  try {
    const stripped = pubkeyHex.startsWith("0x") ? pubkeyHex.slice(2) : pubkeyHex;
    if (stripped.length !== 1952 * 2) return "";
    const bytes = new Uint8Array(1952);
    for (let i = 0; i < 1952; i += 1) {
      bytes[i] = Number.parseInt(stripped.slice(i * 2, i * 2 + 2), 16);
    }
    // Use the @noble/hashes keccak256 — it's a transitive dep via
    // ethers' bundle, but accessed directly here for clarity.
    const { keccak256 } = await import("ethers");
    const hashHex = keccak256(bytes);
    // hashHex is 0x + 64 chars; last 40 hex chars = 20-byte address.
    return "0x" + hashHex.slice(-40);
  } catch {
    return "";
  }
}
