import {
  addressToTypedBech32,
  ApiClient,
  CLAIMED_EVENT_TOPIC0,
  decodeClaimedEvent,
  formatLyth,
} from "@monolythium/core-sdk";
import type {
  ApiCapabilitiesResponse,
  ApiEnvelope,
  ApiHealthResponse,
  ApiQueryValue,
  ApiStreamsIndexResponse,
  ChainStatsResponse,
  CirculatingSupplyResponse,
  ClobMarketsResponse,
  ClobOrderBookResponse,
  ClobTradesResponse,
  NativeMarketStateResponse,
  PrecompileCatalogueResponse,
  TotalBurnedResponse,
} from "@monolythium/core-sdk";
import { withSigningBackend } from "./signing-backend";
import { getProvider } from "./client";
import { isMethodDisabled, METHOD_UNAVAILABLE_LABEL } from "./rpc-availability";
import { getNativeTransactionCount } from "./native-rpc";
import { requireTypedUserAddress, requireTypedUserAddressHex } from "./address";
import { selectNativeSpotMarket, type SelectedNativeSpotMarket } from "./market";
import { walletFetch } from "./http";
import {
  earliestRetainedFrom,
  normaliseActivityCoverageKind,
  type ActivityCoverageKind,
} from "./activity-coverage";
import { NATIVE_LYTH_TOKEN_ID } from "./lyth-display";

export interface RpcOutcome<T> {
  ok: boolean;
  value?: T;
  error?: string;
}

export interface LiveNetworkStatus {
  endpoint: string;
  chainId: RpcOutcome<bigint>;
  blockHeight: RpcOutcome<bigint>;
  peerCount: RpcOutcome<bigint>;
  listening: RpcOutcome<boolean>;
  clientVersion: RpcOutcome<string>;
  syncing: RpcOutcome<unknown>;
  chainStats: RpcOutcome<ChainStatsResponse>;
  currentRound: RpcOutcome<{ height: bigint }>;
  syncStatus: RpcOutcome<unknown | null>;
  indexerStatus: RpcOutcome<unknown | null>;
  mempoolStatus: RpcOutcome<unknown>;
  activePrecompiles: RpcOutcome<Array<{ name: string; address: string; gateable: boolean; enabled: boolean }>>;
}

export interface LiveClusterRow {
  clusterId: number;
  size: number;
  threshold: number;
  aggregateHealth: string;
  regionDiversity: string[] | null;
  active: boolean;
}

export interface LiveDelegationStatus {
  endpoint: string;
  clusters: RpcOutcome<LiveClusterRow[]>;
  activeClusters: RpcOutcome<LiveClusterRow[]>;
  healthyClusters: RpcOutcome<LiveClusterRow[]>;
  delegationCap: RpcOutcome<unknown>;
  delegations: RpcOutcome<{ wallet: string; rows: Array<{ cluster: number; weightBps: number }>; totalBps: number; block: unknown }>;
  delegationHistory: RpcOutcome<Array<{ blockHeight: bigint; txIndex: number; logIndex: number; cluster: number; toCluster: number | null; kind: string; weightBps: number; walletTotalBps: number | null }>>;
}

export interface LiveTokenStatus {
  endpoint: string;
  nativeBalance: RpcOutcome<string>;
  /** Raw native balance as an exact lythoshi integer string — the same
   *  `eth_getBalance` read `nativeBalance` formats, kept un-converted so a
   *  caller can format it at its own precision via the exact bigint formatter
   *  (never re-truncating a float-tailed decimal). */
  nativeBalanceLythoshi: RpcOutcome<string>;
  tokenBalances: RpcOutcome<
    Array<{
      tokenId: string;
      balance: string;
      updatedAtBlock: bigint;
      /** Native MRC identity when the row came from a native MRC event — the
       *  `assetId` keys the per-token `lyth_mrcMetadata` (decimals/symbol) read.
       *  For factory-origin MRC-20 the assetId equals the tokenId. */
      mrc?: { standard: string; assetId: string; tokenId?: string | null } | null;
    }>
  >;
  addressLabel: RpcOutcome<{ address: string; category: string; displayName: string | null; updatedAtBlock: bigint } | null>;
  assetPolicy: RpcOutcome<Record<string, unknown>>;
}

