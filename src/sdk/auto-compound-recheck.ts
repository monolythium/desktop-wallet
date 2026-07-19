// The bounded re-read after an auto-compound flip.
//
// The displayed flag is ALWAYS the last live read — never an optimistic flip to
// what the user asked for. A wallet that shows "on" because the button was
// pressed is lying about on-chain state, and this is a setting that moves money.
//
// So after a successful submit the row says "Updating…" and the page re-reads
// until the chain agrees. It gives up after a bound and then shows the actual
// read — honestly stale rather than stuck, and still never a lie.
//
// Pure decision logic; the page owns the timer.

/** Gap between re-reads while a flip is outstanding. Short enough to catch the
 *  flip within a block or two, long enough not to hammer an operator. */
export const AC_FLAG_RECHECK_MS = 3_000;

/** How long to keep re-reading before giving up. Past this the row drops
 *  "Updating…" and shows whatever the chain last said — which may still be the
 *  old value. That is honest; a spinner with no end is not. */
export const AC_FLAG_RECHECK_TIMEOUT_MS = 60_000;

/** Label shown while a flip is outstanding. */
export const AC_UPDATING_LABEL = "Updating…";

/** What the toggle row should do next, given the target being awaited, what the
 *  chain currently reports, and how long we have been waiting.
 *
 *  `"settled"` — the chain agrees; stop and show the real value.
 *  `"timeout"` — the bound elapsed; stop and show the real value anyway.
 *  `"waiting"` — keep re-reading.
 *
 *  A null `observed` (the read failed) is NOT treated as disagreement: it keeps
 *  waiting, because a failed read says nothing about the flag. Pure. */
export function autoCompoundRecheckVerdict(input: {
  target: boolean;
  observed: boolean | null;
  elapsedMs: number;
}): "settled" | "timeout" | "waiting" {
  if (input.observed === input.target) return "settled";
  if (input.elapsedMs >= AC_FLAG_RECHECK_TIMEOUT_MS) return "timeout";
  return "waiting";
}

/** True while the row should present as updating. Pure. */
export function autoCompoundUpdating(target: boolean | null): boolean {
  return target !== null;
}
