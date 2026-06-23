import { beforeEach, describe, expect, it, vi } from "vitest";

// The submit seam's contract: submit is PLAINTEXT. We assert that
// `submitNativeTx` delegates to the SDK `submitTransactionWithPrivacy` with
// `private: false` (the `mesh_submitTx` path that confirms on the chain) and
// never fetches an encryption key — the encrypted mempool was removed.

// Capture the args every call to the SDK privacy submit receives.
interface RecordedSubmitArgs {
  private: boolean;
  tx: {
    gasLimit: bigint;
    maxFeePerGas: bigint;
    maxPriorityFeePerGas: bigint;
    value: bigint;
    input: string;
    to: string;
  };
}
const submitWithPrivacySpy = vi.fn(
  (_args: RecordedSubmitArgs): Promise<string> => Promise.resolve("0xdeadbeef"),
);
const fetchEncryptionKeySpy = vi.fn((): Promise<unknown> =>
  Promise.resolve({ kind: "encryption-key" }),
);

vi.mock("@monolythium/core-sdk/crypto", () => ({
  MlDsa65Backend: {
    fromSeed: (_seed: Uint8Array) => ({
      // 20-byte hex address, lower-case.
      getAddress: () => "0x000000000000000000000000000000000000abcd",
    }),
  },
  fetchEncryptionKey: (...a: unknown[]) => fetchEncryptionKeySpy(...(a as [])),
  submitTransactionWithPrivacy: (args: RecordedSubmitArgs) =>
    submitWithPrivacySpy(args),
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
  submitWithPrivacySpy.mockClear();
  fetchEncryptionKeySpy.mockClear();
  resetProviderForTest();
  setProviderForTest({
    rpcClient: { endpoint: "http://test/rpc" },
    endpoint: "http://test/rpc",
  } as unknown as MonolythiumClient);
});

describe("submitNativeTx — plaintext path", () => {
  it("submits PLAINTEXT (private:false) and never fetches the encryption key", async () => {
    const res = await submitNativeTx({ seed: SEED, to: TO, valueLythoshi: 5n });

    expect(submitWithPrivacySpy).toHaveBeenCalledTimes(1);
    const call = submitWithPrivacySpy.mock.calls[0]![0];
    expect(call.private).toBe(false);
    expect(fetchEncryptionKeySpy).not.toHaveBeenCalled();
    expect(res.txHash).toBe("0xdeadbeef");
  });

  it("uses the SDK transfer fee defaults (no hardcoded limit) by default", async () => {
    await submitNativeTx({ seed: SEED, to: TO });
    const call = submitWithPrivacySpy.mock.calls[0]![0];
    expect(call.tx.gasLimit).toBe(100_000n);
    // Tip is clamped to the max by the resolver — never exceeds maxFeePerGas.
    expect(call.tx.maxPriorityFeePerGas).toBeLessThanOrEqual(call.tx.maxFeePerGas);
  });

  it("uses the registry fee class default (~250k) for register-class writes", async () => {
    await submitNativeTx({ seed: SEED, to: TO, feeClass: "registry" });
    const call = submitWithPrivacySpy.mock.calls[0]![0];
    expect(call.tx.gasLimit).toBe(250_000n);
  });
});
