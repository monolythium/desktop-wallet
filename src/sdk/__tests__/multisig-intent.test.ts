// multisig-intent — encode/decode + tolerant decode helper.

import { describe, expect, it } from "vitest";
import {
  decodeIntent,
  decodeIntentFromHex,
  describeIntent,
  encodeErc20TransferIntent,
  encodeNameRegisterIntent,
  encodeNameTransferIntent,
  encodeNftTransferIntent,
  encodeSendIntent,
  encodeStakeDelegateIntent,
  encodeStakeRedelegateIntent,
  encodeStakeUndelegateIntent,
  tryDecodeIntentFromHex,
} from "../multisig-intent";

describe("multisig-intent · send", () => {
  it("encodes and decodes a send intent round-trip", () => {
    const bytes = encodeSendIntent({
      to: "0x" + "ab".repeat(20),
      amountLyth: "12.5",
    });
    const back = decodeIntent(bytes);
    expect(back.kind).toBe("send");
    if (back.kind !== "send") return;
    expect(back.to).toBe("0x" + "ab".repeat(20));
    expect(back.amountLyth).toBe("12.5");
  });

  it("decodes from a hex string mirroring the proposal record", () => {
    const bytes = encodeSendIntent({ to: "0x" + "11".repeat(20), amountLyth: "1" });
    const hex =
      "0x" +
      Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
    const back = decodeIntentFromHex(hex);
    expect(back.kind).toBe("send");
  });

  it("rejects missing fields", () => {
    expect(() =>
      decodeIntent(new TextEncoder().encode('{"kind":"send"}')),
    ).toThrow(/missing to\/amountLyth/);
  });

  it("rejects unknown kinds", () => {
    expect(() =>
      decodeIntent(new TextEncoder().encode('{"kind":"unknown"}')),
    ).toThrow(/Unknown intent kind/);
  });

  it("tryDecodeIntentFromHex returns null on bad input", () => {
    expect(tryDecodeIntentFromHex("0xdeadbeef")).toBeNull();
    expect(tryDecodeIntentFromHex("not hex")).toBeNull();
  });
});

describe("multisig-intent · stake", () => {
  it("encodes + decodes stake_delegate", () => {
    const bytes = encodeStakeDelegateIntent({ clusterId: 42, weightBps: 2500 });
    const back = decodeIntent(bytes);
    expect(back.kind).toBe("stake_delegate");
    if (back.kind !== "stake_delegate") return;
    expect(back.clusterId).toBe(42);
    expect(back.weightBps).toBe(2500);
  });

  it("encodes + decodes stake_undelegate", () => {
    const bytes = encodeStakeUndelegateIntent({ clusterId: 7, weightBps: 1000 });
    const back = decodeIntent(bytes);
    expect(back.kind).toBe("stake_undelegate");
  });

  it("encodes + decodes stake_redelegate", () => {
    const bytes = encodeStakeRedelegateIntent({
      fromClusterId: 1,
      toClusterId: 2,
      weightBps: 500,
    });
    const back = decodeIntent(bytes);
    expect(back.kind).toBe("stake_redelegate");
    if (back.kind !== "stake_redelegate") return;
    expect(back.fromClusterId).toBe(1);
    expect(back.toClusterId).toBe(2);
  });

  it("rejects stake_redelegate with from === to", () => {
    expect(() =>
      encodeStakeRedelegateIntent({ fromClusterId: 1, toClusterId: 1, weightBps: 100 }),
    ).toThrow(/distinct from\/to/);
  });

  it("rejects stake_delegate with negative clusterId", () => {
    expect(() =>
      encodeStakeDelegateIntent({ clusterId: -1, weightBps: 100 }),
    ).toThrow(/non-negative integer clusterId/);
  });

  it("rejects stake_delegate with zero weight", () => {
    expect(() =>
      encodeStakeDelegateIntent({ clusterId: 1, weightBps: 0 }),
    ).toThrow(/positive integer weightBps/);
  });
});

