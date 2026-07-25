// Incoming-transfer detection.
//
// The wallet records + toasts a notification when native LYTH arrives. The
// indexer already surfaces inbound rows in the activity feed; this driver turns
// the *newly-seen* ones into notifications exactly once, using a per-(address,
// chain) watermark. On first run a small receive set (a fresh / migrated wallet)
// is notified, while a large imported history is baselined silently so it never
// toasts its whole history.
//
// Unlocked + visible only. Two callers drive it: the Activity page's refresh,
// and the app-level `IncomingPoller` (every 2 minutes, from any route). Both
// require an unlocked wallet and a visible window, so there is still no
// background or closed-surface polling and the address-privacy posture is
// unchanged — the reads happen only while the user is present at the app.
//
// The two paths need no coordination: they share the per-scope watermark and the
// `${chainIdHex}:${txHash}` record dedupe, so an overlap records nothing twice.
//
// Honest absence: only inbound NATIVE LYTH rows (no MRC-20 token id) become
// receive notifications; the synthetic id
// `in:<block>.<txIndex>.<logIndex>:<cp>:<amount>:<seq>` is never linked out (it
// is not a real tx hash). The counterparty/amount/seq fold disambiguates two
// same-block native receives, which share the txIndex 0 + u32::MAX logIndex
// sentinel and would otherwise collide onto one row. The decision logic
// (`incomingCandidatesFromRows` + `planIncomingNotifications`) is pure and unit-
// tested; this module only wires it to the store, the toggle, and the toast.

import type { LiveAddressActivityRow } from "./live";
import { readIncomingEnabled } from "./feature-flags";
import { formatLythDisplay, isNativeLythTokenId } from "./lyth-display";
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

/**
 * True ONLY when the row's counterparty can be positively established as this
 * wallet's own address. Both sides are typed bech32m, which is case-insensitive
 * by construction, so lowercasing can never make two DIFFERENT addresses equal —
 * normalising here cannot silence a real arrival.
 *
 * FAIL DIRECTION — this must fail toward NOTIFYING, and that is encoded here
 * rather than left to the caller's control flow. Every uncertainty (no own
 * address, a blank or non-string value on either side, a normalisation that
 * throws) returns FALSE, meaning "not self", meaning the arrival is announced.
 * A spurious notification is an annoyance; a silenced real one is invisible —
 * there is no chain signal for it and nothing downstream surfaces it, so the
 * user simply never learns money arrived.
 */
function isOwnCounterparty(counterparty: unknown, ownBech32m: unknown): boolean {
  try {
    if (typeof counterparty !== "string" || typeof ownBech32m !== "string") return false;
    const cp = counterparty.trim().toLowerCase();
    const own = ownBech32m.trim().toLowerCase();
    if (cp === "" || own === "") return false;
    return cp === own;
  } catch {
    return false; // any doubt announces
  }
}

/** Reduce indexed activity rows to inbound NATIVE-LYTH candidates. Outgoing rows
 *  and MRC-20 token transfers are ignored — native is the null OR zero-address
 *  token id (the indexer's native sentinel), so the check is by
 *  `isNativeLythTokenId`, not `tokenId === null`. The raw-lythoshi amount is
 *  converted to display LYTH for the notification. Pure.
 *
 *  `ownBech32m` suppresses a SELF-TRANSFER's inbound leg. The chain serves such a
 *  transfer as two rows (its activity view selects the inbound arm on `to_addr`
 *  and the outbound arm on `from_addr`), and the inbound one would otherwise be
 *  announced as money arriving from the user's own address. Omitting the
 *  argument suppresses nothing — see {@link isOwnCounterparty} for the fail
 *  direction, which is deliberate and must not be inverted.
 *
 *  Scoped to the address this detection run is FOR, not to every address the
 *  vault holds: a transfer between two accounts the user owns is a genuine
 *  arrival at the receiving one, and suppressing it would be the forbidden
 *  direction. */
export function incomingCandidatesFromRows(
  rows: ReadonlyArray<LiveAddressActivityRow>,
  ownBech32m?: string | null,
): IncomingCandidate[] {
  const out: IncomingCandidate[] = [];
  for (const r of rows) {
    if (r.direction !== "in" || !isNativeLythTokenId(r.tokenId)) continue;
    // The inbound half of a self-transfer is not an arrival.
    if (isOwnCounterparty(r.counterparty, ownBech32m)) continue;
    out.push({
      anchor: {
        blockHeight: Number(r.blockHeight),
        txIndex: r.txIndex,
        logIndex: r.logIndex,
      },
      amountDecimal: formatLythDisplay(r.amount, 4) ?? "0",
      counterparty: r.counterparty ?? "",
    });
  }
  return out;
}

/** A candidate plus its folded synthetic id. */
export interface RecordableIncoming extends IncomingCandidate {
  /** `in:<block>.<txIndex>.<logIndex>:<cp>:<amount>:<seq>` — the dedupe key. */
  id: string;
}

/** The folded synthetic id for an incoming native receive. Keeps the `in:`
 *  prefix (never `0x`) so it stays non-linkable, and folds counterparty + amount
 *  + an oldest-first seq so two same-block receives don't collide. */
export function incomingTransferId(
  anchor: IncomingWatermark,
  counterparty: string,
  amountDecimal: string,
  seq: number,
): string {
  return `in:${anchor.blockHeight}.${anchor.txIndex}.${anchor.logIndex}:${counterparty}:${amountDecimal}:${seq}`;
}

