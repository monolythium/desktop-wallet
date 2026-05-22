// ManageSignersModal — unified UI for all four governance operations
// on a multisig vault: threshold change, add signer, remove signer,
// rotate signer. Each tab builds the corresponding governance payload
// per `apply_governance_payload`'s wire format and routes it through
// `proposal_create` + `proposal_attach_signature` (the creator's own
// share). Co-signers approve from the Proposals page, then the
// "Apply governance change" button on that page applies the mutation.

import { useState } from "react";
import { MlDsa65Backend } from "@monolythium/core-sdk/crypto";
import {
  encodeGovernanceAddSigner,
  encodeGovernanceRemoveSigner,
  encodeGovernanceRotateSigner,
  encodeGovernanceSetThreshold,
  MultisigInvokeError,
  proposalAttachSignature,
  proposalCreate,
  type MultisigVaultSummary,
} from "../sdk/multisig";
import { fetchAndUnlockVault, PRIMARY_ACCOUNT } from "../sdk/keychain";

type Tab = "threshold" | "add" | "remove" | "rotate";

interface Props {
  multisig: MultisigVaultSummary;
  onClose: () => void;
  /** Optional initial tab — defaults to "threshold" for backward
   *  compatibility with the Phase 6 entry point. */
  initialTab?: Tab;
}

/** Shared finalize step: derive the creator's address from `seed`,
 *  validate membership, create the proposal, and attach the creator's
 *  signature. Returns `null` on success or an error message. */
async function finalize(args: {
  multisig: MultisigVaultSummary;
  seed: Uint8Array;
  payload: Uint8Array;
}): Promise<string | null> {
  try {
    const backend = MlDsa65Backend.fromSeed(args.seed);
    const myAddress = backend.getAddress().toLowerCase();
    const isMember = args.multisig.signers.some(
      (s) => s.address.toLowerCase() === myAddress,
    );
    if (!isMember) {
      return "Your active single-vault is not a signer of this multisig — you can't propose governance.";
    }
    const proposal = await proposalCreate({
      multisigVaultId: args.multisig.id,
      operation: "governance",
      payload: args.payload,
      createdByAddress: myAddress,
    });
    const hashHex = proposal.payloadHash.startsWith("0x")
      ? proposal.payloadHash.slice(2)
      : proposal.payloadHash;
    const bytes = new Uint8Array(hashHex.length / 2);
    for (let i = 0; i < hashHex.length; i += 2) {
      bytes[i / 2] = Number.parseInt(hashHex.slice(i, i + 2), 16);
    }
    const signature = backend.signPrehash(bytes);
    await proposalAttachSignature({
      proposalId: proposal.id,
      signerAddress: myAddress,
      signature,
    });
    return null;
  } catch (cause) {
    return cause instanceof MultisigInvokeError
      ? cause.message
      : (cause as Error)?.message ?? String(cause);
  }
}

export function ManageSignersModal({
  multisig,
  onClose,
  initialTab = "threshold",
}: Props) {
  const [tab, setTab] = useState<Tab>(initialTab);
  const [done, setDone] = useState(false);

  return (
    <ModalOverlay onDismiss={onClose}>
      <div className="w-card">
        <div className="w-card__head">
          <h3>Manage signers — {multisig.label}</h3>
          <button className="btn btn--sm btn--ghost" onClick={onClose}>
            Cancel
          </button>
        </div>
        <div
          style={{
            display: "flex",
            gap: 6,
            padding: "8px 16px",
            borderBottom: "1px solid var(--w-border)",
          }}
        >
          {(["threshold", "add", "remove", "rotate"] as Tab[]).map((t) => (
            <button
              key={t}
              type="button"
              className={`btn btn--sm ${tab === t ? "btn--primary" : "btn--ghost"}`}
              onClick={() => {
                setTab(t);
                setDone(false);
              }}
            >
              {t === "threshold"
                ? "Threshold"
                : t === "add"
                  ? "Add signer"
                  : t === "remove"
                    ? "Remove"
                    : "Rotate"}
            </button>
          ))}
        </div>
        <div className="w-card__body">
          {done ? (
            <DoneBanner onClose={onClose} />
          ) : tab === "threshold" ? (
            <ThresholdTab
              multisig={multisig}
              onDone={() => setDone(true)}
            />
          ) : tab === "add" ? (
            <AddSignerTab multisig={multisig} onDone={() => setDone(true)} />
          ) : tab === "remove" ? (
            <RemoveSignerTab multisig={multisig} onDone={() => setDone(true)} />
          ) : (
            <RotateSignerTab multisig={multisig} onDone={() => setDone(true)} />
          )}
        </div>
      </div>
    </ModalOverlay>
  );
}

