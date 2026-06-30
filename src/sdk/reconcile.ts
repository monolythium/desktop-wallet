// Durable tracked-tx reconcile core.
//
// This is the ONE reconcile path that replaces the OperationsDrawer's bounded
// fire-and-forget `lyth_txStatus` poll. It holds the SDK RpcClient, probes
// each persisted tracked tx for a terminal state, and runs the same
// detect → record sequence the old drawer poll ran — but driven from an
// app-level interval, so it survives drawer-close and follows a tx to a REAL
// terminal state (confirmed OR failed) instead of dying when the drawer closes.
//
// READ-AND-RECORD ONLY: it reads public tx status / receipts for hashes the
// wallet already broadcast and writes only the notification store + the
// tracked-tx store. It never touches signing, broadcast, fees, nonces, or any
// vault material.
//
// Status fidelity (the load-bearing invariant) lives in `classifyPending`
// (`pending-tx.ts`): a notification is recorded ONLY on an explicit on-chain
// observation — `lyth_txStatus="found"` (confirmed) or a receipt `status` bit
// (1 = confirmed, 0 = failed). The "failed" path — unreachable by the old
// design, which only recorded "failed" on a synchronous submit throw that
// produced no hash — now fires here when the chain returns a reverted receipt
// for a tx the wallet successfully broadcast.

import { MONOLYTHIUM_TESTNET_CHAIN_ID } from "@monolythium/core-sdk";
import { loadActiveWallet } from "./active-wallet";
import { getProvider } from "./client";
import { recordNotification } from "./notifications-store";
import { toastTerminalNotification } from "./os-toast";
import {
  classifyPending,
  type ChainProbe,
  type PendingTx,
} from "./pending-tx";
import {
  applyPendingTransition,
  bridgePendingTx,
  enqueuePendingTx,
  listPendingTxs,
  removePendingTx,
} from "./pending-tx-store";
import type { OperationNotifyMeta } from "../operations/types";

/** Lowercased scope address — the wallet's active identity is the sender (and
 *  the notification scope's address dimension). Mirrors `notifications-record.ts`. */
async function scopeAddressLower(): Promise<string | null> {
  const wallet = await loadActiveWallet();
  return wallet.status === "ready" ? wallet.address.toLowerCase() : null;
}

/** Hex chain id for the scope key — `0x10f2c` for testnet-69420. */
function scopeChainIdHex(): string {
  return `0x${MONOLYTHIUM_TESTNET_CHAIN_ID.toString(16)}`;
}

/** Enqueue a successfully-broadcast operation into the durable tracked set so
 *  the app-level poller follows it to a terminal state. Called from the
 *  OperationsDrawer's Done transition for operations that set `descriptor.notify`
 *  AND resolved a single canonical hash (Send, single Delegate). Operations
 *  that submit zero or many txs (e.g. the autovote batch) carry no single hash
 *  and are never enqueued. Best-effort — a tracking-store failure is swallowed
 *  so it can't break the drawer flow. */
export async function trackOperationTx(
  meta: OperationNotifyMeta,
  txHash: string | undefined,
): Promise<void> {
  if (!txHash) return;
  const addressLower = await scopeAddressLower();
  if (!addressLower) return;
  const tx: PendingTx = {
    txHash,
    chainIdHex: scopeChainIdHex(),
    addressLower,
    opKind: meta.kind,
    amountDecimal: meta.amountDecimal,
    counterparty: meta.counterparty,
    clusterId: meta.clusterId,
    clusterName: meta.clusterName,
    submittedAt: Date.now(),
  };
  await enqueuePendingTx(tx);
}

/** Probe one tracked tx's chain state — `lyth_txStatus` first (the indexer
 *  fast-path), falling back to `eth_getTransactionReceipt` for the explicit
 *  success/revert bit. Returns the two raw answers normalized into a
 *  {@link ChainProbe}; the pure {@link classifyPending} turns them into a
 *  verdict. Never throws — every RPC failure becomes a `"throw"` marker that
 *  keeps the tx pending. */
async function probeTx(txHash: string): Promise<ChainProbe> {
  const client = getProvider().rpcClient;
  let txStatus: ChainProbe["txStatus"];
  try {
    const status = await client.lythTxStatus(txHash);
    if (status.status === "found") {
      txStatus = {
        kind: "found",
        blockNumber:
          typeof status.blockNumber === "number" &&
          Number.isFinite(status.blockNumber)
            ? status.blockNumber
            : null,
        txIndex:
          typeof status.txIndex === "number" && Number.isFinite(status.txIndex)
            ? status.txIndex
            : null,
      };
      // Already terminal-confirmed; no need to spend a receipt round-trip.
      return { txStatus, receipt: { kind: "skipped" } };
    }
    txStatus = { kind: "not_found" };
  } catch {
    txStatus = { kind: "throw" };
  }

  // Not surfaced by the indexer yet (or the status RPC failed) — ask for the
  // receipt so a reverted tx still reaches a "failed" verdict.
  let receipt: ChainProbe["receipt"];
  try {
    const r = await client.ethGetTransactionReceipt(txHash);
    if (r === null) {
      receipt = { kind: "null" };
    } else {
      const blockNumber = Number(r.block_number);
      const txIndex = Number(r.tx_index);
      receipt = {
        kind: "receipt",
        status: r.status,
        blockNumber: Number.isFinite(blockNumber) ? blockNumber : null,
        txIndex: Number.isFinite(txIndex) ? txIndex : null,
      };
    }
  } catch {
    receipt = { kind: "throw" };
  }
  return { txStatus, receipt };
}

