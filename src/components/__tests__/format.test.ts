// `formatAddress` + `formatAddressShort` — whitepaper §22.7 display
// layer. The helpers must:
//
//   - convert any 0x-shaped 20-byte hex address to bech32m
//   - pass through anything that already looks bech32m or names
//   - never throw at render time, even on malformed input
//   - keep the `mono1` HRP visible in the short form so the network
//     is unmistakable at a glance

import { describe, expect, it } from "vitest";
import { formatAddress, formatAddressShort } from "../format";
import { TEST_ADDRESS, TEST_BECH32M } from "../../__tests__/helpers/fixtures";

describe("formatAddress", () => {
  it("converts 0x hex to mono1 bech32m (zero address)", () => {
    expect(formatAddress(TEST_BECH32M.zero.hex)).toBe(TEST_BECH32M.zero.bech32);
  });

  it("converts 0x hex to mono1 bech32m (anvil0)", () => {
    expect(formatAddress(TEST_ADDRESS)).toBe(TEST_BECH32M.anvil0.bech32);
  });

  it("accepts uppercase 0X prefix", () => {
    expect(formatAddress("0X" + TEST_ADDRESS.slice(2))).toBe(
      TEST_BECH32M.anvil0.bech32,
    );
  });

  it("passes through a bech32m string unchanged", () => {
    expect(formatAddress(TEST_BECH32M.anvil0.bech32)).toBe(
      TEST_BECH32M.anvil0.bech32,
    );
  });

  it("passes through null and undefined as an em-dash", () => {
    expect(formatAddress(null)).toBe("—");
    expect(formatAddress(undefined)).toBe("—");
    expect(formatAddress("")).toBe("—");
  });

  it("passes through malformed hex without throwing", () => {
    // Too short — SDK rejects, but the helper must keep rendering.
    expect(formatAddress("0xdead")).toBe("0xdead");
    // Non-hex characters — same contract.
    expect(formatAddress("0xzzzz...")).toBe("0xzzzz...");
  });

  it("passes through arbitrary non-0x strings (names, demo placeholders)", () => {
    expect(formatAddress("alice.mono")).toBe("alice.mono");
    expect(formatAddress("mvk:mira:p2p:10aa…77fc")).toBe(
      "mvk:mira:p2p:10aa…77fc",
    );
  });
});

describe("formatAddressShort", () => {
  it("shortens bech32m output keeping the mono1 prefix + 4 trailing body chars", () => {
    // anvil0 bech32m: mono1 + 32 body + 6 checksum = 43 chars total.
    // Compact form: mono1 + 8 body + … + 4 last body chars + checksum?
    // The implementation slices the post-`mono1` body, so we just
    // assert the shape and the first/last anchors.
    const short = formatAddressShort(TEST_ADDRESS);
    expect(short.startsWith("mono1")).toBe(true);
    expect(short).toContain("…");
    // The last 4 chars of the short form correspond to the last 4 chars
    // of the bech32m body (which ends with the 6-char checksum tail).
    const fullBech = TEST_BECH32M.anvil0.bech32;
    expect(short.endsWith(fullBech.slice(-4))).toBe(true);
  });

  it("passes through null/undefined as em-dash", () => {
    expect(formatAddressShort(null)).toBe("—");
    expect(formatAddressShort(undefined)).toBe("—");
  });

  it("passes short non-0x strings through unchanged", () => {
    expect(formatAddressShort("alice.mono")).toBe("alice.mono");
  });

  it("falls back to hex shortener for malformed 0x input", () => {
    // Long-enough malformed hex — `shortHex(addr, 6, 4)` style truncation.
    const garbage = "0x" + "z".repeat(40);
    const out = formatAddressShort(garbage);
    expect(out).toContain("…");
    expect(out.startsWith("0x")).toBe(true);
  });
});
