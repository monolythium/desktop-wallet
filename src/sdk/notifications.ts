// Pure notification model — types, key builders, the history cap + newest-
// first append helper, friendly title strings, and tolerant parsers.
//
// This wallet uses typed bech32m (`mono…`) counterparties on every surface,
// so the module treats `counterparty` as an opaque address string.
//
// No `chrome.*`, no DOM, no Tauri IPC, no module-scope state — every helper
// here is deterministic and unit-testable in vitest without runtime shims.
// The Tauri-store round-trip lives in `notifications-store.ts`; the single
// recording chokepoint (terminal transition of a tracked write) lives in the
// OperationsDrawer.
//
// Invariants this module helps uphold:
//   - Status fidelity: `NotificationRecord.status` is `"confirmed" | "failed"`
//     only — never optimism inferred from a pending state.
//   - Dedupe by canonical hash: `notificationId` builds the stable per-record
//     key `${chainIdHex}:${txHash}` used both as the record `id` and the
//     dedupe-set membership key.
//   - No secrets in the body: a record carries only txHash / status /
//     blockNumber / kind / amountDecimal / counterparty / createdAtMs / read /
//     schemaVersion — never a contact name.

/** Max notification records retained per (address, chain) — newest-first,
 *  capped via `appendCapped`. 50 covers months of normal use; older records
 *  drop silently on append. */
export const NOTIFICATION_HISTORY_CAP = 50;

/** Max dedupe-set ids retained per (address, chain) — newest-first. Bounds the
 *  set that was previously unbounded (it grew one id per notification forever,
 *  re-serialising the whole file O(n) on every write). Kept comfortably larger
 *  than {@link NOTIFICATION_HISTORY_CAP} and any realistic re-observation window:
 *  a tx only needs its id in the set for as long as it could plausibly be seen
 *  again, and the reconcile poller drops terminal txs from tracking while
 *  incoming-detection advances a watermark past processed blocks, so an evicted
 *  old id is never re-observed and can't re-fire a notification. */
export const NOTIFIED_SET_CAP = 256;

/** Append `id` to a dedupe-set, keeping the newest {@link NOTIFIED_SET_CAP}.
 *  Pure. */
export function appendNotifiedIdCapped(ids: readonly string[], id: string): string[] {
  return [...ids, id].slice(-NOTIFIED_SET_CAP);
}

/** Operation classification attached to a recorded notification. Drives the
 *  friendly title via {@link notificationTitle}. `contract_call` is the
 *  fallback for untagged / unrecognized paths. */
export type TxOpKind =
  | "send"
  | "receive"
  | "delegate"
  | "undelegate"
  | "redelegate"
  | "claim"
  | "set-auto-compound"
  | "emergency-key"
  | "agent-policy"
  | "contract_call";

/** Runtime guard for `TxOpKind`. Coerces unknown / malformed literals to a
 *  safe fallback at the parse boundary rather than propagating garbage. */
export function isTxOpKind(v: unknown): v is TxOpKind {
  return (
    v === "send" ||
    v === "receive" ||
    v === "delegate" ||
    v === "undelegate" ||
    v === "redelegate" ||
    v === "claim" ||
    v === "set-auto-compound" ||
    v === "emergency-key" ||
    v === "agent-policy" ||
    v === "contract_call"
  );
}

/** One persisted notification — the row the Notifications page + detail modal
 *  render. */
