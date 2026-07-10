import { describe, expect, it, vi } from "vitest";
import type { RpcClient } from "@monolythium/core-sdk";

// Override only resolveExecutionFee so the executionUnitLimit pass-through is
// testable offline; every other SDK export (formatLyth, RpcClient) stays real.
const resolveExecutionFeeSpy = vi.fn((..._args: unknown[]) =>
  Promise.resolve({ maxFeePerGas: 1000n, maxPriorityFeePerGas: 1000n, gasLimit: 250_000n }),
);
vi.mock("@monolythium/core-sdk", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@monolythium/core-sdk")>()),
  resolveExecutionFee: (...args: unknown[]) => resolveExecutionFeeSpy(...args),
}));

import { formatLyth } from "@monolythium/core-sdk";
import { maxFeeLythoshiFrom, previewTransferFee, totalReservedLyth } from "../fee-preview";

const dummyClient = {} as unknown as RpcClient;

describe("maxFeeLythoshiFrom", () => {
  it("multiplies the per-unit cap by the execution-unit limit", () => {
    const fee = { maxFeePerGas: 2000n, maxPriorityFeePerGas: 2000n, gasLimit: 100_000n };
    expect(maxFeeLythoshiFrom(fee)).toBe(200_000_000n);
  });
});

describe("totalReservedLyth", () => {
  it("sums amount + max fee and formats as LYTH", () => {
    const amount = 1_500_000_000_000_000_000n; // 1.5 LYTH (18 decimals)
    const maxFee = 2_000_000_000_000_000_000n; // 2 LYTH
    const total = totalReservedLyth(amount, maxFee);
    expect(total).toBe(formatLyth((amount + maxFee).toString(), { includeUnit: false }));
    // 1.5 + 2 = 3.5 LYTH
    expect(Number(total.replace(/,/g, ""))).toBeCloseTo(3.5, 6);
  });

  it("handles a zero amount (fee-only reservation)", () => {
    const total = totalReservedLyth(0n, 2_000_000_000_000_000_000n);
    expect(Number(total.replace(/,/g, ""))).toBeCloseTo(2, 6);
  });
});

describe("previewTransferFee — executionUnitLimit pass-through", () => {
  it("forwards a token-call unit limit so the shown max fee matches the reserve", async () => {
    resolveExecutionFeeSpy.mockClear();
    const preview = await previewTransferFee(dummyClient, 250_000n);
    expect(resolveExecutionFeeSpy).toHaveBeenCalledWith(dummyClient, { executionUnitLimit: 250_000n });
    // 1000 per-unit × 250k units = 250,000,000 lythoshi worst-case max.
    expect(preview.maxFeeLythoshi).toBe(250_000_000n);
    expect(preview.maxFeeLyth).toBe(formatLyth("250000000", { includeUnit: false }));
  });

  it("passes no options for a plain native transfer (SDK default limit)", async () => {
    resolveExecutionFeeSpy.mockClear();
    await previewTransferFee(dummyClient);
    expect(resolveExecutionFeeSpy).toHaveBeenCalledWith(dummyClient, undefined);
  });
});
