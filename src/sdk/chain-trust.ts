// Genesis + chain-id trust for the chain-health machine.
//
// Enforces (fail-closed) that the operator the wallet reads from is on the
// pinned chain id AND proves the pinned genesis hash, per the status
// specification §F: a different chain id → UNTRUSTED OPERATOR; the right chain
// id but a different (or unproven) genesis → ALL OPERATORS UNTRUSTED
// (re-genesis / stale pin). The pin is the SDK chain registry
// (`getChainInfo(...).chain_id` / `.genesis_hash`) — the same value the About /
// Settings / News surfaces already display, now enforced.
//
// The degraded cause is resolved by F1's tested `classifyNoOperatorReason`
// (precedence regenesis > untrusted > quarantined > unreachable) — this module
// only supplies the real per-operator signals; it does NOT re-derive precedence.
// Quarantine detection reuses the SDK's `isQuarantineError` (`-32047`).
//
// This pass verifies the ACTIVE operator (single endpoint). The fleet probe +
// failover that make OPERATOR QUARANTINED derivable are a follow-up.

import { RpcClient, getChainInfo, isQuarantineError } from "@monolythium/core-sdk";
import type { ChainStatsResponse } from "@monolythium/core-sdk";
import { currentEndpoint, getProviderUnchecked } from "./client";
import { rpcClientOptions } from "./http";
import { listPeers } from "./peers";
import {
  classifyNoOperatorReason,
  type DegradedCause,
  type FleetTrustSignals,
} from "./chain-health";

/** The registry network this build pins its chain identity to. */
export const NETWORK_SLUG = "testnet-69420";

/** One operator's trust verdict — the real signals fed to
 *  {@link classifyNoOperatorReason}. A quarantined operator answered a `-32047`
 *  and could not report its chain id/genesis (so `wrongChainId` / `genesisMismatch`
 *  stay false — it is not "wrong chain", it is refusing to serve). */
export interface OperatorVerdict {
  url: string;
  /** Reachable and answered a DIFFERENT chain id (→ untrusted). */
  wrongChainId: boolean;
  /** Right chain id but a definitively different genesis hash (→ regenesis). */
  genesisMismatch: boolean;
  /** Answered a `-32047` "chain quarantined" rejection. */
  quarantined: boolean;
  /** Right chain id AND the genesis hash matches the pin. */
  trusted: boolean;
  /** Head height + identity, only meaningful when reachable on the right chain. */
  height: number | null;
  headId: string | null;
}

/** The resolved head for a tick: a trusted operator's head, or a degraded cause
 *  (the exact shape {@link reduceHealth} consumes as an observation, plus the
 *  `url` the read came from so the view reflects the read path). */
export type TrustedHead =
  | { ok: true; url: string; height: number; headId: string; chainId: number }
  | { ok: false; cause: DegradedCause; reason?: string };

/**
 * Build a trust verdict from one operator's `lyth_chainStats` (pure).
 * Fail-closed: a null/absent `genesisHash` is NOT a pass — it proves nothing, so
 * `trusted` stays false. Genesis is compared case-insensitively (§F.2). The head
 * identity is the block hash, or the height when the hash is null (fail-closed).
 */
export function verdictFromStats(
  stats: ChainStatsResponse,
  pinChainId: number,
  pinGenesis: string,
  url = "",
): OperatorVerdict {
  const chainIdOk = stats.chainId === pinChainId;
  const observed = stats.genesisHash;
  const genesisOk =
    chainIdOk && observed != null && observed.toLowerCase() === pinGenesis.toLowerCase();
  return {
    url,
    wrongChainId: !chainIdOk,
    genesisMismatch: chainIdOk && observed != null && !genesisOk,
    quarantined: false,
    trusted: genesisOk,
    height: stats.latestHeight,
    headId: stats.latestBlockHash ?? String(stats.latestHeight),
  };
}

/** A verdict for an operator that answered a `-32047` quarantine rejection. */
export function quarantinedVerdict(url = ""): OperatorVerdict {
  return {
    url,
    wrongChainId: false,
    genesisMismatch: false,
    quarantined: true,
    trusted: false,
    height: null,
    headId: null,
  };
}

/** A verdict for an operator that could not be reached at all (transport fault). */
export function unreachableVerdict(url = ""): OperatorVerdict {
  return {
    url,
    wrongChainId: false,
    genesisMismatch: false,
    quarantined: false,
    trusted: false,
    height: null,
    headId: null,
  };
}

