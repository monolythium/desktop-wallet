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
// This mirrors the browser wallet, whose tracked-tx core also treats
// `lyth_txStatus="found"` / a success receipt as the confirmed signal and only
// ever persists explicit "confirmed" / "failed".

import { MONOLYTHIUM_TESTNET_CHAIN_ID } from "@monolythium/core-sdk";
import { IDENTITY } from "../data/fixtures";
import { recordNotification } from "./notifications-store";
import type { TxOpKind } from "./notifications";

/** Lowercased scope address. The wallet's active typed bech32m address is the
 *  notification scope's address dimension (the recipient of every record it
 *  fires for is the user's own outbound activity). */
function scopeAddressLower(): string {
  return IDENTITY.address.toLowerCase();
}

/** Hex chain id for the scope key — `0x10f2c` for testnet-69420. */
function scopeChainIdHex(): string {
  return `0x${MONOLYTHIUM_TESTNET_CHAIN_ID.toString(16)}`;
}

export interface OperationNotifyContext {
  kind: TxOpKind;
  amountDecimal: string;
  counterparty: string;
}

/** Record a terminal FAILURE for an operation that threw. Honest + immediate:
 *  a rejected submission is a real terminal state. `txHash` may be absent (the
 *  failure could precede a hash); when absent we skip recording (no canonical
 *  id to dedupe on, and no Monoscan target). Best-effort. */
export async function recordOperationFailure(
  meta: OperationNotifyContext,
  txHash: string | undefined,
): Promise<void> {
  if (!txHash) return;
  await recordNotification({
    addressLower: scopeAddressLower(),
    chainIdHex: scopeChainIdHex(),
    txHash,
    status: "failed",
    blockNumber: null,
    kind: meta.kind,
    amountDecimal: meta.amountDecimal,
    counterparty: meta.counterparty,
  });
}
