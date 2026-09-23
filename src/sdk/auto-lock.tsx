// Auto-lock — a re-prompt gate, not a key wipe.
//
// This wallet holds no long-lived decrypted secret: the seed is decrypted
// per operation and zeroed immediately. So "locking" does not clear a session
// key (there is none) — it flips a flag that re-gates the shell behind the
// password screen. This provider owns that flag plus one inactivity timer.
//
// The timer is a plain setTimeout reset on genuine user input. Because a
// setTimeout under-counts while the OS sleeps, we also stamp an absolute
// wall-clock deadline and re-check it whenever the window regains focus or
// becomes visible — locking immediately if that deadline already passed.

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { readAutoLockMinutes } from "./auto-lock-setting";
import { clearUnlockLockout } from "./unlock-lockout";
import { clearSentRecipientIntegrityKeys } from "./sent-recipients";
import { clearDerivedAddresses } from "./address-provenance";
import { readPersistedLocked, writePersistedLocked } from "./lock-state";

interface AutoLockApi {
  isLocked: boolean;
  lock: () => void;
  unlock: () => void;
  /** Suspend the idle timer while a sensitive flow (e.g. a signing operation)
   *  is open, so it can't be interrupted mid-action. Calls nest: each
   *  pauseTimer() must be matched by a resumeTimer(). */
  pauseTimer: () => void;
  resumeTimer: () => void;
}

const AutoLockContext = createContext<AutoLockApi | null>(null);

// Module-level copy of the lock flag so non-React modules (e.g. the OS-toast
// layer, which decides whether to suppress a toast while locked) can read it
// synchronously. The LockProvider keeps it in sync with its React state.
//
// SEEDED FROM THE PERSISTED MARKER AT MODULE INIT, not left `false` until the
// first React sync. `isWalletLocked()`'s two consumers — IncomingPoller and
// os-toast — can both run before the provider's effect has fired, so a plain
// `false` here let a toast reach the OS during the window between process
// start and first render, even though the wallet was locked (SA-10-001).
let _walletLocked = readPersistedLocked();

/** True when the wallet is currently locked. Readable outside React. */
export function isWalletLocked(): boolean {
  return _walletLocked;
}

export function useAutoLock(): AutoLockApi {
  const ctx = useContext(AutoLockContext);
  if (ctx === null) {
    throw new Error("useAutoLock must be used inside a <LockProvider>");
  }
  return ctx;
}

export function LockProvider({ children }: { children: ReactNode }) {
  // Read the persisted marker at mount, so an idle lock survives a relaunch
  // instead of coming back as an open shell (SA-09-004). Lazy initialiser: the
  // read happens once, not on every render.
  const [isLocked, setIsLocked] = useState(() => readPersistedLocked());
  const deadlineRef = useRef(0);
  const timerRef = useRef<number | null>(null);
  const pauseDepthRef = useRef(0);

  const clearTimer = useCallback(() => {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const arm = useCallback(() => {
    clearTimer();
    if (pauseDepthRef.current > 0) return; // suspended during a sensitive flow
    const ms = readAutoLockMinutes() * 60_000;
    deadlineRef.current = Date.now() + ms;
    timerRef.current = window.setTimeout(() => setIsLocked(true), ms);
  }, [clearTimer]);

  const lock = useCallback(() => {
    // No session key to wipe: the seed is decrypted per operation and zeroed
    // immediately, and any in-flight operation pauses the timer rather than
    // being interrupted. Locking just clears the timer and flips the flag
    // that re-gates the shell behind the password screen.
    clearTimer();
    setIsLocked(true);
  }, [clearTimer]);

  const unlock = useCallback(() => {
    // A successful unlock clears the brute-force lockout counter (the only
    // caller, UnlockGate, reaches here only after the password verified).
    clearUnlockLockout();
    setIsLocked(false);
    arm();
  }, [arm]);

  const pauseTimer = useCallback(() => {
    pauseDepthRef.current += 1;
    clearTimer();
  }, [clearTimer]);

  const resumeTimer = useCallback(() => {
    pauseDepthRef.current = Math.max(0, pauseDepthRef.current - 1);
    if (pauseDepthRef.current === 0) arm();
  }, [arm]);

  // Keep the module-level copy in sync so non-React readers see the lock flag,
  // and persist the flag so it survives the process.
  //
  // This lives in an effect on `isLocked` rather than inside lock()/unlock()
  // because there are THREE ways to become locked and only one of them is
  // lock(): the idle timer calls setIsLocked directly, and so does the
  // wall-clock deadline check after sleep/resume. Writing at the call sites
  // would persist the manual lock and silently miss both automatic ones.
  useEffect(() => {
    _walletLocked = isLocked;
    writePersistedLocked(isLocked);
  }, [isLocked]);

  // Zeroize the one session secret this wallet caches — the sent-recipients
  // integrity sub-keys — whenever it locks. (The seed itself is still decrypted
  // per operation and never cached, so there is nothing else to wipe.)
  useEffect(() => {
    if (isLocked) clearSentRecipientIntegrityKeys();
  }, [isLocked]);

  // Forget which addresses this process derived. After a lock the user must
  // prove the passphrase again, so a provenance record surviving the lock would
  // let the pre-lock proof vouch for a catalog value planted afterwards.
  useEffect(() => {
    if (isLocked) clearDerivedAddresses();
  }, [isLocked]);

  // Arm on mount; tear the timer down on unmount.
  useEffect(() => {
    arm();
    return clearTimer;
  }, [arm, clearTimer]);

  // Extend the deadline only on genuine user interaction. Background
  // re-renders and programmatic route changes don't fire these listeners,
  // so passive activity can't keep the wallet awake.
  useEffect(() => {
    if (isLocked) return;
    const bump = () => arm();
    window.addEventListener("pointerdown", bump, { passive: true });
    window.addEventListener("keydown", bump);
    return () => {
      window.removeEventListener("pointerdown", bump);
      window.removeEventListener("keydown", bump);
    };
  }, [isLocked, arm]);

  // Wall-clock guard for sleep/resume: a paused setTimeout may not fire (or
  // fires late) while the machine sleeps, so re-check the absolute deadline
  // when the window returns to the foreground.
  useEffect(() => {
    if (isLocked) return;
    const check = () => {
      if (pauseDepthRef.current > 0) return;
      if (Date.now() >= deadlineRef.current) setIsLocked(true);
    };
    const onVisible = () => {
      if (document.visibilityState === "visible") check();
    };
    window.addEventListener("focus", check);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.removeEventListener("focus", check);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [isLocked]);

  return (
    <AutoLockContext.Provider value={{ isLocked, lock, unlock, pauseTimer, resumeTimer }}>
      {children}
    </AutoLockContext.Provider>
  );
}

/** Renders `locked` instead of `children` whenever the wallet is locked.
 *  Must be used inside a <LockProvider>. */
export function LockBoundary({
  locked,
  children,
}: {
  locked: ReactNode;
  children: ReactNode;
}) {
  const { isLocked } = useAutoLock();
  return <>{isLocked ? locked : children}</>;
}
