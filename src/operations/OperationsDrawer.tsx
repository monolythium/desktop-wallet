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

import { useEffect, useRef, useState } from "react";
import {
  KeychainCallError,
  PRIMARY_ACCOUNT,
  fetchAndUnlockVault,
} from "../sdk/keychain";
import { VaultCallError } from "../sdk/vault";
import {
  LedgerCallError,
  enumerateDevices,
  getAddress as ledgerGetAddress,
  type LedgerDeviceInfo,
} from "../sdk/ledger";
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

/**
 * Auth-pane error union. The keychain branches reuse the existing
 * `KeychainCallError`; the password-mismatch branch comes from the
 * vault module. We surface them with the same banner shell so the user
 * sees a consistent visual error language regardless of which layer
 * complained.
 */
type AuthError =
  | { kind: "keychain"; cause: KeychainCallError }
  | { kind: "vault"; cause: VaultCallError }
  | { kind: "ledger"; cause: LedgerCallError };

/**
 * Hardware-signer mini state machine. The Ledger flow has more visible
 * steps than the password flow, so we surface them as an explicit FSM
 * the user can watch tick over: scanning → connected → awaiting-approval
 * → approved → (drawer advances to executing).
 */
type LedgerFlow =
  | { kind: "idle" }
  | { kind: "scanning" }
  | { kind: "connected"; device: LedgerDeviceInfo }
  | { kind: "awaiting_approval"; device: LedgerDeviceInfo }
  | { kind: "approved"; device: LedgerDeviceInfo; address: string };

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
  const [ledgerFlow, setLedgerFlow] = useState<LedgerFlow>({ kind: "idle" });
  // Cancellation token for the in-flight hardware flow. We bump this
  // every time the user retries / steps back so a stale enumeration
  // resolving late doesn't clobber a fresh attempt.
  const ledgerAttempt = useRef(0);

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
    // Stage 4 wires the keychain-vault path AND the Ledger hardware path.
    // Passkey stays banner-only until that signer lands.
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
      try {
        await fetchAndUnlockVault(PRIMARY_ACCOUNT, password);
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
      void runExecute();
      return;
    }
    if (descriptor.auth === "hardware") {
      // The hardware flow is its own stepper — see runLedgerFlow. The
      // Authorize button reuses this entry point; the flow ends by
      // calling runExecute() once the device confirms.
      void runLedgerFlow();
      return;
    }
    // Passkey + none → straight through.
    void runExecute();
  };

  /**
   * Walk the Ledger flow:
   *   scanning → connected → awaiting_approval → approved → execute.
   * On each error we drop back to `idle` and surface the typed cause via
   * `authError` so the user sees a code-specific call to action (retry vs
   * unlock-and-retry) without leaving the auth stage.
   */
  const runLedgerFlow = async () => {
    const attempt = ++ledgerAttempt.current;
    const isStale = () => ledgerAttempt.current !== attempt;
    const hdPath = descriptor.ledger?.hdPath ?? "m/44'/60'/0'/0/0";
    const expected = descriptor.ledger?.expectedAddress?.toLowerCase();

    setAuthBusy(true);
    setAuthError(null);
    setLedgerFlow({ kind: "scanning" });
    try {
      const devices = await enumerateDevices();
      if (isStale()) return;
      const device = devices[0];
      if (!device) {
        setAuthError({
          kind: "ledger",
          cause: new LedgerCallError({ code: "no_device" }),
        });
        setLedgerFlow({ kind: "idle" });
        setAuthBusy(false);
        return;
      }
      setLedgerFlow({ kind: "connected", device });

      setLedgerFlow({ kind: "awaiting_approval", device });
      const address = await ledgerGetAddress(device.deviceId, hdPath);
      if (isStale()) return;
      const lower = address.toLowerCase();
      if (expected && lower !== expected) {
        // Wrong device or wrong derivation path — bail with a typed error
        // rather than letting the user sign with the wrong key.
        setAuthError({
          kind: "ledger",
          cause: new LedgerCallError({
            code: "invalid_argument",
            message: `device address ${lower} doesn't match ${expected}`,
          }),
        });
        setLedgerFlow({ kind: "idle" });
        setAuthBusy(false);
        return;
      }
      setLedgerFlow({ kind: "approved", device, address: lower });
      setAuthBusy(false);
      // Tiny delay so the user actually sees the "approved" tick; not a
      // semantic delay, just a beat for the eye.
      await new Promise((r) => setTimeout(r, 200));
      if (isStale()) return;
      void runExecute();
    } catch (cause) {
      if (isStale()) return;
      if (cause instanceof LedgerCallError) {
        setAuthError({ kind: "ledger", cause });
      } else {
        setAuthError({
          kind: "ledger",
          cause: new LedgerCallError({ code: "transport", message: String(cause) }),
        });
      }
      setLedgerFlow({ kind: "idle" });
      setAuthBusy(false);
    }
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
          {stage === "auth" ? (
            <AuthPane
              descriptor={descriptor}
              authError={authError}
              password={password}
              setPassword={setPassword}
              onSubmit={() => void advanceFromAuth()}
              busy={authBusy}
              ledgerFlow={ledgerFlow}
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
                  // Bump the attempt counter so an in-flight Ledger
                  // enumeration that resolves late doesn't poke the UI
                  // after the user stepped back.
                  ledgerAttempt.current++;
                  setLedgerFlow({ kind: "idle" });
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
                disabled={authBusy || (descriptor.auth === "keychain" && !password)}
              >
                {hardwareButtonLabel({
                  authMethod: descriptor.auth,
                  busy: authBusy,
                  ledgerFlow,
                  hasError: authError !== null,
                })}
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
  ledgerFlow: LedgerFlow;
}

function AuthPane({
  descriptor,
  authError,
  password,
  setPassword,
  onSubmit,
  busy,
  ledgerFlow,
}: AuthPaneProps) {
  if (descriptor.auth === "hardware") {
    return <LedgerAuthPane ledgerFlow={ledgerFlow} authError={authError} />;
  }
  if (descriptor.auth === "passkey") {
    // TODO: wire WebAuthn / platform passkey signer.
    return (
      <div className="w-banner">
        A platform passkey prompt will open. Approve to continue.
        <div style={{ marginTop: 6, fontSize: 11.5, color: "var(--w-text-3)" }}>
          (Passkey signer wiring is not yet implemented. This pane is banner-only for now.)
        </div>
      </div>
    );
  }
  return (
    <>
      <div className="w-banner">
        Enter your wallet password. The vault decrypts in-process via
        Argon2id + AES-256-GCM; the password never touches disk.
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
  } else if (error.kind === "vault") {
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
  } else {
    const cause = error.cause.cause;
    switch (cause.code) {
      case "no_device":
        headline = "No Ledger detected";
        detail = "Plug in your Ledger and click Connect to scan again.";
        break;
      case "user_cancelled":
        headline = "Cancelled on device";
        detail = "You rejected the prompt on the Ledger. Click Connect to retry.";
        break;
      case "device_locked":
        headline = "Device locked";
        detail = "Unlock your Ledger and reopen the Ethereum app, then retry.";
        break;
      case "transport":
        headline = "Ledger connection lost";
        detail = `Transport error: ${cause.message}. Reconnect the device and retry.`;
        break;
      case "invalid_argument":
        headline = "Wrong device or path";
        detail = cause.message;
        break;
      case "device_error":
        headline = "Device returned an error";
        detail = `0x${cause.sw.toString(16).padStart(4, "0")}: ${cause.message}`;
        break;
      case "malformed_response":
        headline = "Unexpected response";
        detail = `${cause.message}. Update the Ethereum app on the device and retry.`;
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

/**
 * Pick the Authorize-button label given current state. Plain function so
 * we can keep the JSX terse — and so the label transitions match the
 * mini state machine without spaghetti ternaries.
 */
function hardwareButtonLabel(args: {
  authMethod: OperationDescriptor["auth"];
  busy: boolean;
  ledgerFlow: LedgerFlow;
  hasError: boolean;
}): string {
  if (args.authMethod !== "hardware") {
    return args.busy ? "Unlocking…" : "Authorize";
  }
  if (args.hasError && !args.busy) {
    return "Retry";
  }
  switch (args.ledgerFlow.kind) {
    case "idle":
      return "Connect Ledger";
    case "scanning":
      return "Scanning…";
    case "connected":
      return "Reading address…";
    case "awaiting_approval":
      return "Awaiting approval…";
    case "approved":
      return "Approved";
  }
}

/**
 * The Ledger auth pane. Renders the four-step pipeline (scan → connect →
 * approve → approved) as a vertical checklist and keeps the spinner
 * pointed at the in-flight step. Errors come through `authError` and
 * render under the checklist via the shared banner.
 */
function LedgerAuthPane({
  ledgerFlow,
  authError,
}: {
  ledgerFlow: LedgerFlow;
  authError: AuthError | null;
}) {
  const stages: ReadonlyArray<{ key: LedgerFlow["kind"]; label: string }> = [
    { key: "scanning", label: "Scanning for device" },
    { key: "connected", label: "Device connected" },
    { key: "awaiting_approval", label: "Confirm address on device" },
    { key: "approved", label: "Address approved" },
  ];
  const order = ["idle", "scanning", "connected", "awaiting_approval", "approved"] as const;
  const currentIdx = order.indexOf(ledgerFlow.kind);
  return (
    <>
      <div className="w-banner">
        Connect your Ledger and unlock the Ethereum app. The drawer will
        ask the device to confirm the signing address before broadcasting
        anything.
      </div>
      <ol style={{ listStyle: "none", padding: 0, margin: "16px 0 0", fontSize: 12.5 }}>
        {stages.map((s) => {
          const idx = order.indexOf(s.key);
          const isOn = ledgerFlow.kind === s.key;
          const isDone = currentIdx > idx && ledgerFlow.kind !== "idle";
          const symbol = isOn ? "→" : isDone ? "✓" : "·";
          const color = isOn
            ? "var(--w-text-1)"
            : isDone
              ? "var(--w-text-2)"
              : "var(--w-text-3)";
          return (
            <li
              key={s.key}
              style={{
                color,
                padding: "6px 0",
                display: "flex",
                alignItems: "center",
                gap: 8,
              }}
            >
              <span
                style={{
                  fontFamily: "var(--f-mono)",
                  width: 16,
                  textAlign: "center",
                  fontWeight: isOn ? 700 : 400,
                }}
              >
                {symbol}
              </span>
              <span>{s.label}</span>
              {isOn ? <span className="w-spin" style={{ width: 10, height: 10, marginLeft: 6 }} /> : null}
            </li>
          );
        })}
      </ol>
      {ledgerFlow.kind === "approved" ? (
        <div className="w-banner" style={{ marginTop: 12, fontSize: 11.5 }}>
          Address: <span className="mono">{ledgerFlow.address}</span>
        </div>
      ) : null}
      {authError ? <AuthErrorBanner error={authError} /> : null}
    </>
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
