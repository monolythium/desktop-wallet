// Recording hook — immediate terminal records for an operation that fails
// synchronously, before the broadcast is ever accepted.
//
// Why this lives here (and not in the OperationsDrawer): the drawer owns UI
// state; this module owns the honest mapping from "what the chain actually
// told us" to a `NotificationRecord`. Keeping it separate keeps the drawer
// thin and makes the status logic unit-testable.
//
// Status fidelity (the load-bearing invariant):
//   - A thrown `execute()` is a genuine terminal FAILURE — the node /
//     precompile / SDK rejected the submission synchronously. When that
//     rejection still carries a canonical hash we record `status: "failed"`
//     immediately. This is an explicit rejection, never optimism.
//   - A resolved `execute()` means the envelope was ACCEPTED by the node —
//     i.e. broadcast, NOT a confirmed receipt. We record NOTHING here for the
//     accepted case. Instead the drawer enqueues the broadcast tx into the
//     durable tracked-tx store (`pending-tx-store.ts`) and the app-level
//     reconcile poller (`reconcile.ts`) follows it to a real terminal state,
//     recording "confirmed" only on an explicit `lyth_txStatus="found"` /
//     receipt-success observation and "failed" on a reverted receipt. That is
//     the single reconcile path; this module no longer polls.
//
// The tracked-tx core treats `lyth_txStatus="found"` / a success receipt as
// the confirmed signal and only ever persists explicit "confirmed" / "failed".

import { loadActiveWallet } from "./active-wallet";
import { scopeChainKey } from "./chains";
import { recordNotification } from "./notifications-store";
import { toastTerminalNotification } from "./os-toast";
import type { TxOpKind } from "./notifications";
import { classifySendError, extractSendError } from "./send-error";

/** Lowercased scope address. The wallet's active typed bech32m address is the
 *  notification scope's address dimension (the recipient of every record it
 *  fires for is the user's own outbound activity). */
async function scopeAddressLower(): Promise<string | null> {
  const wallet = await loadActiveWallet();
  return wallet.status === "ready" ? wallet.address.toLowerCase() : null;
}

export interface OperationNotifyContext {
  kind: TxOpKind;
  amountDecimal: string;
  counterparty: string;
  /** For delegation kinds: the target cluster (optional). */
  clusterId?: number;
  clusterName?: string;
  /** Delegation weight in basis points, so a failed delegation states the same
   *  percent its landed siblings do. Optional + already carried by the record —
   *  the tracked-tx path has always written it, and this closes the one door
   *  that dropped it. */
  delegationWeightBps?: number;
}

/** Record a terminal FAILURE for an operation that threw. Honest + immediate:
 *  a rejected submission is a real terminal state. `txHash` may be absent (the
 *  failure could precede a hash); when absent we skip recording (no canonical
 *  id to dedupe on, and no Monoscan target). Best-effort. */
export async function recordOperationFailure(
  meta: OperationNotifyContext,
  txHash: string | undefined,
  cause?: unknown,
): Promise<void> {
  if (!txHash) return;
  const addressLower = await scopeAddressLower();
  if (!addressLower) return;
  // Classify the rejection into a BOUNDED token (a SendErrorKind), never the raw
  // node string — a node error can carry an endpoint, a path, or unbounded text.
  // The numeric JSON-RPC code is carried when the node supplied one.
  let reason: string | undefined;
  let reasonCode: number | undefined;
  if (cause !== undefined) {
    const extracted = extractSendError(cause);
    reason = classifySendError(extracted.message).kind;
    reasonCode =
      typeof extracted.code === "number" && Number.isFinite(extracted.code)
        ? extracted.code
        : undefined;
  }
  const { added, record } = await recordNotification({
    addressLower,
    chainIdHex: scopeChainKey(),
    txHash,
    status: "failed",
    blockNumber: null,
    kind: meta.kind,
    amountDecimal: meta.amountDecimal,
    counterparty: meta.counterparty,
    clusterId: meta.clusterId,
    clusterName: meta.clusterName,
    delegationWeightBps: meta.delegationWeightBps,
    reason,
    reasonCode,
  });
  // Raise an OS toast ONLY for a genuinely-new record (added === true), reusing
  // the store's `${chainIdHex}:${txHash}` dedupe. Best-effort + flag-gated
  // inside the helper; never throws back into the caller's submit flow.
  if (added && record) void toastTerminalNotification(record);
}
