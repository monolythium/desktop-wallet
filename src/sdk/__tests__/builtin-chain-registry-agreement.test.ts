// The builtin chain record must agree with the SDK registry it is a record OF.
//
// Surfaced by the 0.6.7 → 0.6.8 bump ritual. The TRUST anchor is already
// registry-sourced: `chain-trust.ts` reads `getChainInfo(NETWORK_SLUG).chain_id`
// and `.genesis_hash` for the builtin branch, so a chain that disagreed with the
// pin would fail closed. But `chains.ts` carries the builtin chain's id as
// LITERALS — `BUILTIN_CHAIN_ID = "0x10F2C"` and `chainIdNum: 69420` — and those
// literals are the wallet's storage-scope key and its Networks-row display.
//
// Nothing checked that the two agreed. If an SDK bump ever moved the registry's
// chain id, the trust gate would correctly refuse the chain while the wallet
// went on scoping storage under the old key and displaying the old number — a
// confusing failure whose cause would sit two layers from the symptom.
//
// This is the cheap guard: it turns a silent divergence into a red test on the
// bump that causes it, which is the only moment anyone is looking.

import { describe, expect, it } from "vitest";
import { getChainInfo } from "@monolythium/core-sdk";
import { BUILTIN_CHAIN, BUILTIN_CHAIN_ID, canonicalChainKey } from "../chains";
import { NETWORK_SLUG } from "../about";

describe("the builtin chain record agrees with the SDK registry", () => {
  it("reads a real registry entry (the check is not vacuous)", () => {
    const info = getChainInfo(NETWORK_SLUG);
    expect(info).toBeDefined();
    expect(typeof info.chain_id).toBe("number");
    expect(info.genesis_hash).toMatch(/^0x[0-9a-fA-F]{64}$/);
  });

  it("the decimal chain id matches the registry", () => {
    expect(BUILTIN_CHAIN.chainIdNum).toBe(getChainInfo(NETWORK_SLUG).chain_id);
  });

  it("the canonical hex key matches the registry's chain id", () => {
    // The scope key the wallet partitions storage by. A drift here would scope
    // a live wallet's history under a key nothing reads any more.
    const fromRegistry = canonicalChainKey(`0x${getChainInfo(NETWORK_SLUG).chain_id.toString(16)}`);
    expect(BUILTIN_CHAIN_ID).toBe(fromRegistry);
  });

  it("the trust anchor itself is registry-sourced, not a literal", () => {
    // The property the grep is really about: the builtin branch of the trust
    // resolver must read the registry. Asserted at the source so a future edit
    // that inlines a literal there is caught.
    const trust = TRUST_SOURCE;
    expect(trust).toContain("getChainInfo(NETWORK_SLUG)");
    expect(trust).toContain("info.chain_id");
    expect(trust).toContain("info.genesis_hash");
  });

  it("no shipped module hardcodes the genesis hash", () => {
    // The genesis hash is the trust anchor; a literal copy of it anywhere in
    // shipped source is a second source of truth that cannot be re-pinned.
    const offenders = Object.entries(SHIPPED)
      .filter(([rel]) => !rel.includes("__tests__"))
      .filter(([, src]) => /0x[0-9a-f]{8}[0-9a-f]{56}/i.test(src))
      .map(([rel]) => rel);
    expect(offenders).toEqual([]);
  });
});

const RAW = import.meta.glob("/src/**/*.{ts,tsx}", {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;

const SHIPPED: Record<string, string> = Object.fromEntries(
  Object.entries(RAW).map(([p, s]) => [p.replace(/^\/src\//, ""), s]),
);

const TRUST_SOURCE = SHIPPED["sdk/chain-trust.ts"] ?? "";

describe("the scan behind those assertions is real", () => {
  it("walked the tree and found the trust module", () => {
    expect(Object.keys(SHIPPED).length).toBeGreaterThan(50);
    expect(TRUST_SOURCE.length).toBeGreaterThan(1_000);
  });

  it("the genesis-literal detector fires on a real 64-hex hash", () => {
    const synthetic =
      "const pin = '0xe22733f4d7e013b93f0f825667fcf852cbf7ad1ca31a42a1bfcf1ab6d79c89a3';";
    expect(/0x[0-9a-f]{8}[0-9a-f]{56}/i.test(synthetic)).toBe(true);
    // …and not on a short hex, an address, or a tx hash prefix.
    expect(/0x[0-9a-f]{8}[0-9a-f]{56}/i.test("0x10F2C")).toBe(false);
    expect(/0x[0-9a-f]{8}[0-9a-f]{56}/i.test("0x8105a54a9989b588c1dae8942de8d3272fd83592")).toBe(false);
  });
});