export interface NotificationRecord {
  /** `${chainIdHex}:${txHash}` — also the dedupe-set membership key. */
  id: string;
  /** Canonical inner-tx hash. 0x-prefixed. */
  txHash: string;
  /** Real on-chain status — `"confirmed"` only on an explicit `lyth_txStatus`
   *  "found" observation; `"failed"` only on an explicit submission rejection.
   *  Never coerced from a pending state. */
  status: "confirmed" | "failed";
  /** Block number from the observed status (or `null` on the `found`
   *  fast-path when the response didn't carry a parseable value, and on a
   *  rejected submission). */
  blockNumber: number | null;
  /** Operation classification used to render the friendly title. */
  kind: TxOpKind;
  /** Canonical amount string (already formatted decimal). NEVER a BigInt — the
   *  store serializes JSON only. */
  amountDecimal: string;
  /** Amount unit — the token symbol for an MRC-20 send; absent for native LYTH
   *  (renders "LYTH"). Optional + backward-compatible: records written before
   *  this field read as LYTH. */
  unit?: string;
  /** Typed bech32m counterparty — the recipient the user intended to send to,
   *  or the precompile target for contract calls. */
  counterparty: string;
  /** For delegation kinds: the target cluster, so the row/detail can name the
   *  cluster rather than the bare delegation-module address. Optional and
   *  backward-compatible — records written before this field simply omit it. */
  clusterId?: number;
  clusterName?: string;
  /** A settled-rewards amount (LYTH decimal) decoded at the confirmed terminal
   *  from the receipt's `Claimed` log (the tx value is 0x0, so the amount lives
   *  in the log, not the value). Written for a `claim` and for a
   *  `set-auto-compound` that settled pending rewards in the same tx. Optional +
   *  legacy-safe; an undecodable log leaves it absent. */
  claimedAmount?: string;
  /** The tx's network fee in raw lythoshi, decoded from `lyth_decodeTx` at the
   *  confirmed terminal. Optional + legacy-safe — an absent record or an
   *  undecodable fee omits the fee row (honest absence, never a fabricated 0). */
  feeLythoshi?: string;
  /** Owning scope — the lowercased address this record was recorded under (the
   *  active vault's identity at write time). Optional + backward-compatible:
   *  records written before this field omit it. It lets a merged/global list
   *  still tell which vault a record belongs to; per-scope reads additionally
   *  attribute by the storage-key scope, so a legacy record without this field
   *  is still owned correctly and never shown under another vault. */
  scope?: string;
  /** Epoch ms when the terminal transition was observed (the fire-time). */
  createdAtMs: number;
  /** Read state. `false` on insert; `markAllRead` flips per-scope. */
  read: boolean;
  /** Bump on shape change. */
  schemaVersion: 0;
}

/** Per-(address, chain) history blob. Newest-first, capped. */
export interface NotificationsHistoryEnvelope {
  schemaVersion: 0;
  entries: NotificationRecord[];
}

/** Per-(address, chain) dedupe set — an array (JSON-only store) of
 *  `notificationId` strings. Kept separate from the history blob so a
 *  hypothetical "clear history" wouldn't lose dedupe state and re-fire for
 *  txs the user already saw. */
export interface NotifiedSetEnvelope {
  schemaVersion: 0;
  ids: string[];
}

/** Per-(address, chain) history key inside the store. */
export function notificationsHistoryKey(
  addressLower: string,
  chainIdHex: string,
): string {
  return `mono.notifications.history.${addressLower}.${chainIdHex}.v1`;
}

/** Per-(address, chain) dedupe-set key inside the store. */
export function notifiedSetKey(addressLower: string, chainIdHex: string): string {
  return `mono.notifications.notified.${addressLower}.${chainIdHex}.v1`;
}

/** Stable per-record id = dedupe-set membership key. `chainIdHex`
 *  disambiguates the same txHash across chains. */
export function notificationId(chainIdHex: string, txHash: string): string {
  return `${chainIdHex}:${txHash}`;
}

/** Anchor for incoming-transfer detection — the position of the newest inbound
 *  row already notified for an (address, chain). Compared lexicographically. */
export interface IncomingWatermark {
  blockHeight: number;
  txIndex: number;
  logIndex: number;
  /** The accounted synthetic ids recorded at the top block. Disambiguates
   *  multiple same-block native receives (which share the txIndex 0 + u32::MAX
   *  logIndex sentinel) so a second receive in the watermark's block isn't lost.
   *  Optional + additive — a legacy watermark without it treats its boundary
   *  block as history (never re-toasts on upgrade). */
  blockIds?: string[];
}

/** Per-(address, chain) incoming-watermark key inside the store. */
export function incomingWatermarkKey(
  addressLower: string,
  chainIdHex: string,
): string {
  return `mono.notifications.incoming-watermark.${addressLower}.${chainIdHex}.v1`;
}

