// Clipboard helper for security-sensitive material (24-word BIP-39
// recovery phrase). Copies to the OS clipboard, then schedules a best-
// effort wipe after a configurable timeout. The wipe is best-effort
// because navigator.clipboard.readText requires user permission and
// may reject; if it fails we still blindly call writeText("") so the
// clipboard is at least cleared even though we can't verify it still
// held our copy.
//
// Only one in-flight clear-timer is tracked. Calling copyWithAutoClear
// again while a previous timer is pending resets the timer (the user
// expects a fresh 30s window after each copy).

let clearTimer: ReturnType<typeof setTimeout> | null = null;
let lastCopiedText: string | null = null;

/**
 * Copy `text` to the clipboard, scheduling a best-effort wipe after
 * `clearAfterMs`. Returns once the initial write completes. The wipe
 * fires asynchronously and is not awaited.
 *
 * Throws if `navigator.clipboard.writeText` rejects — callers should
 * surface a user-visible "copy failed" hint in that case.
 */
export async function copyWithAutoClear(
  text: string,
  clearAfterMs: number = 30_000,
): Promise<void> {
  cancelClipboardAutoClear();
  await navigator.clipboard.writeText(text);
  lastCopiedText = text;
  clearTimer = setTimeout(() => {
    void (async () => {
      try {
        let currentMatchesOurs = true;
        try {
          const current = await navigator.clipboard.readText();
          currentMatchesOurs = current === lastCopiedText;
        } catch {
          // readText denied — assume our text is still there.
        }
        if (currentMatchesOurs) {
          try {
            await navigator.clipboard.writeText("");
          } catch {
            // writeText denied during clear — nothing we can do.
          }
        }
      } finally {
        clearTimer = null;
        lastCopiedText = null;
      }
    })();
  }, clearAfterMs);
}

/** Cancel a pending auto-clear WITHOUT touching the clipboard.
 *
 *  Rarely what you want: it leaves the copied secret sitting on the OS
 *  clipboard with no timer left to remove it. Owners of a secret copy should
 *  call {@link flushClipboardAutoClear} on unmount instead — leaving a surface
 *  should narrow the exposure window, not widen it. Kept for the internal
 *  re-copy path, which immediately re-arms. */
export function cancelClipboardAutoClear(): void {
  if (clearTimer !== null) {
    clearTimeout(clearTimer);
    clearTimer = null;
    lastCopiedText = null;
  }
}

/**
 * Run the pending wipe NOW instead of waiting out the timer — for when the
 * owner of a secret copy unmounts.
 *
 * The wipe is conditional, and deliberately stricter than the timer's:
 *
 *   - the clipboard still holds exactly what we wrote → clear it;
 *   - it holds something else → LEAVE IT ALONE;
 *   - the read failed → LEAVE IT ALONE;
 *   - nothing pending → no-op.
 *
 * The read-failure case is where this differs from the 30-second timer, which
 * blind-clears when it cannot read (its window was promised to the user, so
 * finishing the job wins). A flush is early and unpromised, and the sequence it
 * has to survive is ordinary: copy the phrase, copy something else — a
 * password, an address, a note — then navigate away. Blind-clearing there
 * destroys content the wallet never wrote. Erasing our own secret is ours to
 * do; erasing the user's clipboard is not.
 *
 * Best-effort by nature: this cannot reach OS clipboard HISTORY (Windows
 * Win+V) or a cloud-synced clipboard, which is why the surface says so.
 */
export async function flushClipboardAutoClear(): Promise<void> {
  if (clearTimer === null) return; // nothing pending
  const ours = lastCopiedText;
  clearTimeout(clearTimer);
  clearTimer = null;
  lastCopiedText = null;
  if (ours === null) return;
  try {
    const current = await navigator.clipboard.readText();
    if (current !== ours) return; // the user copied something since — theirs
    await navigator.clipboard.writeText("");
  } catch {
    // Read (or write) denied: we cannot prove the clipboard is still ours, so
    // we do not touch it.
  }
}

/**
 * Clear the clipboard on the user's explicit instruction.
 *
 * Unconditional, unlike the timer and the flush: a click is always a valid
 * write context, so this is the reliable counterpart to two best-effort paths.
 * Cancels any pending timer and drops the tracked copy first, so nothing
 * re-fires afterwards. Resolves true only on a real write — a failure is
 * reported honestly rather than shown as a success.
 */
export async function clearClipboardNow(): Promise<boolean> {
  cancelClipboardAutoClear();
  try {
    await navigator.clipboard.writeText("");
    return true;
  } catch {
    return false;
  }
}

/**
 * The clipboard payload for a recovery phrase: bare, space-separated words.
 *
 * It used to be numbered ("1.plunge 2.thank …"), which reads nicely and cannot
 * be pasted back into anything. The wallet's own import textarea and the reset
 * possession-proof field both validate raw BIP-39 words, so the numbered form
 * failed wordlist and checksum validation everywhere in the app — a backup that
 * could not restore the wallet it came from.
 *
 * On-screen ordinals stay; they are layout, and layout does not belong in a
 * payload. One shared join for every copy surface so payloads cannot drift.
 */
export function formatPhraseForClipboard(words: readonly string[]): string {
  return words.join(" ").trim().split(/\s+/).join(" ");
}
