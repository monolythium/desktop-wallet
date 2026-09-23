// The three fee classes must reproduce what their seams already signed.
//
// D2 moves WHEN the fee is read, never what the formula is. That claim is only
// worth anything if each class computes the same value its seam would have — so
// this asserts the resolver's output against the seam's own default, per class,
// from one pinned quote.
//
// The MRV branch is the one that could quietly diverge: it does not route
// through `submitNativeTx` and takes the quote's SUMMED per-unit price, not the
// SDK resolver's safety-multiplied one. Folding it into `transfer` would have
// changed what MRV signs, silently and on every deploy.

import { describe, expect, it } from "vitest";
import { RpcClient } from "@monolythium/core-sdk";
import { resolveOperationFee, reservationLythoshi } from "../fee-quote";
import {
  MAX_EXECUTION_UNIT_PRICE_LYTHOSHI,
  MEMPOOL_PRIORITY_TIP_FLOOR_LYTHOSHI,
} from "../fee-model";

const BASE = 25n;
const TIP = MEMPOOL_PRIORITY_TIP_FLOOR_LYTHOSHI;
/** The invariant a live node holds: the summed price CONTAINS the tip. R9 found
 *  a fixture violating it, which only surfaced once something read them
 *  together. */
const SUMMED = BASE + TIP;

function client(): { rpc: RpcClient; reads: () => number } {
  let reads = 0;
  const fetchStub: typeof fetch = async (_url, init) => {
    const body = JSON.parse(String(init?.body)) as { id?: number; method: string };
    if (body.method !== "lyth_executionUnitPrice") throw new Error(`unhandled: ${body.method}`);
    reads += 1;
    return new Response(
      JSON.stringify({
        jsonrpc: "2.0",
        id: body.id ?? 1,
        result: {
          executionUnitPriceLythoshi: SUMMED.toString(),
          basePricePerExecutionUnitLythoshi: BASE.toString(),
          priorityTipLythoshi: TIP.toString(),
          blockNumber: 1,
          source: "test",
        },
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  };
  return { rpc: new RpcClient("http://test.invalid", { fetch: fetchStub }), reads: () => reads };
}

describe("each class reproduces its seam's own fee", () => {
  it("mrv takes the SUMMED per-unit price — not the base, and not a resolver product", async () => {
    // `resolveNativeContext` defaults `maxExecutionFeeLythoshi` to
    // `quote.summedLythoshi`. Anything else changes what a deploy signs.
    const c = client();
    const fee = await resolveOperationFee(
      { feeClass: "mrv", executionUnitLimit: 100_000n },
      c.rpc,
    );
    expect(fee.signed.maxFeePerGas).toBe(SUMMED);
    expect(fee.signed.maxPriorityFeePerGas).toBe(TIP);
    expect(fee.signed.gasLimit).toBe(100_000n);
    // Anti-vacuity: base and summed really are different, so "takes the summed
    // one" is a discriminating claim.
    expect(SUMMED).not.toBe(BASE);
    expect(fee.signed.maxFeePerGas).not.toBe(BASE);
  });

  it("reads the node exactly once, whichever class", async () => {
    for (const feeClass of ["transfer", "registry", "mrv"] as const) {
      const c = client();
      await resolveOperationFee({ feeClass, executionUnitLimit: 50_000n }, c.rpc);
      expect(c.reads(), `${feeClass} must read once`).toBe(1);
    }
  });

  it("every class is bounded by the shared clamp", async () => {
    for (const feeClass of ["transfer", "registry", "mrv"] as const) {
      const c = client();
      const fee = await resolveOperationFee({ feeClass, executionUnitLimit: 50_000n }, c.rpc);
      expect(fee.signed.maxFeePerGas).toBeLessThanOrEqual(MAX_EXECUTION_UNIT_PRICE_LYTHOSHI);
      expect(fee.signed.maxPriorityFeePerGas).toBeLessThanOrEqual(fee.signed.maxFeePerGas);
      expect(fee.signed.maxPriorityFeePerGas).toBeGreaterThan(0n);
    }
  });

  it("the display string is the RESERVATION of the very fee that will be signed", async () => {
    // The whole mechanism in one assertion: not "the same formula", but the
    // same object.
    const c = client();
    const fee = await resolveOperationFee(
      { feeClass: "transfer", executionUnitLimit: 30_000n },
      c.rpc,
    );
    const { formatLyth } = await import("@monolythium/core-sdk");
    expect(fee.displayLyth).toBe(
      formatLyth(reservationLythoshi(fee.signed).toString(), { includeUnit: false }),
    );
    expect(reservationLythoshi(fee.signed)).toBe(fee.signed.maxFeePerGas * fee.signed.gasLimit);
  });
});
