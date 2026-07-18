// Setup-health: which wallet features are configured, and whether to nag.
//
// Two rules keep this from becoming the pushy pattern it easily could be:
//
//   • HEALTH TRACKS REALITY, NOT PREFERENCES. A step's `complete` comes from a
//     real read only; the dismissal state below never feeds a step. So the chip
//     cannot congratulate a user for hiding it.
//   • A STEP IS COUNTED ONLY WHEN APPLICABLE. An inapplicable step leaves both
//     the numerator and the denominator, rather than rendering as
//     forever-incomplete — nagging toward a surface the user cannot reach is a
//     dead affordance.
//
// The registry deliberately ships ONE step, because exactly one has an honest
// completion read today. It is the extension point, not a scoreboard to fill.

export interface SetupNagState {
  dismissedForever: boolean;
  snoozedUntilMs: number | null;
}

export interface SetupStep {
  id: string;
  label: string;
  applicable: boolean;
  complete: boolean;
}

export const SETUP_NAG_SNOOZE_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

/** Per-WALLET dismissal map — one wallet's "don't ask again" must never silence
 *  another's, and a freshly added wallet sees the chip again. */
export const SETUP_NAG_STORAGE_KEY = "wallet.setupHealth.nagState";

/**
 * Whether the setup chip should show.
 *
 * Order is binding:
 *   1. everything complete → false, regardless of any stored state (completion
 *      always wins; a fully-configured wallet never carries a permanent chip);
 *   2. never dismissed → true;
 *   3. dismissed forever → false, and never auto-cleared even if setup later
 *      regresses — the user said no;
 *   4. otherwise show once the snooze has expired, BOUNDARY INCLUSIVE.
 */
export function shouldShowSetupNag(
  state: SetupNagState | null,
  allComplete: boolean,
  nowMs: number,
): boolean {
  if (allComplete) return false;
  if (state === null) return true;
  if (state.dismissedForever) return false;
  return nowMs >= (state.snoozedUntilMs ?? 0);
}

/** Only applicable steps count. A zero denominator means nothing applies, which
 *  is "fully set up" — 100, so the chip hides. */
export function setupCompletion(steps: SetupStep[]): {
  completed: number;
  total: number;
  percent: number;
  remaining: string[];
} {
  const applicable = steps.filter((s) => s.applicable);
  const completed = applicable.filter((s) => s.complete).length;
  const total = applicable.length;
  return {
    completed,
    total,
    percent: total === 0 ? 100 : Math.round((completed / total) * 100),
    remaining: applicable.filter((s) => !s.complete).map((s) => s.label),
  };
}

export interface SetupStepInputs {
  /** The wallet's only name-registration surface lives behind this flag. */
  steleEnabled: boolean;
  /** Locally recorded registrations for this address (synchronous, no network). */
  registeredNames: string[];
  /** Reverse-name read: a resolved name, or null for none/unresolved/failed. */
  reverseName: string | null;
  /** True when the reverse read has not produced a definitive answer. */
  reverseUnresolved: boolean;
}

/**
 * The shipped step registry.
 *
 * `.mono name` completion is BIASED TO TRUE: a locally recorded registration or
 * a resolved reverse name completes it, and so does an unreadable state. Never
 * nag a name owner, and never nag on a read the wallet could not make.
 */
export function deriveSetupSteps(inputs: SetupStepInputs): SetupStep[] {
  const hasLocalName = inputs.registeredNames.length > 0;
  const hasReverseName = inputs.reverseName !== null && inputs.reverseName.trim() !== "";
  return [
    {
      id: "mono-name",
      label: ".mono name",
      applicable: inputs.steleEnabled,
      complete: hasLocalName || hasReverseName || inputs.reverseUnresolved,
    },
  ];
}

// ── Storage (tolerant; a corrupt map defaults to "show") ────────────────────

type NagMap = Record<string, SetupNagState>;

function parseState(raw: unknown): SetupNagState | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const dismissedForever = r.dismissedForever === true;
  const snoozed = r.snoozedUntilMs;
  const snoozedUntilMs =
    typeof snoozed === "number" && Number.isFinite(snoozed) ? snoozed : null;
  return { dismissedForever, snoozedUntilMs };
}

function readMap(): NagMap {
  try {
    const raw = localStorage.getItem(SETUP_NAG_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    const out: NagMap = {};
    for (const [addr, v] of Object.entries(parsed as Record<string, unknown>)) {
      const state = parseState(v);
      if (state !== null) out[addr] = state; // malformed entries are dropped
    }
    return out;
  } catch {
    return {}; // non-breaking default: show
  }
}

export function readSetupNagState(addressLower: string): SetupNagState | null {
  return readMap()[addressLower] ?? null;
}

function writeState(addressLower: string, state: SetupNagState): void {
  try {
    localStorage.setItem(
      SETUP_NAG_STORAGE_KEY,
      JSON.stringify({ ...readMap(), [addressLower]: state }),
    );
  } catch {
    // Blocked storage — the in-session dismissal still applies.
  }
}

/** Snooze for this wallet only. Repeatable. */
export function snoozeSetupNag(addressLower: string, nowMs: number): void {
  writeState(addressLower, {
    dismissedForever: false,
    snoozedUntilMs: nowMs + SETUP_NAG_SNOOZE_MS,
  });
}

/** Permanent for this wallet only. Never auto-cleared. */
export function dismissSetupNagForever(addressLower: string): void {
  writeState(addressLower, { dismissedForever: true, snoozedUntilMs: null });
}