/** True when anchor `a` is strictly newer than `b` — lexicographic by
 *  blockHeight, then txIndex, then logIndex. */
export function anchorAfter(a: IncomingWatermark, b: IncomingWatermark): boolean {
  if (a.blockHeight !== b.blockHeight) return a.blockHeight > b.blockHeight;
  if (a.txIndex !== b.txIndex) return a.txIndex > b.txIndex;
  return a.logIndex > b.logIndex;
}

/** Tolerant parse of a stored incoming watermark. Malformed → null (caller
 *  treats it as "no baseline yet" and baselines on the next pass). */
export function parseIncomingWatermark(raw: unknown): IncomingWatermark | null {
  if (raw === null || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.blockHeight !== "number" || !Number.isFinite(r.blockHeight)) return null;
  if (typeof r.txIndex !== "number" || !Number.isFinite(r.txIndex)) return null;
  if (typeof r.logIndex !== "number" || !Number.isFinite(r.logIndex)) return null;
  // Additive + non-rejecting: absence/garbage → undefined (legacy boundary is
  // history), never a reason to drop the whole watermark.
  const blockIds = Array.isArray(r.blockIds)
    ? r.blockIds.filter((s): s is string => typeof s === "string")
    : undefined;
  return { blockHeight: r.blockHeight, txIndex: r.txIndex, logIndex: r.logIndex, blockIds };
}

/** Insert a record newest-first and slice to the cap. Pure. */
export function appendCapped(
  entries: NotificationRecord[],
  record: NotificationRecord,
  cap: number = NOTIFICATION_HISTORY_CAP,
): NotificationRecord[] {
  const next = [record, ...entries];
  return next.length > cap ? next.slice(0, cap) : next;
}

function asNotificationStatus(v: unknown): "confirmed" | "failed" | undefined {
  return v === "confirmed" || v === "failed" ? v : undefined;
}

function asNotificationKind(v: unknown): TxOpKind | undefined {
  return isTxOpKind(v) ? v : undefined;
}

/** Friendly title strings for each operation kind × status. The list page
 *  and detail modal both call {@link notificationTitle} so the wording stays
 *  centralized here. */
export const NOTIFICATION_LABELS: Record<
  TxOpKind,
  { confirmed: string; failed: string }
> = {
  send: { confirmed: "Sent", failed: "Send failed" },
  receive: { confirmed: "Received", failed: "Received" },
  delegate: { confirmed: "Delegated", failed: "Delegate failed" },
  undelegate: { confirmed: "Undelegated", failed: "Undelegate failed" },
  redelegate: { confirmed: "Redelegated", failed: "Redelegate failed" },
  claim: { confirmed: "Rewards claimed", failed: "Claim failed" },
  "set-auto-compound": {
    confirmed: "Auto-compound updated",
    failed: "Auto-compound update failed",
  },
  "emergency-key": {
    confirmed: "Backup key registered",
    failed: "Backup registration failed",
  },
  "agent-policy": {
    confirmed: "Agent policy updated",
    failed: "Agent policy failed",
  },
  contract_call: {
    confirmed: "Transaction confirmed",
    failed: "Transaction failed",
  },
};

/** True for the delegation precompile kinds whose notification names a cluster
 *  rather than the bare delegation-module address. */
export function isDelegationKind(kind: TxOpKind): boolean {
  return kind === "delegate" || kind === "undelegate" || kind === "redelegate";
}

/** Display label for a delegation record's target cluster — the captured name,
 *  else `Cluster #<id>`, else `null` when no cluster metadata was captured
 *  (legacy records) or the kind isn't a delegation. The in-app row + detail
 *  derive the same label, so every surface names the cluster identically rather
 *  than the bare delegation-module precompile address. */
export function delegationClusterLabel(record: NotificationRecord): string | null {
  if (!isDelegationKind(record.kind)) return null;
  return (
    record.clusterName ??
    (record.clusterId !== undefined ? `Cluster #${record.clusterId}` : null)
  );
}

