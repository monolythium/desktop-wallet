// Proposals — Phase 6 multisig dashboard.
//
// Lists every proposal for the active multisig vault, with a row-level
// expansion that surfaces signers' status (✓ collected, · pending) and
// per-state actions (sign / cancel / mark-submitted). Co-signing happens
// here: enter master password → unseal active single-vault → derive
// ML-DSA-65 backend → sign payload_hash → attach signature.
//
// V1 scope:
//   - Read-only view of proposals + signature progress.
//   - Co-sign flow for members whose local single-vault is in the signer
//     set (the active single-vault's seed; we don't ask which one).
//   - Cancel (creator only — backend enforces).
//   - Mark-submitted CTA when the proposal is in ReadyToSubmit state;
//     V1 records the tx_hash the user pastes in. Commit 11 wires this
//     into the actual broadcast.
//
// Out of V1 (handled in later commits):
//   - QR / text off-band signature import (Commit 9).
//   - Auto-routing the bundled tx broadcast (Commit 11).

import { useMemo, useState } from "react";
import { Identity } from "../components/Identity";
import { useMultisigs, useProposals } from "../sdk/useMultisig";
import { MultisigInvokeError, type Proposal } from "../sdk/multisig";
import { fetchAndUnlockVault, PRIMARY_ACCOUNT } from "../sdk/keychain";
import { MlDsa65Backend } from "@monolythium/core-sdk/crypto";

