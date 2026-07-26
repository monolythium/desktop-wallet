// Which hint bar shows — at most ONE at a time.
//
// The precedence order is the load-bearing part, not the current membership:
// recovery-critical > security convenience > discoverability. Never market
// features during a security setup flow. The desktop has no recovery-critical
// or convenience member today (no emergency-key surface, no biometric unlock
// exists), so the registry holds exactly one hint — but any future member slots
// in ABOVE discovery, never below.

export type HintId = "features";

export interface HintInputs {
  /** True when at least one feature flag is off — something to discover. */
  anyFlagOff: boolean;
  /** True when this wallet dismissed the features hint. */
  featuresDismissed: boolean;
}

/** Ordered by class. The first eligible hint wins; at most one renders. */
export function pickHint(inputs: HintInputs): HintId | null {
  // [recovery-critical]  — no member today.
  // [security convenience] — no member today.
  // [discoverability]
  if (!inputs.featuresDismissed && inputs.anyFlagOff) return "features";
  return null;
}

/** Per-WALLET dismissal map, so a new wallet sees the hint once. */
export const FEATURES_HINT_STORAGE_KEY = "wallet.featuresHint.dismissed";

type DismissedMap = Record<string, true>;

function readMap(): DismissedMap {
  try {
    const raw = localStorage.getItem(FEATURES_HINT_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    const out: DismissedMap = {};
    for (const [addr, v] of Object.entries(parsed as Record<string, unknown>)) {
      if (v === true) out[addr] = true;
    }
    return out;
  } catch {
    return {}; // non-breaking default: not dismissed
  }
}

export function isFeaturesHintDismissed(addressLower: string): boolean {
  return readMap()[addressLower] === true;
}

export function dismissFeaturesHint(addressLower: string): void {
  try {
    localStorage.setItem(
      FEATURES_HINT_STORAGE_KEY,
      JSON.stringify({ ...readMap(), [addressLower]: true }),
    );
  } catch {
    // Blocked storage — the in-session dismissal still applies.
  }
}
