// Token-transfer activity reader.
//
// Pulls Transfer / TransferSingle / TransferBatch logs touching the
// holder and decodes them into a uniform `TokenActivityRow` shape the
// Activity page can render alongside LYTH transfers.
//
// Two queries per `Transfer` topic (in + out) + two per ERC-1155
// topic gives 6 parallel eth_getLogs calls, same shape as token
// discovery (Commit 5). The cursor-based incremental variant lands in
// Commit 16; this commit ships the one-shot N-block scan.

import { AbiCoder } from "ethers";
import { getProvider } from "./client";
import { capture, type RpcOutcome } from "./live";
import {
  computeScanWindow,
  readdesktop MCP client,
  writedesktop MCP client,
} from "./log-cursor";
import {
  TOPIC_TRANSFER,
  TOPIC_TRANSFER_BATCH,
  TOPIC_TRANSFER_SINGLE,
} from "./token-discovery";

const ABI = AbiCoder.defaultAbiCoder();

// ─── Public types ──────────────────────────────────────────────────

export type TokenActivityKind = "erc20" | "erc721" | "erc1155";
export type TokenActivityDirection = "in" | "out" | "self";

export interface TokenActivityRow {
  /** Block height the log was mined in. */
  blockNumber: bigint;
  /** Transaction hash carrying the log. */
  txHash: string;
  /** Log index within the block — used as a stable sort key tiebreaker. */
  logIndex: number;
  /** Contract address (lowercased). */
  contract: string;
  kind: TokenActivityKind;
  direction: TokenActivityDirection;
  /** Counterparty address (the `from` or `to` we didn't match on). */
  counterparty: string;
  /** Raw amount as uint256 — ERC-721 borrows the field for tokenId. */
  amount: bigint;
  /** ERC-721 tokenId — `null` for ERC-20. ERC-1155 carries it separately. */
  tokenId: bigint | null;
}

export interface TokenActivityOptions {
  fromBlock?: bigint;
  toBlock?: bigint | "latest";
  /** Maximum rows to return. Default 50. */
  limit?: number;
}

// ─── Reader ────────────────────────────────────────────────────────

/**
 * Scan transfer event logs touching `holder`. Returns rows sorted
 * newest-first. Default window: latest - 100_000 blocks.
 */
export async function loadTokenActivity(
  holder: string,
  options: TokenActivityOptions = {},
): Promise<RpcOutcome<TokenActivityRow[]>> {
  const provider = getProvider();
  const client = provider.rpcClient;
  let fromBlock: bigint;
  let latestBlock: bigint | undefined;
  let priorRows: TokenActivityRow[] = [];
  if (options.fromBlock !== undefined) {
    fromBlock = options.fromBlock;
  } else {
    const latestOut = await capture(() => client.ethBlockNumber());
    if (!latestOut.ok || typeof latestOut.value !== "bigint") {
      return { ok: false, error: latestOut.error ?? "ethBlockNumber failed" };
    }
    latestBlock = latestOut.value;
    const window = computeScanWindow({
      scope: "activity",
      holder,
      latestBlock,
      defaultLookback: 100_000n,
    });
    fromBlock = window.fromBlock;
    if (window.isIncremental) {
      const prior = readdesktop MCP client<SerializedActivityRow[]>("activity", holder);
      priorRows = (prior?.payload ?? []).map(deserializeRow);
    }
  }
  const blockHexFrom = "0x" + fromBlock.toString(16);
  const blockHexTo =
    options.toBlock === undefined || options.toBlock === "latest"
      ? "latest"
      : "0x" + options.toBlock.toString(16);

  const holderTopic = "0x" + holder.toLowerCase().slice(2).padStart(64, "0");
  const queries = [
    { topics: [TOPIC_TRANSFER, holderTopic, null], dir: "out" as const },
    { topics: [TOPIC_TRANSFER, null, holderTopic], dir: "in" as const },
    {
      topics: [TOPIC_TRANSFER_SINGLE, null, holderTopic, null],
      dir: "out" as const,
    },
    {
      topics: [TOPIC_TRANSFER_SINGLE, null, null, holderTopic],
      dir: "in" as const,
    },
    {
      topics: [TOPIC_TRANSFER_BATCH, null, holderTopic, null],
      dir: "out" as const,
    },
    {
      topics: [TOPIC_TRANSFER_BATCH, null, null, holderTopic],
      dir: "in" as const,
    },
  ];

  const results = await Promise.all(
    queries.map((q) =>
      capture(() =>
        client.call<RawLog[]>("eth_getLogs", [
          {
            fromBlock: blockHexFrom,
            toBlock: blockHexTo,
            topics: q.topics,
          },
        ]),
      ),
    ),
  );

  const rows: TokenActivityRow[] = [];
  for (let i = 0; i < queries.length; i += 1) {
    const r = results[i];
    const q = queries[i];
    if (!r?.ok || !q || !Array.isArray(r.value)) continue;
    for (const log of r.value) {
      const decoded = decodeLog(log, q.dir, holder);
      if (decoded) rows.push(decoded);
    }
  }
  // Merge in the cursor's prior payload (incremental scans only re-fetch
  // blocks since the cursor; the older rows live in the cursor payload).
  rows.push(...priorRows);

  // Deduplicate by (txHash, logIndex) — a self-transfer touches both
  // `from` and `to` queries; the cursor merge can also duplicate.
  const seen = new Set<string>();
  const deduped: TokenActivityRow[] = [];
  for (const row of rows) {
    const key = `${row.txHash}:${row.logIndex}`;
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(row);
  }
  // Sort newest first.
  deduped.sort((a, b) => {
    if (a.blockNumber !== b.blockNumber) {
      return a.blockNumber > b.blockNumber ? -1 : 1;
    }
    return b.logIndex - a.logIndex;
  });
  // Persist the cursor — cap the cached payload to the most recent
  // 200 rows so localStorage doesn't bloat across long-running wallets.
  if (latestBlock !== undefined) {
    writedesktop MCP client<SerializedActivityRow[]>("activity", holder, {
      lastBlock: latestBlock,
      scannedAtMs: Date.now(),
      payload: deduped.slice(0, 200).map(serializeRow),
    });
  }
  const limit = options.limit ?? 50;
  return { ok: true, value: deduped.slice(0, limit) };
}

