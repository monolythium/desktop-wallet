// The Operations drawer.
//
// State machine:
//
//   preview  → auth  → executing → done
//        \-> error  (from any stage)
//
// Every chain-touching or keychain-touching action routes through this surface.
// Reuse the same drawer for swap, stake, send, sign, and any future write path.
//
// The drawer does NOT do the work itself — it owns UI state and calls
// `descriptor.execute()` once auth completes. That keeps the chain logic
// in `sdk/` and the keychain logic in Tauri commands, where they belong.

import { useEffect, useState } from "react";
import type {
  OperationDescriptor,
  OperationResult,
  OperationStage,
} from "./types";

interface Props {
  descriptor: OperationDescriptor;
  onClose: () => void;
}

const STAGE_ORDER: ReadonlyArray<Exclude<OperationStage, "error">> = [
  "preview",
  "auth",
  "executing",
  "done",
];

const STAGE_LABEL: Record<OperationStage, string> = {
  preview: "Preview",
  auth: "Authorize",
  executing: "Executing",
  done: "Done",
  error: "Error",
};

export function OperationsDrawer({ descriptor, onClose }: Props) {
  const [stage, setStage] = useState<OperationStage>("preview");
  const [result, setResult] = useState<OperationResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Esc closes the drawer except mid-execute (don't let users abandon a tx
  // we may have already broadcast).
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (stage === "executing") return;
      onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose, stage]);

  const advanceFromPreview = () => {
    if (descriptor.auth === "none") {
      void runExecute();
      return;
    }
    setStage("auth");
  };

  const advanceFromAuth = () => {
    void runExecute();
  };

  const runExecute = async () => {
    setStage("executing");
    setError(null);
    try {
      const r = await descriptor.execute();
      setResult(r);
      setStage("done");
    } catch (cause) {
      const message = (cause as Error)?.message ?? String(cause);
      setError(message);
      setStage("error");
    }
  };

  return (
    <div
      className="w-overlay"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && stage !== "executing") onClose();
      }}
    >
      <div className="w-drawer" role="dialog" aria-label={descriptor.title}>
        <div className="w-drawer__head">
          <div style={{ flex: 1 }}>
            <div className="cap" style={{ marginBottom: 4 }}>{descriptor.auth === "none" ? "Read" : "Operation"}</div>
            <h3>{descriptor.title}</h3>
            {descriptor.subtitle ? <div className="sub">{descriptor.subtitle}</div> : null}
          </div>
          <button
            className="btn btn--sm btn--ghost"
            onClick={onClose}
            disabled={stage === "executing"}
            aria-label="Close drawer"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M18 6 6 18M6 6l12 12" />
            </svg>
          </button>
        </div>

        <StageRail stage={stage} />

        <div className="w-drawer__body">
          {stage === "preview" ? <PreviewPane descriptor={descriptor} /> : null}
          {stage === "auth" ? <AuthPane descriptor={descriptor} /> : null}
          {stage === "executing" ? <ExecutingPane descriptor={descriptor} /> : null}
          {stage === "done" && result ? <DonePane descriptor={descriptor} result={result} /> : null}
          {stage === "error" ? <ErrorPane error={error ?? "Unknown error"} /> : null}
        </div>

        <div className="w-drawer__foot">
          {stage === "preview" ? (
            <>
              <button className="btn btn--ghost" onClick={onClose}>Cancel</button>
              <button className="btn btn--primary" style={{ marginLeft: "auto" }} onClick={advanceFromPreview}>
                {descriptor.auth === "none" ? "Run" : "Continue"}
              </button>
            </>
          ) : null}
          {stage === "auth" ? (
            <>
              <button className="btn btn--ghost" onClick={() => setStage("preview")}>Back</button>
              <button className="btn btn--primary" style={{ marginLeft: "auto" }} onClick={advanceFromAuth}>
                {descriptor.auth === "hardware" ? "Confirm on device" : "Authorize"}
              </button>
            </>
          ) : null}
          {stage === "executing" ? (
            <span className="cap" style={{ margin: "auto", color: "var(--w-text-3)" }}>
              Working — do not close.
            </span>
          ) : null}
          {stage === "done" ? (
            <button className="btn btn--primary" style={{ marginLeft: "auto" }} onClick={onClose}>
              Done
            </button>
          ) : null}
          {stage === "error" ? (
            <>
              <button className="btn btn--ghost" onClick={() => setStage("preview")}>Back</button>
              <button className="btn btn--primary" style={{ marginLeft: "auto" }} onClick={onClose}>Close</button>
            </>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function StageRail({ stage }: { stage: OperationStage }) {
  if (stage === "error") {
    return (
      <div className="w-stages">
        <span className="w-stages__step is-on" style={{ color: "var(--alert)", borderColor: "rgba(255,138,154,0.45)", background: "rgba(255,138,154,0.10)" }}>
          {STAGE_LABEL.error}
        </span>
      </div>
    );
  }
  const idx = STAGE_ORDER.indexOf(stage);
  return (
    <div className="w-stages" aria-label="Operation progress">
      {STAGE_ORDER.map((s, i) => {
        const isOn = s === stage;
        const isDone = i < idx;
        const cls = isOn ? "is-on" : isDone ? "is-done" : "";
        return (
          <span key={s} style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
            <span className={`w-stages__step ${cls}`}>{STAGE_LABEL[s]}</span>
            {i < STAGE_ORDER.length - 1 ? <span className="w-stages__chev">›</span> : null}
          </span>
        );
      })}
    </div>
  );
}

function PreviewPane({ descriptor }: { descriptor: OperationDescriptor }) {
  return (
    <>
      <div className="w-card" style={{ padding: 0 }}>
        <div className="w-card__head"><h3>Diff</h3></div>
        <div className="w-card__body">
          {descriptor.diff.length === 0 ? (
            <div style={{ fontSize: 12, color: "var(--w-text-3)" }}>(no diff)</div>
          ) : (
            descriptor.diff.map((line, i) => (
              <div key={i} className="w-kv">
                <span className="k">{line.k}</span>
                <span className={`v ${line.kind === "fee" ? "mono" : ""}`}
                      style={line.kind === "warn" ? { color: "var(--warn)" } : undefined}>
                  {line.v}
                </span>
              </div>
            ))
          )}
        </div>
      </div>

      {descriptor.effects.length > 0 ? (
        <div className="w-card" style={{ padding: 0 }}>
          <div className="w-card__head"><h3>Effects</h3></div>
          <div className="w-card__body">
            <ul style={{ margin: 0, paddingLeft: 18, fontSize: 12.5, lineHeight: 1.65 }}>
              {descriptor.effects.map((e, i) => (
                <li key={i} style={{ color: e.level === "warn" ? "var(--warn)" : "var(--w-text-2)" }}>
                  {e.text}
                </li>
              ))}
            </ul>
          </div>
        </div>
      ) : null}
    </>
  );
}

function AuthPane({ descriptor }: { descriptor: OperationDescriptor }) {
  if (descriptor.auth === "hardware") {
    return (
      <div className="w-banner">
        Confirm on your hardware device. The drawer will continue automatically when the device returns a signature.
      </div>
    );
  }
  if (descriptor.auth === "passkey") {
    return (
      <div className="w-banner">
        A platform passkey prompt will open. Approve to continue.
      </div>
    );
  }
  return (
    <div className="w-banner">
      Click <b>Authorize</b> to release the signing key from the OS keychain. Stage 3 will wire the real
      Tauri command; Stage 2 stops here in mock-mode.
    </div>
  );
}

function ExecutingPane({ descriptor }: { descriptor: OperationDescriptor }) {
  return (
    <div style={{ textAlign: "center", padding: "32px 0" }}>
      <div className="w-spin" />
      <h3 style={{ margin: "16px 0 6px" }}>{descriptor.title}</h3>
      <div style={{ color: "var(--w-text-3)", fontSize: 12.5 }}>
        Submitting to the network…
      </div>
    </div>
  );
}

function DonePane({ descriptor, result }: { descriptor: OperationDescriptor; result: OperationResult }) {
  return (
    <div style={{ textAlign: "center", padding: "20px 0 8px" }}>
      <div className="w-check">
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
          <path d="m5 12 5 5 9-11" />
        </svg>
      </div>
      <h3 style={{ margin: "16px 0 6px" }}>{result.headline}</h3>
      <div style={{ color: "var(--w-text-3)", fontSize: 12.5 }}>{descriptor.title}</div>
      {result.detail ? (
        <div style={{ marginTop: 14 }}>
          <div className="cap" style={{ marginBottom: 4 }}>Detail</div>
          <div className="mono" style={{ fontSize: 12, color: "var(--w-text-2)", wordBreak: "break-all" }}>
            {result.detail}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function ErrorPane({ error }: { error: string }) {
  return (
    <div className="w-banner error">
      <div style={{ fontWeight: 600, marginBottom: 4 }}>Operation failed</div>
      <div style={{ fontFamily: "var(--f-mono)", fontSize: 11.5, wordBreak: "break-all" }}>{error}</div>
    </div>
  );
}