describe("multisig-intent · naming", () => {
  it("encodes + decodes name_register", () => {
    const bytes = encodeNameRegisterIntent({
      name: "Alice",
      category: "human",
      durationYears: 2,
    });
    const back = decodeIntent(bytes);
    expect(back.kind).toBe("name_register");
    if (back.kind !== "name_register") return;
    // Encoder lowercases the name canonically.
    expect(back.name).toBe("alice");
    expect(back.durationYears).toBe(2);
  });

  it("encodes + decodes name_transfer", () => {
    const bytes = encodeNameTransferIntent({
      name: "alice",
      recipient: "0x" + "ab".repeat(20),
    });
    const back = decodeIntent(bytes);
    expect(back.kind).toBe("name_transfer");
  });

  it("rejects name_register with out-of-range duration", () => {
    expect(() =>
      encodeNameRegisterIntent({ name: "x", category: "human", durationYears: 11 }),
    ).toThrow(/durationYears out of range/);
  });
});

describe("multisig-intent · token transfer", () => {
  it("encodes + decodes erc20_transfer", () => {
    const bytes = encodeErc20TransferIntent({
      token: "0x" + "cd".repeat(20),
      to: "0x" + "ab".repeat(20),
      amount: "1000000000000000000",
    });
    const back = decodeIntent(bytes);
    expect(back.kind).toBe("erc20_transfer");
    if (back.kind !== "erc20_transfer") return;
    expect(back.amount).toBe("1000000000000000000");
  });

  it("encodes + decodes nft_transfer (erc721)", () => {
    const bytes = encodeNftTransferIntent({
      contract: "0x" + "cd".repeat(20),
      to: "0x" + "ab".repeat(20),
      tokenId: "42",
      amount: "1",
      standard: "erc721",
    });
    const back = decodeIntent(bytes);
    expect(back.kind).toBe("nft_transfer");
    if (back.kind !== "nft_transfer") return;
    expect(back.standard).toBe("erc721");
  });

  it("encodes + decodes nft_transfer (erc1155 with multi-amount)", () => {
    const bytes = encodeNftTransferIntent({
      contract: "0x" + "cd".repeat(20),
      to: "0x" + "ab".repeat(20),
      tokenId: "9999999999999999999",
      amount: "5",
      standard: "erc1155",
    });
    const back = decodeIntent(bytes);
    expect(back.kind).toBe("nft_transfer");
    if (back.kind !== "nft_transfer") return;
    expect(back.tokenId).toBe("9999999999999999999"); // no precision loss
    expect(back.amount).toBe("5");
  });

  it("rejects nft_transfer with unknown standard", () => {
    expect(() =>
      encodeNftTransferIntent({
        contract: "0xabc",
        to: "0xdef",
        tokenId: "1",
        amount: "1",
        // @ts-expect-error — testing runtime rejection
        standard: "erc777",
      }),
    ).toThrow(/unknown NFT standard/);
  });
});

describe("multisig-intent · canonical encoding", () => {
  it("two encodes of the same shape produce byte-identical output", () => {
    const a = encodeStakeDelegateIntent({ clusterId: 7, weightBps: 500 });
    const b = encodeStakeDelegateIntent({ clusterId: 7, weightBps: 500 });
    expect(a).toEqual(b);
  });

  it("describeIntent produces a human-friendly line per kind", () => {
    expect(
      describeIntent({ kind: "send", to: "0x" + "ab".repeat(20), amountLyth: "1.5" }),
    ).toMatch(/Send 1\.5 LYTH/);
    expect(
      describeIntent({ kind: "stake_delegate", clusterId: 9, weightBps: 250 }),
    ).toMatch(/Delegate 2\.50% to cluster 9/);
    expect(
      describeIntent({
        kind: "name_register",
        name: "alice",
        category: "human",
        durationYears: 1,
      }),
    ).toMatch(/Register .human\/alice/);
    expect(
      describeIntent({
        kind: "nft_transfer",
        contract: "0x" + "cd".repeat(20),
        to: "0x" + "ab".repeat(20),
        tokenId: "42",
        amount: "1",
        standard: "erc721",
      }),
    ).toMatch(/ERC721 #42/);
  });
});