export interface LiveTradeStatus {
  endpoint: string;
  apiBaseUrl: string;
  activePrecompiles: RpcOutcome<PrecompileCatalogueResponse>;
  nativeMarketState: RpcOutcome<NativeMarketStateResponse>;
  clobMarkets: RpcOutcome<ClobMarketsResponse>;
  clobOrderBook: RpcOutcome<ClobOrderBookResponse>;
  clobTrades: RpcOutcome<ClobTradesResponse>;
  apiHealth: RpcOutcome<ApiHealthResponse>;
  apiCapabilities: RpcOutcome<ApiCapabilitiesResponse>;
  apiStreams: RpcOutcome<ApiStreamsIndexResponse>;
  orderBookReplay: RpcOutcome<NativeMarketOrderBookReplayResponse>;
  selectedMarket: SelectedNativeSpotMarket | null;
  /** Current block height — the reference point for an order-expiry "in N
   *  blocks" entry. `null` when the head read failed. */
  blockHeight: bigint | null;
}

export interface NativeMarketOrderBookReplayResponse {
  replay: true;
  streamTopic: string;
  deltas: unknown[];
}

export interface LiveAddressActivityRow {
  blockHeight: bigint;
  txIndex: number;
  logIndex: number;
  kind: string;
  direction: string | null;
  counterparty: string | null;
  tokenId: string | null;
  amount: string | null;
  cluster: number | null;
  weightBps: number | null;
  subKind: string | null;
  // Enrichment fields (lyth enrichAddressActivity). Each is honestly null when
  // the chain can't resolve it: the timestamp for old/pruned blocks, the tx
  // hash for rows that aren't the wallet's own tx, the cluster name when the
  // cluster carries no registered name.
  blockTimestampSeconds: bigint | null;
  txHash: string | null;
  clusterName: string | null;
}

export interface LiveWalletIdentity {
  address: string;
  publicKeyHex: string;
  publicKeyBytes: number;
}

export interface LiveWalletBalance {
  address: string;
  nonce: bigint;
  balanceLythoshi: string;
  balanceLyth: string;
}

export async function capture<T>(fn: () => Promise<T>): Promise<RpcOutcome<T>> {
  try {
    return { ok: true, value: await fn() };
  } catch (cause) {
    return { ok: false, error: errorMessage(cause) };
  }
}

export async function loadLiveNetworkStatus(): Promise<LiveNetworkStatus> {
  const client = getProvider().rpcClient;
  const [
    chainId,
    blockHeight,
    peerCount,
    listening,
    clientVersion,
    syncing,
    chainStats,
    currentRound,
    syncStatus,
    indexerStatus,
    mempoolStatus,
    activePrecompiles,
  ] = await Promise.all([
    capture(() => client.ethChainId()),
    capture(() => client.ethBlockNumber()),
    capture(() => client.netPeerCount()),
    capture(() => client.netListening()),
    capture(() => client.web3ClientVersion()),
    capture(() => client.ethSyncing()),
    capture(() => client.lythChainStats()),
    capture(() => client.lythCurrentRound()),
    capture(() => client.lythSyncStatus()),
    capture(() => client.lythIndexerStatus()),
    capture(() => client.lythMempoolStatus()),
    capture(() => client.lythListActivePrecompiles().then((catalogue) => catalogue.precompiles)),
  ]);
  return {
    endpoint: client.endpoint,
    chainId,
    blockHeight,
    peerCount,
    listening,
    clientVersion,
    syncing,
    chainStats,
    currentRound,
    syncStatus,
    indexerStatus,
    mempoolStatus,
    activePrecompiles,
  };
}

export async function loadLiveDelegationStatus(wallet: string): Promise<LiveDelegationStatus> {
  const client = getProvider().rpcClient;
  const typedWallet = requireTypedUserAddress(wallet, "wallet");
  const clusterPage = await capture(() => client.lythClusterDirectory(0, 100));
  const clusterRows = clusterPage.ok ? clusterPage.value?.clusters ?? [] : [];
  const activeClusterRows = clusterRows.filter((cluster) => cluster.active);
  const healthyClusterRows = activeClusterRows.filter((cluster) => cluster.aggregateHealth === "ok");
  const [delegationCap, delegations, delegationHistory] = await Promise.all([
    capture(() => client.lythGetDelegationCap()),
    capture(() => client.lythGetDelegations(typedWallet)),
    capture(() => client.lythGetDelegationHistory(typedWallet, 25)),
  ]);
  return {
    endpoint: client.endpoint,
    clusters: clusterPage.ok ? { ok: true, value: clusterRows } : { ok: false, error: clusterPage.error },
    activeClusters: clusterPage.ok ? { ok: true, value: activeClusterRows } : { ok: false, error: clusterPage.error },
    healthyClusters: clusterPage.ok ? { ok: true, value: healthyClusterRows } : { ok: false, error: clusterPage.error },
    delegationCap,
    delegations,
    delegationHistory,
  };
}

