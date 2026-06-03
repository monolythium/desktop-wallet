// Lock gate — the full-screen password re-prompt shown when the wallet
// auto-locks. Verifies the password by decrypting the active vault through the
// existing keychain unlock path, then zeroes the returned seed immediately (we
// only needed to confirm the password, never to keep it). No address is shown
// while locked. Fails closed: a wrong password keeps the gate up.

import { useEffect, useState } from "react";
import {
  KeychainCallError,
  fetchAndUnlockVault,
  getActiveAccount,
} from "../sdk/keychain";
import { VaultCallError } from "../sdk/vault";
import { useAutoLock } from "../sdk/auto-lock";
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
      if (cause instanceof VaultCallError && cause.cause.code === "wrong_password") {
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

  return (
    <div className="w-onboarding">
      <div className="w-onboarding__card" style={{ textAlign: "center" }}>
        <div
          aria-hidden="true"
          style={{
            width: 52,
            height: 52,
            margin: "0 auto 14px",
            borderRadius: 13,
            background: "var(--gold)",
            boxShadow: "0 0 16px rgba(var(--gold-glow), 0.4)",
          }}
        />
        <h1 style={{ margin: "0 0 6px" }}>Wallet locked</h1>
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
          <input
            type="password"
            autoFocus
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
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
      </div>
    </div>
  );
}
