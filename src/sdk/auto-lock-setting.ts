// Auto-lock preference: how long the wallet may sit idle before it locks
// itself and requires the password again. Persisted with the same lightweight
// localStorage convention as `wallet.route` / `wallet.denom` in App.tsx. The
// lock mechanism that consumes this value lives in sdk/auto-lock.

export const AUTO_LOCK_OPTIONS = [5, 15, 30, 60] as const;
export const AUTO_LOCK_DEFAULT_MINUTES = 15;

const STORAGE_KEY = "wallet.autoLockMinutes";

/** Clamp an arbitrary number to one of the allowed options, falling back to
 *  the default for anything outside the set (including NaN). */
export function normalizeAutoLockMinutes(value: number): number {
  return (AUTO_LOCK_OPTIONS as readonly number[]).includes(value)
    ? value
    : AUTO_LOCK_DEFAULT_MINUTES;
}

export function readAutoLockMinutes(): number {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw !== null) return normalizeAutoLockMinutes(Number.parseInt(raw, 10));
  } catch {
    // localStorage unavailable — fall through to the default.
  }
  return AUTO_LOCK_DEFAULT_MINUTES;
}

export function writeAutoLockMinutes(minutes: number): void {
  const normalized = normalizeAutoLockMinutes(minutes);
  try {
    localStorage.setItem(STORAGE_KEY, String(normalized));
  } catch {
    // localStorage unavailable — the in-memory provider value still applies.
  }
}
