// Live chain identity for persisted wallet state.
//
// Chain id alone is not a sufficient cache boundary: testnet regenesis keeps
// chain 69420 while replacing block 0. Persisted activity, notification
// watermarks/dedupe, and tracked transactions must therefore be scoped to the
// live genesis. We use the canonical block-0 hash exposed by the active RPC
// endpoint, with `lyth_chainStats.genesisHash` as a compatibility fallback.
//
// Identity resolution fails closed. If neither live read succeeds, callers do
// not surface or mutate genesis-sensitive persisted state; a stale pre-cut
// cache is never treated as current merely because the network is offline.

import { getProvider } from "./client";

const IDENTITY_TTL_MS = 30_000;

interface IdentityCache {
  endpoint: string;
  identity: string;
  checkedAtMs: number;
}

interface IdentityFlight {
  endpoint: string;
  promise: Promise<string | null>;
}

let cache: IdentityCache | null = null;
let inFlight: IdentityFlight | null = null;
let testResolver: (() => Promise<string | null>) | null = null;

/** Normalize a canonical 32-byte hash. Anything else is not a usable genesis
 * identity and is rejected rather than becoming a cache namespace. */
export function normalizeGenesisIdentity(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLowerCase();
  return /^0x[0-9a-f]{64}$/.test(normalized) ? normalized : null;
}

/** Resolve the active endpoint's live genesis identity. Successful reads are
 * briefly cached to avoid adding an RPC round-trip to every store operation;
 * failures are not cached, so recovery is immediate once an endpoint returns. */
export async function resolveLiveGenesisIdentity(): Promise<string | null> {
  if (testResolver) {
    return normalizeGenesisIdentity(await testResolver());
  }

  const provider = getProvider();
  const endpoint = provider.endpoint;
  const now = Date.now();
  if (
    cache &&
    cache.endpoint === endpoint &&
    now - cache.checkedAtMs < IDENTITY_TTL_MS
  ) {
    return cache.identity;
  }
  if (inFlight?.endpoint === endpoint) return inFlight.promise;

  const promise = (async (): Promise<string | null> => {
    let identity: string | null = null;
    try {
      const block0 = await provider.rpcClient.ethGetBlockByNumber(0);
      identity = normalizeGenesisIdentity(block0?.hash);
    } catch {
      // Older nodes can lack the block-header compatibility method. Fall back
      // to the native chain summary below.
    }
    if (identity === null) {
      try {
        const stats = await provider.rpcClient.lythChainStats();
        identity = normalizeGenesisIdentity(stats.genesisHash);
      } catch {
        // Fail closed below.
      }
    }
    if (identity !== null) {
      cache = { endpoint, identity, checkedAtMs: Date.now() };
    }
    return identity;
  })();

  inFlight = { endpoint, promise };
  try {
    return await promise;
  } finally {
    if (inFlight?.promise === promise) inFlight = null;
  }
}

/** Same as {@link resolveLiveGenesisIdentity}, but makes fail-closed behavior
 * explicit for persisted-store callers. */
export async function requireLiveGenesisIdentity(): Promise<string> {
  const identity = await resolveLiveGenesisIdentity();
  if (identity === null) {
    throw new Error("live genesis identity unavailable");
  }
  return identity;
}

/** Test-only identity seam. Passing `null` restores live RPC resolution. */
export function __setGenesisIdentityResolverForTests(
  resolver: (() => Promise<string | null>) | null,
): void {
  testResolver = resolver;
  cache = null;
  inFlight = null;
}
