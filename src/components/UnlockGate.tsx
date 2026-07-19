// Lock gate — the full-screen password re-prompt shown when the wallet
// auto-locks. Verifies the password by decrypting the active vault through the
// existing keychain unlock path, then zeroes the returned seed immediately (we
// only needed to confirm the password, never to keep it). No address is shown
// while locked. Fails closed: a wrong password keeps the gate up.

import { useEffect, useState } from "react";
import { WalletLockLogo } from "./WalletLockLogo";
import { PasswordInput } from "./PasswordInput";
import {
  KeychainCallError,
  fetchAndUnlockVault,
  getActiveAccount,
} from "../sdk/keychain";
import { isWrongPasswordFailure } from "../sdk/vault";
import { loadActiveWallet } from "../sdk/active-wallet";
import { useAutoLock } from "../sdk/auto-lock";
import {
  resetConfirmMatches,
  resetPhraseProofMatches,
  resetWalletOnThisDevice,
} from "../sdk/reset";
import {
  lockoutRemainingMs,
  readLockoutState,
  recordWrongUnlockAttempt,
} from "../sdk/unlock-lockout";

export function UnlockGate() {
  const { unlock } = useAutoLock();
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [lockoutUntil, setLockoutUntil] = useState(0);
  const [now, setNow] = useState(() => Date.now());
  // Forgot-password recovery: the only escape hatch for a locked, password-lost
  // user. Reveals a type-to-confirm reset that reuses the shared wipe path; the
  // device re-onboards (re-import from the recovery phrase) after the reload.
  const [forgotOpen, setForgotOpen] = useState(false);
  const [confirmText, setConfirmText] = useState("");
  const [resetPhrase, setResetPhrase] = useState("");
  const [resetBusy, setResetBusy] = useState(false);
  const [resetError, setResetError] = useState<string | null>(null);
  // The active vault's address, to verify the entered recovery phrase against
  // (available even while locked — the catalog stores it in plaintext).
  const [activeAddressHex, setActiveAddressHex] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void loadActiveWallet().then((w) => {
      if (!cancelled) setActiveAddressHex(w.addressHex);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const resetProofOk = resetPhraseProofMatches(resetPhrase, activeAddressHex);
  const canReset = resetConfirmMatches(confirmText) && resetProofOk && !resetBusy;

  // Re-check the persisted brute-force lockout against the wall clock on mount,
  // so a relaunch can't sidestep an in-progress lockout.
  useEffect(() => {
    setLockoutUntil(readLockoutState().lockoutUntil);
  }, []);

  // Tick while a lockout window is active so the countdown updates and the
  // input re-enables the instant it elapses.
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
      const seed = await fetchAndUnlockVault(getActiveAccount(), password);
      seed.fill(0); // verification only — never retain the decrypted seed
      setPassword("");
      setLockoutUntil(0); // unlock() clears the persisted lockout counter
      unlock();
    } catch (cause) {
      if (isWrongPasswordFailure(cause)) {
        // Escalating deterrence on top of Argon2id: bump the count and impose
        // the next window if a threshold is met. Reset happens only on success.
        const next = recordWrongUnlockAttempt();
        setLockoutUntil(next.lockoutUntil);
        setNow(Date.now());
        const rem = lockoutRemainingMs(next.lockoutUntil, Date.now());
        setError(
          rem > 0
            ? `Wrong password — too many attempts. Locked for ${Math.ceil(rem / 1000)}s.`
            : "Wrong password. Try again.",
        );
      } else if (cause instanceof KeychainCallError) {
        setError(cause.message);
      } else {
        setError((cause as Error)?.message ?? "Unlock failed.");
      }
      setBusy(false);
      return;
    }
    setBusy(false);
  };

  const doReset = async () => {
    if (!canReset) return;
    setResetBusy(true);
    setResetError(null);
    try {
      await resetWalletOnThisDevice();
    } catch (cause) {
      setResetError((cause as Error)?.message ?? String(cause));
      setResetBusy(false);
    }
  };

  const closeForgot = () => {
    setForgotOpen(false);
    setConfirmText("");
    setResetPhrase("");
    setResetError(null);
  };

  return (
    <div className="w-onboarding">
      <div className="w-onboarding__card" style={{ textAlign: "center" }}>
        <WalletLockLogo size={52} badge={forgotOpen ? "key" : "lock"} />
        {forgotOpen ? (
          <>
            <h1 style={{ margin: "0 0 6px" }}>Forgot your password?</h1>
            <p
              style={{
                margin: "0 0 16px",
                color: "var(--w-text-2)",
                fontSize: 13,
                lineHeight: 1.55,
              }}
            >
              We can't recover your password. To regain access, reset this
              device's wallet, then add your accounts back with your 24-word
              recovery phrase.
            </p>
            <div className="w-banner error" style={{ lineHeight: 1.6, textAlign: "left" }}>
              This erases <strong>every wallet</strong> on this device and its
              encrypted vault. <strong>Only the recovery phrase can restore each
              one</strong> — without it, those funds are gone. Your funds on-chain
              are unaffected.
            </div>
            <label className="w-onboarding__field" style={{ marginTop: 16, textAlign: "left" }}>
              <span className="cap">Enter this wallet's 24-word recovery phrase</span>
              <textarea
                autoFocus
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
              <span className="cap" style={{ color: resetProofOk ? "var(--ok)" : "var(--fg-500)", marginTop: 4 }}>
                {resetProofOk
                  ? "✓ Recovery phrase verified — you can restore this wallet"
                  : "Confirms you can restore afterward. It never leaves this device."}
              </span>
            </label>
            <label className="w-onboarding__field" style={{ marginTop: 12, textAlign: "left" }}>
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
            {resetError ? (
              <div className="w-banner error" style={{ marginTop: 12, textAlign: "left" }}>
                {resetError}
              </div>
            ) : null}
            <div style={{ display: "flex", gap: 8, marginTop: 20 }}>
              <button className="btn" disabled={resetBusy} onClick={closeForgot}>
                Cancel
              </button>
              <button
                className="btn btn--primary"
                style={{ marginLeft: "auto" }}
                disabled={!canReset}
                onClick={() => void doReset()}
              >
                {resetBusy ? "Erasing…" : "Erase wallet"}
              </button>
            </div>
          </>
        ) : (
          <>
            <h1 style={{ margin: "0 0 6px" }}>Unlock Monolythium Wallet</h1>
            <p
              style={{
                margin: "0 0 20px",
                color: "var(--w-text-2)",
                fontSize: 13,
                lineHeight: 1.55,
              }}
            >
              Enter your password to unlock. It decrypts your vault locally with
              Argon2id and XChaCha20-Poly1305; the password is never stored.
            </p>
            <label className="w-onboarding__field" style={{ textAlign: "left" }}>
              <span className="cap">Password</span>
              <PasswordInput
                autoFocus
                autoComplete="current-password"
                value={password}
                onChange={setPassword}
                onKeyDown={(e) => {
                  if (e.key === "Enter") void submit();
                }}
                disabled={busy || lockedOut}
              />
            </label>
            {lockedOut ? (
              <div className="w-banner error" style={{ marginTop: 12, textAlign: "left" }}>
                Too many wrong attempts. Try again in {remainingSec}s.
              </div>
            ) : error ? (
              <div className="w-banner error" style={{ marginTop: 12, textAlign: "left" }}>
                {error}
              </div>
            ) : null}
            <div style={{ display: "flex", marginTop: 20 }}>
              <button
                className="btn btn--primary"
                style={{ width: "100%" }}
                disabled={busy || password.length === 0 || lockedOut}
                onClick={() => void submit()}
              >
                {lockedOut ? `Locked — ${remainingSec}s` : busy ? "Unlocking…" : "Unlock"}
              </button>
            </div>
            {/* Recovery escape hatch — always available (even while locked out),
                since a password-lost user has no other way back in. */}
            <button
              type="button"
              onClick={() => setForgotOpen(true)}
              style={{
                marginTop: 16,
                background: "none",
                border: "none",
                color: "var(--gold)",
                fontSize: 12,
                textDecoration: "underline",
                cursor: "pointer",
              }}
            >
              Forgot your password?
            </button>
          </>
        )}
      </div>
    </div>
  );
}
