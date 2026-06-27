import { beforeEach, describe, expect, it, vi } from "vitest";

// The submit seam's contract: submit is PLAINTEXT. We assert that
// `submitNativeTx` delegates to the SDK `submitTransaction` (the
// `mesh_submitTx` path that confirms on the chain). The encrypted mempool was
// removed (DEC-029), so there is no privacy flag and no encryption-key fetch —
// the SDK no longer exposes either.

// Capture the args every call to the SDK plaintext submit receives.
interface RecordedSubmitArgs {
  tx: {
    gasLimit: bigint;
    maxFeePerGas: bigint;
    maxPriorityFeePerGas: bigint;
    value: bigint;
    input: string;
    to: string;
  };
}
const submitTransactionSpy = vi.fn(
  (_args: RecordedSubmitArgs): Promise<string> => Promise.resolve("0xdeadbeef"),
);

vi.mock("@monolythium/core-sdk/crypto", () => ({
  MlDsa65Backend: {
    fromSeed: (_seed: Uint8Array) => ({
      // 20-byte hex address, lower-case.
      getAddress: () => "0x000000000000000000000000000000000000abcd",
    }),
  },
  submitTransaction: (args: RecordedSubmitArgs) => submitTransactionSpy(args),
}));

// Stub the fee resolvers + chain id so submit.ts builds a tx without a node.
vi.mock("@monolythium/core-sdk", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@monolythium/core-sdk")>();
  return {
    ...actual,
    RpcClient: class {
      readonly endpoint: string;
      constructor(endpoint: string) {
        this.endpoint = endpoint;
      }
    },
    resolveExecutionFee: vi.fn(() =>
      Promise.resolve({
        maxFeePerGas: 6000n,
        maxPriorityFeePerGas: 6000n,
        gasLimit: 100_000n,
      }),
    ),
    resolveRegistryExecutionFee: vi.fn(() =>
      Promise.resolve({
        maxFeePerGas: 6000n,
        maxPriorityFeePerGas: 6000n,
        gasLimit: 250_000n,
      }),
    ),
  };
});

// Nonce read — no node.
vi.mock("../native-rpc", () => ({
  getNativeTransactionCount: vi.fn(() => Promise.resolve(3n)),
}));

import { resetProviderForTest, setProviderForTest, type MonolythiumClient } from "../client";
import { submitNativeTx } from "../submit";

const SEED = new Uint8Array(32).fill(7);
const TO = "0x000000000000000000000000000000000000dead";

beforeEach(() => {
  submitTransactionSpy.mockClear();
  resetProviderForTest();
  setProviderForTest({
    rpcClient: { endpoint: "http://test/rpc" },
    endpoint: "http://test/rpc",
  } as unknown as MonolythiumClient);
});

describe("submitNativeTx — plaintext path", () => {
  it("submits PLAINTEXT via the SDK submitTransaction seam", async () => {
    const res = await submitNativeTx({ seed: SEED, to: TO, valueLythoshi: 5n });

    expect(submitTransactionSpy).toHaveBeenCalledTimes(1);
    expect(res.txHash).toBe("0xdeadbeef");
  });

  it("uses the SDK transfer fee defaults (no hardcoded limit) by default", async () => {
    await submitNativeTx({ seed: SEED, to: TO });
    const call = submitTransactionSpy.mock.calls[0]![0];
    expect(call.tx.gasLimit).toBe(100_000n);
    // Tip is clamped to the max by the resolver — never exceeds maxFeePerGas.
    expect(call.tx.maxPriorityFeePerGas).toBeLessThanOrEqual(call.tx.maxFeePerGas);
  });

  it("uses the registry fee class default (~250k) for register-class writes", async () => {
    await submitNativeTx({ seed: SEED, to: TO, feeClass: "registry" });
    const call = submitTransactionSpy.mock.calls[0]![0];
    expect(call.tx.gasLimit).toBe(250_000n);
  });
});
