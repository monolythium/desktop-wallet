// About-page data helpers — pure, testable derivations from the wallet's real
// runtime state. No fabricated values: every field the About page renders is
// either a live read or an honest chain-level constant. The page composes these.

import { getVersion } from "@tauri-apps/api/app";
import {
  ADDRESS_KIND_HRPS,
  getChainInfo,
  LYTHOSHI_PER_LYTH,
  type ChainInfo,
  type RuntimeProvenanceResponse,
} from "@monolythium/core-sdk";
import {
  readExperimentalEnabled,
  readIncomingEnabled,
  readNotificationDetails,
  readNotificationsEnabled,
  readNotifyWhileLocked,
} from "./feature-flags";
import { featureLabel } from "./feature-meta";
import { readDeveloperMode } from "./studio-host";
import { getProvider } from "./client";
import { isLive, withChainEnvelope, type ChainOutcome } from "./chain-readiness";
import { TESTNET_CHAIN_ID, type ProbeResult } from "./peers";

/** The registry network slug the wallet is pinned to. */
export const NETWORK_SLUG = "testnet-69420";

/** Product identity — a plain self-description, no comparison to any other
 *  wallet, no "reference implementation" claim. */
export const WALLET_TITLE = "Monolythium Wallet";
export const WALLET_TAGLINE =
  "A sovereign post-quantum wallet for the Monolythium chain.";

/** True iff running inside Tauri (the same probe App/updater use). getVersion()
 *  round-trips through Tauri IPC and rejects in the browser preview. */
