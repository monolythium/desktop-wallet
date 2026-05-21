// ChangeThresholdModal — opens a governance proposal that proposes a
// new M-of-N threshold for a multisig vault. Creator signs immediately;
// remaining signers co-sign from the Proposals page; the wallet applies
// the change via `multisig_apply_governance` once the proposal hits
// ReadyToSubmit.

import { useState } from "react";
import { MlDsa65Backend } from "@monolythium/core-sdk/crypto";
import {
  encodeGovernanceSetThreshold,
  MultisigInvokeError,
  proposalAttachSignature,
  proposalCreate,
  type MultisigVaultSummary,
} from "../sdk/multisig";
import { fetchAndUnlockVault, PRIMARY_ACCOUNT } from "../sdk/keychain";

interface Props {
  multisig: MultisigVaultSummary;
  onClose: () => void;
}

export function ChangeThresholdModal({ multisig, onClose }: Props) {
  const [newThreshold, setNewThreshold] = useState(multisig.threshold);
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  const submit = async () => {
    setError(null);
    if (newThreshold === multisig.threshold) {
      setError("Pick a different threshold");
      return;
    }
    if (newThreshold < 1 || newThreshold > multisig.signerCount) {
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
    try {
      const backend = MlDsa65Backend.fromSeed(seed);
      const myAddress = backend.getAddress().toLowerCase();
      const isMember = multisig.signers.some(
        (s) => s.address.toLowerCase() === myAddress,
      );
      if (!isMember) {
        setError(
          "Your active single-vault is not a signer of this multisig — you can't propose governance.",
        );
        return;
      }
      const payload = encodeGovernanceSetThreshold(newThreshold);
      const proposal = await proposalCreate({
        multisigVaultId: multisig.id,
        operation: "governance",
        payload,
        createdByAddress: myAddress,
      });
      // Sign payload_hash and attach the creator's signature.
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
      setDone(true);
    } catch (cause) {
      setError(
        cause instanceof MultisigInvokeError
          ? cause.message
          : (cause as Error)?.message ?? String(cause),
      );
    } finally {
      seed.fill(0);
      setBusy(false);
    }
  };

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
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div style={{ width: "100%", maxWidth: 520 }}>
        <div className="w-card">
          <div className="w-card__head">
            <h3>Change threshold — {multisig.label}</h3>
            <button className="btn btn--sm btn--ghost" onClick={onClose}>
              Cancel
            </button>
          </div>
          <div className="w-card__body">
            {done ? (
              <>
                <div className="w-banner" style={{ marginBottom: 12 }}>
                  Governance proposal created. Your signature is attached;
                  remaining members co-sign from the Proposals page. Once
                  the threshold is reached the proposal can be applied to
                  update {multisig.label}.
                </div>
                <div style={{ display: "flex", gap: 6 }}>
                  <button className="btn btn--sm btn--primary" onClick={onClose}>
                    Done
                  </button>
                </div>
              </>
            ) : (
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
                    value={newThreshold}
                    onChange={(e) =>
                      setNewThreshold(Number(e.currentTarget.value))
                    }
                    style={{ flex: 1 }}
                  />
                  <span
                    className="mono"
                    style={{ fontWeight: 600, minWidth: 60, textAlign: "right" }}
                  >
                    {newThreshold} of {multisig.signerCount}
                  </span>
                </div>
                <div className="row-help" style={{ marginBottom: 12 }}>
                  Lowering the threshold weakens the multisig; raising it
                  requires more co-signers per operation. Phase 6 ships
                  threshold-change governance only — add/remove/rotate
                  signer ops land in a later phase.
                </div>
                <div className="cap" style={{ marginBottom: 4 }}>
                  Master password (to sign the governance proposal)
                </div>
                <input
                  type="password"
                  className="w-live-input"
                  value={password}
                  onChange={(e) => setPassword(e.currentTarget.value)}
                  autoComplete="current-password"
                  disabled={busy}
                  style={{ marginBottom: 8 }}
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
                    disabled={busy || !password}
                  >
                    {busy ? "Proposing…" : "Propose change"}
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
      </div>
    </div>
  );
}
