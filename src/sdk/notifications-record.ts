// Recording hook — the single chokepoint that turns an operation's terminal
// transition into a persisted notification.
//
// Why this lives here (and not in the OperationsDrawer): the drawer owns UI
// state; this module owns the honest mapping from "what the chain actually
// told us" to a `NotificationRecord`, plus the bounded confirm-poll. Keeping
// it separate keeps the drawer thin and makes the status logic unit-testable.
//
// Status fidelity (the load-bearing invariant):
//   - A thrown `execute()` is a genuine terminal FAILURE — the node /
//     precompile / SDK rejected the submission synchronously. We record
//     `status: "failed"` immediately. This is an explicit rejection, never
//     optimism.
//   - A resolved `execute()` means the envelope was ACCEPTED by the node —
//     i.e. broadcast, NOT a confirmed receipt. We do NOT record "confirmed"
//     here. Instead we poll `lyth_txStatus(txHash)` until it reports the tx as
//     on-chain (`status: "found"`), then record `status: "confirmed"` with the
//     real block number. If the poll never observes the tx within its budget,
//     we record NOTHING (honest absence — no optimistic "confirmed").
//
// This mirrors the browser wallet, whose notification records also treat
// `lyth_txStatus="found"` as the confirmed signal and only ever persist
// explicit "confirmed" / "failed".

import { MONOLYTHIUM_TESTNET_CHAIN_ID } from "@monolythium/core-sdk";
import { IDENTITY } from "../data/fixtures";
import { getProvider } from "./client";
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

/** Confirm-poll budget. Six attempts, ~2.5s apart, ≈15s total — long enough
 *  for testnet anchoring without holding a background task open indefinitely.
 *  Tuned conservatively: missing the window records nothing (the user still
 *  sees the broadcast in the Done pane), which is the honest failure mode. */
const CONFIRM_POLL_ATTEMPTS = 6;
const CONFIRM_POLL_INTERVAL_MS = 2_500;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** After a successful broadcast, poll `lyth_txStatus` until the tx is observed
 *  on-chain, then record a `"confirmed"` notification with the real block
 *  number. Records nothing if the tx never surfaces within the budget.
 *
 *  Resolves once it has either recorded or exhausted the budget — the caller
 *  fires it without awaiting, so the Done pane is never blocked on the poll. */
export async function recordOperationConfirmed(
  meta: OperationNotifyContext,
  txHash: string,
): Promise<void> {
  if (!txHash) return;
  const client = getProvider().rpcClient;
  for (let attempt = 0; attempt < CONFIRM_POLL_ATTEMPTS; attempt++) {
    try {
      const status = await client.lythTxStatus(txHash);
      if (status.status === "found") {
        await recordNotification({
          addressLower: scopeAddressLower(),
          chainIdHex: scopeChainIdHex(),
          txHash,
          status: "confirmed",
          blockNumber:
            typeof status.blockNumber === "number" &&
            Number.isFinite(status.blockNumber)
              ? status.blockNumber
              : null,
          kind: meta.kind,
          amountDecimal: meta.amountDecimal,
          counterparty: meta.counterparty,
        });
        return;
      }
    } catch {
      // Transient RPC failure — keep trying within the budget.
    }
    if (attempt < CONFIRM_POLL_ATTEMPTS - 1) {
      await sleep(CONFIRM_POLL_INTERVAL_MS);
    }
  }
  // Budget exhausted without an on-chain observation → record nothing. The
  // broadcast still shows in the Done pane; we never fabricate a "confirmed".
}