export async function loadLiveTokenStatus(wallet: string): Promise<LiveTokenStatus> {
  const client = getProvider().rpcClient;
  const typedWallet = requireTypedUserAddress(wallet, "wallet");
  const walletHex = requireTypedUserAddressHex(wallet, "wallet");
  const [nativeBalanceLythoshi, tokenBalances, addressLabel, assetPolicy] = await Promise.all([
    capture(async () => {
      const result = await client.ethGetBalance(walletHex);
      return BigInt(normalizeBalanceHex(result)).toString();
    }),
    capture(() => client.lythGetTokenBalances(typedWallet)),
    capture(() => client.lythGetAddressLabel(typedWallet)),
    // The chain keys the asset-policy read by 32-byte token id, not the ticker;
    // native LYTH is the all-zero id. Passing "LYTH" -32602s on every call.
    capture(
      () => client.lythGetAssetPolicy(NATIVE_LYTH_TOKEN_ID) as Promise<Record<string, unknown>>,
    ),
  ]);
  // Formatted (full-precision) LYTH for existing consumers, derived from the
  // raw lythoshi so both share the one `eth_getBalance` read and can't diverge.
  const nativeBalance: RpcOutcome<string> = nativeBalanceLythoshi.ok
    ? { ok: true, value: formatLyth(nativeBalanceLythoshi.value ?? "0", { includeUnit: false }) }
    : nativeBalanceLythoshi;
  return {
    endpoint: client.endpoint,
    nativeBalance,
    nativeBalanceLythoshi,
    tokenBalances,
    addressLabel,
    assetPolicy,
  };
}

export async function loadLiveTradeStatus(): Promise<LiveTradeStatus> {
  const client = getProvider().rpcClient;
  const api = new ApiClient(client.endpoint, { fetch: walletFetch });
  const [
    activePrecompiles,
    nativeMarketState,
    clobMarkets,
    apiHealth,
    apiCapabilities,
    apiStreams,
    blockHeight,
  ] = await Promise.all([
    capture(() => client.lythListActivePrecompiles()),
    capture(() => client.lythNativeMarketState({ includeSpotOrders: false, limit: 25 })),
    capture(() => client.lythClobMarkets(25)),
    capture(() => api.health()),
    capture(() => api.capabilities()),
    capture(() => api.streams()),
    capture(() => client.ethBlockNumber()),
  ]);

  const selectedMarket = selectNativeSpotMarket(
    nativeMarketState.ok ? nativeMarketState.value : null,
    clobMarkets.ok ? clobMarkets.value?.markets : null,
  );

  const clobOrderBook: RpcOutcome<ClobOrderBookResponse> = selectedMarket
    ? await capture(() => client.lythClobOrderBook(selectedMarket.marketId, 20))
    : emptyOutcome("No native spot market is available.");
  const clobTrades: RpcOutcome<ClobTradesResponse> = selectedMarket
    ? await capture(() => client.lythClobTrades(selectedMarket.marketId, 20))
    : emptyOutcome("No native spot market is available.");
  const orderBookReplay: RpcOutcome<NativeMarketOrderBookReplayResponse> = selectedMarket && blockHeight.ok
    ? await capture(() =>
        api.get<ApiEnvelope<NativeMarketOrderBookReplayResponse>>("/native-market-orderbook-deltas", nativeMarketOrderBookDeltasQuery({
          fromBlock: blockHeight.value ?? 0n,
          toBlock: blockHeight.value ?? 0n,
          limit: 20,
          marketId: selectedMarket.marketId,
        })).then((response) => response.data),
      )
    : emptyOutcome(blockHeight.ok ? "No native spot market is available." : blockHeight.error ?? "Block height unavailable.");

  return {
    endpoint: client.endpoint,
    apiBaseUrl: api.baseUrl,
    activePrecompiles,
    nativeMarketState,
    clobMarkets,
    clobOrderBook,
    clobTrades,
    apiHealth,
    apiCapabilities,
    apiStreams,
    orderBookReplay,
    selectedMarket,
    blockHeight: blockHeight.ok ? blockHeight.value ?? null : null,
  };
}

/** Rows per page — the initial read AND every older page. */
export const ACTIVITY_PAGE_SIZE = 30;

/** One page of address activity plus the cursor for the next (older) page. */
export interface ActivityPage {
  rows: LiveAddressActivityRow[];
  /** Opaque `0x` keyset string, round-tripped verbatim. Null = no more pages. */
  nextCursor: string | null;
}

