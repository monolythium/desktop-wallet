// Chain-readiness envelope — one timeout, one typed outcome, one `via` label.
//
// ── THE CONSUMER CONTRACT (binding) ─────────────────────────────────────────
//
//   kind === "live"  → render the section with the real data.
//   ANY other kind   → HIDE THE SECTION ENTIRELY.
//
// Not a placeholder. Not a perpetual skeleton. Not a zero, a dash inside an
// otherwise-complete card, or a "last known" value. The section is absent.
//
// This is why EVERY non-live outcome carries `data: null` and why there is NO
// caller-supplied fallback slot. The pattern this replaces threaded a
// "realistic-shaped" placeholder value through non-live outcomes so a card
// could keep its layout — which is a fabrication mechanism with a friendly
// name. A shape that looks like data IS data to whoever reads the screen.
//
// For the same reason there is no `unwrap()` / `dataOr()` helper. Consumers
// branch on `kind`. A helper that returns `data` regardless of provenance is
// exactly the thing that lets a non-live value reach a render, and the absence
// of that convenience is deliberate.
//
// The `via` label is a developer-mode affordance only — plain surfaces never
// name an RPC method.

/** A chain call's outcome. Only `live` carries data. */
export type ChainOutcome<T> =
  | { kind: "live"; data: T; via: string; durationMs: number }
  | { kind: "offline"; data: null; via: string; reason: string; durationMs: number }
  | { kind: "not-deployed"; data: null; via: string; reason: string; durationMs: number }
  | { kind: "schema-error"; data: null; via: string; reason: string; durationMs: number };

/** The kinds a failure may be reported as. */
export type NotLiveKind = "offline" | "not-deployed" | "schema-error";

export interface ChainEnvelopeOptions {
  /** Budget for the whole call. */
  timeoutMs?: number;
  /** Developer-facing source label (e.g. the RPC method name). */
  label?: string;
  /**
   * How to classify a THROWN error.
   *
   * `not-deployed` when the method is a known chain gap rather than an outage;
   * `schema-error` when a throw from this call means the response shape moved.
   * Deliberately does NOT affect the timeout path — a call that never answered
   * told us nothing about whether it exists or what shape it has, so reporting
   * a timeout as "not deployed" would be a conclusion from silence.
   */
  notLiveAs?: NotLiveKind;
  /** Shape check on a settled response. False → `schema-error`. */
  isValid?: (raw: unknown) => boolean;
}

const TIMEOUT = Symbol("chain-readiness-timeout");

/**
 * Run a chain call inside the envelope. NEVER throws and never rejects — every
 * failure becomes a typed outcome.
 */
export async function withChainEnvelope<T>(
  call: () => Promise<T>,
  opts: ChainEnvelopeOptions = {},
): Promise<ChainOutcome<T>> {
  const { timeoutMs = 8000, label = "chain", notLiveAs = "offline", isValid } = opts;

  const started = Date.now();
  const elapsed = () => Date.now() - started;

  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<typeof TIMEOUT>((resolve) => {
    timer = setTimeout(() => resolve(TIMEOUT), timeoutMs);
  });

  try {
    const raced = await Promise.race([call(), timeout]);

    if (raced === TIMEOUT) {
      // A timeout is an OUTAGE unless the caller explicitly said this method may
      // not exist. See `notLiveAs` above.
      const kind: NotLiveKind = notLiveAs === "not-deployed" ? "not-deployed" : "offline";
      return {
        kind,
        data: null,
        via: label,
        reason: `${label}: timeout after ${timeoutMs}ms`,
        durationMs: elapsed(),
      };
    }

    if (isValid !== undefined && !isValid(raced)) {
      return {
        kind: "schema-error",
        data: null,
        via: label,
        reason: `${label}: response failed shape validation`,
        durationMs: elapsed(),
      };
    }

    return { kind: "live", data: raced as T, via: label, durationMs: elapsed() };
  } catch (cause) {
    const message = (cause as Error)?.message ?? String(cause);
    return {
      kind: notLiveAs,
      data: null,
      via: label,
      reason: `${label}: ${message}`,
      durationMs: elapsed(),
    };
  } finally {
    // Clear the handle when the call settles first, so a fast call is not held
    // open for the remainder of an unused budget.
    if (timer !== undefined) clearTimeout(timer);
  }
}

/** True iff the outcome carries real data. The only accessor provided — see
 *  the header on why there is no unwrap helper. */
export function isLive<T>(out: ChainOutcome<T>): out is Extract<ChainOutcome<T>, { kind: "live" }> {
  return out.kind === "live";
}
