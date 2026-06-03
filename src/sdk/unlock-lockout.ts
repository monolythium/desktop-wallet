// Progressive brute-force lockout for the unlock gate.
//
// After repeated wrong passwords the password input is disabled for an
// escalating window (5 wrong → 30 s, 10 → 5 min, 20 → 30 min). The count
// resets only on a successful unlock — not when a window elapses — so an
// attacker can't sidestep escalation by waiting each window out.
//
// This is UX deterrence layered ON TOP OF the real protection: the Argon2id
// KDF already makes every password guess deliberately expensive. A local
// attacker with disk access faces Argon2id regardless of this counter, so the
// persisted state is best-effort (lightweight localStorage, the same
// convention as `auto-lock-setting.ts`) and is re-checked against the wall
// clock on mount — a relaunch can't clear an in-progress lockout, and a
// cleared localStorage only drops the deterrence layer, never the KDF.

const FAIL_COUNT_KEY = "wallet.unlockFailCount";
const LOCKOUT_UNTIL_KEY = "wallet.unlockLockoutUntil";

/** Escalating lockout curve. Scanned high→low; the first threshold the
 *  consecutive-fail count meets wins (so 5–9 → 30 s, 10–19 → 5 min,
 *  20+ → 30 min). */
export const LOCKOUT_THRESHOLDS = [
  { fails: 20, ms: 30 * 60_000 },
  { fails: 10, ms: 5 * 60_000 },
  { fails: 5, ms: 30_000 },
] as const;

/** Pure — the lockout window (ms) for a consecutive-fail count. 0 below the
 *  first threshold. */
export function lockoutMsForAttempts(fails: number): number {
  for (const t of LOCKOUT_THRESHOLDS) {
    if (fails >= t.fails) return t.ms;
  }
  return 0;
}

/** Pure — remaining lockout (ms) for a lockout-until timestamp at `now`. */
export function lockoutRemainingMs(lockoutUntil: number, now: number): number {
  return lockoutUntil > now ? lockoutUntil - now : 0;
}

export interface LockoutState {
  /** Consecutive wrong-password count. Persists across windows; cleared only
   *  on a successful unlock. */
  failCount: number;
  /** Epoch ms the input stays disabled until. 0 = not locked. */
  lockoutUntil: number;
}

const CLEAR: LockoutState = { failCount: 0, lockoutUntil: 0 };

/** Read the persisted lockout state. Malformed / unavailable → cleared. */
export function readLockoutState(): LockoutState {
  try {
    const fc = Number.parseInt(localStorage.getItem(FAIL_COUNT_KEY) ?? "", 10);
    const lu = Number.parseInt(localStorage.getItem(LOCKOUT_UNTIL_KEY) ?? "", 10);
    return {
      failCount: Number.isFinite(fc) && fc > 0 ? fc : 0,
      lockoutUntil: Number.isFinite(lu) && lu > 0 ? lu : 0,
    };
  } catch {
    return { ...CLEAR };
  }
}

function writeLockoutState(state: LockoutState): void {
  try {
    localStorage.setItem(FAIL_COUNT_KEY, String(state.failCount));
    localStorage.setItem(LOCKOUT_UNTIL_KEY, String(state.lockoutUntil));
  } catch {
    // localStorage unavailable — deterrence is best-effort; the KDF still applies.
  }
}

/** Record one wrong attempt: bump the consecutive count, impose the escalated
 *  window if a threshold is met (else keep any existing window), persist, and
 *  return the new state. */
export function recordWrongUnlockAttempt(now: number = Date.now()): LockoutState {
  const prev = readLockoutState();
  const failCount = prev.failCount + 1;
  const ms = lockoutMsForAttempts(failCount);
  const lockoutUntil = ms > 0 ? now + ms : prev.lockoutUntil;
  const next: LockoutState = { failCount, lockoutUntil };
  writeLockoutState(next);
  return next;
}

/** Clear all lockout state — called on a successful unlock. */
export function clearUnlockLockout(): void {
  writeLockoutState({ ...CLEAR });
}