/**
 * Pull the next-page cursor out of the activity envelope.
 *
 * The cursor is an OPAQUE `0x`-prefixed keyset string — the wallet never parses
 * or constructs one, it only round-trips it. Tolerant: absent, non-string, or
 * malformed yields null (treated as "no more pages"), which degrades to today's
 * single-page behaviour rather than paging into nonsense. Pure.
 */
export function activityCursorFrom(raw: unknown): string | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const cursor = (raw as Record<string, unknown>).nextCursor;
  if (typeof cursor !== "string") return null;
  const trimmed = cursor.trim();
  if (trimmed === "" || !trimmed.startsWith("0x")) return null;
  return trimmed;
}

/**
 * One page of activity. `cursor` absent = the newest page.
 *
 * Rows are re-sliced to `ACTIVITY_PAGE_SIZE` client-side BEFORE mapping, so a
 * misbehaving operator cannot grow wallet memory by over-answering.
 */
export async function loadLiveActivityPage(
  wallet: string,
  cursor?: string,
): Promise<RpcOutcome<ActivityPage>> {
  return capture(async () => {
    // Validated INSIDE capture: a malformed address is an outcome, not a
    // rejection — every caller of this reader treats it as a fallible read.
    const typedWallet = requireTypedUserAddress(wallet, "wallet");
    const client = getProvider().rpcClient;
    // The node returns a paginated envelope ({ activity, nextCursor, ... }); read
    // it tolerantly and enrich here. (We do not call the SDK's enrich helper — it
    // assumes a bare array and throws on the envelope.)
    const raw = (await (cursor === undefined
      ? client.lythGetAddressActivity(typedWallet, ACTIVITY_PAGE_SIZE)
      : client.lythGetAddressActivity(typedWallet, ACTIVITY_PAGE_SIZE, cursor))) as unknown;
    const entries = activityEntriesFrom(raw).slice(0, ACTIVITY_PAGE_SIZE);
    const nextCursor = activityCursorFrom(raw);
    if (entries.length === 0) return { rows: [], nextCursor };
    return { rows: await enrichActivityEntries(client, entries), nextCursor };
  });
}

/** The newest page's ROWS only — the long-standing shape every non-paging
 *  consumer (Send familiarity, Home preview, the incoming poller) still uses.
 *  A thin wrapper over {@link loadLiveActivityPage}, so there is exactly one
 *  RPC implementation behind both shapes. */
export async function loadLiveAddressActivity(wallet: string): Promise<RpcOutcome<LiveAddressActivityRow[]>> {
  const page = await loadLiveActivityPage(wallet);
  if (!page.ok) return { ok: false, error: page.error };
  return { ok: true, value: page.value?.rows ?? [] };
}

/** An OLDER page. Read-only and additive by contract: no cache write, no
 *  coverage probe, no incoming detection, no notification write, no pending
 *  reconcile. A transient error surfaces verbatim — it is NEVER masked as
 *  "no more pages", which would silently truncate the user's history. */
export async function loadOlderActivityPage(
  wallet: string,
  cursor: string,
): Promise<RpcOutcome<ActivityPage>> {
  return loadLiveActivityPage(wallet, cursor);
}

/** Normalize the node's address-activity response to the raw entry array. The
 *  node returns a paginated envelope (`{ activity, nextCursor, schemaVersion }`);
 *  a bare array or an `{ entries }` envelope are also accepted. Anything
 *  unrecognized — or an empty result — yields `[]`, so the caller never maps a
 *  non-array. Pure. */
export function activityEntriesFrom(raw: unknown): unknown[] {
  if (Array.isArray(raw)) return raw;
  if (raw !== null && typeof raw === "object") {
    const r = raw as Record<string, unknown>;
    if (Array.isArray(r.activity)) return r.activity;
    if (Array.isArray(r.entries)) return r.entries;
  }
  return [];
}

/** Coerce a node block height / timestamp (number, decimal or 0x-hex string, or
 *  bigint) to a bigint; `null` on anything unparseable. Pure. */
export function toBlockBigInt(v: unknown): bigint | null {
  try {
    if (v === null || v === undefined || v === "") return null;
    if (typeof v === "bigint") return v;
    if (typeof v === "number") return Number.isFinite(v) ? BigInt(Math.trunc(v)) : null;
    if (typeof v === "string") return BigInt(v);
  } catch {
    return null;
  }
  return null;
}

/** Map one raw node activity entry onto the wallet's row shape (enrichment
 *  fields null — filled by {@link enrichActivityEntries}). Returns `null` for an
 *  entry without a usable block height, so a malformed row is dropped rather than
 *  breaking the feed. Pure. */
