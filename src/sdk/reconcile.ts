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
// encrypted payload.
//
// Status fidelity (the load-bearing invariant) lives in `classifyPending`
// (`pending-tx.ts`): a notification is recorded ONLY on an explicit on-chain
// observation — `lyth_txStatus="found"` (confirmed) or a receipt `status` bit
// (1 = confirmed, 0 = failed). The "failed" path — unreachable by the old
// design, which only recorded "failed" on a synchronous submit throw that
// produced no hash — now fires here when the chain returns a reverted receipt
// for a tx the wallet successfully broadcast.

import { MONOLYTHIUM_TESTNET_CHAIN_ID } from "@monolythium/core-sdk";
import { IDENTITY } from "../data/fixtures";
import { getProvider } from "./client";
import { recordNotification } from "./notifications-store";
import {
  classifyPending,
  isPendingExpired,
  type ChainProbe,
  type PendingTx,
} from "./pending-tx";
import {
  enqueuePendingTx,
  listPendingTxs,
  removePendingTx,
} from "./pending-tx-store";
import type { OperationNotifyMeta } from "../operations/types";

/** Lowercased scope address — the wallet's active identity is the sender (and
 *  the notification scope's address dimension). Mirrors `notifications-record.ts`. */
function scopeAddressLower(): string {
  return IDENTITY.address.toLowerCase();
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
  const tx: PendingTx = {
    txHash,
    chainIdHex: scopeChainIdHex(),
    addressLower: scopeAddressLower(),
    opKind: meta.kind,
    amountDecimal: meta.amountDecimal,
    counterparty: meta.counterparty,
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
      receipt = {
        kind: "receipt",
        status: r.status,
        blockNumber: Number.isFinite(blockNumber) ? blockNumber : null,
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
 *    1. TTL-evict first — a tx aged past its tracking window is dropped
 *       SILENTLY (no record; honest absence) so it's neither notified nor
 *       re-probed.
 *    2. Probe the chain and classify. On a terminal verdict, record ONE
 *       notification (confirmed with the block number, or failed) and remove
 *       the tx from the tracked set. The notification store dedupes on
 *       `${chainIdHex}:${txHash}`, so a record can never re-fire.
 *    3. Otherwise leave the tx tracked for the next tick.
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
    const txs = await listPendingTxs();
    for (const tx of txs) {
      // 1. Silent TTL eviction — never records.
      if (isPendingExpired(tx, now)) {
        await removePendingTx(tx.chainIdHex, tx.txHash);
        expired++;
        continue;
      }
      // 2. Probe + classify.
      const probe = await probeTx(tx.txHash);
      const verdict = classifyPending(probe);
      if (verdict.kind === "pending") {
        remaining++;
        continue;
      }
      // Terminal — record the genuine status verbatim, then stop tracking.
      await recordNotification({
        addressLower: tx.addressLower,
        chainIdHex: tx.chainIdHex,
        txHash: tx.txHash,
        status: verdict.kind,
        blockNumber: verdict.blockNumber,
        kind: tx.opKind,
        amountDecimal: tx.amountDecimal,
        counterparty: tx.counterparty,
      });
      await removePendingTx(tx.chainIdHex, tx.txHash);
      recorded++;
    }
  } catch {
    // Best-effort — a reconcile failure must never escape the poller.
  }
  return { remaining, recorded, expired };
}
