// Token discovery via Transfer-event log scan.
//
// EVM Transfer events let us discover every token contract a user has
// touched without enumerating the entire chain. The three event
// signatures we care about:
//
//   ERC-20  / ERC-721:   Transfer(address indexed from, address indexed to, uint256 [indexed?] value/tokenId)
//   ERC-1155:            TransferSingle(address indexed operator, address indexed from, address indexed to, uint256 id, uint256 value)
//                        TransferBatch (address indexed operator, address indexed from, address indexed to, uint256[] ids, uint256[] values)
//
// ERC-20 and ERC-721 share the `Transfer` topic. The third arg
// distinguishes: ERC-20 emits `value` as non-indexed (logs have 3
// topics), ERC-721 emits `tokenId` as indexed (logs have 4 topics).
//
// We scan in two queries (one for the user's `from`, one for `to`)
// per topic to catch both in- and out-transfers. De-duplicate by
// contract address; classify by topic count + secondary verification
// (supportsErc721 for the borderline 4-topic case) is optional —
// we trust the topic-count heuristic for the initial pass.
//
// Cache: 5-minute LRU on (holder, fromBlock) → discovered list, in
// localStorage (matches Phase 3 contacts pattern). Persistence here
// is fine because the data is non-secret and reduces repeat scans
// across mounts.

import { keccak256, toUtf8Bytes, zeroPadValue } from "ethers";
import { getProvider } from "./client";
import { capture, type RpcOutcome } from "./live";
import {
  cleardesktop MCP client,
  computeScanWindow,
  readdesktop MCP client,
  writedesktop MCP client,
} from "./log-cursor";

// ─── Topic hashes ──────────────────────────────────────────────────

/** keccak256("Transfer(address,address,uint256)") — shared by ERC-20 + ERC-721. */
export const TOPIC_TRANSFER = keccak256(
  toUtf8Bytes("Transfer(address,address,uint256)"),
);

/** keccak256("TransferSingle(address,address,address,uint256,uint256)") — ERC-1155. */
export const TOPIC_TRANSFER_SINGLE = keccak256(
  toUtf8Bytes("TransferSingle(address,address,address,uint256,uint256)"),
);

/** keccak256("TransferBatch(address,address,address,uint256[],uint256[])") — ERC-1155. */
export const TOPIC_TRANSFER_BATCH = keccak256(
  toUtf8Bytes("TransferBatch(address,address,address,uint256[],uint256[])"),
);

// ─── Public types ──────────────────────────────────────────────────

export type TokenKind = "erc20" | "erc721" | "erc1155";

export interface DiscoveredToken {
  contract: string;
  kind: TokenKind;
}

export interface DiscoverOptions {
  /** Earliest block to scan from. Defaults to `latest - 100_000`. */
  fromBlock?: bigint;
  /** Latest block to scan to. Defaults to "latest". */
  toBlock?: bigint | "latest";
  /** Pass `false` to bypass the localStorage cache (e.g. manual refresh). */
  useCache?: boolean;
}

// ─── Cache ─────────────────────────────────────────────────────────

const CACHE_KEY_PREFIX = "mono.discovered.v1.";
const CACHE_TTL_MS = 5 * 60 * 1000;

interface CacheEntry {
  cachedAtMs: number;
  fromBlock: string;
  tokens: DiscoveredToken[];
}

function cacheKey(holder: string): string {
  return CACHE_KEY_PREFIX + holder.toLowerCase();
}