export function toActivityBaseRow(raw: unknown): LiveAddressActivityRow | null {
  if (raw === null || typeof raw !== "object") return null;
  const e = raw as Record<string, unknown>;
  const blockHeight = toBlockBigInt(e.blockHeight);
  if (blockHeight === null) return null;
  const int = (v: unknown): number =>
    typeof v === "number" && Number.isFinite(v) ? v : 0;
  const intOrNull = (v: unknown): number | null =>
    typeof v === "number" && Number.isFinite(v) ? v : null;
  const strOrNull = (v: unknown): string | null => (typeof v === "string" ? v : null);
  return {
    blockHeight,
    txIndex: int(e.txIndex),
    logIndex: int(e.logIndex),
    kind: typeof e.kind === "string" ? e.kind : "",
    direction: strOrNull(e.direction),
    counterparty: strOrNull(e.counterparty),
    tokenId: strOrNull(e.tokenId),
    amount: strOrNull(e.amount),
    cluster: intOrNull(e.cluster),
    weightBps: intOrNull(e.weightBps),
    subKind: strOrNull(e.subKind),
    blockTimestampSeconds: null,
    txHash: null,
    clusterName: null,
  };
}

/** Probe the indexer's coverage for an address (`lyth_addressActivityKind`) so an
 *  empty feed can say WHY it's empty — nothing indexed yet, the indexer off, the
 *  window pruned — instead of a single generic line. Falls back to "not_found"
 *  (the historical "no activity yet" copy) on any read failure or a node that
 *  lacks the method, so a probe failure never alarms the user or regresses the
 *  empty state. */
export async function loadAddressActivityKind(
  wallet: string,
): Promise<ActivityCoverage> {
  try {
    const typedWallet = requireTypedUserAddress(wallet, "wallet");
    const res = (await getProvider().rpcClient.lythAddressActivityKind(
      typedWallet,
    )) as unknown as { kind?: unknown };
    return {
      kind: normaliseActivityCoverageKind(res.kind as string),
      earliestRetained: earliestRetainedFrom(res),
    };
  } catch {
    // Fail-safe: never alarm on a probe failure.
    return { kind: "not_found", earliestRetained: null };
  }
}

/** The coverage probe's answer: why the feed is empty, plus the retention floor
 *  when the indexer reports one. */
export interface ActivityCoverage {
  kind: ActivityCoverageKind;
  earliestRetained: string | null;
}

/** Read a block's header timestamp + ordered tx-hash array via the raw
 *  `eth_getBlockByNumber` (hash-only). Best-effort — any failure degrades to
 *  `{ null, [] }` so enrichment never breaks the feed. */
async function blockTimeAndTxHashes(
  client: ReturnType<typeof getProvider>["rpcClient"],
  height: bigint,
): Promise<{ timestampSeconds: bigint | null; txHashes: string[] }> {
  try {
    const raw = (await client.call("eth_getBlockByNumber", [
      `0x${height.toString(16)}`,
      false,
    ])) as Record<string, unknown> | null;
    if (!raw || typeof raw !== "object") return { timestampSeconds: null, txHashes: [] };
    const txs = raw["transactions"];
    return {
      timestampSeconds: toBlockBigInt(raw["timestamp"]),
      txHashes: Array.isArray(txs)
        ? txs.filter((t): t is string => typeof t === "string")
        : [],
    };
  } catch {
    return { timestampSeconds: null, txHashes: [] };
  }
}

/** Enrich raw activity entries with each row's block timestamp, canonical tx
 *  hash (resolved from `(blockHeight, txIndex)`), and resolved cluster name —
 *  one block read per distinct height, one name read per distinct cluster. Each
 *  enrichment is best-effort (null on failure); honest absence, never a throw. */
async function enrichActivityEntries(
  client: ReturnType<typeof getProvider>["rpcClient"],
  entries: ReadonlyArray<unknown>,
): Promise<LiveAddressActivityRow[]> {
  const base = entries
    .map(toActivityBaseRow)
    .filter((r): r is LiveAddressActivityRow => r !== null);

  const heights = [...new Set(base.map((r) => r.blockHeight))];
  const blockByHeight = new Map<
    bigint,
    { timestampSeconds: bigint | null; txHashes: string[] }
  >();
  await Promise.all(
    heights.map(async (h) => {
      blockByHeight.set(h, await blockTimeAndTxHashes(client, h));
    }),
  );

  const clusters = [
    ...new Set(base.map((r) => r.cluster).filter((c): c is number => c != null)),
  ];
  const nameByCluster = new Map<number, string | null>();
  await Promise.all(
    clusters.map(async (c) => {
      try {
        nameByCluster.set(c, (await client.lythGetClusterName(c)).name ?? null);
      } catch {
        nameByCluster.set(c, null);
      }
    }),
  );

  return base.map((r) => {
    const block = blockByHeight.get(r.blockHeight);
    const txHash =
      block && r.txIndex >= 0 && r.txIndex < block.txHashes.length
        ? block.txHashes[r.txIndex]!
        : null;
    return {
      ...r,
      blockTimestampSeconds: block?.timestampSeconds ?? null,
      txHash,
      clusterName: r.cluster != null ? nameByCluster.get(r.cluster) ?? null : null,
    };
  });
}

