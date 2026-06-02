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

interface AutoLockApi {
  isLocked: boolean;
  lock: () => void;
  unlock: () => void;
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

  const clearTimer = useCallback(() => {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const arm = useCallback(() => {
    clearTimer();
    const ms = readAutoLockMinutes() * 60_000;
    deadlineRef.current = Date.now() + ms;
    timerRef.current = window.setTimeout(() => setIsLocked(true), ms);
  }, [clearTimer]);

  const lock = useCallback(() => {
    clearTimer();
    setIsLocked(true);
  }, [clearTimer]);

  const unlock = useCallback(() => {
    setIsLocked(false);
    arm();
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
    <AutoLockContext.Provider value={{ isLocked, lock, unlock }}>
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
