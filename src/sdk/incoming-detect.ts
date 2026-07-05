// Incoming-transfer detection.
//
// The wallet records + toasts a notification when native LYTH arrives. The
// indexer already surfaces inbound rows in the activity feed; this driver turns
// the *newly-seen* ones into notifications exactly once, using a per-(address,
// chain) watermark. On first run a small receive set (a fresh / migrated wallet)
// is notified, while a large imported history is baselined silently so it never
// toasts its whole history.
//
// Open-surface / unlocked only: it runs after the Activity page loads its
// indexed rows (a focused window IS the open, unlocked surface), so there is no
// background/closed-surface polling and the Hybrid address-privacy posture is
// preserved.
//
// Honest absence: only inbound NATIVE LYTH rows (no MRC-20 token id) become
// receive notifications; the synthetic id `in:<block>.<txIndex>.<logIndex>` is
// never linked out (it is not a real tx hash). The decision logic
// (`incomingCandidatesFromRows` + `planIncomingNotifications`) is pure and unit-
// tested; this module only wires it to the store, the toggle, and the toast.

import type { LiveAddressActivityRow } from "./live";
import { readIncomingEnabled } from "./feature-flags";
import {
  anchorAfter,
  type IncomingWatermark,
} from "./notifications";
import {
  getIncomingWatermark,
  recordNotification,
  setIncomingWatermark,
} from "./notifications-store";
import { toastTerminalNotification } from "./os-toast";

/** One inbound native-LYTH row reduced to what a receive notification needs. */
export interface IncomingCandidate {
  anchor: IncomingWatermark;
  /** Already-formatted decimal amount, or "0" when the row carried none. */
  amountDecimal: string;
  /** Typed bech32m sender, or "" when the row carried none. */
  counterparty: string;
}

/** Reduce indexed activity rows to inbound NATIVE-LYTH candidates. Outgoing
 *  rows and MRC-20 token transfers (non-null tokenId) are ignored. Pure. */
export function incomingCandidatesFromRows(
  rows: ReadonlyArray<LiveAddressActivityRow>,
): IncomingCandidate[] {
  const out: IncomingCandidate[] = [];
  for (const r of rows) {
    if (r.direction !== "in" || r.tokenId !== null) continue;
    out.push({
      anchor: {
        blockHeight: Number(r.blockHeight),
        txIndex: r.txIndex,
        logIndex: r.logIndex,
      },
      amountDecimal: r.amount ?? "0",
      counterparty: r.counterparty ?? "",
    });
  }
  return out;
}

/** The plan for one detection pass. Pure — the caller applies it. */
export interface IncomingPlan {
  /** Non-null on first run with a LARGE receive history: the baseline watermark
   *  to persist WITHOUT recording (never toast a pre-existing history). A small
   *  first-run set records + notifies instead — see {@link
   *  planIncomingNotifications}. */
  baseline: IncomingWatermark | null;
  /** Candidates strictly newer than the watermark, oldest-first so the history
   *  append leaves the newest at the top. */
  toRecord: IncomingCandidate[];
  /** Watermark to persist after recording (the max anchor seen), or null to
   *  leave the stored watermark unchanged. */
  newWatermark: IncomingWatermark | null;
}

/** First run for an (address, chain) scope with THIS many inbound receives (or
 *  fewer) in view notifies them all instead of silently baselining: a fresh /
 *  newly migrated wallet's receives are genuine recent arrivals the user wants
 *  recorded (the "in-app record is always kept" promise), not history to hide. A
 *  LARGER set is an established / imported wallet — baseline it silently so a
 *  whole receive history is never dumped into notifications on first use.
 *  Tunable. */
const INCOMING_FIRST_RUN_NOTIFY_CAP = 10;

/** Decide what to record + the watermark to advance to. Pure. On first run
 *  (watermark === null) a small receive set is recorded + notified (see
 *  {@link INCOMING_FIRST_RUN_NOTIFY_CAP}); a larger one only establishes a
 *  baseline (the newest anchor) and records nothing, so a wallet with real
 *  history never toasts it. */
export function planIncomingNotifications(
  watermark: IncomingWatermark | null,
  candidates: ReadonlyArray<IncomingCandidate>,
): IncomingPlan {
  if (candidates.length === 0) {
    return { baseline: null, toRecord: [], newWatermark: null };
  }
  let max = candidates[0]!.anchor;
  for (const c of candidates) if (anchorAfter(c.anchor, max)) max = c.anchor;

  if (watermark === null) {
    // A LARGE first-run receive history is an established / imported wallet —
    // baseline it silently so the whole history never dumps into notifications.
    if (candidates.length > INCOMING_FIRST_RUN_NOTIFY_CAP) {
      return { baseline: max, toRecord: [], newWatermark: null };
    }
    // A SMALL set on a fresh / migrated scope is genuine recent arrivals —
    // record + notify each (oldest-first so the newest lands on top) and advance
    // the watermark to the newest as usual.
    const fresh = [...candidates].sort((a, b) =>
      anchorAfter(a.anchor, b.anchor) ? 1 : -1,
    );
    return { baseline: null, toRecord: fresh, newWatermark: max };
  }

  const fresh = candidates.filter((c) => anchorAfter(c.anchor, watermark));
  fresh.sort((a, b) => (anchorAfter(a.anchor, b.anchor) ? 1 : -1)); // oldest first
  return {
    baseline: null,
    toRecord: fresh,
    newWatermark: anchorAfter(max, watermark) ? max : null,
  };
}

/** Detect newly-arrived incoming native LYTH and record/toast each exactly
 *  once. On first run a small receive set is recorded + notified while a large
 *  imported history is baselined silently; advances the watermark after. The
 *  in-app record is always written; the OS toast is gated by the incoming
 *  toggle. Best-effort — never throws back into the caller. */
export async function detectAndNotifyIncoming(
  addressLower: string,
  chainIdHex: string,
  confirmedRows: ReadonlyArray<LiveAddressActivityRow>,
): Promise<{ recorded: number }> {
  try {
    const candidates = incomingCandidatesFromRows(confirmedRows);
    if (candidates.length === 0) return { recorded: 0 };

    const watermark = await getIncomingWatermark(addressLower, chainIdHex);
    const plan = planIncomingNotifications(watermark, candidates);

    if (plan.baseline !== null) {
      await setIncomingWatermark(addressLower, chainIdHex, plan.baseline);
      return { recorded: 0 };
    }

    const enabled = readIncomingEnabled();
    let recorded = 0;
    for (const c of plan.toRecord) {
      const { blockHeight, txIndex, logIndex } = c.anchor;
      const { added, record } = await recordNotification({
        addressLower,
        chainIdHex,
        txHash: `in:${blockHeight}.${txIndex}.${logIndex}`,
        status: "confirmed",
        blockNumber: blockHeight,
        kind: "receive",
        amountDecimal: c.amountDecimal,
        counterparty: c.counterparty,
      });
      if (added) {
        recorded++;
        // The record always lands (and counts toward the bell badge); the OS
        // toast is suppressed when the user disabled incoming toasts.
        if (enabled && record) void toastTerminalNotification(record);
      }
    }
    if (plan.newWatermark !== null) {
      await setIncomingWatermark(addressLower, chainIdHex, plan.newWatermark);
    }
    return { recorded };
  } catch {
    return { recorded: 0 };
  }
}