export interface LiveSupplyStatus {
  endpoint: string;
  circulatingSupply: RpcOutcome<CirculatingSupplyResponse>;
  totalBurned: RpcOutcome<TotalBurnedResponse>;
}

/** Native LYTH supply stats — circulating supply (with initial supply +
 *  cumulative burned) and total burned. Both are real chain reads; amounts are
 *  decimal lythoshi strings the caller formats via `formatLyth`. A failed read
 *  surfaces the verbatim node error so the page can fall back to "—". */
export async function loadLiveSupplyStatus(): Promise<LiveSupplyStatus> {
  const client = getProvider().rpcClient;
  const [circulatingSupply, totalBurned] = await Promise.all([
    capture(() => client.lythCirculatingSupply()),
    capture(() => client.lythTotalBurned()),
  ]);
  return {
    endpoint: client.endpoint,
    circulatingSupply,
    totalBurned,
  };
}

/** Raw baseline APR in basis points for a cluster (`lyth_clusterApr` →
 *  `aprBps`). `0` is a REAL chain value ("no reward accrued in the window"),
 *  distinct from `null` (the read failed / is unavailable). Never fabricates. */
export async function loadLiveClusterAprBps(
  clusterId: number,
  windowBlocks?: number,
): Promise<number | null> {
  try {
    const res = await getProvider().rpcClient.lythClusterApr(clusterId, windowBlocks);
    const n = Number(res.aprBps);
    return Number.isFinite(n) ? n : null;
  } catch {
    return null;
  }
}

/** Fan out {@link loadLiveClusterAprBps}. Map of clusterId → raw aprBps; a real
 *  `0` IS included (renders "0.00%"), only a failed read is omitted (→ "—"). */
export async function loadLiveClusterAprBpsMap(
  clusterIds: number[],
  windowBlocks?: number,
): Promise<Map<number, number>> {
  const out = new Map<number, number>();
  const unique = Array.from(new Set(clusterIds));
  await Promise.all(
    unique.map(async (id) => {
      const bps = await loadLiveClusterAprBps(id, windowBlocks);
      if (bps !== null) out.set(id, bps);
    }),
  );
  return out;
}

/** Best-effort cluster operating entity (`lyth_getClusterEntity` → `entity`,
 *  e.g. "mono-labs" / "independent"). Null when unresolved / the read fails —
 *  the caller renders an honest "—". */
export async function loadLiveClusterEntity(clusterId: number): Promise<string | null> {
  try {
    const res = await getProvider().rpcClient.lythGetClusterEntity(clusterId);
    return res.entity && res.entity.length > 0 ? res.entity : null;
  } catch {
    return null;
  }
}

/** Fan out {@link loadLiveClusterEntity}. Map of clusterId → entity label (only
 *  resolved clusters appear; a missing key renders "—"). */
export async function loadLiveClusterEntities(
  clusterIds: number[],
): Promise<Map<number, string>> {
  const out = new Map<number, string>();
  const unique = Array.from(new Set(clusterIds));
  await Promise.all(
    unique.map(async (id) => {
      const entity = await loadLiveClusterEntity(id);
      if (entity !== null) out.set(id, entity);
    }),
  );
  return out;
}

/** Live operator counts for a cluster's detail view (`lyth_clusterStatus`).
 *  Best-effort — null when the read fails, so the detail shows honest "—". */
export interface LiveClusterOperatorStatus {
  live: number;
  offline: number;
  lagging: number;
  maintenance: number;
}

export async function loadLiveClusterStatus(
  clusterId: number,
): Promise<LiveClusterOperatorStatus | null> {
  try {
    const res = await getProvider().rpcClient.lythClusterStatus(clusterId);
    return {
      live: res.live,
      offline: res.offline,
      lagging: res.lagging,
      maintenance: res.maintenance,
    };
  } catch {
    return null;
  }
}

/** Delegator (demand) count for a cluster (`lyth_getClusterDelegators` →
 *  `count`). Null when the read fails — the detail renders an honest "—".
 *  A real `0` (no delegators) is returned as `0`, not null. */
