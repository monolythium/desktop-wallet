// The MRV seam reads the quote ZERO times once the surface has priced it.
//
// These two surfaces rendered the literal `"node quote"` where a fee belonged —
// the same shape as the delegation block's "applies (paid in LYTH)", and the one
// the preimage map called worse than absence. They also could not use the shared
// plan directly: MRV does not route through `submitNativeTx` and defaults its
// max price to the quote's SUMMED per-unit price rather than the SDK resolver's
// safety-multiplied one, so `feeClass: "mrv"` reproduces that instead.
//
// The property asserted here is stronger than "the numbers agree". Supplying
// both fee fields makes `resolveNativeContext`'s `needsQuote` false, so the seam
// issues no second read AT ALL — and a read that never happens cannot return a
// different price.

import { describe, expect, it } from "vitest";
import { RpcClient } from "@monolythium/core-sdk";
import { ML_DSA_65_SEED_LEN } from "@monolythium/core-sdk/crypto";
import { buildMrvCallTransactionPlan } from "../mrv";
import { MAX_EXECUTION_UNIT_PRICE_LYTHOSHI } from "../fee-model";

const CONTRACT_HEX = "0x2222222222222222222222222222222222222222";

function mockRpc(): { client: RpcClient; methods: () => string[] } {
  const methods: string[] = [];
  const fetchStub: typeof fetch = async (_url, init) => {
    const body = JSON.parse(String(init?.body)) as { id?: number; method: string };
    methods.push(body.method);
    let result: unknown;
    switch (body.method) {
      case "lyth_getTransactionCount":
        result = "0x5";
        break;
      case "lyth_executionUnitPrice":
        // Deliberately absurd: if the seam DID re-read, the signed max price
        // would be this clamped to the ceiling rather than what was supplied.
        result = {
          executionUnitPriceLythoshi: (MAX_EXECUTION_UNIT_PRICE_LYTHOSHI * 10n).toString(),
          basePricePerExecutionUnitLythoshi: (MAX_EXECUTION_UNIT_PRICE_LYTHOSHI * 10n).toString(),
          priorityTipLythoshi: "1000000000",
          blockNumber: 1,
          source: "test",
        };
        break;
      default:
        throw new Error(`unhandled: ${body.method}`);
    }
    return new Response(JSON.stringify({ jsonrpc: "2.0", id: body.id ?? 1, result }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };
  return { client: new RpcClient("http://test.invalid", { fetch: fetchStub }), methods: () => methods };
}

const SUPPLIED_MAX = "2000000000";
const SUPPLIED_TIP = "1000000000";

describe("a priced MRV surface does not re-read the quote", () => {
  it("issues NO `lyth_executionUnitPrice` call when both fee fields are supplied", async () => {
    const rpc = mockRpc();
    const plan = await buildMrvCallTransactionPlan({
      client: rpc.client,
      seed: new Uint8Array(ML_DSA_65_SEED_LEN).fill(0x41),
      contractAddress: CONTRACT_HEX,
      input: "0x0102",
      valueLythoshi: "0",
      executionUnitLimit: 50_000n,
      maxExecutionFeeLythoshi: SUPPLIED_MAX,
      priorityTipLythoshi: SUPPLIED_TIP,
    });

    // Anti-vacuity: the plan really was built against this transport.
    expect(rpc.methods()).toContain("lyth_getTransactionCount");
    expect(plan.nativeTx.nonce).toBe(5n);

    expect(rpc.methods()).not.toContain("lyth_executionUnitPrice");
    expect(plan.nativeTx.maxExecutionFeeLythoshi).toBe(SUPPLIED_MAX);
    expect(plan.nativeTx.priorityTipLythoshi).toBe(SUPPLIED_TIP);
  });

  it("DOES read it when the surface supplies nothing — the control", async () => {
    // Without this the assertion above would pass on a seam that had stopped
    // reading quotes entirely, and the absurd price below proves the read is
    // the one that would have produced a different number.
    const rpc = mockRpc();
    const plan = await buildMrvCallTransactionPlan({
      client: rpc.client,
      seed: new Uint8Array(ML_DSA_65_SEED_LEN).fill(0x41),
      contractAddress: CONTRACT_HEX,
      input: "0x0102",
      valueLythoshi: "0",
      executionUnitLimit: 50_000n,
    });
    expect(rpc.methods()).toContain("lyth_executionUnitPrice");
    expect(plan.nativeTx.maxExecutionFeeLythoshi).toBe(
      MAX_EXECUTION_UNIT_PRICE_LYTHOSHI.toString(),
    );
    expect(plan.nativeTx.maxExecutionFeeLythoshi).not.toBe(SUPPLIED_MAX);
  });

  it("re-clamping a supplied value is idempotent — the seam's own clamp cannot move it", async () => {
    // `mrv.ts` clamps unconditionally (R9), so a pre-clamped value passes
    // through it a second time. If that were not idempotent the shown and
    // signed numbers would part company at the last step.
    const rpc = mockRpc();
    const atCeiling = MAX_EXECUTION_UNIT_PRICE_LYTHOSHI.toString();
    const plan = await buildMrvCallTransactionPlan({
      client: rpc.client,
      seed: new Uint8Array(ML_DSA_65_SEED_LEN).fill(0x41),
      contractAddress: CONTRACT_HEX,
      input: "0x0102",
      valueLythoshi: "0",
      executionUnitLimit: 50_000n,
      maxExecutionFeeLythoshi: atCeiling,
      priorityTipLythoshi: SUPPLIED_TIP,
    });
    expect(plan.nativeTx.maxExecutionFeeLythoshi).toBe(atCeiling);
    expect(plan.nativeTx.priorityTipLythoshi).toBe(SUPPLIED_TIP);
  });
});