/** Outcome of one reconcile tick. `remaining` = tracked txs still outstanding
 *  after this tick (the poller stops its interval when this hits 0);
 *  `recorded` / `expired` are diagnostic counts (terminal notifications fired
 *  and silently-dropped expired txs). */
export interface ReconcileTickResult {
  remaining: number;
  recorded: number;
  expired: number;
}

/** One reconcile pass over the durable tracked set.
 *
 *  For each tracked tx, in order:
 *    1. Probe the chain and classify. On a terminal verdict, record ONE
 *       notification (confirmed with the block number, or failed). The store
 *       dedupes on `${chainIdHex}:${txHash}`, so a record can never re-fire.
 *       A CONFIRMED tx is then BRIDGED — stamped with its inclusion slot and
 *       kept visible (rendered confirmed at chain speed) until the indexer
 *       surfaces the canonical row and the feed retires it by (block, txIndex).
 *       A FAILED tx (or a slot-less confirm) stops tracking immediately.
 *    2. Recompute the survivors' lifecycle and silently drop rows past the
 *       terminal-retention window (bridged rows pass through untouched).
 *
 *  Best-effort: never throws out of the caller's interval. Exported for unit
 *  tests (driven against the in-memory store stub) and called by the
 *  app-level poller. */
export async function reconcilePendingOnce(
  now: number = Date.now(),
): Promise<ReconcileTickResult> {
  let recorded = 0;
  let expired = 0;
  let remaining = 0;
  try {
    // 1. Probe each tracked tx for a terminal verdict FIRST, so a tx that
    //    reached terminal is always recorded — even an old one — before any
    //    retention removal in step 2.
    const txs = await listPendingTxs();
    for (const tx of txs) {
      // A bridged row is already confirmed-and-recorded; skip it. The feed
      // retires it once the indexer surfaces the canonical row at its slot.
      if (tx.confirmedBlockHeight !== undefined) continue;
      const probe = await probeTx(tx.txHash);
      const verdict = classifyPending(probe);
      if (verdict.kind === "pending") continue;
      // Terminal — record the genuine status verbatim (once; the store dedupes).
      const { added, record } = await recordNotification({
        addressLower: tx.addressLower,
        chainIdHex: tx.chainIdHex,
        txHash: tx.txHash,
        status: verdict.kind,
        blockNumber: verdict.blockNumber,
        kind: tx.opKind,
        amountDecimal: tx.amountDecimal,
        counterparty: tx.counterparty,
        clusterId: tx.clusterId,
        clusterName: tx.clusterName,
      });
      // Raise an OS toast ONLY for a genuinely-new record (added === true), so
      // the store's `${chainIdHex}:${txHash}` dedupe also dedupes the toast — a
      // re-observed terminal hash neither re-records nor re-toasts. Best-effort
      // + flag-gated inside the helper; never throws back into this tick.
      if (added && record) void toastTerminalNotification(record);
      if (
        verdict.kind === "confirmed" &&
        verdict.blockNumber !== null &&
        verdict.txIndex !== null
      ) {
        // Bridge: stamp the inclusion slot + KEEP it visible (rendered confirmed)
        // at chain speed until the indexer surfaces the canonical row and the
        // feed retires it by (block, txIndex).
        await bridgePendingTx(
          tx.chainIdHex,
          tx.txHash,
          verdict.blockNumber,
          verdict.txIndex,
        );
      } else {
        // Failed — or a confirmed verdict carrying no inclusion slot to bridge —
        // stops tracking (a slot-less confirm is represented by the indexer row).
        await removePendingTx(tx.chainIdHex, tx.txHash);
      }
      recorded++;
    }
    // 2. Recompute the survivors' lifecycle (so the feed relabels pending →
    //    slow → expired) and silently drop rows visible in a terminal state past
    //    the retention window. Replaces the old blind 5-min silent expiry — a
    //    slow/expired tx now stays visible + tracked instead of vanishing.
    const transition = await applyPendingTransition(now);
    expired = transition.removed;
    remaining = (await listPendingTxs()).length;
  } catch {
    // Best-effort — a reconcile failure must never escape the poller.
  }
  return { remaining, recorded, expired };
}