export async function loadLiveClusterDelegatorCount(
  clusterId: number,
): Promise<number | null> {
  try {
    const res = await getProvider().rpcClient.lythGetClusterDelegators(clusterId);
    return typeof res.count === "number" ? res.count : null;
  } catch {
    return null;
  }
}

/** Best-effort confirmation depth for a tx hash (`lyth_txConfirmations`).
 *  Returns the confirmation count when the chain reports the tx as found, else
 *  null (not found, no depth, or a read error) — the caller falls back to its
 *  existing honest status. */
export async function loadLiveTxConfirmations(txHash: string): Promise<number | null> {
  try {
    const result = await getProvider().rpcClient.lythTxConfirmations(txHash);
    if (result.status === "found" && typeof result.confirmations === "number") {
      return result.confirmations;
    }
    return null;
  } catch {
    return null;
  }
}

/** Best-effort cluster display name (`lyth_getClusterName`). Returns null when
 *  the cluster has no registered name or the read fails — callers fall back to
 *  "Cluster #<id>" (honest absence, never a fabricated name). */
export async function loadClusterName(clusterId: number): Promise<string | null> {
  try {
    const res = await getProvider().rpcClient.lythGetClusterName(clusterId);
    return res.name && res.name.length > 0 ? res.name : null;
  } catch {
    return null;
  }
}

/** Fan out {@link loadClusterName} over a set of cluster ids. Returns a map of
 *  clusterId → name (only clusters with a real registered name appear — a
 *  missing key means "unnamed", so callers render "Cluster #<id>"). Tolerant of
 *  per-cluster failures. */
export async function loadLiveClusterNames(
  clusterIds: number[],
): Promise<Map<number, string>> {
  const out = new Map<number, string>();
  const unique = Array.from(new Set(clusterIds));
  await Promise.all(
    unique.map(async (id) => {
      const name = await loadClusterName(id);
      if (name !== null) out.set(id, name);
    }),
  );
  return out;
}

/** Ceiling above which a decoded claim is not a claim.
 *
 *  200,000,000 LYTH is twice the genesis supply, so any single reward
 *  settlement at or beyond it is a rogue or buggy operator echo rather than
 *  money that moved. Such a value is treated as UNDECODABLE — never clamped
 *  down to the ceiling, which would turn a bogus reading into a plausible
 *  figure and hide the fact that the answer was garbage. */
export const MAX_PLAUSIBLE_CLAIM_LYTHOSHI = 200_000_000n * 10n ** 18n;

/** Decode the settled reward amount (LYTH decimal) from a confirmed claim tx's
 *  `Claimed` log via `lyth_decodeTx`.
 *
 *  Returns null when there is no Claimed log, the read/decode fails, or the
 *  amount is implausible. Null means the surfaces show the bare title — the
 *  submit-time claimable is a DIFFERENT quantity (execution settles further
 *  rewards) and is never substituted. */
export async function decodeClaimedAmount(txHash: string): Promise<string | null> {
  try {
    const decoded = await getProvider().rpcClient.lythDecodeTx(txHash);
    const logs = Array.isArray(decoded.logs) ? decoded.logs : [];
    for (const log of logs) {
      if (log.topics?.[0] === CLAIMED_EVENT_TOPIC0) {
        const event = decodeClaimedEvent(log.topics, log.data);
        const amount = event.amount;
        if (amount > MAX_PLAUSIBLE_CLAIM_LYTHOSHI) return null;
        return formatLyth(amount.toString(), { includeUnit: false });
      }
    }
    return null;
  } catch {
    return null;
  }
}

/** Decode the network fee (raw lythoshi string) from a confirmed tx via
 *  `lyth_decodeTx`. Returns null when the fee can't be decoded — the caller
 *  omits the fee row (honest absence, never a fabricated 0). */
export async function decodeTxFeeLythoshi(txHash: string): Promise<string | null> {
  try {
    const decoded = await getProvider().rpcClient.lythDecodeTx(txHash);
    const total = decoded.fee?.total_lythoshi;
    if (typeof total !== "string" || total.length === 0) return null;
    // A zero (or unparseable) fee is treated as absent — a confirmed tx's fee is
    // never a real 0, so omit the row rather than render a fabricated "0 LYTH".
    try {
      if (BigInt(total) <= 0n) return null;
    } catch {
      return null;
    }
    return total;
  } catch {
    return null;
  }
}

export async function loadAccountPolicy(address: string) {
  return getProvider().rpcClient.lythGetAccountPolicy(requireTypedUserAddress(address, "account policy address"));
}

/** Raw native balance as an exact lythoshi integer string via `eth_getBalance`
 *  (SDK 0.6.0 `AccountProofResponse.value`, normalized). The single balance read
 *  the Delegate page derives its effective-weight LYTH figures from. Throws on
 *  RPC failure — wrap in {@link capture}. */
