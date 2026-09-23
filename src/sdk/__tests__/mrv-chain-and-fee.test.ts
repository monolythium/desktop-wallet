// D1 — the two signed fields the MRV seam used to take from the operator it
// submits to.
//
// This is the wallet's only signing path that does not route through
// `submitNativeTx`, so it inherited neither of that seam's bindings: the chain
// id came from `eth_chainId` (the operator's own claim about which chain it
// serves) and the fee had no client-side ceiling at all.
//
// WHY THE FIX IS NOT A DISPLAY CHANGE. Rendering an operator-supplied chain id
// on the confirm surface hands the user a number with nothing to check it
// against. The wallet, by contrast, already knows the answer — it refuses to
// talk to an operator that does not match `activeChainPin()`. Signing that
// value instead of the reported one removes the question rather than asking it.
//
// Both assertions are driven through the real plan builders, which are the same
// `prepare*` helpers `submitMrv*Transaction` uses — never by calling the
// encoder with hand-built fields, which would assert the SDK agrees with itself.

import { describe, expect, it } from "vitest";
import { RpcClient, getChainInfo } from "@monolythium/core-sdk";
import type { ChainStatsResponse } from "@monolythium/core-sdk";
import { ML_DSA_65_SEED_LEN } from "@monolythium/core-sdk/crypto";
import {
  MAX_EXECUTION_UNIT_PRICE_LYTHOSHI,
  MEMPOOL_PRIORITY_TIP_FLOOR_LYTHOSHI,
} from "../fee-model";
import { NETWORK_SLUG, activeChainPin, verdictFromStats } from "../chain-trust";
import { buildMrvCallTransactionPlan } from "../mrv";

const CONTRACT_HEX = "0x2222222222222222222222222222222222222222";

function seed(): Uint8Array {
  return new Uint8Array(ML_DSA_65_SEED_LEN).fill(0x41);
}

/**
 * A node that answers whatever it is told to. `summedPrice` is base + tip, the
 * invariant a live `lyth_executionUnitPrice` holds — the fixture states it
 * rather than letting two unrelated numbers stand in for one quote.
 */
