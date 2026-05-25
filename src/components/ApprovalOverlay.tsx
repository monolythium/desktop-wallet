// Approval overlay — modal that pops whenever the Stele backend's
// approval bridge fires a `approval-required` event (MCP client / desktop MCP client /
// local tooling asking the wallet to sign something on the user's behalf).
//
// Renders the tool name + summary + raw prepared-tx JSON, gathers the
// user's decision, and resolves the bridge via stele_approval_resolve.
// Mounted from App.tsx only while Stele is enabled, so default builds
// pay no cost.

import { useCallback, useEffect, useState } from "react";
import {
  ApprovalCallError,
  listenApprovals,
  resolveApproval,
  type ApprovalEvent,
} from "../sdk/approval-bridge";

interface Pending {
  event: ApprovalEvent;
  // 3-second cooldown before approve is enabled (matches design brief §7.9).
  readyAt: number;
}

export function ApprovalOverlay() {
  const [pending, setPending] = useState<Pending | null>(null);
  const [now, setNow] = useState(Date.now());
  const [passphrase, setPassphrase] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let unlisten: (() => void) | null = null;
    let cancelled = false;
    listenApprovals((ev) => {
      // If a new request arrives while one is pending, keep the older
      // one in flight — the backend gates one resolve at a time anyway.
      setPending((prev) => prev ?? { event: ev, readyAt: Date.now() + 3000 });
    }).then((u) => {
      if (cancelled) {
        u?.();
        return;
      }
      unlisten = u;
    });
    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, []);

  // Tick the countdown so the Approve button enables itself.
  useEffect(() => {
    if (!pending) return;
    const t = window.setInterval(() => setNow(Date.now()), 250);
    return () => window.clearInterval(t);
  }, [pending]);

  const close = () => {
    setPending(null);
    setPassphrase("");
    setReason("");
    setError(null);
    setBusy(false);
  };

  const onResolve = useCallback(
    async (approved: boolean) => {
      if (!pending) return;
      setBusy(true);
      setError(null);
      try {
        await resolveApproval({
          request_id: pending.event.request_id,
          approved,
          wallet_passphrase: approved && passphrase ? passphrase : null,
          reason: !approved && reason ? reason : null,
        });
        close();
      } catch (cause) {
        if (cause instanceof ApprovalCallError) setError(cause.message);
        else setError(String(cause));
      } finally {
        setBusy(false);
      }
    },
    [pending, passphrase, reason],
  );

  if (!pending) return null;

  const cooldownLeft = Math.max(0, Math.ceil((pending.readyAt - now) / 1000));
  const approveDisabled = busy || cooldownLeft > 0;
  const req = pending.event.request;

  return (
    <div
      role="dialog"
      aria-modal="true"
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.55)",
        zIndex: 9999,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 20,
      }}
    >
      <div
        className="w-card"
        style={{
          width: "min(560px, 100%)",
          maxHeight: "85vh",
          overflow: "auto",
        }}
      >
        <div className="w-card__head">
          <h3>Client wants to sign</h3>
          <span className="w-todo__pill">{req.tool}</span>
        </div>
        <div className="w-card__body" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <div>
            <div className="row-label">Summary</div>
            <div className="row-help">{req.summary || "(no summary provided)"}</div>
          </div>

          {req.wallet ? (
            <div>
              <div className="row-label">Wallet</div>
              <code>{req.wallet}</code>
            </div>
          ) : null}

          <div>
            <div className="row-label">Prepared transaction</div>
            <pre
              style={{
                background: "var(--w-bg-2, #161616)",
                border: "1px solid var(--w-border, #2a2a2a)",
                borderRadius: 6,
                padding: 10,
                fontFamily: "var(--w-font-mono, ui-monospace, monospace)",
                fontSize: 11,
                maxHeight: 220,
                overflow: "auto",
                whiteSpace: "pre-wrap",
                wordBreak: "break-all",
                margin: 0,
              }}
            >
              {JSON.stringify(req.prepared_tx, null, 2)}
            </pre>
          </div>

          <div>
            <div className="row-label">Wallet passphrase (optional)</div>
            <input
              type="password"
              placeholder="Required for tools that sign on-chain"
              value={passphrase}
              onChange={(e) => setPassphrase(e.target.value)}
              style={inputStyle()}
            />
          </div>

          {error ? (
            <div className="row-help" style={{ color: "var(--w-text-2, #999)" }}>
              {error}
            </div>
          ) : null}

          <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "center" }}>
            <div>
              <div className="row-label" style={{ fontSize: 11, opacity: 0.7 }}>Reject reason (optional)</div>
              <input
                type="text"
                placeholder="Why you're rejecting"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                style={{ ...inputStyle(), minWidth: 200 }}
              />
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              <button
                type="button"
                className="btn btn--sm"
                onClick={() => onResolve(false)}
                disabled={busy}
              >
                Reject
              </button>
              <button
                type="button"
                className="btn btn--sm"
                onClick={() => onResolve(true)}
                disabled={approveDisabled}
                title={cooldownLeft > 0 ? `Approve in ${cooldownLeft}s` : undefined}
              >
                {cooldownLeft > 0 ? `Approve in ${cooldownLeft}s` : busy ? "…" : "Approve"}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function inputStyle(): React.CSSProperties {
  return {
    padding: "8px 10px",
    borderRadius: 6,
    border: "1px solid var(--w-border, #2a2a2a)",
    background: "var(--w-bg-2, #161616)",
    color: "var(--w-text, #e6e6e6)",
    fontFamily: "var(--w-font-mono, ui-monospace, SFMono-Regular, monospace)",
    fontSize: 13,
  };
}
