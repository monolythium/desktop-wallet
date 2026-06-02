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

// How long the window may stay unfocused before the wallet locks. A short
// grace avoids re-prompting for a quick alt-tab (e.g. to a password manager);
// refocusing within the window cancels the pending lock.
const BLUR_GRACE_MS = 30_000;

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

export function useAutoLock(): AutoLockApi {
  const ctx = useContext(AutoLockContext);
  if (ctx === null) {
    throw new Error("useAutoLock must be used inside a <LockProvider>");
  }
  return ctx;
}

export function LockProvider({ children }: { children: ReactNode }) {
  const [isLocked, setIsLocked] = useState(false);
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

  // Lock shortly after the native window loses focus. Suspended during
  // operations and while already locked. Best-effort: in the non-Tauri design
  // preview the window API is unavailable, so this quietly does nothing.
  useEffect(() => {
    if (isLocked) return;
    let unlisten: (() => void) | null = null;
    let graceTimer: number | null = null;
    let disposed = false;
    const clearGrace = () => {
      if (graceTimer !== null) {
        window.clearTimeout(graceTimer);
        graceTimer = null;
      }
    };
    void (async () => {
      try {
        const { getCurrentWindow } = await import("@tauri-apps/api/window");
        const handle = await getCurrentWindow().onFocusChanged(
          ({ payload: focused }) => {
            clearGrace();
            if (focused || pauseDepthRef.current > 0) return;
            graceTimer = window.setTimeout(() => setIsLocked(true), BLUR_GRACE_MS);
          },
        );
        if (disposed) handle();
        else unlisten = handle;
      } catch {
        // Window focus API unavailable — no blur lock; the idle timer stands.
      }
    })();
    return () => {
      disposed = true;
      clearGrace();
      if (unlisten) unlisten();
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
