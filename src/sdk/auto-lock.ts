// Auto-lock settings + idle-timer plumbing.
//
// State surface:
//   - persisted preference in localStorage: interval in minutes
//     (or 0 = "Never")
//   - in-memory idle timer: resets on any user-interaction event
//     (keydown / mousemove / mousedown / wheel / touchstart)
//   - on timer expiry: fires the `onLock` callback (the App wires
//     this to `lockVault()` from useVaults + a UI lock-screen route)
//
// Storage key matches the Phase 3/4 localStorage convention
// (`mono.<scope>.v1`).

const STORAGE_KEY = "mono.autolock.v1";

/** Available auto-lock intervals (minutes). 0 = "Never". */
export const AUTO_LOCK_INTERVALS = [0, 1, 5, 15, 30, 60] as const;

/** Default — 15 minutes — matches the brief and the browser-wallet
 *  default. Long enough to feel forgiving on a desktop, short enough
 *  to limit damage if the machine is left unattended. */
export const DEFAULT_AUTO_LOCK_MINUTES = 15;

interface PersistedSettings {
  intervalMinutes: number;
}

function safeRead(): PersistedSettings | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as PersistedSettings;
    if (typeof parsed.intervalMinutes !== "number") return null;
    if (!Number.isFinite(parsed.intervalMinutes)) return null;
    return parsed;
  } catch {
    return null;
  }
}

function safeWrite(s: PersistedSettings): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(s));
  } catch {
    // ignore
  }
}

/** Read the persisted interval, or fall back to the default. */
export function getAutoLockMinutes(): number {
  const stored = safeRead();
  if (stored === null) return DEFAULT_AUTO_LOCK_MINUTES;
  return clampInterval(stored.intervalMinutes);
}

/** Persist the interval. Validates against the allowed list. */
export function setAutoLockMinutes(minutes: number): void {
  safeWrite({ intervalMinutes: clampInterval(minutes) });
}

function clampInterval(n: number): number {
  return AUTO_LOCK_INTERVALS.includes(n as (typeof AUTO_LOCK_INTERVALS)[number])
    ? n
    : DEFAULT_AUTO_LOCK_MINUTES;
}

/** Test-only — clear the persisted setting. */
export function _resetAutoLockForTest(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // ignore
  }
}

// ─── Idle-timer plumbing ───────────────────────────────────────────

const IDLE_EVENTS: Array<keyof WindowEventMap> = [
  "keydown",
  "mousemove",
  "mousedown",
  "wheel",
  "touchstart",
  "scroll",
];

interface IdleTimerHandle {
  /** Stop the timer + remove the idle listeners. */
  dispose: () => void;
  /** Manually reset the timer (e.g. after a successful unlock). */
  reset: () => void;
}

/**
 * Install an idle timer that fires `onIdle` after `minutes` of
 * inactivity. Returns a handle the caller can dispose when the
 * component unmounts or when the user changes the interval.
 *
 * `minutes === 0` means "Never" — the handle is a no-op.
 */
export function installIdleTimer(
  minutes: number,
  onIdle: () => void,
  /** Custom window override for tests (defaults to global `window`). */
  windowImpl: Window & typeof globalThis = window,
): IdleTimerHandle {
  if (minutes <= 0) {
    return {
      dispose: () => undefined,
      reset: () => undefined,
    };
  }
  const intervalMs = minutes * 60 * 1000;
  let timerId: ReturnType<typeof setTimeout> | null = null;
  let disposed = false;

  const fire = () => {
    timerId = null;
    if (disposed) return;
    onIdle();
  };

  const reset = () => {
    if (disposed) return;
    if (timerId !== null) {
      clearTimeout(timerId);
    }
    timerId = setTimeout(fire, intervalMs);
  };

  // Initial arm + listener wiring.
  reset();
  const handler = () => reset();
  for (const evt of IDLE_EVENTS) {
    windowImpl.addEventListener(evt, handler, { passive: true });
  }

  const dispose = () => {
    if (disposed) return;
    disposed = true;
    if (timerId !== null) {
      clearTimeout(timerId);
      timerId = null;
    }
    for (const evt of IDLE_EVENTS) {
      windowImpl.removeEventListener(evt, handler);
    }
  };

  return { dispose, reset };
}
