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
import {
  KeychainCallError,
  fetchAndUnlockVault,
  getActiveAccount,
} from "../sdk/keychain";
import { VaultCallError } from "../sdk/vault";
import { captureAddressOnUnlock } from "../sdk/vaultCatalog";
import { readExperimentalEnabled } from "../sdk/feature-flags";
import { recordOperationFailure } from "../sdk/notifications-record";
import { trackOperationTx } from "../sdk/reconcile";
import { useAutoLock } from "../sdk/auto-lock";
import { MlDsa65Backend } from "@monolythium/core-sdk/crypto";
import type {
  OperationExecutionContext,
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

/**
 * Auth-pane error union. The keychain branches reuse the existing
 * `KeychainCallError`; the password-mismatch branch comes from the
 * vault module. We surface them with the same banner shell so the user
 * sees a consistent visual error language regardless of which layer
 * complained.
 */
type AuthError =
  | { kind: "keychain"; cause: KeychainCallError }
  | { kind: "vault"; cause: VaultCallError };

export function OperationsDrawer({ descriptor, onClose }: Props) {
  const [stage, setStage] = useState<OperationStage>("preview");
  const [result, setResult] = useState<OperationResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Auth-specific error state. We keep this separate from the global
  // `error` so the Auth pane can show a "try again" hint without dropping
  // the user into the terminal Error stage. Only `runExecute` failures
  // promote into the Error stage.
  const [authError, setAuthError] = useState<AuthError | null>(null);
  const [authBusy, setAuthBusy] = useState(false);
  const [password, setPassword] = useState("");
  const { pauseTimer, resumeTimer } = useAutoLock();

  // Suspend the idle auto-lock timer while this drawer is open so a long
  // signing operation is never interrupted mid-action; resume on unmount.
  useEffect(() => {
    pauseTimer();
    return resumeTimer;
  }, [pauseTimer, resumeTimer]);

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

  // Drop the password from React state the moment the drawer leaves the
  // auth stage (executing/done/error). Best-effort hygiene — React state
  // is still in heap, but this minimizes the window where an inadvertent
  // dump (devtools, error overlay) could capture it.
  useEffect(() => {
    if (stage !== "auth" && stage !== "preview" && password) {
      setPassword("");
    }
  }, [stage, password]);

  const advanceFromPreview = () => {
    if (descriptor.auth === "none") {
      void runExecute();
      return;
    }
    setAuthError(null);
    setStage("auth");
  };

  const advanceFromAuth = async () => {
    // Stage 4 wires the keychain-vault path.
    if (descriptor.auth === "keychain") {
      if (!password) {
        setAuthError({
          kind: "vault",
          cause: new VaultCallError({ code: "invalid_argument", message: "Enter your password." }),
        });
        return;
      }
      setAuthBusy(true);
      setAuthError(null);
      let vaultSeed: Uint8Array;
      const activeSlot = getActiveAccount();
      try {
        vaultSeed = await fetchAndUnlockVault(activeSlot, password);
        // Best-effort: backfill the catalog with the derived address so
        // legacy installs (catalog entry with addressHex: null) and any
        // future address-corruption recovery picks up the live answer.
        try {
          const addressHex = MlDsa65Backend.fromSeed(vaultSeed)
            .getAddress()
            .toLowerCase();
          void captureAddressOnUnlock(activeSlot, addressHex).catch(() => {});
        } catch {
          // Never let an address-backfill failure break the unlock path.
        }
      } catch (cause) {
        if (cause instanceof KeychainCallError) {
          setAuthError({ kind: "keychain", cause });
        } else if (cause instanceof VaultCallError) {
          setAuthError({ kind: "vault", cause });
        } else {
          setAuthError({
            kind: "keychain",
            cause: new KeychainCallError({ code: "backend", message: String(cause) }),
          });
        }
        setAuthBusy(false);
        return;
      }
      setAuthBusy(false);
      // Clear the password from state immediately on success.
      setPassword("");
      void runExecute({ vaultSeed });
      return;
    }
    if (descriptor.auth === "passkey") {
      setError("Passkey signing is unavailable in this build.");
      setStage("error");
      return;
    }
    void runExecute();
  };

  const runExecute = async (ctx: OperationExecutionContext = {}) => {
    setStage("executing");
    setError(null);
    let resultTxHash: string | undefined;
    try {
      const r = await descriptor.execute(ctx);
      resultTxHash = r.txHash;
      setResult(r);
      setStage("done");
      // Terminal transition: broadcast accepted (NOT yet a confirmed receipt).
      // Only the experimental flag wires the notifications center. We do NOT
      // poll here — the broadcast tx is enqueued into the durable tracked-tx
      // store, and the app-level reconcile poller follows it to a real terminal
      // state (recording "confirmed" on an on-chain observation, "failed" on a
      // reverted receipt) even after this drawer closes. The Done pane shows
      // the broadcast immediately; the notification comes from the reconciler.
      if (descriptor.notify && resultTxHash && readExperimentalEnabled()) {
        void trackOperationTx(descriptor.notify, resultTxHash);
      }
    } catch (cause) {
      const message = (cause as Error)?.message ?? String(cause);
      setError(message);
      setStage("error");
      // Terminal transition: the node / precompile / SDK rejected the
      // submission — a genuine failure, recorded immediately (when a canonical
      // hash exists to key it on).
      if (descriptor.notify && readExperimentalEnabled()) {
        void recordOperationFailure(descriptor.notify, resultTxHash);
      }
    } finally {
      ctx.vaultSeed?.fill(0);
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
          {stage === "auth" ? (
            <AuthPane
              descriptor={descriptor}
              authError={authError}
              password={password}
              setPassword={setPassword}
              onSubmit={() => void advanceFromAuth()}
              busy={authBusy}
            />
          ) : null}
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
              <button
                className="btn btn--ghost"
                onClick={() => {
                  setPassword("");
                  setStage("preview");
                }}
                disabled={authBusy}
              >
                Back
              </button>
              <button
                className="btn btn--primary"
                style={{ marginLeft: "auto" }}
                onClick={() => void advanceFromAuth()}
                disabled={authBusy || descriptor.auth === "passkey" || (descriptor.auth === "keychain" && !password)}
              >
                {authBusy ? "Unlocking…" : "Authorize"}
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

interface AuthPaneProps {
  descriptor: OperationDescriptor;
  authError: AuthError | null;
  password: string;
  setPassword: (next: string) => void;
  onSubmit: () => void;
  busy: boolean;
}

function AuthPane({
  descriptor,
  authError,
  password,
  setPassword,
  onSubmit,
  busy,
}: AuthPaneProps) {
  if (descriptor.auth === "passkey") {
    return (
      <div className="w-banner">
        Passkey signing is unavailable in this build.
        <div style={{ marginTop: 6, fontSize: 11.5, color: "var(--w-text-3)" }}>
          Use a keychain vault until the WebAuthn signer ships.
        </div>
      </div>
    );
  }
  return (
    <>
      <div className="w-banner">
        Enter your wallet password. The vault decrypts in-process via
        Argon2id + XChaCha20-Poly1305; the password never touches disk.
      </div>
      <label className="w-onboarding__field" style={{ marginTop: 12 }}>
        <span className="cap">Password</span>
        <input
          type="password"
          autoFocus
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !busy && password) onSubmit();
          }}
          disabled={busy}
        />
      </label>
      {authError ? <AuthErrorBanner error={authError} /> : null}
    </>
  );
}

function AuthErrorBanner({ error }: { error: AuthError }) {
  // Each branch renders the same banner shell with a code-specific call to
  // action. Keeping these in one place means the strings stay consistent
  // when more error codes land.
  let headline: string;
  let detail: string;
  if (error.kind === "keychain") {
    const cause = error.cause.cause;
    switch (cause.code) {
      case "not_found":
        headline = "Wallet not set up on this device";
        detail = `No keychain entry for ${cause.account}. Run onboarding to create the vault.`;
        break;
      case "user_cancelled":
        headline = "Cancelled at the OS prompt";
        detail = "The OS keychain prompt was dismissed. Click Authorize to retry.";
        break;
      case "invalid_argument":
        headline = "Invalid keychain request";
        detail = cause.message;
        break;
      case "backend":
        headline = "Keychain unavailable";
        detail = cause.message;
        break;
    }
  } else {
    const cause = error.cause.cause;
    switch (cause.code) {
      case "wrong_password":
        headline = "Wrong password";
        detail = "The password didn't unlock the vault. Try again.";
        break;
      case "invalid_argument":
        headline = "Password required";
        detail = cause.message;
        break;
      case "backend":
        headline = "Vault unavailable";
        detail = cause.message;
        break;
    }
  }
  return (
    <div className="w-banner error" style={{ marginTop: 12 }}>
      <div style={{ fontWeight: 600, marginBottom: 4 }}>{headline}</div>
      <div style={{ fontSize: 12, color: "var(--w-text-2)" }}>{detail}</div>
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
