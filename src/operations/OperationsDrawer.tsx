// The Operations drawer.
//
// State machine:
//
//   preview  → auth  → executing → done
//        \-> error  (from any stage)
//
// Every chain-touching or keychain-touching action routes through this surface.
// Reuse the same drawer for swap, delegate, send, sign, and any future write path.
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
import { VaultCallError, isWrongPasswordFailure } from "../sdk/vault";
import { captureAddressOnUnlock } from "../sdk/vaultCatalog";
import { recordOperationFailure } from "../sdk/notifications-record";
import { rejectedSubmitTxHash } from "../sdk/submit";
import { trackOperationTx } from "../sdk/reconcile";
import { useAutoLock } from "../sdk/auto-lock";
import {
  clearUnlockLockout,
  lockoutRemainingMs,
  readLockoutState,
  recordWrongUnlockAttempt,
} from "../sdk/unlock-lockout";
import { withSigningBackend } from "../sdk/signing-backend";
import { markAddressDerived } from "../sdk/address-provenance";
import {
  classifySendError,
  errorLinksOperators,
  extractSendError,
  formatSendError,
  severityColours,
  type SendErrorInput,
} from "../sdk/send-error";
import { readDeveloperMode } from "../sdk/feature-flags";
import { PasswordInput } from "../components/PasswordInput";
import type { Route } from "../components/types";
import type {
  OperationExecutionContext,
  OperationNotifyMeta,
  OperationDescriptor,
  OperationResult,
  OperationStage,
} from "./types";

