// The has-name probe and its nudge state.
//
// BIASED HARD TO SILENCE. The probe answers "has a name OR uncertain" (true)
// versus "definitively has none" (false), and ONLY the definitive-none verdict
// can produce a nudge. Every failure path — locked, offline, untrusted
// operator, RPC error, unsupported method — returns true.
//
// The asymmetry is deliberate: falsely nagging a name owner is worse than
// missing a nudge, and a wallet that nags on an answer it could not get is
// nagging about its own connectivity.

import { getProvider } from "./client";
import { readRegisteredNames } from "./my-names";
import { pickReverseName } from "./reverse-name";

export interface NameNudgeState {
  dismissedForever: boolean;
  snoozedUntilMs: number | null;
}

export const NAME_NUDGE_SNOOZE_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

/** Per-address key — one wallet's dismissal never silences another's. */
export function nameNudgeKey(addressLower: string): string {
  return `wallet.nameNudge.${addressLower}`;
}

/**
 * True = has a name, or we could not tell. False = definitively no name.
 *
 * Order:
 *   1. this device's registration record (synchronous, no network);
 *   2. one `lyth_nameOf` read through the TRUST-GATED provider;
 *   3. any throw → true.
 */
export async function loadHasNameVerdict(address: string): Promise<boolean> {
  const addr = address.trim();
  if (addr === "") return true; // nothing to nudge about
  try {
    if (readRegisteredNames(addr).length > 0) return true;
  } catch {
    return true; // an unreadable local record is uncertainty, not absence
  }
  try {
    const name = pickReverseName(await getProvider().rpcClient.lythNameOf(addr));
    return name !== null;
  } catch {
    // Locked, offline, untrusted operator, unsupported method — all uncertain.
    return true;
  }
}

/**
 * Whether the nudge shows.
 *
 * `probeSaysNoName` must be exactly false (a definitive no-name verdict);
 * anything else never shows. Then: no stored state → show; dismissed forever →
 * never; else show once the snooze expires, BOUNDARY INCLUSIVE.
 */
export function shouldShowNameNudge(
  state: NameNudgeState | null,
  probeSaysNoName: boolean,
  nowMs: number,
): boolean {
  if (probeSaysNoName !== true) return false;
  if (state === null) return true;
  if (state.dismissedForever) return false;
  return nowMs >= (state.snoozedUntilMs ?? 0);
}

function parseState(raw: unknown): NameNudgeState | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const snoozed = r.snoozedUntilMs;
  return {
    dismissedForever: r.dismissedForever === true,
    snoozedUntilMs:
      typeof snoozed === "number" && Number.isFinite(snoozed) ? snoozed : null,
  };
}

export function readNameNudgeState(addressLower: string): NameNudgeState | null {
  try {
    const raw = localStorage.getItem(nameNudgeKey(addressLower));
    if (!raw) return null;
    return parseState(JSON.parse(raw) as unknown);
  } catch {
    return null; // non-breaking default: show
  }
}

function writeState(addressLower: string, state: NameNudgeState): void {
  try {
    localStorage.setItem(nameNudgeKey(addressLower), JSON.stringify(state));
  } catch {
    // Blocked storage — the in-session dismissal still applies.
  }
}

export function snoozeNameNudge(addressLower: string, nowMs: number): void {
  writeState(addressLower, {
    dismissedForever: false,
    snoozedUntilMs: nowMs + NAME_NUDGE_SNOOZE_MS,
  });
}

export function dismissNameNudgeForever(addressLower: string): void {
  writeState(addressLower, { dismissedForever: true, snoozedUntilMs: null });
}

/** Drop this address's nudge state — called from the vault-removal cleanup. */
export function purgeNameNudgeForAddress(addressLower: string): void {
  try {
    localStorage.removeItem(nameNudgeKey(addressLower));
  } catch {
    // Best-effort.
  }
}