/** Amount to display for a record: a reward claim's decoded settled amount
 *  ("+<amt> LYTH") when known, else the plain amount ("<amt> LYTH"), else null
 *  for a zero/absent amount (omitted — honest absence). Centralizes the
 *  claim-amount rule the toast, the in-app row, and the detail all use. */
export function notificationAmountLabel(record: NotificationRecord): string | null {
  // Keyed on the FIELD, not the kind: enabling auto-compound with pending
  // rewards settles them in the same tx and emits the same Claimed log, so any
  // record carrying a decoded settled amount shows it.
  if (record.claimedAmount && !isZeroAmount(record.claimedAmount)) {
    // Settled rewards are paid in native LYTH.
    return `+${record.claimedAmount} LYTH`;
  }
  return isZeroAmount(record.amountDecimal)
    ? null
    : `${record.amountDecimal} ${amountUnitLabel(record.unit)}`;
}

/** The unit shown next to a recorded amount — the token symbol when present,
 *  else native LYTH. Pure; the single default so a token send is never
 *  mislabeled and a legacy (unit-less) record still reads "LYTH". */
export function amountUnitLabel(unit: string | undefined): string {
  return unit && unit.length > 0 ? unit : "LYTH";
}

/** Render the friendly title for a notification. */
export function notificationTitle(
  kind: TxOpKind,
  status: "confirmed" | "failed",
): string {
  return NOTIFICATION_LABELS[kind][status];
}

/** Middle-truncate a typed bech32m address for compact display — identical
 *  head/tail to `_detailModalParts.truncMiddle` so the OS toast body matches
 *  the in-app row's `short` form verbatim. Inlined here (rather than imported)
 *  to keep this module DOM/React-free per its header invariant. */
function shortAddress(s: string, head = 10, tail = 6): string {
  return s.length > head + tail + 1 ? `${s.slice(0, head)}…${s.slice(-tail)}` : s;
}

/** Friendly title + body for a terminal notification — the SAME wording the
 *  in-app Notifications row renders (title = {@link notificationTitle}; body =
 *  `"<amount> LYTH · <short bech32m>"`, or just the short address when the
 *  amount is zero). Pure + secret-free: only the public amount + a
 *  middle-truncated bech32m address ever appear, never a contact name or any
 *  encrypted payload. The OS-toast layer (`os-toast.ts`) consumes this so the
 *  toast and the in-app record always read identically. */
/** Generic, content-free title shown on the OS toast when "Show transaction
 *  details" is off — so a glanceable toast leaks neither the amount/address NOR
 *  the action (Sent / Delegated / …) on a shared screen. The in-app record always
 *  keeps the full friendly title + detail; only the OS toast is redacted. */
const REDACTED_TOAST_TITLE = "Monolythium Wallet";

export function notificationToast(
  record: NotificationRecord,
  includeDetails: boolean = true,
): {
  title: string;
  body: string;
} {
  // Redacted mode: a generic title and no body — neither the amount/address nor
  // the action is surfaced on the OS toast. The in-app record keeps full detail.
  if (!includeDetails) return { title: REDACTED_TOAST_TITLE, body: "" };
  const title = notificationTitle(record.kind, record.status);
  // A settling tx's value is 0x0; the settled amount lives in the Claimed log,
  // decoded into `claimedAmount`. Keyed on the field so an auto-compound that
  // settled pending rewards shows its figure too.
  if (record.claimedAmount && !isZeroAmount(record.claimedAmount)) {
    return { title, body: `+${record.claimedAmount} LYTH` };
  }
  // A delegation tx's counterparty is the bare delegation-module precompile;
  // name the target cluster instead (the same label the in-app row shows),
  // falling back to the truncated address only when no cluster metadata was
  // captured (legacy records).
  const short = delegationClusterLabel(record) ?? shortAddress(record.counterparty);
  const body = isZeroAmount(record.amountDecimal)
    ? short
    : `${record.amountDecimal} ${amountUnitLabel(record.unit)} · ${short}`;
  return { title, body };
}

/** Present-tense, in-flight labels for a tracked tx still awaiting its terminal
 *  receipt. Deliberately distinct from the terminal `NOTIFICATION_LABELS`
 *  (e.g. "Sending…" vs. "Sent") so a Pending row never reads as already
 *  confirmed. The Activity "Pending" section and its detail modal both call
 *  {@link pendingOpLabel} so the wording stays centralized here. */
