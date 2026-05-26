import { ApiClient, formatLyth } from "@monolythium/core-sdk";
import type {
  ApiCapabilitiesResponse,
  ApiEnvelope,
  ApiHealthResponse,
  ApiQueryValue,
  ApiStreamsIndexResponse,
  ClobMarketsResponse,
  ClobOrderBookResponse,
  ClobTradesResponse,
  NativeMarketStateResponse,
  PrecompileCatalogueResponse,
} from "@monolythium/core-sdk";
import { MlDsa65Backend } from "@monolythium/core-sdk/crypto";
import { getProvider } from "./client";
import { getNativeTransactionCount } from "./native-rpc";
import { requireTypedUserAddress, requireTypedUserAddressHex } from "./address";
import { selectNativeSpotMarket, type SelectedNativeSpotMarket } from "./market";

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

export interface LiveStakeStatus {
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
  tokenBalances: RpcOutcome<Array<{ tokenId: string; balance: string; updatedAtBlock: bigint }>>;
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
    currentRound,
    syncStatus,
    indexerStatus,
    mempoolStatus,
    activePrecompiles,
  };
}

export async function loadLiveStakeStatus(wallet: string): Promise<LiveStakeStatus> {
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
  const [nativeBalance, tokenBalances, addressLabel, assetPolicy] = await Promise.all([
    capture(async () => {
      const result = await client.ethGetBalance(walletHex);
      return formatLyth(BigInt(normalizeBalanceHex(result)).toString(), { includeUnit: false });
    }),
    capture(() => client.lythGetTokenBalances(typedWallet)),
    capture(() => client.lythGetAddressLabel(typedWallet)),
    capture(() => client.lythGetAssetPolicy("LYTH") as Promise<Record<string, unknown>>),
  ]);
  return {
    endpoint: client.endpoint,
    nativeBalance,
    tokenBalances,
    addressLabel,
    assetPolicy,
  };
}

export async function loadLiveTradeStatus(): Promise<LiveTradeStatus> {
  const client = getProvider().rpcClient;
  const api = new ApiClient(client.endpoint);
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
  };
}

export async function loadLiveAddressActivity(wallet: string): Promise<RpcOutcome<LiveAddressActivityRow[]>> {
  const typedWallet = requireTypedUserAddress(wallet, "wallet");
  return capture(() => getProvider().rpcClient.lythGetAddressActivity(typedWallet, 30));
}

export async function loadAccountPolicy(address: string) {
  return getProvider().rpcClient.lythGetAccountPolicy(requireTypedUserAddress(address, "account policy address"));
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

export function deriveLiveWalletIdentity(seed: Uint8Array): LiveWalletIdentity {
  const backend = MlDsa65Backend.fromSeed(seed);
  const publicKey = backend.publicKey();
  return {
    address: backend.getAddress(),
    publicKeyHex: bytesToHex(publicKey),
    publicKeyBytes: publicKey.length,
  };
}

export function formatOutcome<T>(outcome: RpcOutcome<T>, render: (value: T) => string): string {
  if (!outcome.ok) return outcome.error ?? "unavailable";
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

function normalizeBalanceHex(balance: unknown): string {
  if (typeof balance === "string") return balance;
  if (balance && typeof balance === "object" && "balance" in balance) {
    const raw = (balance as { balance?: unknown }).balance;
    if (typeof raw === "string") return raw;
  }
  return "0x0";
}

function bytesToHex(bytes: Uint8Array): string {
  return `0x${Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("")}`;
}
