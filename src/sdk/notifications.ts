// Pure notification model — types, key builders, the history cap + newest-
// first append helper, friendly title strings, and tolerant parsers.
//
// Ported nearly verbatim from the browser-wallet's `shared/notifications.ts`
// so the two wallets share one notification shape contract. The only
// adaptation for desktop: counterparties are typed bech32m (`mono…`) on
// every desktop surface, so this module treats `counterparty` as an opaque
// address string rather than the browser's lowercase `0x` form.
//
// No `chrome.*`, no DOM, no Tauri IPC, no module-scope state — every helper
// here is deterministic and unit-testable in vitest without runtime shims.
// The Tauri-store round-trip lives in `notifications-store.ts`; the single
// recording chokepoint (terminal transition of a tracked write) lives in the
// OperationsDrawer.
//
// Invariants this module helps uphold (mirrored from the browser rules):
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
  /** Canonical LYTH amount string (already formatted decimal). NEVER a
   *  BigInt — the store serializes JSON only. */
  amountDecimal: string;
  /** Typed bech32m counterparty — the recipient the user intended to send to,
   *  or the precompile target for contract calls. */
  counterparty: string;
  /** For delegation kinds: the target cluster, so the row/detail can name the
   *  cluster rather than the bare delegation-module address. Optional and
   *  backward-compatible — records written before this field simply omit it. */
  clusterId?: number;
  clusterName?: string;
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
  delegate: { confirmed: "Staked", failed: "Stake failed" },
  undelegate: { confirmed: "Unstaked", failed: "Unstake failed" },
  redelegate: { confirmed: "Restaked", failed: "Restake failed" },
  claim: { confirmed: "Rewards claimed", failed: "Claim failed" },
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
export function notificationToast(record: NotificationRecord): {
  title: string;
  body: string;
} {
  const title = notificationTitle(record.kind, record.status);
  const short = shortAddress(record.counterparty);
  const body = isZeroAmount(record.amountDecimal)
    ? short
    : `${record.amountDecimal} LYTH · ${short}`;
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
  delegate: "Staking…",
  undelegate: "Unstaking…",
  redelegate: "Restaking…",
  claim: "Claiming rewards…",
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
  return {
    id: r.id,
    txHash: r.txHash,
    status,
    blockNumber,
    kind,
    amountDecimal: r.amountDecimal,
    counterparty: r.counterparty,
    clusterId,
    clusterName,
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
