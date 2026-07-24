// Durable tracked-tx reconcile core.
//
// This is the ONE reconcile path that replaces the OperationsDrawer's bounded
// fire-and-forget `lyth_txStatus` poll. It holds the SDK RpcClient, probes
// each persisted tracked tx for a terminal state, and runs the same
// detect → record sequence the old drawer poll ran — but driven from an
// app-level interval, so it survives drawer-close and follows a tx to a REAL
// terminal state (confirmed OR failed) instead of dying when the drawer closes.
//
// READ-AND-RECORD ONLY: it reads public tx status / receipts (and the account's
// committed nonce, read-only, to detect a dropped tx) for hashes the wallet
// already broadcast, and writes only the notification store + the tracked-tx
// store. It never touches signing, broadcast, fees, or any vault material.
//
// Status fidelity (the load-bearing invariant) lives in `classifyPending`
// (`pending-tx.ts`): a notification is recorded ONLY on an explicit on-chain
// observation — `lyth_txStatus="found"` (confirmed) or a receipt `status` bit
// (1 = confirmed, 0 = failed). The "failed" path — unreachable by the old
// design, which only recorded "failed" on a synchronous submit throw that
// produced no hash — now fires here when the chain returns a reverted receipt
// for a tx the wallet successfully broadcast.

import { loadActiveWallet } from "./active-wallet";
import { scopeChainKey } from "./chains";
import { getProvider } from "./client";
import { decodeClaimedAmount, decodeTxFeeLythoshi } from "./live";
import { getNativeTransactionCount } from "./native-rpc";
import { recordNotification } from "./notifications-store";
import { REASON_UNAVAILABLE } from "./notifications";
import { classifyChainRevert, readRawRevertReason } from "./raw-revert-reason";
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
  markPendingIncluded,
  removePendingTx,
} from "./pending-tx-store";
import type { OperationNotifyMeta } from "../operations/types";

/** Lowercased scope address — the wallet's active identity is the sender (and
 *  the notification scope's address dimension). Mirrors `notifications-record.ts`. */
