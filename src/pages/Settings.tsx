// Settings for wallet preferences and optional surfaces.

import { useCallback, useEffect, useState } from "react";
import type { ChainInfo } from "@monolythium/core-sdk";
import { useActiveWallet } from "../sdk/active-wallet";
import { CopyableAddress } from "../components/_detailModalParts";
import { MnemonicGrid } from "../components/MnemonicGrid";
import { getActiveAccount, revealRecoveryPhrase } from "../sdk/keychain";
import { PasswordInput } from "../components/PasswordInput";
import { REVEAL_AUTO_HIDE_SECONDS } from "../components/MnemonicGrid";
import {
  clearUnlockLockout,
  lockoutRemainingMs,
  readLockoutState,
  recordWrongUnlockAttempt,
} from "../sdk/unlock-lockout";
import { VaultCallError } from "../sdk/vault";
import {
  resetConfirmMatches,
  resetPhraseProofMatches,
  resetWalletOnThisDevice,
} from "../sdk/reset";
import {
  AUTO_LOCK_OPTIONS,
  AUTO_LOCK_WARNING_TITLE,
  autoLockConfirmLabel,
  autoLockIncreaseNeedsConfirm,
  autoLockWarningParagraphs,
  readAutoLockMinutes,
  writeAutoLockMinutes,
} from "../sdk/auto-lock-setting";
import { useAutoLock } from "../sdk/auto-lock";
import {
  readIncomingEnabled,
  writeIncomingEnabled,
  readNotificationsEnabled,
  writeNotificationsEnabled,
  readNotificationDetails,
  writeNotificationDetails,
  readNotifyWhileLocked,
  writeNotifyWhileLocked,
} from "../sdk/feature-flags";
import { fetchLiveTestnetRegistry } from "../sdk/live-registry";
import {
  outboundMcpStart,
  outboundMcpStatus,
  outboundMcpStop,
  OutboundMcpCallError,
  type McpOutboundStatus,
} from "../sdk/outbound-mcp";
import {
  readDevkitChannel,
  writeDevkitChannel,
  type NativeDevkitChannel,
} from "../sdk/studio-host";
import {
  LAYOUTS,
  applyLayout,
  readLayout,
  type LayoutId,
} from "../sdk/theme";
import { DeveloperModeToggle } from "../components/DeveloperModeToggle";
import { PreferencesPanel } from "../components/PreferencesPanel";

interface SettingsProps {
  steleEnabled: boolean;
  setSteleEnabled: (enabled: boolean) => void;
  experimentalEnabled: boolean;
  setExperimentalEnabled: (enabled: boolean) => void;
  /** Open directly on a sub-page (for the sidebar shortcuts — Display &
   *  Preferences / Recovery phrase / Reset wallet). Defaults to the hub. */
  initialSubPage?: SettingsSubPage;
}

type SettingsSubPage = "main" | "notifications" | "appearance" | "reset" | "reveal";