// ─── desktop MCP client (de)serialization ─────────────────────────────────────
// `TokenActivityRow` carries bigints which JSON can't round-trip;
// the cursor payload stores them as strings.

interface SerializedActivityRow {
  blockNumber: string;
  txHash: string;
  logIndex: number;
  contract: string;
  kind: TokenActivityKind;
  direction: TokenActivityDirection;
  counterparty: string;
  amount: string;
  tokenId: string | null;
}

function serializeRow(row: TokenActivityRow): SerializedActivityRow {
  return {
    blockNumber: row.blockNumber.toString(),
    txHash: row.txHash,
    logIndex: row.logIndex,
    contract: row.contract,
    kind: row.kind,
    direction: row.direction,
    counterparty: row.counterparty,
    amount: row.amount.toString(),
    tokenId: row.tokenId === null ? null : row.tokenId.toString(),
  };
}

function deserializeRow(row: SerializedActivityRow): TokenActivityRow {
  return {
    blockNumber: BigInt(row.blockNumber),
    txHash: row.txHash,
    logIndex: row.logIndex,
    contract: row.contract,
    kind: row.kind,
    direction: row.direction,
    counterparty: row.counterparty,
    amount: BigInt(row.amount),
    tokenId: row.tokenId === null ? null : BigInt(row.tokenId),
  };
}

// ─── Decoder ───────────────────────────────────────────────────────

interface RawLog {
  address?: string;
  topics?: string[];
  data?: string;
  blockNumber?: string;
  transactionHash?: string;
  logIndex?: string | number;
}

