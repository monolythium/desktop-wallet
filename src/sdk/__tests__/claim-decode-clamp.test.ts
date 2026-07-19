// The claim decoder's plausibility ceiling.
//
// A decoded amount is trusted because it came from a receipt log, but the
// receipt came from an operator. An implausible figure — beyond twice the
// genesis supply — is a rogue or buggy echo, not money that moved.
//
// It is treated as undecodable rather than clamped DOWN to the ceiling.
// Clamping would turn a garbage reading into a plausible-looking figure and
// erase the evidence that the answer was garbage; the honest outcome is the bare
// "Rewards claimed" title with no number at all.

import { afterEach, describe, expect, it, vi } from "vitest";
import { CLAIMED_EVENT_TOPIC0 } from "@monolythium/core-sdk";

const lythDecodeTx = vi.fn();
vi.mock("../client", () => ({
  getProvider: () => ({ rpcClient: { lythDecodeTx } }),
}));

import { MAX_PLAUSIBLE_CLAIM_LYTHOSHI, decodeClaimedAmount } from "../live";

/** One 32-byte ABI word. */
const word = (n: bigint) => n.toString(16).padStart(64, "0");

/** A receipt carrying a Claimed(wallet, amount, autoCompound) log. */
function receiptWithClaim(amountLythoshi: bigint) {
  return {
    logs: [
      {
        topics: [CLAIMED_EVENT_TOPIC0, `0x${word(1n)}`],
        data: `0x${word(amountLythoshi)}${word(0n)}`,
      },
    ],
  };
}

const LYTH = 10n ** 18n;

describe("decodeClaimedAmount", () => {
  afterEach(() => vi.clearAllMocks());

  it("decodes a normal settlement", async () => {
    lythDecodeTx.mockResolvedValue(receiptWithClaim(882914150695720660n));
    expect(await decodeClaimedAmount("0xabc")).toBe("0.88291415069572066");
  });

  it("decodes a whole-LYTH settlement", async () => {
    lythDecodeTx.mockResolvedValue(receiptWithClaim(5n * LYTH));
    expect(await decodeClaimedAmount("0xabc")).toBe("5");
  });

  it("accepts a value exactly AT the ceiling", async () => {
    lythDecodeTx.mockResolvedValue(receiptWithClaim(MAX_PLAUSIBLE_CLAIM_LYTHOSHI));
    expect(await decodeClaimedAmount("0xabc")).not.toBeNull();
  });

  it("refuses a value ABOVE the ceiling — undecodable, not clamped", async () => {
    const bogus = MAX_PLAUSIBLE_CLAIM_LYTHOSHI + 1n;
    lythDecodeTx.mockResolvedValue(receiptWithClaim(bogus));
    const out = await decodeClaimedAmount("0xabc");
    expect(out).toBeNull();
    // Explicitly NOT the ceiling value — clamping would launder the garbage.
    expect(out).not.toBe("200000000");
  });

  it("refuses an absurd value outright", async () => {
    lythDecodeTx.mockResolvedValue(receiptWithClaim(2n ** 200n));
    expect(await decodeClaimedAmount("0xabc")).toBeNull();
  });

  it("the ceiling is twice the genesis supply", async () => {
    expect(MAX_PLAUSIBLE_CLAIM_LYTHOSHI).toBe(200_000_000n * LYTH);
  });

  it("returns null when no Claimed log is present", async () => {
    // A NoClaimableRewards revert emits none; so does any non-claim receipt.
    lythDecodeTx.mockResolvedValue({ logs: [] });
    expect(await decodeClaimedAmount("0xabc")).toBeNull();
    lythDecodeTx.mockResolvedValue({ logs: [{ topics: ["0xdead"], data: "0x" }] });
    expect(await decodeClaimedAmount("0xabc")).toBeNull();
  });

  it("returns null on a failed read rather than throwing", async () => {
    lythDecodeTx.mockRejectedValue(new Error("transaction not found"));
    expect(await decodeClaimedAmount("0xabc")).toBeNull();
  });

  it("returns null on a malformed log rather than throwing", async () => {
    lythDecodeTx.mockResolvedValue({
      logs: [{ topics: [CLAIMED_EVENT_TOPIC0], data: "0xnothex" }],
    });
    expect(await decodeClaimedAmount("0xabc")).toBeNull();
  });
});
