// Shared connect-flow modal: confirm → checking → result. Used by the Operators
// directory (a single "Use this operator" adoption) and the operator-override
// editor (adopting a draft row). The structure and titles are identical; the
// callers differ only in the optional confirm lead ("You're on X. " on the
// directory, omitted in the editor) and the result message they compute (the
// directory's singular "Your operator…" vs the editor's plural "Your operators…").
// The result phase has no close affordance while checking is in flight.

export type ConnectPhase =
  | { phase: "confirm" }
  | { phase: "checking" }
  | { phase: "result"; ok: boolean; message: string };

export function ConnectFlowModal({
  name,
  phase,
  confirmLead,
  onConfirm,
  onClose,
}: {
  name: string;
  phase: ConnectPhase;
  /** Optional lead sentence before the confirm question (e.g. "You're on X. "). */
  confirmLead?: string;
  onConfirm: () => void;
  onClose: () => void;
}) {
  const dismissable = phase.phase !== "checking";
  return (
    <div className="w-overlay w-overlay--center" role="presentation" onClick={() => dismissable && onClose()}>
      <div className="w-card w-confirm" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
        <div className="w-card__body">
          {phase.phase === "confirm" ? (
            <>
              <h3 className="w-confirm__title">Connect to this operator?</h3>
              <p className="row-help" style={{ marginTop: 8 }}>
                {confirmLead}Connect to <strong>{name}</strong>? The wallet runs a health &amp;
                security check first and won't switch if it fails.
              </p>
              <div className="w-confirm__actions">
                <button type="button" className="btn btn--ghost" onClick={onClose}>Cancel</button>
                <button type="button" className="btn btn--primary" onClick={onConfirm}>Connect</button>
              </div>
            </>
          ) : phase.phase === "checking" ? (
            <>
              <h3 className="w-confirm__title">Connect to this operator?</h3>
              <p className="row-help" style={{ marginTop: 8 }}>
                Running a health &amp; security check on <strong>{name}</strong>…
              </p>
            </>
          ) : (
            <>
              <h3 className="w-confirm__title" style={{ color: phase.ok ? "var(--ok)" : "var(--err)" }}>
                {phase.ok ? "Connected" : "Can't connect"}
              </h3>
              <p className="row-help" style={{ marginTop: 8 }}>{phase.message}</p>
              <div className="w-confirm__actions">
                <button type="button" className="btn btn--primary" onClick={onClose}>Done</button>
                <button type="button" className="btn btn--ghost" onClick={onClose}>Close</button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
