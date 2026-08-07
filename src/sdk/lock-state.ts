// Durable locked marker — so a relaunch cannot clear an active lock.
//
// The lock flag used to live only in React state, which meant it did not
// survive the process. A wallet locked by the idle timer came back UNLOCKED
// after a kill-and-relaunch: the shell rendered, and with it the cached
// balances, activity and contacts, without the passphrase ever being asked for
// (SA-09-004). The module-level flag the OS-toast layer reads had the same
// problem in the other direction — it started `false` at every process start,
// so a toast could fire while the wallet was, from the user's point of view,
// locked (SA-10-001).
//
// The mechanism already existed and simply had not been applied here:
// `unlock-lockout.ts` deliberately persists the brute-force lockout so a
// relaunch cannot sidestep it. This follows that file's storage convention
// (plain localStorage, best-effort writes) for the same reason.
//
// FAIL DIRECTION. The failure that exposes data is the one to refuse, so an
// unreadable marker means LOCKED:
//
//   - key absent            -> unlocked. This is the honest "never locked on
//                              this profile" state. It must not mean locked, or
//                              a first run would open on a password prompt for
//                              a wallet that does not exist yet.
//   - key present, sentinel -> locked.
//   - key present, garbage  -> LOCKED. A marker we cannot interpret may be a
//                              locked marker.
//   - storage throws        -> LOCKED. We cannot tell absent from present, and
//                              guessing "absent" is the guess that exposes.
//
// What this does NOT defend against, stated so it is not mistaken for more than
// it is: an attacker who can DELETE the key can reach the unlocked shell. But
// that attacker already has read access to the same localStorage holding the
// cached balances and activity the lock is protecting, so the marker is no
// weaker than the data behind it. What it does close is the process-kill route,
// where no storage write is needed at all.

const LOCK_KEY = "wallet.locked";

/** The only value this module writes. Any OTHER present value is treated as
 *  locked rather than as unlocked — see the fail direction above. */
const LOCKED_SENTINEL = "1";

/**
 * The persisted lock state, resolved fail-closed.
 *
 * Returns `false` only when storage is readable AND the key is genuinely
 * absent. Every other outcome is `true`.
 */
export function readPersistedLocked(): boolean {
  try {
    // Absence is the ONLY unlocked answer. A present-but-unrecognised value is
    // treated as locked rather than ignored, so a partially-written or
    // tampered marker cannot read as "unlocked".
    return localStorage.getItem(LOCK_KEY) !== null;
  } catch {
    return true;
  }
}

/**
 * Persist (or clear) the locked marker.
 *
 * Best-effort, like the lockout counter: a storage failure while WRITING
 * cannot expose anything on its own, because the read side already fails
 * closed when storage misbehaves.
 */
export function writePersistedLocked(locked: boolean): void {
  try {
    if (locked) localStorage.setItem(LOCK_KEY, LOCKED_SENTINEL);
    else localStorage.removeItem(LOCK_KEY);
  } catch {
    // Storage unavailable — nothing to do. The read path fails closed.
  }
}

/** Test seam: the storage key, so guards pin the real one rather than a copy. */
export const LOCK_STATE_KEY = LOCK_KEY;