interface Props {
  descriptor: OperationDescriptor;
  onClose: () => void;
  /** Optional route callback — when present, the classified error card renders
   *  its "Operators" mention as a link that closes the drawer and routes there.
   *  Absent ⇒ the word stays plain text. */
  onNavigate?: (route: Route) => void;
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

export function OperationsDrawer({ descriptor, onClose, onNavigate }: Props) {
  const [stage, setStage] = useState<OperationStage>("preview");
  const [result, setResult] = useState<OperationResult | null>(null);
  // The raw thrown error (message + optional JSON-RPC code), classified at render.
  const [errorRaw, setErrorRaw] = useState<SendErrorInput | null>(null);
  // Auth-specific error state. We keep this separate from the global
  // `error` so the Auth pane can show a "try again" hint without dropping
  // the user into the terminal Error stage. Only `runExecute` failures
  // promote into the Error stage.
  const [authError, setAuthError] = useState<AuthError | null>(null);
  const [authBusy, setAuthBusy] = useState(false);
  const [password, setPassword] = useState("");
  const [lockoutUntil, setLockoutUntil] = useState(0);
  const [now, setNow] = useState(() => Date.now());
  const { pauseTimer, resumeTimer } = useAutoLock();

  // Suspend the idle auto-lock timer while this drawer is open so a long
  // signing operation is never interrupted mid-action; resume on unmount.
  useEffect(() => {
    pauseTimer();
    return resumeTimer;
  }, [pauseTimer, resumeTimer]);

  // Honor the same brute-force lockout the full-screen lock gate enforces: an
  // in-progress lockout — from earlier wrong passwords, here or at the gate —
  // blocks this per-operation password prompt too, so the drawer can't be used
  // as a lockout-bypass surface. Re-checked against the wall clock on mount.
  useEffect(() => {
    setLockoutUntil(readLockoutState().lockoutUntil);
  }, []);

  // Tick while a lockout window is active so the countdown updates and the
  // prompt re-enables the instant it elapses.
  useEffect(() => {
    if (lockoutUntil <= Date.now()) return;
    const id = window.setInterval(() => {
      const t = Date.now();
      setNow(t);
      if (t >= lockoutUntil) window.clearInterval(id);
    }, 500);
    return () => window.clearInterval(id);
  }, [lockoutUntil]);

  const remainingMs = lockoutRemainingMs(lockoutUntil, now);
  const lockedOut = remainingMs > 0;
  const remainingSec = Math.ceil(remainingMs / 1000);

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
    // Refuse to attempt a decrypt while a brute-force lockout is in force — the
    // Authorize button is disabled too, this guards the Enter-key path.
    if (lockedOut) return;
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
          // Address only — the derived key is disposed before the backfill is
          // even dispatched, so it does not linger for the unlock's duration.
          const addressHex = withSigningBackend(vaultSeed, (backend) =>
            backend.getAddress().toLowerCase(),
          );
          // Record the derivation BEFORE the backfill is dispatched. The
          // backfill is a fire-and-forget store write that may fail; the fact
          // that this process derived the address is already true either way,
          // and gating it on a disk write would make a store error look like a
          // failed proof of ownership.
          markAddressDerived(addressHex);
          void captureAddressOnUnlock(activeSlot, addressHex).catch(() => {});
        } catch {
          // Never let an address-backfill failure break the unlock path.
        }
      } catch (cause) {
        if (isWrongPasswordFailure(cause)) {
          // Feed the same escalating brute-force lockout the lock gate uses, so
          // repeated wrong passwords at this prompt throttle identically; the
          // window (if a threshold is met) then disables the prompt below.
          const next = recordWrongUnlockAttempt();
          setLockoutUntil(next.lockoutUntil);
          setNow(Date.now());
        }
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
      // A correct password clears the brute-force counter — same reset-on-success
      // discipline as the lock gate.
      clearUnlockLockout();
      setLockoutUntil(0);
      setAuthBusy(false);
      // Clear the password from state immediately on success.
      setPassword("");
      void runExecute({ vaultSeed });
      return;
    }
    if (descriptor.auth === "passkey") {
      setErrorRaw({ message: "Passkey signing is unavailable in this build.", code: null });
      setStage("error");
      return;
    }
    void runExecute();
  };

  const runExecute = async (ctx: OperationExecutionContext = {}) => {
    setStage("executing");
    setErrorRaw(null);
    let resultTxHash: string | undefined;
    // What `execute` learned about its own subject while running. Empty for
    // every single-submission operation, which is already complete at
    // descriptor time; a batch fills it in its catch, where the failing
    // allocation is the one fact the descriptor could not carry. Held in a plain
    // local rather than state — it is read once, below, and never rendered.
    let notifyPatch: Partial<OperationNotifyMeta> = {};
    const notifyMeta = (): OperationNotifyMeta | undefined =>
      descriptor.notify && { ...descriptor.notify, ...notifyPatch };
    try {
      const r = await descriptor.execute({
        ...ctx,
        refineNotify: (patch) => {
          notifyPatch = { ...notifyPatch, ...patch };
        },
      });
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
      const accepted = notifyMeta();
      if (accepted && resultTxHash) {
        void trackOperationTx(accepted, resultTxHash, r.nonce);
      }
    } catch (cause) {
      setErrorRaw(extractSendError(cause));
      setStage("error");
      // Terminal transition: the node / precompile / SDK rejected the
      // submission — a genuine failure, recorded immediately (when a canonical
      // hash exists to key it on). On an admission reject the tx was signed +
      // submitted, so its hash is known locally even though it never landed;
      // record the refused attempt with its classified reason.
      const failed = notifyMeta();
      if (failed) {
        const hash = resultTxHash ?? rejectedSubmitTxHash(cause);
        void recordOperationFailure(failed, hash, cause);
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
              lockedOut={lockedOut}
              remainingSec={remainingSec}
            />
          ) : null}
          {stage === "executing" ? <ExecutingPane descriptor={descriptor} /> : null}
          {stage === "done" && result ? <DonePane descriptor={descriptor} result={result} /> : null}
          {stage === "error" ? (
            <ErrorPane
              input={errorRaw ?? { message: "Unknown error", code: null }}
              context={descriptor.errorContext}
              onNavigate={onNavigate}
              onClose={onClose}
            />
          ) : null}
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
                disabled={authBusy || lockedOut || descriptor.auth === "passkey" || (descriptor.auth === "keychain" && !password)}
              >
                {lockedOut ? `Locked — ${remainingSec}s` : authBusy ? "Unlocking…" : "Authorize"}
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
                {/* Additive sibling — muted with a colour token, never opacity.
                    The `.v` span above keeps its class list, styling and text
                    byte-identical whether or not this renders. */}
                {line.fiat !== undefined && (
                  <span
                    className="v-fiat"
                    data-testid="diff-fiat"
                    style={{ color: "var(--fg-400)", fontWeight: 400, marginLeft: 6 }}
                  >
                    ({line.fiat})
                  </span>
                )}
              </div>
            ))
          )}
        </div>
      </div>

      {/* The disclosure tier. Closed by default — a confirm screen nobody reads
          is the failure this whole surface is written against, and a `<details>`
          a user can open is a different object from a row they must scroll past.
          `<details>` rather than the shared collapsible: that one hides with the
          `hidden` attribute, so its content leaves the accessibility tree, and a
          signed fact must stay reachable whether the section is open or not. */}
      {descriptor.details && descriptor.details.length > 0 ? (
        <div className="w-card" style={{ padding: 0 }}>
          <div className="w-card__body">
            <details data-testid="operation-details">
              <summary style={{ fontSize: 11.5, color: "var(--w-text-3)", cursor: "pointer" }}>
                Transaction details
              </summary>
              <div style={{ marginTop: 8 }}>
                {descriptor.details.map((line, i) => (
                  <div key={i} className="w-kv">
                    <span className="k">{line.k}</span>
                    <span
                      className="v mono"
                      style={{ overflowWrap: "anywhere", wordBreak: "break-all" }}
                    >
                      {line.v}
                    </span>
                  </div>
                ))}
              </div>
            </details>
          </div>
        </div>
      ) : null}

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
  lockedOut: boolean;
  remainingSec: number;
}