/** Attach a folded id to each candidate. `seq` is assigned oldest-first within
 *  each `(block, counterparty, amount)` group so a receive's id is stable across
 *  polls (a same-block block's rows are fixed once indexed). Pure. */
function assignIncomingIds(
  candidates: ReadonlyArray<IncomingCandidate>,
): RecordableIncoming[] {
  // Stable oldest-first order; equal anchors keep their input order.
  const ordered = [...candidates].sort((a, b) => {
    if (a.anchor.blockHeight !== b.anchor.blockHeight) {
      return a.anchor.blockHeight - b.anchor.blockHeight;
    }
    if (a.anchor.txIndex !== b.anchor.txIndex) return a.anchor.txIndex - b.anchor.txIndex;
    return a.anchor.logIndex - b.anchor.logIndex;
  });
  const seqByKey = new Map<string, number>();
  return ordered.map((c) => {
    const key = `${c.anchor.blockHeight}:${c.counterparty}:${c.amountDecimal}`;
    const seq = seqByKey.get(key) ?? 0;
    seqByKey.set(key, seq + 1);
    return { ...c, id: incomingTransferId(c.anchor, c.counterparty, c.amountDecimal, seq) };
  });
}

/** The plan for one detection pass. Pure — the caller applies it. */
export interface IncomingPlan {
  /** Non-null on first run with a LARGE receive history: the baseline watermark
   *  to persist WITHOUT recording (never toast a pre-existing history). Carries
   *  the top block's accounted ids so a later same-block arrival is still
   *  detected. A small first-run set records + notifies instead — see {@link
   *  planIncomingNotifications}. */
  baseline: IncomingWatermark | null;
  /** Records to write, oldest-first so the history append leaves the newest at
   *  the top. */
  toRecord: RecordableIncoming[];
  /** Watermark to persist after recording (the max anchor + its block's
   *  accounted ids), or null to leave the stored watermark unchanged. */
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

/** Decide what to record + the watermark to advance to. Pure.
 *
 *  First run (watermark === null): a SMALL receive set (≤ {@link
 *  INCOMING_FIRST_RUN_NOTIFY_CAP}) is recorded + notified — a fresh / migrated
 *  wallet's genuine recent arrivals; a LARGER one only establishes a baseline
 *  (the newest anchor + its block's accounted ids) and records nothing, so a
 *  wallet with real history never toasts it.
 *
 *  Newness gate (subsequent runs): a candidate is recorded when it is strictly
 *  after the watermark OR it sits in the watermark's block but its folded id
 *  isn't yet accounted (`blockIds`). A legacy watermark (no `blockIds`) treats
 *  its boundary block as history (admits nothing there) — so an upgrade never
 *  re-toasts. The new watermark's `blockIds` are the top block's ids (merged
 *  with the prior set when the top block is unchanged, reset when it advances). */
export function planIncomingNotifications(
  watermark: IncomingWatermark | null,
  candidates: ReadonlyArray<IncomingCandidate>,
): IncomingPlan {
  if (candidates.length === 0) {
    return { baseline: null, toRecord: [], newWatermark: null };
  }
  const withIds = assignIncomingIds(candidates);
  let max = withIds[0]!.anchor;
  for (const c of withIds) if (anchorAfter(c.anchor, max)) max = c.anchor;
  const topBlockIds = withIds
    .filter((c) => c.anchor.blockHeight === max.blockHeight)
    .map((c) => c.id);

  if (watermark === null) {
    // A LARGE first-run receive history is an established / imported wallet —
    // baseline it silently (seeding the top block's accounted ids so a later
    // same-block arrival is still detected) so the whole history never dumps
    // into notifications.
    if (candidates.length > INCOMING_FIRST_RUN_NOTIFY_CAP) {
      return {
        baseline: { ...max, blockIds: topBlockIds },
        toRecord: [],
        newWatermark: null,
      };
    }
    // A SMALL set on a fresh / migrated scope is genuine recent arrivals —
    // record + notify each (oldest-first from assignIncomingIds) and advance the
    // watermark to the newest, carrying the top block's ids.
    return {
      baseline: null,
      toRecord: withIds,
      newWatermark: { ...max, blockIds: topBlockIds },
    };
  }

  const fresh = withIds.filter(
    (c) =>
      anchorAfter(c.anchor, watermark) ||
      (c.anchor.blockHeight === watermark.blockHeight &&
        watermark.blockIds !== undefined &&
        !watermark.blockIds.includes(c.id)),
  ); // already oldest-first from assignIncomingIds

  let newWatermark: IncomingWatermark | null = null;
  if (anchorAfter(max, watermark) || max.blockHeight === watermark.blockHeight) {
    const blockIds =
      max.blockHeight === watermark.blockHeight
        ? Array.from(new Set([...(watermark.blockIds ?? []), ...topBlockIds]))
        : topBlockIds;
    newWatermark = { ...max, blockIds };
  }
  return { baseline: null, toRecord: fresh, newWatermark };
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
    // `addressLower` is this run's own wallet address — the scope the rows were
    // read for — so a self-transfer's inbound leg is recognised and not
    // announced as an arrival.
    const candidates = incomingCandidatesFromRows(confirmedRows, addressLower);
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
      const { added, record } = await recordNotification({
        addressLower,
        chainIdHex,
        txHash: c.id,
        status: "confirmed",
        blockNumber: c.anchor.blockHeight,
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
