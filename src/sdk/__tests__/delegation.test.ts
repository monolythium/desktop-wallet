// Delegation encoder — calldata byte-shape correctness.
//
// The targets are the four-byte selectors derived from the Solidity
// signatures pinned in `mono-core`'s
// `crates/precompiles/system/delegation/src/abi.rs`. If the chain
// ever renumbers a selector (the freeze policy says it shouldn't),
// this test fails — that's the right failure mode.

import { describe, expect, it } from "vitest";
import { keccak256, toUtf8Bytes } from "ethers";
import {
  DELEGATION_PRECOMPILE,
  DELEGATION_SELECTORS,
  encodeClaim,
  encodeDelegate,
  encodeRedelegate,
  encodeSetAutoCompound,
  encodeUndelegate,
} from "../delegation";
import { TEST_ADDRESS } from "../../__tests__/helpers/fixtures";

function expectSelector(sig: string, sel: string): void {
  const hash = keccak256(toUtf8Bytes(sig));
  expect(sel).toBe(hash.slice(0, 10));
}

describe("delegation precompile selectors", () => {
  it("match keccak256(signature)[0..4] for every op", () => {
    expectSelector("delegate(uint32,uint16)", DELEGATION_SELECTORS.delegate);
    expectSelector("undelegate(uint32)", DELEGATION_SELECTORS.undelegate);
    expectSelector(
      "redelegate(uint32,uint32,uint16)",
      DELEGATION_SELECTORS.redelegate,
    );
    expectSelector("claim()", DELEGATION_SELECTORS.claim);
    expectSelector("setAutoCompound(bool)", DELEGATION_SELECTORS.setAutoCompound);
  });
});

describe("encodeDelegate", () => {
  it("targets the delegation precompile + EIP-1559 type", () => {
    const tx = encodeDelegate({ from: TEST_ADDRESS, clusterId: 0, weightBps: 5000 });
    expect(tx.to).toBe(DELEGATION_PRECOMPILE);
    expect(tx.from).toBe(TEST_ADDRESS);
    expect(tx.type).toBe(2);
    expect(tx.value).toBe(0n);
  });

  it("encodes the selector + (cluster, weightBps) as two right-aligned words", () => {
    const tx = encodeDelegate({ from: TEST_ADDRESS, clusterId: 7, weightBps: 5_000 });
    // 4 byte selector + 2 × 32 byte words = 4 + 64 = 68 bytes; hex = 0x + 136 chars.
    expect(typeof tx.data).toBe("string");
    expect((tx.data as string).length).toBe(2 + 8 + 64 * 2);
    // Selector front-of-string.
    expect((tx.data as string).startsWith(DELEGATION_SELECTORS.delegate)).toBe(true);
    // Cluster word (bytes 4..36) — right-aligned 32-byte uint32 (0x00..00_00_00_00_07).
    const clusterWord = (tx.data as string).slice(2 + 8, 2 + 8 + 64);
    expect(clusterWord).toBe("0".repeat(62) + "07");
    // Weight word (bytes 36..68) — right-aligned uint16 (5000 = 0x1388).
    const weightWord = (tx.data as string).slice(2 + 8 + 64);
    expect(weightWord).toBe("0".repeat(60) + "1388");
  });

  it("rejects weightBps out of [0, 10000]", () => {
    expect(() =>
      encodeDelegate({ from: TEST_ADDRESS, clusterId: 0, weightBps: 10_001 }),
    ).toThrow(/weightBps/);
    expect(() =>
      encodeDelegate({ from: TEST_ADDRESS, clusterId: 0, weightBps: -1 }),
    ).toThrow(/weightBps/);
  });

  it("rejects non-integer cluster ids", () => {
    expect(() =>
      encodeDelegate({ from: TEST_ADDRESS, clusterId: 1.5, weightBps: 0 }),
    ).toThrow(/clusterId/);
  });
});

describe("encodeUndelegate", () => {
  it("encodes selector + cluster (single word)", () => {
    const tx = encodeUndelegate({ from: TEST_ADDRESS, clusterId: 42 });
    expect(tx.to).toBe(DELEGATION_PRECOMPILE);
    expect((tx.data as string).startsWith(DELEGATION_SELECTORS.undelegate)).toBe(true);
    // Cluster word.
    const word = (tx.data as string).slice(2 + 8);
    expect(word).toBe("0".repeat(62) + "2a");
  });
});

describe("encodeRedelegate", () => {
  it("encodes selector + (from, to, weight) as three words", () => {
    const tx = encodeRedelegate({
      from: TEST_ADDRESS,
      fromClusterId: 1,
      toClusterId: 2,
      weightBps: 100,
    });
    expect((tx.data as string).startsWith(DELEGATION_SELECTORS.redelegate)).toBe(true);
    // Three 32-byte words after the selector.
    expect((tx.data as string).length).toBe(2 + 8 + 64 * 3);
    const fromWord = (tx.data as string).slice(2 + 8, 2 + 8 + 64);
    const toWord = (tx.data as string).slice(2 + 8 + 64, 2 + 8 + 64 * 2);
    const weightWord = (tx.data as string).slice(2 + 8 + 64 * 2);
    expect(fromWord).toBe("0".repeat(62) + "01");
    expect(toWord).toBe("0".repeat(62) + "02");
    expect(weightWord).toBe("0".repeat(60) + "0064");
  });

  it("rejects same-cluster redelegation", () => {
    expect(() =>
      encodeRedelegate({
        from: TEST_ADDRESS,
        fromClusterId: 5,
        toClusterId: 5,
        weightBps: 100,
      }),
    ).toThrow(/differ/);
  });
});

describe("encodeClaim", () => {
  it("produces a bare 4-byte selector calldata", () => {
    const tx = encodeClaim({ from: TEST_ADDRESS });
    expect(tx.to).toBe(DELEGATION_PRECOMPILE);
    expect(tx.data).toBe(DELEGATION_SELECTORS.claim);
    expect(tx.value).toBe(0n);
  });
});

describe("encodeSetAutoCompound", () => {
  it("encodes selector + bool word (0x01 for true)", () => {
    const tx = encodeSetAutoCompound({ from: TEST_ADDRESS, enabled: true });
    expect(tx.data).toBe(
      DELEGATION_SELECTORS.setAutoCompound + "0".repeat(63) + "1",
    );
  });

  it("encodes selector + bool word (0x00 for false)", () => {
    const tx = encodeSetAutoCompound({ from: TEST_ADDRESS, enabled: false });
    expect(tx.data).toBe(
      DELEGATION_SELECTORS.setAutoCompound + "0".repeat(64),
    );
  });
});