function DoneBanner({ onClose }: { onClose: () => void }) {
  return (
    <>
      <div className="w-banner" style={{ marginBottom: 12 }}>
        Governance proposal created. Your signature is attached;
        remaining members co-sign from the Proposals page. Once the
        threshold is reached the "Apply governance change" button on
        that page will commit the change.
      </div>
      <div style={{ display: "flex", gap: 6 }}>
        <button className="btn btn--sm btn--primary" onClick={onClose}>
          Done
        </button>
      </div>
    </>
  );
}

// ─── Threshold tab ────────────────────────────────────────────────

function ThresholdTab({
  multisig,
  onDone,
}: {
  multisig: MultisigVaultSummary;
  onDone: () => void;
}) {
  const [value, setValue] = useState(multisig.threshold);
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setError(null);
    if (value === multisig.threshold) {
      setError("Pick a different threshold");
      return;
    }
    if (value < 1 || value > multisig.signerCount) {
      setError(`Threshold must be 1..=${multisig.signerCount}`);
      return;
    }
    if (!password) {
      setError("Master password required");
      return;
    }
    setBusy(true);
    const seed = await fetchAndUnlockVault(PRIMARY_ACCOUNT, password).catch(
      (cause) => {
        setError((cause as Error)?.message ?? String(cause));
        return null;
      },
    );
    if (!seed) {
      setBusy(false);
      return;
    }
    const err = await finalize({
      multisig,
      seed,
      payload: encodeGovernanceSetThreshold(value),
    });
    seed.fill(0);
    setBusy(false);
    if (err) setError(err);
    else onDone();
  };

  return (
    <>
      <div className="w-kv">
        <span className="k">Current</span>
        <span className="v">
          {multisig.threshold} of {multisig.signerCount}
        </span>
      </div>
      <div className="cap" style={{ marginTop: 12, marginBottom: 4 }}>
        New threshold
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
          min={1}
          max={multisig.signerCount}
          value={value}
          onChange={(e) => setValue(Number(e.currentTarget.value))}
          style={{ flex: 1 }}
        />
        <span
          className="mono"
          style={{ fontWeight: 600, minWidth: 60, textAlign: "right" }}
        >
          {value} of {multisig.signerCount}
        </span>
      </div>
      <PasswordRow
        password={password}
        setPassword={setPassword}
        disabled={busy}
        label="Master password (to sign the governance proposal)"
      />
      <ErrorBanner error={error} />
      <ActionRow
        primary={busy ? "Proposing…" : "Propose change"}
        primaryDisabled={busy || !password}
        onPrimary={() => void submit()}
      />
    </>
  );
}

// ─── Add signer tab ───────────────────────────────────────────────

function AddSignerTab({
  multisig,
  onDone,
}: {
  multisig: MultisigVaultSummary;
  onDone: () => void;
}) {
  const [label, setLabel] = useState("");
  const [pubkey, setPubkey] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setError(null);
    if (!label.trim()) {
      setError("Label required");
      return;
    }
    if (!/^0x[0-9a-f]{3904}$/i.test(pubkey.trim())) {
      setError("Pubkey must be 0x + 3904 hex chars (1952 bytes)");
      return;
    }
    if (multisig.signerCount >= 15) {
      setError("Multisig already at 15-signer hard cap");
      return;
    }
    if (!password) {
      setError("Master password required");
      return;
    }
    let payload: Uint8Array;
    try {
      payload = encodeGovernanceAddSigner({
        kind: "external",
        label: label.trim(),
        pubkey: pubkey.trim().toLowerCase(),
      });
    } catch (cause) {
      setError((cause as Error)?.message ?? String(cause));
      return;
    }
    setBusy(true);
    const seed = await fetchAndUnlockVault(PRIMARY_ACCOUNT, password).catch(
      (cause) => {
        setError((cause as Error)?.message ?? String(cause));
        return null;
      },
    );
    if (!seed) {
      setBusy(false);
      return;
    }
    const err = await finalize({ multisig, seed, payload });
    seed.fill(0);
    setBusy(false);
    if (err) setError(err);
    else onDone();
  };

  return (
    <>
      <div className="row-help" style={{ marginBottom: 12 }}>
        Adds an external signer to the multisig. The new signer must
        independently approve operations from this vault going forward.
        The vault's on-chain address does not change.
      </div>
      <label className="cap">Signer label</label>
      <input
        className="w-live-input"
        value={label}
        onChange={(e) => setLabel(e.currentTarget.value)}
        placeholder="e.g. Backup signer, Co-founder C"
        style={{ marginTop: 4, marginBottom: 12 }}
        maxLength={32}
      />
      <label className="cap">ML-DSA-65 public key (1952 bytes)</label>
      <textarea
        className="w-live-input mono"
        value={pubkey}
        onChange={(e) => setPubkey(e.currentTarget.value)}
        placeholder="0x… (3904 hex chars)"
        rows={3}
        style={{
          marginTop: 4,
          marginBottom: 12,
          width: "100%",
          fontFamily: "var(--f-mono)",
          fontSize: 11,
        }}
        spellCheck={false}
      />
      <PasswordRow
        password={password}
        setPassword={setPassword}
        disabled={busy}
        label="Master password"
      />
      <ErrorBanner error={error} />
      <ActionRow
        primary={busy ? "Proposing…" : "Propose add"}
        primaryDisabled={busy || !password || !label.trim() || !pubkey}
        onPrimary={() => void submit()}
      />
    </>
  );
}