export function Settings({ steleEnabled, setSteleEnabled, experimentalEnabled, setExperimentalEnabled, initialSubPage }: SettingsProps) {
  const wallet = useActiveWallet();
  const [devkitChannel, setDevkitChannel] = useState<NativeDevkitChannel>(() => readDevkitChannel());
  const [autoLockMinutes, setAutoLockMinutes] = useState<number>(() => readAutoLockMinutes());
  // A lengthening awaiting confirmation. Nothing is written or shown as active
  // until it is confirmed, so Cancel reverts by construction.
  const [pendingAutoLock, setPendingAutoLock] = useState<number | null>(null);
  const [subPage, setSubPage] = useState<SettingsSubPage>(initialSubPage ?? "main");
  const { lock } = useAutoLock();

  if (subPage === "notifications") {
    return <ManageNotificationsPage onBack={() => setSubPage("main")} />;
  }
  if (subPage === "appearance") {
    return <AppearancePage onBack={() => setSubPage("main")} />;
  }
  if (subPage === "reset") {
    return <ResetWalletPage onBack={() => setSubPage("main")} />;
  }
  if (subPage === "reveal") {
    return <RevealPhrasePage onBack={() => setSubPage("main")} />;
  }

  return (
    <div className="w-page">
      <div className="w-page__header">
        <h1>Settings</h1>
        <div className="sub">Customize how your wallet looks and behaves.</div>
      </div>

      <div className="w-card">
        <div className="w-card__head"><h3>Account</h3></div>
        <div className="w-card__body">
          <div className="w-setting-row">
            <div>
              <div className="row-label">
                {wallet.status === "ready" || wallet.status === "locked"
                  ? wallet.name
                  : "Active account"}
              </div>
              <div className="row-help">The address others use to send you LYTH.</div>
            </div>
            {wallet.status === "ready" ? (
              <CopyableAddress addr={wallet.address} />
            ) : (
              <span className="row-help">
                {wallet.status === "locked"
                  ? "Unlock to derive address"
                  : wallet.status === "error"
                    ? wallet.error
                    : "No active wallet"}
              </span>
            )}
          </div>
          <div className="w-setting-row">
            <div>
              <div className="row-label">Recovery phrase</div>
              <div className="row-help">
                Show your 24-word recovery phrase — the only way to restore
                this wallet on another device. Anyone who has these words controls
                the wallet, so reveal them only where no one can see.
              </div>
            </div>
            <button className="btn btn--sm" onClick={() => setSubPage("reveal")}>
              Show…
            </button>
          </div>
        </div>
      </div>

      <div className="w-card">
        <div className="w-card__head"><h3>Security</h3></div>
        <div className="w-card__body">
          <div className="w-setting-row">
            <div>
              <div className="row-label">Auto-lock after</div>
              <div className="row-help">
                Lock the wallet and ask for your password again after this much inactivity.
              </div>
            </div>
            <div style={{ display: "flex", gap: 6 }}>
              {AUTO_LOCK_OPTIONS.map((m) => (
                <button
                  key={m}
                  type="button"
                  className={`btn btn--sm${m === autoLockMinutes ? " btn--primary" : ""}`}
                  onClick={() => {
                    // Weakening asks; strengthening just applies. The chip only
                    // moves on a confirmed apply, so Cancel reverts by never
                    // having changed anything.
                    if (autoLockIncreaseNeedsConfirm(autoLockMinutes, m)) {
                      setPendingAutoLock(m);
                      return;
                    }
                    setAutoLockMinutes(m);
                    writeAutoLockMinutes(m);
                  }}
                >
                  {m}m
                </button>
              ))}
            </div>
          </div>
          {pendingAutoLock !== null ? (
            <div
              role="dialog"
              aria-modal="true"
              aria-label={AUTO_LOCK_WARNING_TITLE}
              data-testid="auto-lock-warning"
              style={{
                position: "fixed",
                inset: 0,
                background: "rgba(0,0,0,0.55)",
                backdropFilter: "blur(6px)",
                zIndex: 40,
                display: "grid",
                placeItems: "center",
                padding: 24,
              }}
            >
              <div className="w-card" style={{ maxWidth: 460, width: "100%" }}>
                <div className="w-card__head">
                  <h3>{AUTO_LOCK_WARNING_TITLE}</h3>
                </div>
                <div className="w-card__body">
                  {autoLockWarningParagraphs(pendingAutoLock).map((p) => (
                    <p
                      key={p}
                      style={{
                        margin: "0 0 12px",
                        lineHeight: 1.6,
                        color: "var(--w-text-2)",
                        fontSize: 13,
                      }}
                    >
                      {p}
                    </p>
                  ))}
                  <div style={{ display: "flex", gap: 8, marginTop: 16 }}>
                    <button
                      className="btn"
                      onClick={() => setPendingAutoLock(null)}
                    >
                      Cancel
                    </button>
                    <button
                      className="btn btn--primary"
                      style={{ marginLeft: "auto" }}
                      onClick={() => {
                        setAutoLockMinutes(pendingAutoLock);
                        writeAutoLockMinutes(pendingAutoLock);
                        setPendingAutoLock(null);
                      }}
                    >
                      {autoLockConfirmLabel(pendingAutoLock)}
                    </button>
                  </div>
                </div>
              </div>
            </div>
          ) : null}
          <div className="w-setting-row">
            <div>
              <div className="row-label">Lock wallet now</div>
              <div className="row-help">
                Immediately lock the wallet and return to the password screen.
              </div>
            </div>
            <button className="btn btn--sm" onClick={() => lock()}>Lock now</button>
          </div>
          <div className="w-setting-row">
            <div>
              <div className="row-label">Reset wallet</div>
              <div className="row-help">
                Erase this wallet from this device. Only your recovery phrase can restore it.
              </div>
            </div>
            <button className="btn btn--sm" onClick={() => setSubPage("reset")}>Reset…</button>
          </div>
        </div>
      </div>

      <div className="w-card">
        <div className="w-card__head"><h3>Notifications</h3></div>
        <div className="w-card__body">
          <div className="row-help" style={{ lineHeight: 1.6, marginBottom: 4 }}>
            Control system notifications, what details they show, and how they
            behave while the wallet is locked.
          </div>
          <div className="w-setting-row">
            <div>
              <div className="row-label">Manage notifications</div>
              <div className="row-help">
                System notifications, transaction details, and locked-state behaviour.
              </div>
            </div>
            <button className="btn btn--sm" onClick={() => setSubPage("notifications")}>
              Manage
            </button>
          </div>
        </div>
      </div>

      <div className="w-card">
        <div className="w-card__head"><h3>Display &amp; Preferences</h3></div>
        <div className="w-card__body">
          <div className="w-setting-row">
            <div>
              <div className="row-label">Preferences</div>
              <div className="row-help">Theme, language, display currency, and layout.</div>
            </div>
            <button className="btn btn--sm" onClick={() => setSubPage("appearance")}>
              Customize
            </button>
          </div>
        </div>
      </div>

      <ChainRegistryCard />

      <div className="w-card">
        <div className="w-card__head"><h3>Stele marketplace</h3><span className="w-todo__pill">early access</span></div>
        <div className="w-card__body">
          <div className="w-setting-row">
            <div>
              <div className="row-label">Enable Stele marketplace</div>
              <div className="row-help">
                Shows the Stele, Inbox, and Provider tabs. Lets the same key that holds your LYTH browse, book, and sell services on-chain. Off by default while the marketplace surface is in early access.
              </div>
            </div>
            <button
              type="button"
              className={`w-chip ${steleEnabled ? "is-on" : ""}`}
              onClick={() => setSteleEnabled(!steleEnabled)}
            >
              {steleEnabled ? "Enabled" : "Disabled"}
            </button>
          </div>
        </div>
      </div>

      {steleEnabled ? <OutboundMcpCard /> : null}

      <div className="w-card">
        <div className="w-card__head"><h3>Developer mode</h3></div>
        <div className="w-card__body">
          <DeveloperModeToggle />
          <ChipRow
            label="DevKit channel"
            help="Stable wallet releases do not bundle the full DevKit. Channel selection controls update checks."
            value={devkitChannel}
            options={["stable", "testnet", "local"]}
            onChange={(value) => {
              setDevkitChannel(value);
              writeDevkitChannel(value);
            }}
          />
        </div>
      </div>

      <div className="w-card">
        <div className="w-card__head"><h3>Experimental</h3><span className="w-todo__pill">preview</span></div>
        <div className="w-card__body">
          <div className="w-setting-row">
            <div>
              <div className="row-label">Enable experimental v5 features</div>
              <div className="row-help">
                Shows the Agents page (agent sub-accounts and spending policy), the per-route bridge risk panel, and the Delegate autovote planner. These surfaces are in preview and off by default; turning this off hides them and leaves the wallet on the stable surface.
              </div>
            </div>
            <button
              type="button"
              className={`w-chip ${experimentalEnabled ? "is-on" : ""}`}
              onClick={() => setExperimentalEnabled(!experimentalEnabled)}
            >
              {experimentalEnabled ? "Enabled" : "Disabled"}
            </button>
          </div>
        </div>
      </div>

      <div className="w-card">
        <div className="w-card__head"><h3>About</h3></div>
        <div className="w-card__body">
          <div className="w-setting-row">
            <div>
              <div className="row-label">Wallet</div>
              <div className="row-help">Monolythium Wallet · Stage 2 (consumer surface).</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function ToggleRow({
  label,
  help,
  on,
  onToggle,
}: {
  label: string;
  help: string;
  on: boolean;
  onToggle: () => void;
}) {
  return (
    <div className="w-setting-row">
      <div>
        <div className="row-label">{label}</div>
        <div className="row-help">{help}</div>
      </div>
      <button type="button" className={`w-chip ${on ? "is-on" : ""}`} onClick={onToggle}>
        {on ? "Enabled" : "Disabled"}
      </button>
    </div>
  );
}

/**
 * Manage notifications — the system-notification controls. Each toggle persists
 * a lightweight flag that the OS-toast layer (`os-toast.ts`) reads when it
 * decides whether/how to raise a toast. The in-app notification record is
 * always written regardless of any toggle here (the Notifications centre + bell
 * badge are unaffected). The relationship of the notifications surface to the
 * experimental flag is unchanged — these are the user-facing controls within it.
 */
function ManageNotificationsPage({ onBack }: { onBack: () => void }) {
  const [sysEnabled, setSysEnabled] = useState(() => readNotificationsEnabled());
  const [details, setDetails] = useState(() => readNotificationDetails());
  const [whileLocked, setWhileLocked] = useState(() => readNotifyWhileLocked());
  const [incoming, setIncoming] = useState(() => readIncomingEnabled());

  return (
    <div className="w-page">
      <div className="w-page__header">
        <button
          className="btn btn--sm btn--ghost"
          onClick={onBack}
          style={{ marginBottom: 12 }}
        >
          ← Settings
        </button>
        <h1>Manage notifications</h1>
        <div className="sub">
          System notifications and how they behave. In-app notifications are
          always kept.
        </div>
      </div>
      <div className="w-card">
        <div className="w-card__body">
          <ToggleRow
            label="System notifications"
            help="Show a system notification when a transaction confirms or fails. In-app notifications are always kept."
            on={sysEnabled}
            onToggle={() => {
              const next = !sysEnabled;
              setSysEnabled(next);
              writeNotificationsEnabled(next);
            }}
          />
          <ToggleRow
            label="Show transaction details"
            help="Include the amount and address in notifications. Off shows only 'Transaction confirmed' — safer on shared screens. In-app details are unaffected."
            on={details}
            onToggle={() => {
              const next = !details;
              setDetails(next);
              writeNotificationDetails(next);
            }}
          />
          <ToggleRow
            label="Notify while locked"
            help="Notify for transactions that confirm while the wallet is locked. Off holds them until you next unlock. In-app records are always kept."
            on={whileLocked}
            onToggle={() => {
              const next = !whileLocked;
              setWhileLocked(next);
              writeNotifyWhileLocked(next);
            }}
          />
          <ToggleRow
            label="Incoming transfers"
            help="Show a system notification when LYTH arrives. Detected while the wallet is open; the in-app record is always kept."
            on={incoming}
            onToggle={() => {
              const next = !incoming;
              setIncoming(next);
              writeIncomingEnabled(next);
            }}
          />
        </div>
      </div>
    </div>
  );
}

/**
 * Reset wallet — a destructive, type-to-confirm wipe. Removes every vault from
 * this device by deleting each OS-keychain blob and its catalog entry (the same
 * commands the Wallets page uses to remove a single vault). On success the
 * webview reloads so the boot probe re-runs and, finding no vault, routes to
 * onboarding. On-chain funds are untouched; only the recovery phrase restores.
 */
function ResetWalletPage({ onBack }: { onBack: () => void }) {
  const wallet = useActiveWallet();
  const [confirmText, setConfirmText] = useState("");
  const [resetPhrase, setResetPhrase] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const proofOk = resetPhraseProofMatches(resetPhrase, wallet.addressHex);
  const canReset = resetConfirmMatches(confirmText) && proofOk && !busy;

  const doReset = async () => {
    if (!canReset) return;
    setBusy(true);
    setError(null);
    try {
      await resetWalletOnThisDevice();
    } catch (cause) {
      setError((cause as Error)?.message ?? String(cause));
      setBusy(false);
    }
  };

  return (
    <div className="w-page">
      <div className="w-page__header">
        <button
          className="btn btn--sm btn--ghost"
          onClick={onBack}
          style={{ marginBottom: 12 }}
        >
          ← Settings
        </button>
        <h1>Reset wallet</h1>
        <div className="sub">Erase this wallet from this device.</div>
      </div>
      <div className="w-card">
        <div className="w-card__body">
          <div className="w-banner error" style={{ lineHeight: 1.6 }}>
            This erases <strong>every wallet</strong> on this device and its
            encrypted vault. <strong>Only the recovery phrase can restore each
            one</strong> — without it, those funds are gone. Your funds on-chain
            are unaffected.
          </div>
          <label className="w-onboarding__field" style={{ marginTop: 16 }}>
            <span className="cap">Enter this wallet's 24-word recovery phrase</span>
            <textarea
              autoCapitalize="none"
              autoComplete="off"
              autoCorrect="off"
              spellCheck={false}
              rows={3}
              value={resetPhrase}
              onChange={(e) => setResetPhrase(e.target.value)}
              placeholder="word1 word2 word3 …"
              style={{ resize: "vertical", fontFamily: "var(--f-mono)" }}
            />
            <span className="cap" style={{ color: proofOk ? "var(--ok)" : "var(--fg-500)", marginTop: 4 }}>
              {proofOk
                ? "✓ Recovery phrase verified — you can restore this wallet"
                : "Confirms you can restore afterward. It never leaves this device."}
            </span>
          </label>
          <label className="w-onboarding__field" style={{ marginTop: 12 }}>
            <span className="cap">Then type RESET to confirm</span>
            <input
              type="text"
              autoCapitalize="characters"
              autoComplete="off"
              spellCheck={false}
              value={confirmText}
              onChange={(e) => setConfirmText(e.target.value)}
              placeholder="RESET"
            />
          </label>
          {error ? (
            <div className="w-banner error" style={{ marginTop: 12 }}>{error}</div>
          ) : null}
          <div style={{ display: "flex", gap: 8, marginTop: 20 }}>
            <button className="btn" onClick={onBack} disabled={busy}>Cancel</button>
            <button
              className="btn btn--primary"
              style={{ marginLeft: "auto" }}
              disabled={!canReset}
              onClick={() => void doReset()}
            >
              {busy ? "Erasing…" : "Erase wallet"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * Settings → Show recovery phrase. Re-prompts for the password, decrypts the
 * vault's recovery payload via `revealRecoveryPhrase`, and renders the 24 words
 * with MnemonicGrid behind a warning banner. A vault sealed without the payload
 * reports an honest "not stored" message — no dead control, no fabricated
 * phrase. The auto-lock idle timer is paused while the page is mounted and the
 * phrase is dropped from state on leave.
 */
function RevealPhrasePage({ onBack }: { onBack: () => void }) {
  const { pauseTimer, resumeTimer } = useAutoLock();
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mnemonic, setMnemonic] = useState<string | null>(null);
  const [notStored, setNotStored] = useState(false);
  const [lockoutUntil, setLockoutUntil] = useState(0);
  const [now, setNow] = useState(() => Date.now());
  // Seconds left before the phrase auto-hides, or null before the first reveal.
  const [hideInSec, setHideInSec] = useState<number | null>(null);

  // This page pauses the idle auto-lock so a long transcription is not cut off,
  // which means the usual timeout cannot protect it. A revealed phrase would
  // otherwise sit on screen indefinitely on a walked-away machine with the lock
  // deliberately suspended — so the surface imposes its own tighter bound.
  //
  // The countdown starts at the FIRST REVEAL, not at mount: before that the
  // grid is obscured and there is nothing exposed to time.
  const startHideCountdown = useCallback(() => {
    setHideInSec((cur) => (cur === null ? REVEAL_AUTO_HIDE_SECONDS : cur));
  }, []);

  useEffect(() => {
    if (hideInSec === null) return;
    if (hideInSec <= 0) {
      // Exposure window over. Drop the phrase and leave the way "Done" does —
      // seeing it again costs a fresh password authorization, so the window is
      // per-authorization rather than per-visit.
      setMnemonic(null);
      onBack();
      return;
    }
    const id = window.setTimeout(() => setHideInSec((s) => (s ?? 1) - 1), 1_000);
    return () => window.clearTimeout(id);
  }, [hideInSec, onBack]);

  // Suspend the idle auto-lock while the phrase may be on screen; resume and
  // drop the phrase from state when leaving.
  useEffect(() => {
    pauseTimer();
    return () => {
      resumeTimer();
      setMnemonic(null);
    };
  }, [pauseTimer, resumeTimer]);

  // This prompt verifies the WALLET VAULT PASSWORD, so it belongs to the one
  // shared brute-force budget alongside the unlock gate and the operation
  // drawer. Without this it was an unthrottled Argon2id oracle for the same
  // secret — a way to guess without ever meeting a lockout window.
  //
  // Password CREATION surfaces are deliberately not members: there is no
  // existing secret to guess there.
  useEffect(() => {
    setLockoutUntil(readLockoutState().lockoutUntil);
  }, []);

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

  const submit = async () => {
    if (busy || password.length === 0 || lockedOut) return;
    setBusy(true);
    setError(null);
    try {
      const out = await revealRecoveryPhrase(getActiveAccount(), password);
      setPassword("");
      // A correct password clears the shared budget everywhere — the count
      // resets only on a success, never by waiting a window out.
      clearUnlockLockout();
      setLockoutUntil(0);
      if (out.revealable && out.mnemonic) {
        setMnemonic(out.mnemonic);
      } else {
        setNotStored(true);
      }
    } catch (cause) {
      if (cause instanceof VaultCallError && cause.cause.code === "wrong_password") {
        const next = recordWrongUnlockAttempt();
        setLockoutUntil(next.lockoutUntil);
        setNow(Date.now());
        const rem = lockoutRemainingMs(next.lockoutUntil, Date.now());
        setError(
          rem > 0
            ? `Wrong password — too many attempts. Locked for ${Math.ceil(rem / 1000)}s.`
            : "Wrong password. Try again.",
        );
      } else {
        // Operational failures are not guesses and never escalate the budget.
        setError((cause as Error)?.message ?? "Could not reveal the phrase.");
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="w-page">
      <div className="w-page__header">
        <button
          className="btn btn--sm btn--ghost"
          onClick={onBack}
          style={{ marginBottom: 12 }}
        >
          ← Settings
        </button>
        <h1>Recovery phrase</h1>
        <div className="sub">Show the 24 words that restore this wallet.</div>
      </div>
      <div className="w-card">
        <div className="w-card__body">
          {mnemonic ? (
            <>
              {hideInSec !== null ? (
                <div
                  data-testid="reveal-countdown"
                  style={{
                    display: "inline-block",
                    marginBottom: 12,
                    padding: "3px 10px",
                    borderRadius: "var(--r-pill)",
                    background: "var(--gold-dim, rgba(200,160,60,0.14))",
                    color: "var(--gold)",
                    fontSize: "var(--fs-11)",
                    fontWeight: 600,
                  }}
                >
                  Hides in {hideInSec}s
                </div>
              ) : null}
              <MnemonicGrid mnemonic={mnemonic} onFirstReveal={startHideCountdown} />
              <div style={{ display: "flex", marginTop: 20 }}>
                <button
                  className="btn btn--primary"
                  style={{ width: "100%" }}
                  onClick={onBack}
                >
                  Done
                </button>
              </div>
            </>
          ) : notStored ? (
            <>
              <div className="w-banner" style={{ lineHeight: 1.6 }}>
                This wallet doesn't have its recovery phrase stored, so it can't
                be shown here. Keep using the 24 words you wrote down at setup. To
                enable in-app reveal, re-import those words as a new wallet.
              </div>
              <div style={{ display: "flex", marginTop: 20 }}>
                <button className="btn" onClick={onBack}>Back</button>
              </div>
            </>
          ) : (
            <>
              <div className="w-banner" style={{ lineHeight: 1.6 }}>
                Enter your password to decrypt and show your recovery phrase.
                Make sure no one can see your screen.
              </div>
              <label className="w-onboarding__field" style={{ marginTop: 16 }}>
                <span className="cap">Password</span>
                <PasswordInput
                  autoFocus
                  autoComplete="current-password"
                  value={password}
                  onChange={setPassword}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !busy && !lockedOut) void submit();
                  }}
                  disabled={busy || lockedOut}
                />
              </label>
              {lockedOut ? (
                <div className="w-banner error" style={{ marginTop: 12 }}>
                  Too many wrong attempts. Try again in {remainingSec}s.
                </div>
              ) : error ? (
                <div className="w-banner error" style={{ marginTop: 12 }}>{error}</div>
              ) : null}
              <div style={{ display: "flex", gap: 8, marginTop: 20 }}>
                <button className="btn" onClick={onBack} disabled={busy}>Cancel</button>
                <button
                  className="btn btn--primary"
                  style={{ marginLeft: "auto" }}
                  disabled={busy || password.length === 0 || lockedOut}
                  onClick={() => void submit()}
                >
                  {lockedOut
                    ? `Locked — ${remainingSec}s`
                    : busy
                      ? "Revealing…"
                      : "Show phrase"}
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function OutboundMcpCard() {
  const [status, setStatus] = useState<McpOutboundStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [showToken, setShowToken] = useState(false);

  const refresh = useCallback(async () => {
    setError(null);
    try {
      const s = await outboundMcpStatus();
      setStatus(s);
    } catch (cause) {
      if (cause instanceof OutboundMcpCallError) {
        setError(cause.message);
        setStatus(null);
      } else {
        setError(String(cause));
      }
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const toggle = async () => {
    setBusy(true);
    setError(null);
    try {
      const next = status?.enabled ? await outboundMcpStop() : await outboundMcpStart();
      setStatus(next);
    } catch (cause) {
      if (cause instanceof OutboundMcpCallError) setError(cause.message);
      else setError(String(cause));
    } finally {
      setBusy(false);
    }
  };

  const copyJson = () => {
    if (!status?.enabled || !status.url || !status.auth_token) return;
    const config = {
      mcpServers: {
        "monolythium-wallet": {
          url: status.url,
          headers: { Authorization: `Bearer ${status.auth_token}` },
        },
      },
    };
    navigator.clipboard?.writeText(JSON.stringify(config, null, 2));
  };

  return (
    <div className="w-card">
      <div className="w-card__head">
        <h3>Outbound MCP</h3>
        <span className="w-todo__pill">
          {status == null ? "loading" : status.enabled ? "running" : "stopped"}
        </span>
      </div>
      <div className="w-card__body">
        {error ? (
          <div className="row-help" style={{ color: "var(--w-text-2, #999)", marginBottom: 12 }}>
            {error}
          </div>
        ) : null}

        <div className="w-setting-row">
          <div>
            <div className="row-label">Expose this wallet as an MCP server</div>
            <div className="row-help">
              Lets desktop MCP clients call Stele tools (search providers,
              request bookings, query balance) on your behalf. Loopback-only with a per-session
              bearer token. Every destructive call still routes through the approval bridge.
            </div>
          </div>
          <button
            type="button"
            className={`w-chip ${status?.enabled ? "is-on" : ""}`}
            onClick={toggle}
            disabled={busy}
          >
            {busy ? "…" : status?.enabled ? "Stop" : "Start"}
          </button>
        </div>

        {status?.enabled && status.url ? (
          <div style={{ marginTop: 12, display: "flex", flexDirection: "column", gap: 6 }}>
            <div className="row-help">
              <div className="row-label">URL</div>
              <code>{status.url}</code>
            </div>
            <div className="row-help">
              <div className="row-label">Auth token</div>
              <code>{showToken ? status.auth_token : "•".repeat(24)}</code>
              <button
                type="button"
                className="btn btn--sm"
                onClick={() => setShowToken((v) => !v)}
                style={{ marginLeft: 8 }}
              >
                {showToken ? "Hide" : "Reveal"}
              </button>
            </div>
            <div className="row-help">
              <div className="row-label">Scopes</div>
              {status.scopes.join(" · ")}
            </div>
            <div>
              <button type="button" className="btn btn--sm" onClick={copyJson}>
                Copy MCP client config
              </button>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}

function ChipRow<T extends string>({ label, help, value, options, onChange }: {
  label: string;
  help: string;
  value: T;
  options: ReadonlyArray<T>;
  onChange: (v: T) => void;
}) {
  return (
    <div className="w-setting-row">
      <div>
        <div className="row-label">{label}</div>
        <div className="row-help">{help}</div>
      </div>
      <div className="w-chip-group">
        {options.map((o) => (
          <button
            key={o}
            type="button"
            className={`w-chip ${value === o ? "is-on" : ""}`}
            onClick={() => onChange(o)}
          >
            {o}
          </button>
        ))}
      </div>
    </div>
  );
}

function shortHex(s: string, head = 10, tail = 6): string {
  if (s.length <= head + tail + 1) return s;
  return `${s.slice(0, head)}…${s.slice(-tail)}`;
}

/**
 * Appearance — the 12-palette theme picker + the sidebar/topbar layout
 * toggle. Both write a `data-*` attribute on <html> and persist to
 * localStorage via `sdk/theme`; `main.tsx` re-applies them before first
 * paint on the next launch. The default theme ("monolythium") renders the
 * native :root palette (no attribute).
 */
function AppearancePage({ onBack }: { onBack: () => void }) {
  const [layout, setLayout] = useState<LayoutId>(() => readLayout());

  const pickLayout = (id: LayoutId) => {
    applyLayout(id);
    setLayout(id);
  };

  return (
    <div className="w-page">
      <div className="w-page__header">
        <button
          className="btn btn--sm btn--ghost"
          onClick={onBack}
          style={{ marginBottom: 12 }}
        >
          ← Settings
        </button>
        <h1>Display &amp; Preferences</h1>
        <div className="sub">
          {"How the wallet looks and reads — theme, language, display currency, and layout. Applies across the wallet and persists on this device."}
        </div>
      </div>
      <div className="w-card">
        <div className="w-card__body">
          {/* The SAME component the Welcome screen renders — zero drift. */}
          <PreferencesPanel />
          {/* Layout stays outside the shared panel: it is a desktop shell
              control with no meaning on the pre-shell Welcome screen. */}
          <div style={{ marginTop: 14 }}>
            <ChipRow
              label="Layout"
              help="Sidebar keeps a vertical rail on the left. Topbar moves navigation above the content."
              value={layout}
              options={LAYOUTS}
              onChange={pickLayout}
            />
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * Live testnet chain-registry card. Pulls the canonical genesis_hash
 * and binary_sha from the GitHub chain-registry repo so the wallet
 * reflects the latest registry push without needing an SDK rebuild +
 * wallet bump. Falls back to a "fetching…" state until the network
 * call resolves; on persistent failure the value stays as a dash so
 * the card never displays stale info.
 */
function ChainRegistryCard() {
  const [registry, setRegistry] = useState<ChainInfo | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const info = await fetchLiveTestnetRegistry();
      if (cancelled) return;
      setRegistry(info);
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="w-card">
      <div className="w-card__head">
        <h3>Chain registry</h3>
        <span className="w-live-pill">live</span>
      </div>
      <div className="w-card__body">
        <div className="w-kv">
          <span className="k">Network</span>
          <span className="v">{registry?.display_name ?? "testnet-69420"}</span>
        </div>
        <div className="w-kv">
          <span className="k">Chain id</span>
          <span className="v mono">{registry?.chain_id ?? "—"}</span>
        </div>
        <div className="w-kv">
          <span className="k">Genesis hash</span>
          <span
            className="v mono"
            title={registry?.genesis_hash ?? ""}
            style={{ fontSize: 12 }}
          >
            {loading
              ? "fetching…"
              : registry
                ? shortHex(registry.genesis_hash)
                : "registry unreachable"}
          </span>
        </div>
        <div className="w-kv">
          <span className="k">Binary sha</span>
          <span className="v mono" style={{ fontSize: 12 }}>
            {loading
              ? "fetching…"
              : registry?.binary_sha ?? "registry unreachable"}
          </span>
        </div>
        <div className="row-help" style={{ marginTop: 8 }}>
          Live read from{" "}
          <span className="mono">github.com/monolythium/chain-registry</span>{" "}
          (5-minute cache). The wallet&apos;s pinned trust anchors stay
          compile-time; this card is informational.
        </div>
      </div>
    </div>
  );
}