export const PENDING_OP_LABELS: Record<TxOpKind, string> = {
  send: "Sending…",
  receive: "Receiving…",
  delegate: "Delegating…",
  undelegate: "Undelegating…",
  redelegate: "Redelegating…",
  claim: "Claiming rewards…",
  "set-auto-compound": "Updating auto-compound…",
  "emergency-key": "Registering backup key…",
  "agent-policy": "Updating agent policy…",
  contract_call: "Submitting transaction…",
};

/** Render the present-tense label for an in-flight tracked tx. */
export function pendingOpLabel(kind: TxOpKind): string {
  return PENDING_OP_LABELS[kind];
}

/** True for amount strings that mean "zero LYTH". The list row + detail modal
 *  omit the amount in this case so a 0-LYTH claim / agent-policy reads
 *  cleanly. */
export function isZeroAmount(amountDecimal: string): boolean {
  if (amountDecimal.length === 0) return true;
  return /^0(\.0+)?$/.test(amountDecimal);
}

function asNotificationRecord(raw: unknown): NotificationRecord | null {
  if (raw === null || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const status = asNotificationStatus(r.status);
  const kind = asNotificationKind(r.kind);
  if (status === undefined || kind === undefined) return null;
  if (typeof r.id !== "string") return null;
  if (typeof r.txHash !== "string") return null;
  if (typeof r.amountDecimal !== "string") return null;
  if (typeof r.counterparty !== "string") return null;
  if (typeof r.createdAtMs !== "number" || !Number.isFinite(r.createdAtMs)) {
    return null;
  }
  if (typeof r.read !== "boolean") return null;
  const blockNumber =
    r.blockNumber === null
      ? null
      : typeof r.blockNumber === "number" && Number.isFinite(r.blockNumber)
        ? r.blockNumber
        : undefined;
  if (blockNumber === undefined) return null;
  const clusterId =
    typeof r.clusterId === "number" && Number.isFinite(r.clusterId)
      ? r.clusterId
      : undefined;
  const clusterName = typeof r.clusterName === "string" ? r.clusterName : undefined;
  const claimedAmount =
    typeof r.claimedAmount === "string" && r.claimedAmount.length > 0
      ? r.claimedAmount
      : undefined;
  const feeLythoshi =
    typeof r.feeLythoshi === "string" && r.feeLythoshi.length > 0
      ? r.feeLythoshi
      : undefined;
  const scope = typeof r.scope === "string" ? r.scope : undefined;
  const unit = typeof r.unit === "string" && r.unit.length > 0 ? r.unit : undefined;
  return {
    id: r.id,
    txHash: r.txHash,
    status,
    blockNumber,
    kind,
    amountDecimal: r.amountDecimal,
    unit,
    counterparty: r.counterparty,
    clusterId,
    clusterName,
    claimedAmount,
    feeLythoshi,
    scope,
    createdAtMs: r.createdAtMs,
    read: r.read,
    schemaVersion: 0,
  };
}

/** Tolerant parse of the per-scope history envelope. Malformed → null (caller
 *  treats as empty + heals on next write). */
export function parseHistoryEnvelope(
  raw: unknown,
): NotificationsHistoryEnvelope | null {
  if (raw === null || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  if (r.schemaVersion !== 0) return null;
  if (!Array.isArray(r.entries)) return null;
  const entries: NotificationRecord[] = [];
  for (const e of r.entries) {
    const rec = asNotificationRecord(e);
    if (rec !== null) entries.push(rec);
  }
  return { schemaVersion: 0, entries };
}

/** Tolerant parse of the per-scope dedupe-set envelope. */
export function parseNotifiedSetEnvelope(
  raw: unknown,
): NotifiedSetEnvelope | null {
  if (raw === null || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  if (r.schemaVersion !== 0) return null;
  if (!Array.isArray(r.ids)) return null;
  const ids = r.ids.filter((x): x is string => typeof x === "string");
  return { schemaVersion: 0, ids };
}
