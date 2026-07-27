import { describe, expect, it } from "vitest";
import {
  activeFeatureChips,
  ADDRESS_FORMAT_LABEL,
  ATOMIC_UNIT_LABEL,
  computeGenesisDrift,
  operatorsSummary,
  readChainIdentity,
  runtimeBlockFromProvenance,
  runtimeFeatureChips,
  WALLET_TAGLINE,
  WALLET_TITLE,
  type ChainIdentity,
  type FeatureFlagState,
} from "../about";
import type { ChainInfo } from "@monolythium/core-sdk";
import type { ProbeResult } from "../peers";

const ALL_OFF: FeatureFlagState = {
  experimental: false,
  developer: false,
  incoming: false,
  notifications: false,
  notificationDetails: false,
  notifyWhileLocked: false,
};

function probe(reachable: boolean, chainIdOk: boolean): ProbeResult {
  return { url: "x", reachable, latencyMs: 1, chainIdOk };
}

describe("identity copy", () => {
  it("is a plain self-description — no banned framing", () => {
    const copy = `${WALLET_TITLE} ${WALLET_TAGLINE}`.toLowerCase();
    expect(WALLET_TITLE).toBe("Monolythium Wallet");
    expect(copy).not.toContain("browser");
    expect(copy).not.toContain("reference implementation");
  });
});

describe("activeFeatureChips", () => {
  it("renders no chip when every flag is off", () => {
    expect(activeFeatureChips(ALL_OFF)).toEqual([]);
  });

  it("renders a labelled chip only for the enabled flags, in a stable order", () => {
    const chips = activeFeatureChips({
      ...ALL_OFF,
      developer: true,
      experimental: true,
    });
    // Order follows the chip map: experimental before developer.
    expect(chips.map((c) => c.id)).toEqual(["experimental", "developer"]);
    expect(chips.every((c) => c.label.length > 0)).toBe(true);
  });
});

describe("operatorsSummary", () => {
  it("counts only endpoints reachable AND on the right chain", () => {
    const results = [
      probe(true, true), // live
      probe(true, true), // live
      probe(true, false), // reachable but wrong chain — not live
      probe(false, false), // unreachable
    ];
    const summary = operatorsSummary(results, 5);
    expect(summary.live).toBe(2);
    expect(summary.total).toBe(5);
    expect(summary.label).toBe("2 of 5 endpoints live on chain 69420");
  });

  it("is honest about zero live endpoints (no fabrication)", () => {
    const summary = operatorsSummary([probe(false, false)], 3);
    expect(summary.live).toBe(0);
    expect(summary.label).toContain("0 of 3");
  });
});

describe("developer-mode chain rows", () => {
  it("reads chain identity from the static SDK registry", () => {
    const chain = readChainIdentity();
    expect(chain.chainId).toBe(69420);
    expect(chain.genesisHash).toMatch(/^0x[0-9a-f]+$/i);
    expect(chain.binarySha.length).toBeGreaterThan(0);
  });

  it("derives the atomic-unit and address-format labels from SDK constants", () => {
    // 1 LYTH = 10^18 lythoshi — derived, not hardcoded.
    expect(ATOMIC_UNIT_LABEL).toBe("lythoshi (10^-18 LYTH)");
    expect(ADDRESS_FORMAT_LABEL).toBe("bech32m (mono…)");
  });

  it("splits a runtime feature string into chip tokens", () => {
    expect(runtimeFeatureChips("native-tokens, clob  risc-v")).toEqual([
      "native-tokens",
      "clob",
      "risc-v",
    ]);
    expect(runtimeFeatureChips("")).toEqual([]);
  });

  it("maps a runtime provenance response to the display block (shared helper)", () => {
    const block = runtimeBlockFromProvenance({
      schemaVersion: 1,
      chainId: 69420,
      genesisHash: "0xg",
      latestHeight: 500,
      runtime: {
        clientName: "protocore", version: "v0.4.0", gitCommit: "abcdef0123456789", gitDirty: true,
        p2pProtocolVersion: 2, features: "native-tokens clob",
      },
      upgrade: null,
    } as unknown as Parameters<typeof runtimeBlockFromProvenance>[0]);
    expect(block).toEqual({
      clientName: "protocore", version: "v0.4.0", gitCommit: "abcdef0123456789", gitDirty: true,
      p2pProtocolVersion: 2, latestHeight: 500, features: ["native-tokens", "clob"],
    });
  });
});

describe("computeGenesisDrift", () => {
  const bundled: ChainIdentity = { chainId: 69420, genesisHash: "0xAABB", binarySha: "da04f8f5" };
  const live = (genesis_hash: string, binary_sha = "da04f8f5"): ChainInfo =>
    ({ genesis_hash, binary_sha }) as unknown as ChainInfo;

  it("returns null when there is no live answer", () => {
    expect(computeGenesisDrift(bundled, null)).toBeNull();
  });

  it("returns null when the live genesis field is empty (a non-answer)", () => {
    expect(computeGenesisDrift(bundled, live(""))).toBeNull();
  });

  it("returns null when the genesis matches case-insensitively (no drift)", () => {
    expect(computeGenesisDrift(bundled, live("0xaabb"))).toBeNull();
  });

  it("reports drift on a genesis mismatch (binary sha omitted when it matches)", () => {
    const drift = computeGenesisDrift(bundled, live("0xCCDD"));
    expect(drift).toEqual({ liveGenesisHash: "0xCCDD", liveBinarySha: null });
  });

  it("includes the live binary sha only when it also differs", () => {
    const drift = computeGenesisDrift(bundled, live("0xCCDD", "beefcafe"));
    expect(drift).toEqual({ liveGenesisHash: "0xCCDD", liveBinarySha: "beefcafe" });
  });
});