export function isTauriRuntime(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

/** The running wallet version. Prefers Tauri's getVersion() (the packaged app
 *  version); falls back to the build-time package.json version baked in via the
 *  __APP_VERSION__ define for the browser preview. Never fabricated. */
export async function readWalletVersion(): Promise<string> {
  if (isTauriRuntime()) {
    try {
      return await getVersion();
    } catch {
      // fall through to the build-time constant
    }
  }
  return __APP_VERSION__;
}

/** The user-toggleable flags surfaced as "Active features". */
export interface FeatureFlagState {
  experimental: boolean;
  developer: boolean;
  incoming: boolean;
  notifications: boolean;
  notificationDetails: boolean;
  notifyWhileLocked: boolean;
}

/** Snapshot the current feature-flag state from its persisted sources. */
export function readFeatureFlagState(): FeatureFlagState {
  return {
    experimental: readExperimentalEnabled(),
    developer: readDeveloperMode(),
    incoming: readIncomingEnabled(),
    notifications: readNotificationsEnabled(),
    notificationDetails: readNotificationDetails(),
    notifyWhileLocked: readNotifyWhileLocked(),
  };
}

export interface FeatureChip {
  id: keyof FeatureFlagState;
  label: string;
}

// The flag → label map, in a stable display order.
//
// The PROGRESSIVE-DISCLOSURE flags take their labels from `feature-meta.ts` so
// the chip here and the row in the Settings Features grid cannot drift apart —
// they used to, naming the same flag two different ways. The remaining entries
// are operational flags that appear in no grid, so About still owns their
// labels.
const FEATURE_CHIPS: FeatureChip[] = [
  { id: "experimental", label: featureLabel("experimental") ?? "Experimental" },
  { id: "developer", label: "Developer mode" },
  { id: "incoming", label: "Incoming-transfer alerts" },
  { id: "notifications", label: "System notifications" },
  { id: "notificationDetails", label: "Details in alerts" },
  { id: "notifyWhileLocked", label: "Alerts while locked" },
];

/** The enabled feature flags as display chips, in a stable order. Pure. */
export function activeFeatureChips(state: FeatureFlagState): FeatureChip[] {
  return FEATURE_CHIPS.filter((chip) => state[chip.id]);
}

export interface OperatorsSummary {
  /** Endpoints reachable AND reporting the testnet chain id. */
  live: number;
  /** Total endpoints in the switchable catalogue. */
  total: number;
  /** Honest one-line label. */
  label: string;
}

/** Summarize peer-probe results into an honest "N of M endpoints live on chain
 *  X" figure. NOTE: probePeer verifies chain id only (never genesis), so this
 *  is a reachability / chain-match metric — NOT a genesis-"trusted" count.
 *  Pure. */
export function operatorsSummary(
  results: readonly ProbeResult[],
  total: number,
): OperatorsSummary {
  const live = results.filter((r) => r.reachable && r.chainIdOk).length;
  return {
    live,
    total,
    label: `${live} of ${total} endpoints live on chain ${TESTNET_CHAIN_ID}`,
  };
}

// ── Developer-mode technical rows ────────────────────────────────────────────
// Everything below is gated behind the developer-mode toggle. Values are either
// a static registry read (chain identity), a chain-level constant, or a live
// node read (runtime provenance) — never fabricated.

/** Chain identity from the SDK's static chain registry. */
export interface ChainIdentity {
  chainId: number;
  genesisHash: string;
  binarySha: string;
}

export function readChainIdentity(): ChainIdentity {
  const info = getChainInfo(NETWORK_SLUG);
  return {
    chainId: info.chain_id,
    genesisHash: info.genesis_hash,
    binarySha: info.binary_sha,
  };
}

/** Registry-drift facts: the live registry publishes a genesis different from
 *  the one this build enforces. Display-only — the bundled pin still gates
 *  trust; a drift means the fleet re-genesised and this build is stale until it
 *  updates. */
export interface GenesisDrift {
  liveGenesisHash: string;
  /** The live binary sha, only when it ALSO differs from the bundled one. */
  liveBinarySha: string | null;
}

/** Compare the enforced (bundled) chain identity against the live registry.
 *  Returns null when there is no live answer, the live genesis field is empty
 *  (treated as a non-answer), or the genesis matches case-insensitively — i.e.
 *  the banner shows ONLY on a confirmed mismatch. Pure. */
export function computeGenesisDrift(
  bundled: ChainIdentity,
  live: ChainInfo | null,
): GenesisDrift | null {
  if (!live) return null;
  const liveGenesis = live.genesis_hash;
  if (!liveGenesis) return null;
  if (liveGenesis.toLowerCase() === bundled.genesisHash.toLowerCase()) return null;
  const liveBinarySha =
    live.binary_sha && live.binary_sha.toLowerCase() !== bundled.binarySha.toLowerCase()
      ? live.binary_sha
      : null;
  return { liveGenesisHash: liveGenesis, liveBinarySha };
}

/** The resolved core-sdk version (build-time __SDK_VERSION__ define), or null
 *  when it isn't available — the SDK exposes no runtime version, so this is the
 *  only honest source; a missing value renders as "—", never fabricated. */
export function readSdkVersion(): string | null {
  const value = typeof __SDK_VERSION__ === "string" ? __SDK_VERSION__ : "";
  return value.length > 0 ? value : null;
}

/** 1 LYTH = 10^18 lythoshi — derived from the SDK constant, not hardcoded. */
export const ATOMIC_UNIT_LABEL = `lythoshi (10^-${LYTHOSHI_PER_LYTH.toString().length - 1} LYTH)`;

/** Address format, tied to the SDK's canonical user HRP (bech32m `mono…`). */
export const ADDRESS_FORMAT_LABEL = `bech32m (${ADDRESS_KIND_HRPS.user}…)`;

export interface StaticRow {
  label: string;
  value: string;
}

/** Chain-level constants for the developer rows. These describe the chain, not
 *  a wallet feature, and are stable design facts (not live reads). */
export const CHAIN_STATIC_ROWS: StaticRow[] = [
  { label: "Signing", value: "ML-DSA-65 (FIPS 204)" },
  { label: "Execution", value: "Rust/RISC-V native" },
  { label: "Address format", value: ADDRESS_FORMAT_LABEL },
  { label: "Atomic unit", value: ATOMIC_UNIT_LABEL },
  { label: "EVM compat", value: "read-only RPC · no EVM execution" },
  { label: "Whitepaper", value: "v5.0 · May 2026" },
];

/** The connected node's build/runtime block, from `lyth_runtimeProvenance`.
 *  Describes the RPC node the wallet is talking to — NOT the wallet binary. */
export interface RuntimeBlock {
  clientName: string;
  version: string;
  gitCommit: string;
  gitDirty: boolean;
  p2pProtocolVersion: number | null;
  latestHeight: number | null;
  features: string[];
}

/** Split a comma/space-separated feature string into chip tokens. Pure. */
export function runtimeFeatureChips(features: string): string[] {
  return features.split(/[,\s]+/).filter((token) => token.length > 0);
}

/** Map a `lyth_runtimeProvenance` response to the display block (pure). Shared by
 *  the About runtime card and the Operators screen's per-operator provenance —
 *  one field mapping, never duplicated. */
export function runtimeBlockFromProvenance(prov: RuntimeProvenanceResponse): RuntimeBlock {
  const rt = prov.runtime;
  return {
    clientName: rt.clientName,
    version: rt.version,
    gitCommit: rt.gitCommit,
    gitDirty: rt.gitDirty,
    p2pProtocolVersion:
      typeof rt.p2pProtocolVersion === "number" ? rt.p2pProtocolVersion : null,
    latestHeight: typeof prov.latestHeight === "number" ? prov.latestHeight : null,
    features: runtimeFeatureChips(rt.features),
  };
}

/**
 * Read the connected node's runtime provenance, inside the readiness envelope.
 *
 * The envelope adds a timeout and a typed reason to what was a bare try/catch.
 * The FIELD MAPPING is untouched — `runtimeBlockFromProvenance` stays the one
 * shared mapper for both this card and the Operators screen's per-operator
 * provenance, and it is applied here only on the `live` branch.
 *
 * `not-deployed` is the right classification for a thrown error: a node that
 * lacks `lyth_runtimeProvenance` is a chain gap, not an outage. A timeout still
 * reports `offline`, by the envelope's own rule.
 */
export async function loadRuntimeOutcome(): Promise<ChainOutcome<RuntimeBlock>> {
  const out = await withChainEnvelope(
    () => getProvider().rpcClient.lythRuntimeProvenance(),
    { label: "lyth_runtimeProvenance", notLiveAs: "not-deployed", timeoutMs: 8000 },
  );
  if (!isLive(out)) return out;
  return { ...out, data: runtimeBlockFromProvenance(out.data) };
}

/** Read the connected node's runtime provenance. Returns null on any failure or
 *  on a node that lacks the method — the caller renders an honest absence.
 *
 *  Kept as the narrow accessor for callers that only need "did it answer";
 *  `loadRuntimeOutcome` is the typed form new consumers should adopt. */
export async function loadRuntimeBlock(): Promise<RuntimeBlock | null> {
  const out = await loadRuntimeOutcome();
  return isLive(out) ? out.data : null;
}
