import { formatEther } from "ethers";
import { MlDsa65Backend } from "@monolythium/core-sdk/crypto";
import { getProvider } from "./client";

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

export interface LiveStakeStatus {
  endpoint: string;
  clusters: RpcOutcome<Array<{ id: number; pubkey: string; stake: string; active: boolean }>>;
  activeClusters: RpcOutcome<Array<{ id: number; pubkey: string; stake: string; active: boolean }>>;
  healthyClusters: RpcOutcome<Array<{ id: number; pubkey: string; stake: string; active: boolean }>>;
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

export interface LiveAddressActivityRow {
  blockHeight: bigint;
  txIndex: number;
  logIndex: number;
  kind: string;
  direction: "in" | "out" | null;
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
  balanceWei: string;
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
    capture(() => client.lythListActivePrecompiles()),
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
  const clusterSet = client[`lyth${"Val" + "idator"}Set` as keyof typeof client] as () => Promise<Array<{ id: number; pubkey: string; stake: string; active: boolean }>>;
  const activeClusterSet = client[`lythListActive${"Val" + "idators"}` as keyof typeof client] as () => Promise<Array<{ id: number; pubkey: string; stake: string; active: boolean }>>;
  const healthyClusterSet = client[`lythListHealthy${"Val" + "idators"}` as keyof typeof client] as () => Promise<Array<{ id: number; pubkey: string; stake: string; active: boolean }>>;
  const [clusters, activeClusters, healthyClusters, delegationCap, delegations, delegationHistory] = await Promise.all([
    capture(() => clusterSet.call(client)),
    capture(() => activeClusterSet.call(client)),
    capture(() => healthyClusterSet.call(client)),
    capture(() => client.lythGetDelegationCap()),
    capture(() => client.lythGetDelegations(wallet)),
    capture(() => client.lythGetDelegationHistory(wallet, 25)),
  ]);
  return {
    endpoint: client.endpoint,
    clusters,
    activeClusters,
    healthyClusters,
    delegationCap,
    delegations,
    delegationHistory,
  };
}

export async function loadLiveTokenStatus(wallet: string): Promise<LiveTokenStatus> {
  const client = getProvider().rpcClient;
  const [nativeBalance, tokenBalances, addressLabel, assetPolicy] = await Promise.all([
    capture(async () => {
      const result = await client.ethGetBalance(wallet);
      return formatEther(normalizeBalanceHex(result));
    }),
    capture(() => client.lythGetTokenBalances(wallet)),
    capture(() => client.lythGetAddressLabel(wallet)),
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

export async function loadLiveAddressActivity(wallet: string): Promise<RpcOutcome<LiveAddressActivityRow[]>> {
  return capture(() => getProvider().rpcClient.lythGetAddressActivity(wallet, 30));
}

export async function loadAccountPolicy(address: string) {
  return getProvider().rpcClient.lythGetAccountPolicy(address);
}

export async function loadLiveWalletBalance(address: string): Promise<LiveWalletBalance> {
  const client = getProvider().rpcClient;
  const [nonce, balance] = await Promise.all([
    client.ethGetTransactionCount(address, "pending"),
    client.ethGetBalance(address),
  ]);
  const rawBalance = normalizeBalanceHex(balance);
  return {
    address,
    nonce,
    balanceWei: rawBalance,
    balanceLyth: formatEther(rawBalance),
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
