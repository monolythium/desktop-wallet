// The quote read + per-tier expansion (T2). A stub RpcClient supplies the
// `lyth_executionUnitPrice` response; no network.

import { describe, expect, it } from "vitest";
import type { RpcClient } from "@monolythium/core-sdk";
import { getExecutionUnitQuote } from "../native-rpc";
import { previewNativeSendFee } from "../fee-preview";

function stubClient(resp: unknown): RpcClient {
  return { lythExecutionUnitPrice: async () => resp } as unknown as RpcClient;
}

const okQuote = (over: Record<string, unknown> = {}) => ({
  executionUnitPriceLythoshi: "2000000000",
  basePricePerExecutionUnitLythoshi: "1000000000",
  priorityTipLythoshi: "1000000000",
  blockNumber: 1,
  source: "latest_block",
  ...over,
});

describe("getExecutionUnitQuote", () => {
  it("normalizes base + tip separately and carries the source; ignores the summed field", async () => {
    const q = await getExecutionUnitQuote(stubClient(okQuote({ executionUnitPriceLythoshi: "999" })));
    expect(q.baseLythoshi).toBe(1_000_000_000n);
    expect(q.suggestedTipLythoshi).toBe(1_000_000_000n);
    expect(q.source).toBe("latest_block");
  });

  it("accepts hex and decimal quantity forms", async () => {
    const q = await getExecutionUnitQuote(stubClient(okQuote({ basePricePerExecutionUnitLythoshi: "0x3b9aca00" })));
    expect(q.baseLythoshi).toBe(1_000_000_000n); // 0x3b9aca00
  });

  it("throws with the field name on a malformed quantity", async () => {
    await expect(getExecutionUnitQuote(stubClient(okQuote({ basePricePerExecutionUnitLythoshi: "not-a-number" })))).rejects.toThrow(
      /basePricePerExecutionUnitLythoshi/,
    );
    await expect(getExecutionUnitQuote(stubClient(okQuote({ priorityTipLythoshi: "-5" })))).rejects.toThrow(
      /priorityTipLythoshi/,
    );
  });
});

describe("previewNativeSendFee", () => {
  it("expands the quote into per-tier native results at the 30_000 limit", async () => {
    const b = await previewNativeSendFee(stubClient(okQuote()), {});
    expect(b.quote.baseLythoshi).toBe(1_000_000_000n);
    expect(b.perTier.normal.chargeLythoshi).toBe(42_000_000_000_000n);
    expect(b.perTier.normal.reservationLythoshi).toBe(60_000_000_000_000n); // 2e9 × 30_000
    expect(b.perTier.fast.reservationLythoshi).toBe(90_000_000_000_000n); // 3e9 × 30_000
  });

  it("uses the 250_000 token limit for a token transfer", async () => {
    const b = await previewNativeSendFee(stubClient(okQuote()), { tokenTransfer: true });
    expect(b.perTier.normal.reservationLythoshi).toBe(2_000_000_000n * 250_000n);
    expect(b.perTier.fast.reservationLythoshi).toBe(3_000_000_000n * 250_000n);
  });
});