function decodeLog(
  log: RawLog,
  expectedDir: "in" | "out",
  holder: string,
): TokenActivityRow | null {
  if (typeof log.address !== "string") return null;
  if (!Array.isArray(log.topics) || log.topics.length === 0) return null;
  const topic0 = log.topics[0];
  const txHash = log.transactionHash ?? "0x";
  const blockNumber = log.blockNumber ? BigInt(log.blockNumber) : 0n;
  const logIndex = typeof log.logIndex === "string"
    ? Number.parseInt(log.logIndex, 16)
    : typeof log.logIndex === "number"
      ? log.logIndex
      : 0;
  const contract = log.address.toLowerCase();
  const holderLc = holder.toLowerCase();

  if (topic0 === TOPIC_TRANSFER) {
    // ERC-20 or ERC-721. ERC-721 has 4 topics (indexed tokenId).
    const isErc721 = log.topics.length >= 4;
    const fromTopic = log.topics[1];
    const toTopic = log.topics[2];
    if (!fromTopic || !toTopic) return null;
    const from = "0x" + fromTopic.slice(-40).toLowerCase();
    const to = "0x" + toTopic.slice(-40).toLowerCase();
    let direction: TokenActivityDirection;
    if (from === holderLc && to === holderLc) direction = "self";
    else if (from === holderLc) direction = "out";
    else direction = "in";
    // Drop rows that don't match the expected direction for this query
    // (avoid double-counting; the dedup pass also handles this).
    if (direction !== "self" && direction !== expectedDir) return null;
    const counterparty = direction === "out" || direction === "self" ? to : from;
    let amount = 0n;
    let tokenId: bigint | null = null;
    if (isErc721) {
      const tokenIdTopic = log.topics[3];
      if (!tokenIdTopic) return null;
      tokenId = BigInt(tokenIdTopic);
    } else if (log.data && log.data !== "0x") {
      try {
        const [v] = ABI.decode(["uint256"], log.data);
        amount = BigInt(v as bigint | string | number);
      } catch {
        amount = 0n;
      }
    }
    return {
      blockNumber,
      txHash,
      logIndex,
      contract,
      kind: isErc721 ? "erc721" : "erc20",
      direction,
      counterparty,
      amount,
      tokenId,
    };
  }

  if (topic0 === TOPIC_TRANSFER_SINGLE) {
    // TransferSingle(operator, from, to, id, value)
    const fromTopic = log.topics[2];
    const toTopic = log.topics[3];
    if (!fromTopic || !toTopic) return null;
    const from = "0x" + fromTopic.slice(-40).toLowerCase();
    const to = "0x" + toTopic.slice(-40).toLowerCase();
    let direction: TokenActivityDirection;
    if (from === holderLc && to === holderLc) direction = "self";
    else if (from === holderLc) direction = "out";
    else direction = "in";
    if (direction !== "self" && direction !== expectedDir) return null;
    const counterparty = direction === "out" || direction === "self" ? to : from;
    let tokenId = 0n;
    let amount = 0n;
    if (log.data && log.data !== "0x") {
      try {
        const [id, value] = ABI.decode(["uint256", "uint256"], log.data);
        tokenId = BigInt(id as bigint | string | number);
        amount = BigInt(value as bigint | string | number);
      } catch {
        // ignore
      }
    }
    return {
      blockNumber,
      txHash,
      logIndex,
      contract,
      kind: "erc1155",
      direction,
      counterparty,
      amount,
      tokenId,
    };
  }

  if (topic0 === TOPIC_TRANSFER_BATCH) {
    // TransferBatch(operator, from, to, ids[], values[])
    // We collapse the batch to a single row with amount = sum(values)
    // and tokenId = first id (UI can drill in via the tx hash).
    const fromTopic = log.topics[2];
    const toTopic = log.topics[3];
    if (!fromTopic || !toTopic) return null;
    const from = "0x" + fromTopic.slice(-40).toLowerCase();
    const to = "0x" + toTopic.slice(-40).toLowerCase();
    let direction: TokenActivityDirection;
    if (from === holderLc && to === holderLc) direction = "self";
    else if (from === holderLc) direction = "out";
    else direction = "in";
    if (direction !== "self" && direction !== expectedDir) return null;
    const counterparty = direction === "out" || direction === "self" ? to : from;
    let tokenId: bigint | null = null;
    let amount = 0n;
    if (log.data && log.data !== "0x") {
      try {
        const [ids, values] = ABI.decode(["uint256[]", "uint256[]"], log.data);
        const idArr = ids as Array<bigint | string | number>;
        const valArr = values as Array<bigint | string | number>;
        if (idArr.length > 0) tokenId = BigInt(idArr[0] as bigint | string | number);
        amount = valArr.reduce<bigint>((acc, v) => acc + BigInt(v), 0n);
      } catch {
        // ignore
      }
    }
    return {
      blockNumber,
      txHash,
      logIndex,
      contract,
      kind: "erc1155",
      direction,
      counterparty,
      amount,
      tokenId,
    };
  }
  return null;
}