/** Reduce per-operator verdicts to the fleet signals (pure). `allQuarantined`
 *  requires a non-empty active set every member of which is quarantined
 *  (§G unanimity; empty ⇒ never quarantined). */
export function fleetSignals(verdicts: readonly OperatorVerdict[]): FleetTrustSignals {
  return {
    activeCount: verdicts.length,
    anyGenesisMismatch: verdicts.some((v) => v.genesisMismatch),
    anyWrongChainId: verdicts.some((v) => v.wrongChainId),
    allQuarantined: verdicts.length > 0 && verdicts.every((v) => v.quarantined),
  };
}

/**
 * Resolve the active-set verdicts to a trusted head or a degraded cause (pure).
 * The first fully-trusted operator wins (§O5: one trusted+reachable operator ⇒
 * a healthy read, regardless of another operator being degraded). When none
 * qualifies, the cause comes from F1's `classifyNoOperatorReason` — precedence
 * is NOT re-implemented here.
 */
export function resolveFleet(
  verdicts: readonly OperatorVerdict[],
  pinChainId: number,
): TrustedHead {
  const trusted = verdicts.find((v) => v.trusted);
  if (trusted && trusted.height != null && trusted.headId != null) {
    return { ok: true, url: trusted.url, height: trusted.height, headId: trusted.headId, chainId: pinChainId };
  }
  return { ok: false, cause: classifyNoOperatorReason(fleetSignals(verdicts)) };
}

/**
 * Turn one operator's `lyth_chainStats` read into a trust verdict. A `-32047`
 * quarantine rejection and a transport fault each become their own verdict
 * (fail-closed) rather than throwing. Reused for the active operator (shared
 * client seam) and each fleet operator (a transient client).
 */
async function verdictForClient(
  client: Pick<RpcClient, "lythChainStats">,
  url: string,
  pinChainId: number,
  pinGenesis: string,
): Promise<OperatorVerdict> {
  try {
    const stats = await client.lythChainStats();
    return verdictFromStats(stats, pinChainId, pinGenesis, url);
  } catch (err) {
    return isQuarantineError(err) ? quarantinedVerdict(url) : unreachableVerdict(url);
  }
}

/** Probe one fleet operator by URL over a transient client bound to it (the same
 *  fetch seam — no second RPC path). */
export async function probeOperator(
  url: string,
  pinChainId: number,
  pinGenesis: string,
): Promise<OperatorVerdict> {
  return verdictForClient(new RpcClient(url, rpcClientOptions()), url, pinChainId, pinGenesis);
}

/**
 * Resolve a trusted head across the operator fleet, fail-closed (§F/§G/§K).
 *
 * Fast path: verify the ACTIVE operator (the user's / last failover's choice)
 * through the shared client seam. `lyth_chainStats` carries BOTH the chain id
 * and the genesis hash, so every steady-state tick re-confirms trust in one
 * read — there is no window where a silently-forked operator reads LIVE.
 *
 * If the active operator is not trusted, probe the rest of the fleet
 * (`listPeers`, the same SDK registry the CSP allowlist is generated from) in
 * PARALLEL and select the first trusted operator to fail over to (§O5: one
 * trusted+reachable operator ⇒ a healthy read). When none qualifies, the
 * degraded cause comes from F1's `classifyNoOperatorReason` over the whole
 * active set — so OPERATOR QUARANTINED requires unanimity (§G).
 *
 * `probe` is injectable for tests; production uses {@link probeOperator}.
 */
export async function resolveTrustedHead(
  probe: typeof probeOperator = probeOperator,
): Promise<TrustedHead> {
  const info = getChainInfo(NETWORK_SLUG);
  const pinChain = info.chain_id;
  const pinGenesis = info.genesis_hash;
  const active = currentEndpoint();

  // The health probe re-checks the active operator even while it is untrusted
  // (to detect recovery), so it reads through the UNCHECKED provider.
  const activeVerdict = await verdictForClient(getProviderUnchecked().rpcClient, active, pinChain, pinGenesis);
  if (activeVerdict.trusted) {
    return resolveFleet([activeVerdict], pinChain);
  }

  const others = await Promise.all(
    listPeers()
      .map((peer) => peer.url)
      .filter((url) => url !== active)
      .map((url) => probe(url, pinChain, pinGenesis)),
  );
  return resolveFleet([activeVerdict, ...others], pinChain);
}