function readCache(holder: string): CacheEntry | null {
  try {
    const raw = localStorage.getItem(cacheKey(holder));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as CacheEntry;
    if (
      typeof parsed.cachedAtMs !== "number" ||
      typeof parsed.fromBlock !== "string" ||
      !Array.isArray(parsed.tokens)
    ) {
      return null;
    }
    if (Date.now() - parsed.cachedAtMs >= CACHE_TTL_MS) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

function writeCache(holder: string, entry: CacheEntry): void {
  try {
    localStorage.setItem(cacheKey(holder), JSON.stringify(entry));
  } catch {
    // localStorage may be unavailable / quota-exceeded — fail soft.
  }
}

/** Test-only. Production never calls this. */
export function _resetDiscoveryCacheForTest(): void {
  try {
    const keysToDrop: string[] = [];
    for (let i = 0; i < localStorage.length; i += 1) {
      const k = localStorage.key(i);
      if (k && k.startsWith(CACHE_KEY_PREFIX)) keysToDrop.push(k);
    }
    for (const k of keysToDrop) localStorage.removeItem(k);
  } catch {
    // ignore
  }
}

// ─── Public API ────────────────────────────────────────────────────

/**
 * Scan event logs to discover every token contract `holder` has
 * touched within the window. Returns a deduplicated list with each
 * contract's kind classified.
 *
 * The disambiguation: a `Transfer` log with 4 topics (from, to,
 * tokenId) is ERC-721; with 3 topics (from, to + non-indexed value)
 * is ERC-20. TransferSingle / TransferBatch with the canonical topic0
 * are ERC-1155.
 */
export async function discoverTokens(
  holder: string,
  options: DiscoverOptions = {},
): Promise<RpcOutcome<DiscoveredToken[]>> {
  const useCache = options.useCache !== false;
  // Force-rescan path clears the persisted cursor + cache so the next
  // pass scans the full default window.
  if (!useCache) {
    cleardesktop MCP client("discovery", holder);
  }
  if (useCache) {
    const cached = readCache(holder);
    if (cached) return { ok: true, value: cached.tokens };
  }

  const provider = getProvider();
  const client = provider.rpcClient;

  // Resolve scan window. Caller-provided `fromBlock` wins; otherwise
  // we consult the persisted cursor — incremental scans only ask the
  // RPC about blocks since the last successful fetch.
  let fromBlock: bigint;
  let latestBlock: bigint | undefined;
  let isIncremental = false;
  let priorTokens: DiscoveredToken[] = [];
  if (options.fromBlock !== undefined) {
    fromBlock = options.fromBlock;
  } else {
    const latestOut = await capture(() => client.ethBlockNumber());
    if (!latestOut.ok || typeof latestOut.value !== "bigint") {
      return { ok: false, error: latestOut.error ?? "ethBlockNumber failed" };
    }
    latestBlock = latestOut.value;
    const window = computeScanWindow({
      scope: "discovery",
      holder,
      latestBlock,
      defaultLookback: 100_000n,
    });
    fromBlock = window.fromBlock;
    isIncremental = window.isIncremental;
    if (isIncremental) {
      const prior = readdesktop MCP client<DiscoveredToken[]>("discovery", holder);
      priorTokens = prior?.payload ?? [];
    }
  }
  const toBlock = options.toBlock ?? "latest";

  const holderTopic = zeroPadValue(holder.toLowerCase(), 32);

  // Four queries in parallel: Transfer-from, Transfer-to,
  // TransferSingle-touching-holder (in either operator/from/to slot),
  // TransferBatch-touching-holder.
  const queries = [
    // ERC-20 + ERC-721 outgoing
    { topics: [TOPIC_TRANSFER, holderTopic, null] },
    // ERC-20 + ERC-721 incoming
    { topics: [TOPIC_TRANSFER, null, holderTopic] },
    // ERC-1155 single — from slot
    { topics: [TOPIC_TRANSFER_SINGLE, null, holderTopic, null] },
    // ERC-1155 single — to slot
    { topics: [TOPIC_TRANSFER_SINGLE, null, null, holderTopic] },
    // ERC-1155 batch — from slot
    { topics: [TOPIC_TRANSFER_BATCH, null, holderTopic, null] },
    // ERC-1155 batch — to slot
    { topics: [TOPIC_TRANSFER_BATCH, null, null, holderTopic] },
  ];

  const blockHexFrom = "0x" + fromBlock.toString(16);
  const blockHexTo = toBlock === "latest" ? "latest" : "0x" + toBlock.toString(16);

  const results = await Promise.all(
    queries.map((q) =>
      capture(() =>
        client.call<LogRow[]>("eth_getLogs", [
          {
            fromBlock: blockHexFrom,
            toBlock: blockHexTo,
            topics: q.topics,
          },
        ]),
      ),
    ),
  );

  const discovered = new Map<string, TokenKind>();
  // First two queries are ERC-20/721 Transfer events.
  for (let i = 0; i < 2; i += 1) {
    const r = results[i];
    if (!r?.ok || !Array.isArray(r.value)) continue;
    for (const log of r.value) {
      if (typeof log.address !== "string") continue;
      const addr = log.address.toLowerCase();
      // ERC-721: 4 topics (event sig + 3 indexed args)
      // ERC-20:  3 topics (event sig + 2 indexed args)
      const kind: TokenKind =
        Array.isArray(log.topics) && log.topics.length >= 4 ? "erc721" : "erc20";
      // Promotion rule: if we've already classified this contract as
      // erc721, don't downgrade to erc20 (and vice versa would be a
      // chain bug). Otherwise insert.
      const existing = discovered.get(addr);
      if (existing === undefined) {
        discovered.set(addr, kind);
      } else if (existing !== kind) {
        // Mixed signal — keep the more specific erc721 classification.
        // (Should not happen on well-formed contracts.)
        discovered.set(addr, "erc721");
      }
    }
  }
  // Remaining queries are all ERC-1155.
  for (let i = 2; i < results.length; i += 1) {
    const r = results[i];
    if (!r?.ok || !Array.isArray(r.value)) continue;
    for (const log of r.value) {
      if (typeof log.address !== "string") continue;
      discovered.set(log.address.toLowerCase(), "erc1155");
    }
  }

  // Seed the discovery map with the prior cursor payload so an
  // incremental scan returns the union, not just blocks since cursor.
  for (const prior of priorTokens) {
    if (!discovered.has(prior.contract)) {
      discovered.set(prior.contract, prior.kind);
    }
  }

  const tokens = Array.from(discovered.entries()).map(
    ([contract, kind]): DiscoveredToken => ({ contract, kind }),
  );

  writeCache(holder, {
    cachedAtMs: Date.now(),
    fromBlock: blockHexFrom,
    tokens,
  });

  // Advance the cursor for the next incremental scan. Only do this
  // when we know `latestBlock` (caller didn't override the range).
  if (latestBlock !== undefined) {
    writedesktop MCP client<DiscoveredToken[]>("discovery", holder, {
      lastBlock: latestBlock,
      scannedAtMs: Date.now(),
      payload: tokens,
    });
  }

  return { ok: true, value: tokens };
}

// ─── Internal log shape ────────────────────────────────────────────

interface LogRow {
  address?: string;
  topics?: string[];
  blockNumber?: string;
  transactionHash?: string;
  data?: string;
}