function AuthPane({
  descriptor,
  authError,
  password,
  setPassword,
  onSubmit,
  busy,
  lockedOut,
  remainingSec,
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
      {/* The transaction, at the moment the key is released.
          The diff stays at `preview` — this is a summary, not a second copy of
          it — but the commitment travels, because a user who reads the facts on
          one screen and commits on another has not read them at the moment that
          matters. The two facts here are the two that carry a decision: who is
          paid, and how much.
          `overflow-wrap: anywhere` and not `text-overflow: clip`: clipping drops
          an address's tail with no signal, which is worse than no address. */}
      <div className="w-card" style={{ padding: 0, marginBottom: 12 }} data-testid="auth-commitment">
        <div className="w-card__body">
          <div className="w-kv">
            <span className="k">To</span>
            <span className="v" style={{ overflowWrap: "anywhere", wordBreak: "break-all" }}>
              {descriptor.commitment.subject}
            </span>
          </div>
          <div className="w-kv">
            <span className="k">Amount</span>
            <span className="v mono">
              {descriptor.commitment.amount ?? "No funds leave this wallet"}
            </span>
          </div>
        </div>
      </div>
      <div className="w-banner">
        Enter your wallet password. The vault decrypts in-process via
        Argon2id + XChaCha20-Poly1305; the password never touches disk.
      </div>
      <label className="w-onboarding__field" style={{ marginTop: 12 }}>
        <span className="cap">Password</span>
        {/* Lockout layer 1 of 3: the field (and the Authorize button) go
            disabled. Layer 2 is the Enter guard below; layer 3 is the
            early-return in advanceFromAuth. All three stay, so the drawer can
            never be used as a way around the unlock screen's lockout. */}
        <PasswordInput
          autoFocus
          autoComplete="current-password"
          value={password}
          onChange={setPassword}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !busy && !lockedOut && password) onSubmit();
          }}
          disabled={busy || lockedOut}
        />
      </label>
      {lockedOut ? (
        <div className="w-banner error" style={{ marginTop: 12 }}>
          <div style={{ fontWeight: 600, marginBottom: 4 }}>Too many wrong attempts</div>
          <div style={{ fontSize: 12, color: "var(--w-text-2)" }}>
            Locked for {remainingSec}s. This is the same lockout as the unlock screen.
          </div>
        </div>
      ) : authError ? (
        <AuthErrorBanner error={authError} />
      ) : null}
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

function ErrorPane({
  input,
  context,
  onNavigate,
  onClose,
}: {
  input: SendErrorInput;
  context?: import("../sdk/send-error").SendErrorContext;
  onNavigate?: (route: Route) => void;
  onClose: () => void;
}) {
  const display = formatSendError(input);
  // A failure a subsystem already classified keeps its own words; the rule table
  // only runs on messages nothing has interpreted yet.
  const c = classifySendError(display, context, input.classified);
  const colours = severityColours[c.severity];
  // Dev-gated raw detail — hidden when off, and pointless for `unknown` (its body
  // IS the raw message). Read live (never cached at mount).
  const showTechnical = readDeveloperMode() && c.kind !== "unknown";
  // The "Operators" mention becomes a link only when a route callback exists AND
  // this is a network-class error (genesis / quarantine / offline).
  const linkable = onNavigate !== undefined && errorLinksOperators(c.kind);

  return (
    <div
      style={{
        padding: "12px 14px",
        borderRadius: 10,
        background: colours.cardBg,
        border: `1px solid ${colours.border}`,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
        <span aria-hidden style={{ color: colours.fg }}>{c.severity === "info" ? "ⓘ" : "⚠"}</span>
        <div style={{ fontWeight: 600, color: colours.fg }}>{c.headline}</div>
      </div>
      <div style={{ fontSize: 12.5, lineHeight: 1.6, color: "var(--w-text-2)" }}>
        {linkable ? (
          <BodyWithOperatorsLink
            body={c.body}
            onActivate={() => {
              onClose();
              onNavigate?.("operators");
            }}
          />
        ) : (
          c.body
        )}
      </div>
      {showTechnical ? (
        <details style={{ marginTop: 10 }}>
          <summary style={{ fontSize: 11, color: "var(--w-text-3)", cursor: "pointer" }}>Technical details</summary>
          <div
            style={{
              marginTop: 6,
              fontFamily: "var(--f-mono)",
              fontSize: 11,
              color: "var(--w-text-3)",
              wordBreak: "break-all",
            }}
          >
            {input.message}
          </div>
        </details>
      ) : null}
    </div>
  );
}

/** Render a body, turning the LAST literal "Operators" into a link-styled button. */
function BodyWithOperatorsLink({ body, onActivate }: { body: string; onActivate: () => void }) {
  const word = "Operators";
  const idx = body.lastIndexOf(word);
  if (idx === -1) return <>{body}</>;
  return (
    <>
      {body.slice(0, idx)}
      <button
        type="button"
        onClick={onActivate}
        style={{
          background: "none",
          border: "none",
          padding: 0,
          font: "inherit",
          color: "var(--w-accent, #7aa2f7)",
          textDecoration: "underline",
          cursor: "pointer",
        }}
      >
        {word}
      </button>
      {body.slice(idx + word.length)}
    </>
  );
}
