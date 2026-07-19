// Auto-lock preference: how long the wallet may sit idle before it locks
// itself and requires the password again. Persisted with the same lightweight
// localStorage convention as `wallet.route` in App.tsx. The
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

/** Does moving from `current` to `next` need an explicit confirmation?
 *
 *  Only a WEAKENING does. Lengthening the window widens the period in which
 *  anyone with the machine can spend without knowing the password, and that is
 *  a trade the user should make deliberately rather than by tapping a chip.
 *  Shortening it, or re-picking the same value, needs no ceremony — friction on
 *  the safe direction just teaches people to click through.
 *
 *  A null `current` (the setting has not loaded yet) never warns: an existing
 *  higher value is grandfathered, not warned about retroactively. Pure. */
export function autoLockIncreaseNeedsConfirm(
  current: number | null,
  next: number,
): boolean {
  return current !== null && next > current;
}

/** Title of the confirm shown when the window is being lengthened. */
export const AUTO_LOCK_WARNING_TITLE = "Longer auto-lock, weaker security";

/** The three warning paragraphs, in order. `{N}` is the new value. */
export function autoLockWarningParagraphs(minutes: number): string[] {
  return [
    `You're about to keep your wallet unlocked for up to ${minutes} minutes of inactivity.`,
    "During that window, anyone who can reach your device — shared, borrowed, lost, or left unattended — could send funds or sign transactions without your password.",
    "Only use a longer time on a personal device you keep secure. If anyone else might use it, a shorter auto-lock is safer.",
  ];
}

/** Confirm label for the warning modal. */
export function autoLockConfirmLabel(minutes: number): string {
  return `Use ${minutes} minutes`;
}

export function writeAutoLockMinutes(minutes: number): void {
  const normalized = normalizeAutoLockMinutes(minutes);
  try {
    localStorage.setItem(STORAGE_KEY, String(normalized));
  } catch {
    // localStorage unavailable — the in-memory provider value still applies.
  }
}