export function Proposals() {
  const multisigs = useMultisigs();
  const active = multisigs.active;
  const proposalsApi = useProposals(active?.id ?? null);

  if (multisigs.state.status === "loading") {
    return (
      <div className="w-page">
        <h2>Proposals</h2>
        <div className="cap" style={{ color: "var(--w-text-3)" }}>
          Loading…
        </div>
      </div>
    );
  }

  if (!active) {
    return (
      <div className="w-page">
        <h2>Proposals</h2>
        <div className="w-card" style={{ marginTop: 12 }}>
          <div className="w-card__body" style={{ padding: 16 }}>
            <div className="row-help">
              No multisig vault is active. Switch to a multisig from the
              vault picker (top of the sidebar) to see proposals here.
            </div>
          </div>
        </div>
      </div>
    );
  }

  const proposals = proposalsApi.state.proposals;

  return (
    <div className="w-page">
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <h2 style={{ margin: 0 }}>Proposals</h2>
        <span
          className="cap"
          style={{
            padding: "2px 8px",
            borderRadius: 8,
            border: "1px solid var(--w-border)",
            color: "var(--gold-hi, var(--w-text-2))",
          }}
        >
          {active.label} · {active.threshold} of {active.signerCount}
        </span>
      </div>
      <div
        className="cap"
        style={{ marginTop: 8, color: "var(--w-text-3)" }}
      >
        <Identity addr={active.address} />
      </div>

      {proposalsApi.state.status === "error" ? (
        <div className="w-banner error" style={{ marginTop: 12 }}>
          ✗ {proposalsApi.state.error?.message ?? "Failed to load proposals"}
        </div>
      ) : null}

      {proposals.length === 0 ? (
        <div className="w-card" style={{ marginTop: 16 }}>
          <div className="w-card__body" style={{ padding: 16 }}>
            <div className="row-help">
              No proposals yet. Send LYTH, transfer tokens, or perform
              another operation while this multisig is the active vault —
              the wallet will route the work through a draft proposal that
              shows up here.
            </div>
          </div>
        </div>
      ) : (
        <div style={{ marginTop: 16, display: "flex", flexDirection: "column", gap: 8 }}>
          {proposals.map((p) => (
            <ProposalCard
              key={p.id}
              proposal={p}
              activeMultisig={active}
              onSign={async (args) => {
                await proposalsApi.sign(args);
              }}
              onCancel={async (byAddress) => {
                await proposalsApi.cancel(p.id, byAddress);
              }}
              onMarkSubmitted={async (txHash) => {
                await proposalsApi.markSubmitted(p.id, txHash);
              }}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Proposal card ────────────────────────────────────────────────

interface ProposalCardProps {
  proposal: Proposal;
  activeMultisig: {
    id: string;
    threshold: number;
    signerCount: number;
    signers: { id: string; label: string; address: string; kind: "local" | "external" }[];
  };
  onSign: (args: {
    proposalId: string;
    signerAddress: string;
    signature: Uint8Array;
  }) => Promise<void>;
  onCancel: (byAddress: string) => Promise<void>;
  onMarkSubmitted: (txHash: string) => Promise<void>;
}

function ProposalCard({
  proposal,
  activeMultisig,
  onSign,
  onCancel,
  onMarkSubmitted,
}: ProposalCardProps) {
  const [expanded, setExpanded] = useState(false);
  const [signOpen, setSignOpen] = useState(false);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [submitOpen, setSubmitOpen] = useState(false);

  const signedAddresses = useMemo(
    () => new Set(proposal.signatures.map((s) => s.signerAddress.toLowerCase())),
    [proposal.signatures],
  );
  const collected = proposal.signatures.length;
  const needed = activeMultisig.threshold;
  const terminal =
    proposal.state === "submitted" ||
    proposal.state === "failed" ||
    proposal.state === "expired" ||
    proposal.state === "cancelled";

  return (
    <div className="w-card" style={{ padding: 0 }}>
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        style={{
          width: "100%",
          textAlign: "left",
          background: "transparent",
          border: "none",
          padding: "10px 14px",
          cursor: "pointer",
          display: "grid",
          gridTemplateColumns: "auto 1fr auto",
          gap: 12,
          alignItems: "center",
          color: "var(--w-text-1)",
        }}
        aria-expanded={expanded}
      >
        <span style={{ width: 12 }}>{expanded ? "▾" : "▸"}</span>
        <div>
          <div style={{ fontSize: 13, fontWeight: 600 }}>
            {proposal.operation}{" "}
            <span
              className="cap"
              style={{
                marginLeft: 6,
                padding: "1px 6px",
                borderRadius: 6,
                border: "1px solid var(--w-border)",
                color: stateColor(proposal.state),
              }}
            >
              {proposal.state}
            </span>
          </div>
          <div
            className="cap"
            style={{ marginTop: 2, color: "var(--w-text-3)" }}
          >
            {collected} / {needed} signatures · expires{" "}
            {formatRelative(proposal.expiresAt)}
          </div>
        </div>
        <div
          className="mono"
          style={{ fontSize: 11, color: "var(--w-text-3)" }}
        >
          {proposal.id.slice(0, 8)}…
        </div>
      </button>
      {expanded ? (
        <div
          style={{
            padding: "0 14px 14px",
            borderTop: "1px solid var(--w-border)",
          }}
        >
          <div className="cap" style={{ marginTop: 10, marginBottom: 6 }}>
            Signers
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            {activeMultisig.signers.map((s) => {
              const signed = signedAddresses.has(s.address.toLowerCase());
              return (
                <div
                  key={s.id}
                  style={{
                    display: "grid",
                    gridTemplateColumns: "auto 1fr auto",
                    gap: 8,
                    alignItems: "center",
                    padding: "4px 0",
                    fontSize: 12.5,
                  }}
                >
                  <span style={{ width: 16, color: signed ? "var(--ok)" : "var(--w-text-3)" }}>
                    {signed ? "✓" : "·"}
                  </span>
                  <span>
                    <span style={{ fontWeight: 600 }}>{s.label}</span>{" "}
                    <span
                      className="cap"
                      style={{ marginLeft: 6, color: "var(--w-text-3)" }}
                    >
                      {s.kind}
                    </span>
                  </span>
                  <Identity addr={s.address} />
                </div>
              );
            })}
          </div>

          <div className="cap" style={{ marginTop: 10, marginBottom: 4 }}>
            Payload hash
          </div>
          <div
            className="mono"
            style={{
              fontSize: 11,
              color: "var(--w-text-2)",
              wordBreak: "break-all",
            }}
          >
            {proposal.payloadHash}
          </div>

          <div style={{ display: "flex", gap: 6, marginTop: 12, flexWrap: "wrap" }}>
            {!terminal ? (
              <button
                className="btn btn--sm btn--primary"
                onClick={() => setSignOpen(true)}
              >
                Sign as this wallet
              </button>
            ) : null}
            {proposal.state === "ready_to_submit" ? (
              <button
                className="btn btn--sm"
                onClick={() => setSubmitOpen(true)}
              >
                Mark submitted
              </button>
            ) : null}
            {!terminal ? (
              <button
                className="btn btn--sm btn--ghost"
                style={{ color: "var(--alert)" }}
                onClick={() => setCancelOpen(true)}
              >
                Cancel proposal
              </button>
            ) : null}
          </div>
        </div>
      ) : null}

      {signOpen ? (
        <SignPasswordModal
          proposal={proposal}
          activeMultisig={activeMultisig}
          onClose={() => setSignOpen(false)}
          onSign={onSign}
        />
      ) : null}
      {cancelOpen ? (
        <CancelModal
          onClose={() => setCancelOpen(false)}
          onConfirm={async (byAddress) => {
            await onCancel(byAddress);
            setCancelOpen(false);
          }}
        />
      ) : null}
      {submitOpen ? (
        <MarkSubmittedModal
          onClose={() => setSubmitOpen(false)}
          onConfirm={async (txHash) => {
            await onMarkSubmitted(txHash);
            setSubmitOpen(false);
          }}
        />
      ) : null}
    </div>
  );
}

// ─── Sign modal ───────────────────────────────────────────────────

function SignPasswordModal({
  proposal,
  activeMultisig,
  onClose,
  onSign,
}: {
  proposal: Proposal;
  activeMultisig: ProposalCardProps["activeMultisig"];
  onClose: () => void;
  onSign: ProposalCardProps["onSign"];
}) {
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (!password) {
      setError("Master password required");
      return;
    }
    setBusy(true);
    setError(null);
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
      const isMember = activeMultisig.signers.some(
        (s) => s.address.toLowerCase() === myAddress,
      );
      if (!isMember) {
        setError("Your active single-vault is not a signer of this multisig.");
        return;
      }
      if (
        proposal.signatures.some(
          (s) => s.signerAddress.toLowerCase() === myAddress,
        )
      ) {
        setError("You've already signed this proposal.");
        return;
      }
      const hashHex = proposal.payloadHash.startsWith("0x")
        ? proposal.payloadHash.slice(2)
        : proposal.payloadHash;
      const bytes = new Uint8Array(hashHex.length / 2);
      for (let i = 0; i < hashHex.length; i += 2) {
        bytes[i / 2] = Number.parseInt(hashHex.slice(i, i + 2), 16);
      }
      const signature = backend.signPrehash(bytes);
      await onSign({
        proposalId: proposal.id,
        signerAddress: myAddress,
        signature,
      });
      onClose();
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
    <ModalOverlay onDismiss={onClose}>
      <div className="w-card">
        <div className="w-card__head">
          <h3>Sign proposal</h3>
          <button className="btn btn--sm btn--ghost" onClick={onClose}>
            Cancel
          </button>
        </div>
        <div className="w-card__body">
          <div className="cap" style={{ marginBottom: 8 }}>
            Master password
          </div>
          <input
            type="password"
            className="w-live-input"
            value={password}
            onChange={(e) => setPassword(e.currentTarget.value)}
            autoComplete="current-password"
            autoFocus
            disabled={busy}
            style={{ marginBottom: 8 }}
          />
          <div className="row-help">
            The wallet unseals your single-vault to derive its ML-DSA-65
            key and signs the proposal's payload hash. The seed is wiped
            immediately after.
          </div>
          {error ? (
            <div className="w-banner error" style={{ marginTop: 12 }}>
              ✗ {error}
            </div>
          ) : null}
          <div style={{ display: "flex", gap: 6, marginTop: 16 }}>
            <button
              className="btn btn--sm btn--primary"
              onClick={() => void submit()}
              disabled={busy || !password}
            >
              {busy ? "Signing…" : "Sign and attach"}
            </button>
            <button className="btn btn--sm btn--ghost" onClick={onClose} disabled={busy}>
              Cancel
            </button>
          </div>
        </div>
      </div>
    </ModalOverlay>
  );
}

// ─── Cancel + Mark-submitted modals ──────────────────────────────

function CancelModal({
  onClose,
  onConfirm,
}: {
  onClose: () => void;
  onConfirm: (byAddress: string) => Promise<void>;
}) {
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    if (!password) {
      setError("Master password required");
      return;
    }
    setBusy(true);
    setError(null);
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
      await onConfirm(myAddress);
    } catch (cause) {
      setError((cause as Error)?.message ?? String(cause));
    } finally {
      seed.fill(0);
      setBusy(false);
    }
  };
  return (
    <ModalOverlay onDismiss={onClose}>
      <div className="w-card" style={{ borderColor: "var(--alert)" }}>
        <div className="w-card__head">
          <h3>Cancel proposal</h3>
          <button className="btn btn--sm btn--ghost" onClick={onClose}>
            Cancel
          </button>
        </div>
        <div className="w-card__body">
          <div className="w-banner error" style={{ marginBottom: 12 }}>
            Only the creator can cancel. The backend rejects this if your
            address doesn't match.
          </div>
          <div className="cap" style={{ marginBottom: 4 }}>
            Master password (to derive your address)
          </div>
          <input
            type="password"
            className="w-live-input"
            value={password}
            onChange={(e) => setPassword(e.currentTarget.value)}
            autoComplete="current-password"
            autoFocus
            disabled={busy}
          />
          {error ? (
            <div className="cap" style={{ color: "var(--alert)", marginTop: 8 }}>
              ✗ {error}
            </div>
          ) : null}
          <div style={{ display: "flex", gap: 6, marginTop: 16 }}>
            <button
              className="btn btn--sm"
              style={{ background: "var(--alert)", color: "white" }}
              onClick={() => void submit()}
              disabled={busy || !password}
            >
              Cancel proposal
            </button>
            <button className="btn btn--sm btn--ghost" onClick={onClose} disabled={busy}>
              Back
            </button>
          </div>
        </div>
      </div>
    </ModalOverlay>
  );
}

function MarkSubmittedModal({
  onClose,
  onConfirm,
}: {
  onClose: () => void;
  onConfirm: (txHash: string) => Promise<void>;
}) {
  const [txHash, setTxHash] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const valid = /^0x[0-9a-fA-F]{64}$/.test(txHash.trim());
  return (
    <ModalOverlay onDismiss={onClose}>
      <div className="w-card">
        <div className="w-card__head">
          <h3>Mark proposal submitted</h3>
          <button className="btn btn--sm btn--ghost" onClick={onClose}>
            Cancel
          </button>
        </div>
        <div className="w-card__body">
          <div className="row-help" style={{ marginBottom: 12 }}>
            After the wallet broadcasts the bundled signed envelope, paste
            the transaction hash here to record the off-chain audit trail.
            Commit 11 wires this automatically.
          </div>
          <div className="cap" style={{ marginBottom: 4 }}>
            Transaction hash (0x + 64 hex chars)
          </div>
          <input
            className="w-live-input mono"
            value={txHash}
            onChange={(e) => setTxHash(e.currentTarget.value.trim())}
            placeholder="0x…"
            spellCheck={false}
            autoCapitalize="off"
            style={{ fontSize: 11 }}
          />
          {error ? (
            <div className="cap" style={{ color: "var(--alert)", marginTop: 8 }}>
              ✗ {error}
            </div>
          ) : null}
          <div style={{ display: "flex", gap: 6, marginTop: 16 }}>
            <button
              className="btn btn--sm btn--primary"
              onClick={async () => {
                setBusy(true);
                setError(null);
                try {
                  await onConfirm(txHash.trim());
                } catch (cause) {
                  setError((cause as Error)?.message ?? String(cause));
                } finally {
                  setBusy(false);
                }
              }}
              disabled={busy || !valid}
            >
              Record submission
            </button>
            <button className="btn btn--sm btn--ghost" onClick={onClose} disabled={busy}>
              Cancel
            </button>
          </div>
        </div>
      </div>
    </ModalOverlay>
  );
}

// ─── Helpers ───────────────────────────────────────────────────────

function stateColor(state: Proposal["state"]): string {
  switch (state) {
    case "draft":
    case "collecting":
      return "var(--w-text-2)";
    case "ready_to_submit":
      return "var(--ok)";
    case "submitted":
      return "var(--ok)";
    case "failed":
    case "expired":
    case "cancelled":
      return "var(--alert)";
  }
}

function formatRelative(unixSecs: number): string {
  const now = Date.now() / 1000;
  const delta = unixSecs - now;
  if (delta < 0) return "expired";
  if (delta < 3600) return `in ${Math.round(delta / 60)}m`;
  if (delta < 86400) return `in ${Math.round(delta / 3600)}h`;
  return `in ${Math.round(delta / 86400)}d`;
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
