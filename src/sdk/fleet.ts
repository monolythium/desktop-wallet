// Effective-fleet composition — the ONE function every dial-path consumer calls
// to get the operator set the wallet actually talks to.
//
// It layers the user operator override (operator-override.ts) over the default
// catalogue (peers.ts), applies the hardened-build narrowing (build-mode law 3),
// and collapses to the single custom-chain RPC when a custom chain is active
// (chains.ts). No module caches the fleet across ticks — activeFleet() is called
// at each use, so a saved override / activated chain takes effect restart-free
// (by the next health tick / probe round / popover open).
//
// This module also registers the fleet-aware endpoint policy into client.ts, so
// the low-level client never imports this composition layer (which would cycle).

import { listPeers, type Peer } from "./peers";
import {
  defaultOperatorEntries,
  hardenedOperators,
  readOperatorOverride,
} from "./operator-override";
import { activeChainRecord } from "./chains";
import { isHardenedBuild } from "./build-mode";
import { registerEndpointPolicy } from "./client";

/**
 * The effective dial set (the wallet reads from one member at a time):
 *   - a custom chain active → exactly one Peer for its RPC (`tier: "custom"`);
 *   - otherwise → the hardened-narrowed override-or-defaults, de-duped by URL
 *     (first occurrence wins). A default entry is returned as its original Peer so
 *     the gateway/official tier is preserved; an override-only host becomes a
 *     `tier: "custom"` Peer.
 *
 * In the no-override builtin case this is `listPeers()` verbatim, so nothing about
 * today's dial behavior changes until a user writes an override or a custom chain.
 */
export function activeFleet(): Peer[] {
  const record = activeChainRecord();
  if (!record.builtin) {
    return [{ url: record.rpc, label: record.name, region: null, tier: "custom" }];
  }
  const defaults = listPeers();
  const byUrl = new Map(defaults.map((p) => [p.url, p]));
  const entries = hardenedOperators(defaultOperatorEntries(), readOperatorOverride(), isHardenedBuild());
  const seen = new Set<string>();
  const fleet: Peer[] = [];
  for (const e of entries) {
    if (seen.has(e.rpc)) continue;
    seen.add(e.rpc);
    fleet.push(byUrl.get(e.rpc) ?? { url: e.rpc, label: e.name, region: e.region || null, tier: "custom" });
  }
  return fleet;
}

/** True when a valid override is in effect AND it survived the hardened narrowing
 *  (the effective fleet actually differs from a null-override resolution). Drives
 *  the override status surfaces. */
export function operatorOverrideActive(): boolean {
  const override = readOperatorOverride();
  if (!override) return false;
  const defaults = defaultOperatorEntries();
  const effective = hardenedOperators(defaults, override, isHardenedBuild());
  const base = hardenedOperators(defaults, null, isHardenedBuild());
  if (effective.length !== base.length) return true;
  return effective.some((e, i) => {
    const b = base[i]!;
    return e.name !== b.name || e.region !== b.region || e.rpc !== b.rpc;
  });
}

// Register the fleet-aware endpoint policy exactly once, at load. Guarded so a
// test that mocks ./client without spreading the original (leaving
// registerEndpointPolicy undefined) can't crash on import.
if (typeof registerEndpointPolicy === "function") {
  registerEndpointPolicy({
    isKnown: (url) => activeFleet().some((p) => p.url === url),
    activeCustomChainRpc: () => {
      const record = activeChainRecord();
      return record.builtin ? null : record.rpc;
    },
  });
}