// ─── Remove signer tab ────────────────────────────────────────────

function RemoveSignerTab({
  multisig,
  onDone,
}: {
  multisig: MultisigVaultSummary;
  onDone: () => void;
}) {
  const [targetId, setTargetId] = useState<string>(
    multisig.signers[0]?.id ?? "",
  );
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const wouldBreakThreshold =
    multisig.signerCount - 1 < multisig.threshold;

  const submit = async () => {
    setError(null);
    if (wouldBreakThreshold) {
      setError(
        `Removing leaves ${multisig.signerCount - 1} signers — below threshold ${multisig.threshold}`,
      );
      return;
    }
    const target = multisig.signers.find((s) => s.id === targetId);
    if (!target) {
      setError("Pick a signer");
      return;
    }
    if (!password) {
      setError("Master password required");
      return;
    }
    setBusy(true);
    const seed = await fetchAndUnlockVault(PRIMARY_ACCOUNT, password).catch(
      (cause) => {
        setError((cause as Error)?.message ?? String(cause));
        return null;
      },
    );
    if (!seed) {
      setBusy(false);
      return;
    }
    const err = await finalize({
      multisig,
      seed,
      payload: encodeGovernanceRemoveSigner(target.address),
    });
    seed.fill(0);
    setBusy(false);
    if (err) setError(err);
    else onDone();
  };

  return (
    <>
      <div className="row-help" style={{ marginBottom: 12 }}>
        Removes a signer from the roster. The vault's on-chain address
        does not change. After removal, the remaining signer count must
        still satisfy the threshold (M ≤ N).
      </div>
      {wouldBreakThreshold ? (
        <div className="w-banner error" style={{ marginBottom: 12 }}>
          Cannot remove — would leave {multisig.signerCount - 1} signers,
          below threshold {multisig.threshold}. Lower the threshold
          first via the Threshold tab.
        </div>
      ) : null}
      <label className="cap">Signer to remove</label>
      <select
        className="w-live-input"
        value={targetId}
        onChange={(e) => setTargetId(e.currentTarget.value)}
        style={{ marginTop: 4, marginBottom: 12, width: "100%" }}
        disabled={busy}
      >
        {multisig.signers.map((s) => (
          <option key={s.id} value={s.id}>
            {s.label} · {s.address.slice(0, 10)}… · {s.kind}
          </option>
        ))}
      </select>
      <PasswordRow
        password={password}
        setPassword={setPassword}
        disabled={busy}
        label="Master password"
      />
      <ErrorBanner error={error} />
      <ActionRow
        primary={busy ? "Proposing…" : "Propose remove"}
        primaryDisabled={busy || wouldBreakThreshold || !password}
        onPrimary={() => void submit()}
      />
    </>
  );
}

// ─── Rotate signer tab ────────────────────────────────────────────