function mockRpc(options: {
  /** What the operator CLAIMS its chain id is. */
  chainId?: bigint;
  basePrice?: bigint;
  priorityTip?: bigint;
} = {}): { client: RpcClient; methods: () => string[] } {
  const methods: string[] = [];
  const chainId = options.chainId ?? 69_420n;
  const base = options.basePrice ?? 25n;
  const tip = options.priorityTip ?? MEMPOOL_PRIORITY_TIP_FLOOR_LYTHOSHI;

  const fetchStub: typeof fetch = async (_url, init) => {
    const body = JSON.parse(String(init?.body)) as { id?: number; method: string };
    methods.push(body.method);
    let result: unknown;
    switch (body.method) {
      case "eth_chainId":
        result = `0x${chainId.toString(16)}`;
        break;
      case "lyth_getTransactionCount":
        result = "0x5";
        break;
      case "lyth_executionUnitPrice":
        result = {
          executionUnitPriceLythoshi: (base + tip).toString(),
          basePricePerExecutionUnitLythoshi: base.toString(),
          priorityTipLythoshi: tip.toString(),
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

  return {
    client: new RpcClient("http://test.invalid", { fetch: fetchStub }),
    methods: () => methods,
  };
}

function plan(options: Parameters<typeof mockRpc>[0] = {}, extra: Record<string, unknown> = {}) {
  const rpc = mockRpc(options);
  return buildMrvCallTransactionPlan({
    client: rpc.client,
    seed: seed(),
    contractAddress: CONTRACT_HEX,
    input: "0x0102",
    valueLythoshi: "0",
    executionUnitLimit: 50_000n,
    ...extra,
  }).then((p) => ({ p, methods: rpc.methods() }));
}

/** A `lyth_chainStats` body claiming `chainId`, otherwise well-formed. */
function statsClaiming(chainId: number): ChainStatsResponse {
  return {
    chainId,
    genesisHash: getChainInfo(NETWORK_SLUG).genesis_hash,
    latestHeight: 100,
    latestBlockHash: `0x${"ab".repeat(32)}`,
  } as unknown as ChainStatsResponse;
}

describe("D1 — the signed chain id does not follow the operator", () => {
  it("signs the pin, not the chain id the operator claims", async () => {
    // The operator says it is on a different chain. Before D1 this number went
    // straight into the signed preimage.
    const { p, methods } = await plan({ chainId: 999_999n });

    // Anti-vacuity FIRST: the plan really was built by the real builder against
    // this client — otherwise every assertion below reads a default.
    expect(p.from.startsWith("mono1")).toBe(true);
    expect(p.nativeTx.nonce).toBe(5n);
    expect(methods).toContain("lyth_getTransactionCount");

    expect(p.nativeTx.chainId).toBe(BigInt(activeChainPin().chainId));
    expect(p.nativeTx.chainId).not.toBe(999_999n);
  });

  it("never asks the operator which chain it is on", async () => {
    const { methods } = await plan({ chainId: 999_999n });
    // The read is gone, not merely ignored — an ignored read is a value one
    // refactor away from being used again.
    expect(methods).not.toContain("eth_chainId");
    // …and the mock WOULD have answered it, so this is not passing because the
    // transport is dead.
    expect(methods.length).toBeGreaterThan(0);
  });

  it("signs a chain id an operator must MATCH to be trusted — one derivation", async () => {
    // The tie that makes this a fix rather than a different arbitrary source:
    // the value now signed is the value `verdictFromStats` demands, and the
    // value the operator claimed is one the gate refuses.
    const { p } = await plan({ chainId: 999_999n });
    const pin = activeChainPin();

    const matching = verdictFromStats(statsClaiming(Number(p.nativeTx.chainId)), pin.chainId, pin.genesis);
    expect(matching.wrongChainId).toBe(false);
    expect(matching.trusted).toBe(true);

    const claimed = verdictFromStats(statsClaiming(999_999), pin.chainId, pin.genesis);
    expect(claimed.wrongChainId).toBe(true);
    expect(claimed.trusted).toBe(false);
  });

  it("still honours an explicit caller override — the field is a source, not a constant", async () => {
    const { p } = await plan({ chainId: 999_999n }, { chainId: 4242n });
    expect(p.nativeTx.chainId).toBe(4242n);
  });
});

describe("D1 — the operator's fee is bounded by the wallet's own ceiling", () => {
  it("caps an absurd per-unit price at the wallet ceiling", async () => {
    const absurd = MAX_EXECUTION_UNIT_PRICE_LYTHOSHI * 1_000n;
    const { p } = await plan({ basePrice: absurd });

    // Anti-vacuity: the quote really did carry a value above the ceiling, so
    // the equality below is a clamp and not a coincidence.
    expect(absurd + MEMPOOL_PRIORITY_TIP_FLOOR_LYTHOSHI).toBeGreaterThan(
      MAX_EXECUTION_UNIT_PRICE_LYTHOSHI,
    );
    expect(p.nativeTx.maxExecutionFeeLythoshi).toBe(
      MAX_EXECUTION_UNIT_PRICE_LYTHOSHI.toString(),
    );
  });

  it("raises a sub-floor tip to the mempool floor", async () => {
    const { p } = await plan({ basePrice: 10_000_000_000n, priorityTip: 1n });
    expect(1n).toBeLessThan(MEMPOOL_PRIORITY_TIP_FLOOR_LYTHOSHI);
    expect(p.nativeTx.priorityTipLythoshi).toBe(
      MEMPOOL_PRIORITY_TIP_FLOOR_LYTHOSHI.toString(),
    );
  });

  it("never signs a tip above the max price, on any input", async () => {
    // The plaintext path requires tip <= maxFeePerGas; an absurd tip must be
    // brought under the (also clamped) ceiling rather than refused silently.
    const { p } = await plan({ basePrice: 1n, priorityTip: MAX_EXECUTION_UNIT_PRICE_LYTHOSHI * 5n });
    expect(BigInt(p.nativeTx.priorityTipLythoshi)).toBeLessThanOrEqual(
      BigInt(p.nativeTx.maxExecutionFeeLythoshi),
    );
    expect(BigInt(p.nativeTx.maxExecutionFeeLythoshi)).toBe(MAX_EXECUTION_UNIT_PRICE_LYTHOSHI);
  });

  it("leaves an ordinary quote alone — the clamp bounds, it does not flatten", async () => {
    const base = 25n;
    const tip = MEMPOOL_PRIORITY_TIP_FLOOR_LYTHOSHI;
    const { p } = await plan({ basePrice: base, priorityTip: tip });
    expect(p.nativeTx.maxExecutionFeeLythoshi).toBe((base + tip).toString());
    expect(p.nativeTx.priorityTipLythoshi).toBe(tip.toString());
  });

  it("bounds a CALLER-supplied price too — the ceiling is a client duty either way", async () => {
    const { p } = await plan(
      {},
      { maxExecutionFeeLythoshi: (MAX_EXECUTION_UNIT_PRICE_LYTHOSHI * 7n).toString() },
    );
    expect(p.nativeTx.maxExecutionFeeLythoshi).toBe(
      MAX_EXECUTION_UNIT_PRICE_LYTHOSHI.toString(),
    );
  });
});