export async function loadNativeBalanceLythoshi(address: string): Promise<string> {
  const client = getProvider().rpcClient;
  const addressHex = requireTypedUserAddressHex(address, "wallet");
  const balance = await client.ethGetBalance(addressHex);
  return BigInt(normalizeBalanceHex(balance)).toString();
}

export async function loadLiveWalletBalance(address: string): Promise<LiveWalletBalance> {
  const client = getProvider().rpcClient;
  const addressHex = requireTypedUserAddressHex(address, "wallet");
  const [nonce, balance] = await Promise.all([
    getNativeTransactionCount(client, addressHex),
    client.ethGetBalance(addressHex),
  ]);
  const rawBalance = normalizeBalanceHex(balance);
  const lythoshi = BigInt(rawBalance).toString();
  return {
    address,
    nonce,
    balanceLythoshi: lythoshi,
    balanceLyth: formatLyth(lythoshi, { includeUnit: false }),
  };
}

/**
 * Derive the live wallet identity from a vault seed.
 *
 * THE ADDRESS FORM IS CONVERTED HERE, and this function is the reason why. The
 * SDK backend returns a raw `0x` address; this wallet retired that form
 * everywhere — the recipient parser rejects it, the spending policy
 * canonicalises away from it, and every reader validates through
 * `requireTypedUserAddress*`. So the derivation seam is where the SDK's form
 * becomes the wallet's.
 *
 * Converting at the call site instead would have fixed one caller and left the
 * trap armed for the next: the identity previously flowed straight into
 * `loadLiveWalletBalance`, whose first act is that validator, which threw
 * "raw 0x addresses are retired" on the wallet's own address — and the panel
 * reported balance and nonce as unavailable when the request had simply never
 * been made.
 */
export function deriveLiveWalletIdentity(seed: Uint8Array): LiveWalletIdentity {
  // Public material only. `publicKey()` and `getAddress()` stay valid after
  // disposal, and both are read before the helper's `finally` runs, so the
  // returned identity is unaffected by wiping the secret half.
  return withSigningBackend(seed, (backend) => {
    const publicKey = backend.publicKey();
    return {
      address: addressToTypedBech32("user", backend.getAddress()),
      publicKeyHex: bytesToHex(publicKey),
      publicKeyBytes: publicKey.length,
    };
  });
}

/**
 * Render an outcome for display.
 *
 * Three answers, not two. A read that FAILED shows its error, a read that
 * SUCCEEDED shows its value — and a method the endpoint declines to serve shows
 * neither, because it is a different fact from both. Handled here at the shared
 * seam rather than per surface, so every consumer gets the same answer instead
 * of each solving it locally and drifting apart.
 */
export function formatOutcome<T>(outcome: RpcOutcome<T>, render: (value: T) => string): string {
  if (!outcome.ok) {
    return isMethodDisabled(outcome.error) ? METHOD_UNAVAILABLE_LABEL : outcome.error ?? "unavailable";
  }
  return render(outcome.value as T);
}

export function errorMessage(cause: unknown): string {
  return (cause as Error)?.message ?? String(cause);
}

function emptyOutcome<T>(error: string): RpcOutcome<T> {
  return { ok: false, error };
}

function nativeMarketOrderBookDeltasQuery(filter: {
  fromBlock: number | bigint | string;
  toBlock: number | bigint | string;
  limit?: number | bigint | string | null;
  marketId?: string | null;
}): Record<string, ApiQueryValue> {
  return {
    fromBlock: filter.fromBlock,
    toBlock: filter.toBlock,
    limit: filter.limit,
    marketId: filter.marketId,
  };
}

/** Normalize an `eth_getBalance` result to a BigInt-parsable balance string.
 *  SDK 0.6.0 returns an `AccountProofResponse` whose balance is the `value`
 *  field (a 0x-hex string), not a bare hex string nor a `balance` key — reading
 *  the wrong shape yielded a constant 0. Accepts the bare string + the legacy
 *  `balance` key too; anything unrecognized falls back to "0x0". Exported for
 *  unit tests. */
export function normalizeBalanceHex(balance: unknown): string {
  if (typeof balance === "string") return balance;
  if (balance && typeof balance === "object") {
    const obj = balance as { value?: unknown; balance?: unknown };
    if (typeof obj.value === "string") return obj.value;
    if (typeof obj.balance === "string") return obj.balance;
  }
  return "0x0";
}

function bytesToHex(bytes: Uint8Array): string {
  return `0x${Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("")}`;
}
