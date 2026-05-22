// Two-tier security policy — Phase 7 (whitepaper §28.5 Q29–31).
//
// V1 ships the data model + localStorage persistence; the actual
// evaluation hook + passkey challenge integration are blocked on the
// passkey Rust backend (Phase 8 carry-over). The slider UI in
// Settings → Security can still configure the threshold + the
// "require passkey" intent toggle; the toggle is disabled while no
// passkey is enrolled.
//
// Storage:
//   localStorage["mono.policy.v1"] = JSON.stringify(PolicyConfig)
// One config per browser profile (effectively per-machine). Phase 8
// will migrate this to the vault container so each vault carries its
// own policy.
//
// Whitepaper §28.5 Q29-31 default: high-value challenge ≈ $500 USD
// equivalent. The oracle isn't wired yet (#D13 chain-gap), so V1 uses
// a static LYTH floor (100 LYTH) until the oracle lands; the policy
// type carries both fields so the UI can display the USD estimate
// alongside the LYTH threshold when the oracle is healthy.

export interface PolicyConfig {
  /** Trigger threshold in LYTH (display-precision number). Operations
   *  ≥ this amount route through the high-value branch when the
   *  policy is active. */
  triggerThresholdLyth: number;
  /** Optional USD-equivalent estimate (oracle-driven; null until the
   *  oracle is wired). Display-only — the LYTH threshold is the
   *  source of truth for evaluation. */
  usdEquivalent: number | null;
  /** When true AND a passkey is enrolled, transactions above the
   *  threshold prompt the user for a passkey challenge before
   *  signing. When false, single-factor for every transaction
   *  regardless of value. */
  passkeyRequired: boolean;
  /** Tracks whether the user has at least one passkey on file. The
   *  policy slider's "require passkey" toggle reads this to grey
   *  itself out when no passkey is enrolled — preventing the user
   *  from configuring a policy they can't satisfy. */
  enrolledForHighValue: boolean;
}

const STORAGE_KEY = "mono.policy.v1";

/** Default policy when no override exists in localStorage. 100 LYTH
 *  floor matches the whitepaper's $500-equivalent estimate at typical
 *  testnet prices; the slider lets the user pick anywhere in
 *  [1, 10000] LYTH. */
export const DEFAULT_POLICY: PolicyConfig = {
  triggerThresholdLyth: 100,
  usdEquivalent: null,
  passkeyRequired: false,
  enrolledForHighValue: false,
};

/** Lower bound for the slider. Anything below 1 LYTH would gate
 *  every operation and defeat the two-tier UX. */
export const POLICY_THRESHOLD_MIN_LYTH = 1;

/** Upper bound for the slider. Above this the user is effectively
 *  saying "never require a passkey." */
export const POLICY_THRESHOLD_MAX_LYTH = 10_000;

/** Read the current policy from localStorage. Returns
 *  `DEFAULT_POLICY` on any parse failure or missing key. Never
 *  throws — caller can rely on a usable config. */
export function getPolicy(): PolicyConfig {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULT_POLICY };
    const parsed = JSON.parse(raw) as Partial<PolicyConfig>;
    return mergeWithDefaults(parsed);
  } catch {
    return { ...DEFAULT_POLICY };
  }
}

/** Persist a policy update. Partial input is merged into the current
 *  config so callers can flip one field at a time. */
export function setPolicy(update: Partial<PolicyConfig>): PolicyConfig {
  const current = getPolicy();
  const next = mergeWithDefaults({ ...current, ...update });
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    // localStorage may be unavailable (private mode, sandboxed iframe);
    // silently fall back — the in-memory copy is still returned.
  }
  return next;
}

/** Clear the saved policy and revert to defaults. */
export function resetPolicy(): PolicyConfig {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // ignore
  }
  return { ...DEFAULT_POLICY };
}

/** Predicate: is `value` (in LYTH) at or above the policy's trigger
 *  threshold? V1 evaluator — Phase 8 wires this into the
 *  OperationsDrawer between auth and execute. */
export function isAboveThreshold(
  policy: PolicyConfig,
  valueLyth: number,
): boolean {
  return valueLyth >= policy.triggerThresholdLyth;
}

/** Computed posture string for the unlock-mode badge. */
export function describePolicyPosture(args: {
  policy: PolicyConfig;
  multisigActive: boolean;
  multisigThreshold?: number;
  multisigSignerCount?: number;
}): { label: string; tone: "weak" | "ok" | "strong" } {
  if (args.multisigActive) {
    const m = args.multisigThreshold ?? 0;
    const n = args.multisigSignerCount ?? 0;
    return { label: `Multisig ${m}-of-${n}`, tone: "strong" };
  }
  if (args.policy.enrolledForHighValue && args.policy.passkeyRequired) {
    return { label: "Two-factor active", tone: "strong" };
  }
  if (args.policy.enrolledForHighValue) {
    return { label: "Two-factor available", tone: "ok" };
  }
  return { label: "Single-factor", tone: "weak" };
}

function mergeWithDefaults(p: Partial<PolicyConfig>): PolicyConfig {
  const threshold = clampThreshold(
    typeof p.triggerThresholdLyth === "number"
      ? p.triggerThresholdLyth
      : DEFAULT_POLICY.triggerThresholdLyth,
  );
  return {
    triggerThresholdLyth: threshold,
    usdEquivalent:
      typeof p.usdEquivalent === "number" ? p.usdEquivalent : null,
    passkeyRequired:
      typeof p.passkeyRequired === "boolean"
        ? p.passkeyRequired
        : DEFAULT_POLICY.passkeyRequired,
    enrolledForHighValue:
      typeof p.enrolledForHighValue === "boolean"
        ? p.enrolledForHighValue
        : DEFAULT_POLICY.enrolledForHighValue,
  };
}

function clampThreshold(n: number): number {
  if (!Number.isFinite(n)) return DEFAULT_POLICY.triggerThresholdLyth;
  return Math.max(
    POLICY_THRESHOLD_MIN_LYTH,
    Math.min(POLICY_THRESHOLD_MAX_LYTH, Math.round(n)),
  );
}