function RotateSignerTab({
  multisig,
  onDone,
}: {
  multisig: MultisigVaultSummary;
  onDone: () => void;
}) {
  const [targetId, setTargetId] = useState<string>(
    multisig.signers[0]?.id ?? "",
  );
  const [newLabel, setNewLabel] = useState("");
  const [newPubkey, setNewPubkey] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const target = multisig.signers.find((s) => s.id === targetId);

  const submit = async () => {
    setError(null);
    if (!target) {
      setError("Pick a signer");
      return;
    }
    if (!newLabel.trim()) {
      setError("New label required");
      return;
    }
    if (!/^0x[0-9a-f]{3904}$/i.test(newPubkey.trim())) {
      setError("New pubkey must be 0x + 3904 hex chars");
      return;
    }
    if (!password) {
      setError("Master password required");
      return;
    }
    let payload: Uint8Array;
    try {
      payload = encodeGovernanceRotateSigner({
        oldAddress: target.address,
        newLabel: newLabel.trim(),
        newPubkey: newPubkey.trim().toLowerCase(),
      });
    } catch (cause) {
      setError((cause as Error)?.message ?? String(cause));
      return;
    }
    setBusy(true);
    const seed = await fetchAndUnlockVault(PRIMARY_ACCOUNT, password).catch(
      (cause) => {
        setError((cause as Error)?.message ?? String(cause));
        return null;
      },
    );
    if (!seed) {
      setBusy(false);
      return;
    }
    const err = await finalize({ multisig, seed, payload });
    seed.fill(0);
    setBusy(false);
    if (err) setError(err);
    else onDone();
  };

  return (
    <>
      <div className="row-help" style={{ marginBottom: 12 }}>
        Atomically replaces an existing signer's pubkey + label. The
        signer's stable id is preserved. Use this when a signer rotates
        their key without leaving the roster.
      </div>
      <label className="cap">Signer to rotate</label>
      <select
        className="w-live-input"
        value={targetId}
        onChange={(e) => setTargetId(e.currentTarget.value)}
        style={{ marginTop: 4, marginBottom: 12, width: "100%" }}
        disabled={busy}
      >
        {multisig.signers.map((s) => (
          <option key={s.id} value={s.id}>
            {s.label} · {s.address.slice(0, 10)}…
          </option>
        ))}
      </select>
      <label className="cap">New signer label</label>
      <input
        className="w-live-input"
        value={newLabel}
        onChange={(e) => setNewLabel(e.currentTarget.value)}
        placeholder={target?.label ?? "New label"}
        style={{ marginTop: 4, marginBottom: 12 }}
        maxLength={32}
      />
      <label className="cap">New ML-DSA-65 public key</label>
      <textarea
        className="w-live-input mono"
        value={newPubkey}
        onChange={(e) => setNewPubkey(e.currentTarget.value)}
        placeholder="0x… (3904 hex chars)"
        rows={3}
        style={{
          marginTop: 4,
          marginBottom: 12,
          width: "100%",
          fontFamily: "var(--f-mono)",
          fontSize: 11,
        }}
        spellCheck={false}
      />
      <PasswordRow
        password={password}
        setPassword={setPassword}
        disabled={busy}
        label="Master password"
      />
      <ErrorBanner error={error} />
      <ActionRow
        primary={busy ? "Proposing…" : "Propose rotate"}
        primaryDisabled={busy || !password || !newLabel.trim() || !newPubkey}
        onPrimary={() => void submit()}
      />
    </>
  );
}

// ─── Shared rows ──────────────────────────────────────────────────

function PasswordRow({
  password,
  setPassword,
  disabled,
  label,
}: {
  password: string;
  setPassword: (s: string) => void;
  disabled: boolean;
  label: string;
}) {
  return (
    <>
      <div className="cap" style={{ marginBottom: 4 }}>
        {label}
      </div>
      <input
        type="password"
        className="w-live-input"
        value={password}
        onChange={(e) => setPassword(e.currentTarget.value)}
        autoComplete="current-password"
        disabled={disabled}
        style={{ marginBottom: 8 }}
      />
    </>
  );
}

function ErrorBanner({ error }: { error: string | null }) {
  if (!error) return null;
  return (
    <div className="w-banner error" style={{ marginBottom: 12 }}>
      ✗ {error}
    </div>
  );
}

function ActionRow({
  primary,
  primaryDisabled,
  onPrimary,
}: {
  primary: string;
  primaryDisabled: boolean;
  onPrimary: () => void;
}) {
  return (
    <div style={{ display: "flex", gap: 6 }}>
      <button
        className="btn btn--sm btn--primary"
        onClick={onPrimary}
        disabled={primaryDisabled}
      >
        {primary}
      </button>
    </div>
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
      <div style={{ width: "100%", maxWidth: 520 }}>{children}</div>
    </div>
  );
}