async function scopeAddressLower(): Promise<string | null> {
  const wallet = await loadActiveWallet();
  return wallet.status === "ready" ? wallet.address.toLowerCase() : null;
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
  nonce?: number,
): Promise<void> {
  if (!txHash) return;
  const addressLower = await scopeAddressLower();
  if (!addressLower) return;
  const tx: PendingTx = {
    txHash,
    chainIdHex: scopeChainKey(),
    addressLower,
    opKind: meta.kind,
    amountDecimal: meta.amountDecimal,
    unit: meta.unit,
    counterparty: meta.counterparty,
    clusterId: meta.clusterId,
    clusterName: meta.clusterName,
    delegationWeightBps: meta.delegationWeightBps,
    toClusterId: meta.toClusterId,
    toClusterName: meta.toClusterName,
    // Captured at submit so the reconciler can detect a dropped tx (a later
    // nonce confirmed while this one stayed pending). Absent → time-based only.
    nonce,
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
    txStatus =
      status.status === "found"
        ? {
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
          }
        : { kind: "not_found" };
  } catch {
    txStatus = { kind: "throw" };
  }

  // Always consult the receipt — including for a `found` tx. `lyth_txStatus`
  // reports INCLUSION, not success (a reverted tx is also "found"), so the
  // receipt's status bit is the only authority on the outcome. Scoped to the
  // status bit (F1); the reason text is F4. Uses the sanctioned reader, whose
  // `status` field is delivered (verified live), unlike `revertReason`.
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
    // The reconcile pass is scoped to the ACTIVE chain: `probeTx` and the
    // committed-nonce read below both talk to `getProvider()` — the active
    // chain's RPC — so a tx broadcast to a different chain must not be probed
    // here (that RPC never saw its hash, and a `not_found` could mis-read a
    // live tx as dropped). An off-chain row stays untouched until its own chain
    // is active again; the poller re-arms on a chain switch to pick it up.
    const activeChain = scopeChainKey();
    // 1. Probe each ACTIVE-CHAIN tracked tx for a terminal verdict FIRST, so a
    //    tx that reached terminal is always recorded — even an old one — before
    //    any retention removal in step 2.
    const txs = (await listPendingTxs()).filter(
      (t) => t.chainIdHex === activeChain,
    );
    for (const tx of txs) {
      // A bridged row is already confirmed-and-recorded; skip it. The feed
      // retires it once the indexer surfaces the canonical row at its slot.
      if (tx.confirmedBlockHeight !== undefined) continue;
      const probe = await probeTx(tx.txHash);
      const verdict = classifyPending(probe);
      if (verdict.kind === "pending") {
        // Included but not yet resolved (`found` + an unreadable receipt): mark
        // it so the time-ladder never ages a possibly-succeeded tx into a false
        // "didn't confirm" (V-A). It still resolves via its receipt on a later
        // tick; a persistently-unreadable one ages to "status unknown" instead.
        if (probe.txStatus.kind === "found" && tx.seenIncluded !== true) {
          await markPendingIncluded(tx.chainIdHex, tx.txHash);
        }
        continue;
      }
      // A confirmed reward claim carries its settled amount in the receipt's
      // Claimed log (the tx value is 0x0); decode it so the record shows the
      // real "+<amount> LYTH". Null stays undefined — the surfaces then show the
      // bare title rather than the submit-time claimable, which is a different
      // quantity measured at a different moment.
      //
      // Enabling auto-compound with pending rewards settles them in the same tx,
      // so that kind emits a Claimed log too and is decoded the same way. A
      // failed tx emits no log, so only confirmed verdicts are decoded.
      const claimedAmount =
        verdict.kind === "confirmed" &&
        (tx.opKind === "claim" || tx.opKind === "set-auto-compound")
          ? ((await decodeClaimedAmount(tx.txHash)) ?? undefined)
          : undefined;
      // The network fee for any confirmed tx, decoded from lyth_decodeTx.
      // Undefined (no fee row) when undecodable — never a fabricated 0.
      const feeLythoshi =
        verdict.kind === "confirmed"
          ? ((await decodeTxFeeLythoshi(tx.txHash)) ?? undefined)
          : undefined;
      // F4 — a `failed` verdict is a reverted receipt (status 0). The chain
      // carries the revert reason, but the pinned SDK normaliser drops it, so
      // read it via the ONE raw accessor and classify into bounded fields.
      // Fail-safe: if the raw read fails, fall back to the honest "a reason
      // exists, unread" marker — never silence, never a guess (the three-way
      // distinction survives).
      let reason: string | undefined;
      let reasonCode: number | undefined;
      let reasonDetail: string | undefined;
      if (verdict.kind === "failed") {
        const rawReason = await readRawRevertReason(getProvider().rpcClient, tx.txHash);
        if (rawReason !== null) {
          ({ reason, reasonCode, reasonDetail } = classifyChainRevert(rawReason));
        } else {
          reason = REASON_UNAVAILABLE;
        }
      }
      // Terminal — record the genuine status verbatim (once; the store dedupes).
      const { added, record } = await recordNotification({
        addressLower: tx.addressLower,
        chainIdHex: tx.chainIdHex,
        txHash: tx.txHash,
        status: verdict.kind,
        blockNumber: verdict.blockNumber,
        kind: tx.opKind,
        amountDecimal: tx.amountDecimal,
        unit: tx.unit,
        counterparty: tx.counterparty,
        clusterId: tx.clusterId,
        clusterName: tx.clusterName,
        delegationWeightBps: tx.delegationWeightBps,
        toClusterId: tx.toClusterId,
        toClusterName: tx.toClusterName,
        claimedAmount,
        feeLythoshi,
        reason,
        reasonCode,
        reasonDetail,
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
    // 2. Read each ACTIVE-CHAIN tracking address's committed nonce (read-only,
    //    from the active chain's RPC) so the lifecycle can detect a dropped tx —
    //    a later nonce confirmed while this one is still pending. A failed read
    //    maps to null (inert: never drops). Off-chain rows are excluded: their
    //    nonce lives on a different chain and must not be compared here.
    const survivors = (await listPendingTxs()).filter(
      (t) => t.chainIdHex === activeChain,
    );
    const client = getProvider().rpcClient;
    const committedNonces = new Map<string, number | null>();
    for (const addressLower of new Set(survivors.map((t) => t.addressLower))) {
      try {
        committedNonces.set(addressLower, Number(await getNativeTransactionCount(client, addressLower)));
      } catch {
        committedNonces.set(addressLower, null);
      }
    }
    // 3. Recompute the ACTIVE-CHAIN survivors' lifecycle (so the feed relabels
    //    pending → slow → dropped/expired) and silently drop rows visible in a
    //    terminal state past the retention window. Off-chain rows pass through
    //    untouched (frozen until their chain is active). Replaces the old blind
    //    5-min silent expiry — a slow/expired/dropped tx now stays visible.
    const transition = await applyPendingTransition(now, committedNonces, activeChain);
    expired = transition.removed;
    remaining = (await listPendingTxs()).filter(
      (t) => t.chainIdHex === activeChain,
    ).length;
  } catch {
    // Best-effort — a reconcile failure must never escape the poller.
  }
  return { remaining, recorded, expired };
}
