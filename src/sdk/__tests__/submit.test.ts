import { beforeEach, describe, expect, it, vi } from "vitest";

// The submit seam's contract: submit is PLAINTEXT. `submitNativeTx` builds the
// submission locally via the SDK `buildPlaintextSubmission` (yielding the
// canonical hash) and then posts it via `submitPlaintextTransaction` (the
// `mesh_submitTx` path). The two-step split is what lets an admission reject
// carry its hash (F3). The encrypted mempool was removed (DEC-029), so there is
// no privacy flag and no encryption-key fetch — the SDK no longer exposes either.

// Controls the active chain scopeChainKey() reports, so the nonce-scoping test
// can submit on two different chains. Hoisted so the vi.mock factory can close
// over it. Defaults to the builtin so the other tests are unaffected.
const chainCtl = vi.hoisted(() => ({ current: "0x10f2c" }));
vi.mock("../chains", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../chains")>();
  return { ...actual, scopeChainKey: () => chainCtl.current };
});

// Capture the args every call to the SDK plaintext submit receives.
interface RecordedSubmitArgs {
  tx: {
    gasLimit: bigint;
    maxFeePerGas: bigint;
    maxPriorityFeePerGas: bigint;
    value: bigint;
    input: string;
    to: string;
    nonce: bigint;
  };
}
const LOCAL_TX_HASH = "0x" + "ab".repeat(32); // canonical 32-byte hash
// submit.ts now builds the submission locally (yielding the hash) THEN submits.
// `buildSpy` captures the built tx; `submitSpy` echoes the expected hash, or is
// overridden to throw for the admission-reject path.
const buildSpy = vi.fn((args: RecordedSubmitArgs) => {
  void args;
  return {
    signedTxWireHex: "0xwire",
    innerTxHashHex: LOCAL_TX_HASH,
    innerSighashHex: "0x" + "cd".repeat(32),
    innerWireBytes: 128,
  };
});
const submitSpy = vi.fn(
  (_client: unknown, _wire: string, expected: string): Promise<string> =>
    Promise.resolve(expected),
);

vi.mock("@monolythium/core-sdk/crypto", () => ({
  MlDsa65Backend: {
    fromSeed: (_seed: Uint8Array) => ({
      // 20-byte hex address, lower-case.
      getAddress: () => "0x000000000000000000000000000000000000abcd",
    }),
  },
  buildPlaintextSubmission: (args: RecordedSubmitArgs) => buildSpy(args),
  submitPlaintextTransaction: (client: unknown, wire: string, expected: string) =>
    submitSpy(client, wire, expected),
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

import { resolveExecutionFee } from "@monolythium/core-sdk";
import { resetProviderForTest, setProviderForTest, type MonolythiumClient } from "../client";
import { _resetPendingNonces } from "../pending-nonce";
import { submitNativeTx, SubmitRejectedError, rejectedSubmitTxHash } from "../submit";

const SEED = new Uint8Array(32).fill(7);
const TO = "0x000000000000000000000000000000000000dead";

beforeEach(() => {
  buildSpy.mockClear();
  submitSpy.mockClear();
  chainCtl.current = "0x10f2c";
  _resetPendingNonces();
  resetProviderForTest();
  setProviderForTest({
    rpcClient: { endpoint: "http://test/rpc" },
    endpoint: "http://test/rpc",
  } as unknown as MonolythiumClient);
});

describe("submitNativeTx — plaintext path", () => {
  it("submits PLAINTEXT via the SDK submitTransaction seam", async () => {
    const res = await submitNativeTx({ seed: SEED, to: TO, valueLythoshi: 5n });

    expect(buildSpy).toHaveBeenCalledTimes(1);
    expect(submitSpy).toHaveBeenCalledTimes(1);
    expect(res.txHash).toBe(LOCAL_TX_HASH);
  });

  it("uses the SDK transfer fee defaults (no hardcoded limit) by default", async () => {
    await submitNativeTx({ seed: SEED, to: TO });
    const call = buildSpy.mock.calls[0]![0];
    expect(call.tx.gasLimit).toBe(100_000n);
    // Tip is clamped to the max by the resolver — never exceeds maxFeePerGas.
    expect(call.tx.maxPriorityFeePerGas).toBeLessThanOrEqual(call.tx.maxFeePerGas);
  });

  it("uses the registry fee class default (~250k) for register-class writes", async () => {
    await submitNativeTx({ seed: SEED, to: TO, feeClass: "registry" });
    const call = buildSpy.mock.calls[0]![0];
    expect(call.tx.gasLimit).toBe(250_000n);
  });

  it("F2: a supplied resolvedFee is signed BYTE-IDENTICALLY (no re-resolve)", async () => {
    vi.mocked(resolveExecutionFee).mockClear();
    const resolvedFee = { maxFeePerGas: 3_000_000_000n, maxPriorityFeePerGas: 2_000_000_000n, gasLimit: 30_000n };
    await submitNativeTx({ seed: SEED, to: TO, valueLythoshi: 5n, resolvedFee });
    const call = buildSpy.mock.calls[0]![0];
    expect(call.tx.maxFeePerGas).toBe(3_000_000_000n);
    expect(call.tx.maxPriorityFeePerGas).toBe(2_000_000_000n);
    expect(call.tx.gasLimit).toBe(30_000n);
    expect(call.tx.value).toBe(5n); // value untouched
    expect(resolveExecutionFee).not.toHaveBeenCalled(); // no re-quote when preview-supplied
  });

  it("F3: the resolver output is bounded — absurd price → ceiling, sub-floor tip → floor, value untouched", async () => {
    vi.mocked(resolveExecutionFee).mockResolvedValueOnce({
      maxFeePerGas: 1_000_000_000_000_000_000n, // 10^18 — absurd
      maxPriorityFeePerGas: 500_000_000n, // 5×10^8 — sub-floor
      gasLimit: 30_000n,
    });
    await submitNativeTx({ seed: SEED, to: TO, valueLythoshi: 42n });
    const call = buildSpy.mock.calls[0]![0];
    expect(call.tx.maxFeePerGas).toBe(1_000_000_000_000_000n); // 10^15 ceiling
    expect(call.tx.maxPriorityFeePerGas).toBe(1_000_000_000n); // raised to the 10^9 floor
    expect(call.tx.maxPriorityFeePerGas).toBeLessThanOrEqual(call.tx.maxFeePerGas);
    expect(call.tx.value).toBe(42n); // the clamp NEVER touches value
  });
});

describe("submitNativeTx — pending nonce is scoped to the active chain", () => {
  // getNativeTransactionCount is mocked to a constant committed nonce of 3, so
  // the signed nonce is driven entirely by the local pending-nonce map. The map
  // must be keyed to the ACTIVE chain (scopeChainKey), not a literal: a nonce
  // recorded on one chain must never advance the nonce signed on another.
  it("advances within a chain but stays independent across chains", async () => {
    chainCtl.current = "0xaaa";
    await submitNativeTx({ seed: SEED, to: TO, valueLythoshi: 1n });
    await submitNativeTx({ seed: SEED, to: TO, valueLythoshi: 1n });
    // Second submit on chain A advances past the first (committed 3 → local 4).
    expect(buildSpy.mock.calls[0]![0].tx.nonce).toBe(3n);
    expect(buildSpy.mock.calls[1]![0].tx.nonce).toBe(4n);

    // Switch to chain B: its nonce is independent — back to the committed 3, NOT
    // 5. A literal (fixed) chain key would collide all three under one entry and
    // sign 5 here, so this assertion is what a regression to a literal breaks.
    chainCtl.current = "0xbbb";
    await submitNativeTx({ seed: SEED, to: TO, valueLythoshi: 1n });
    expect(buildSpy.mock.calls[2]![0].tx.nonce).toBe(3n);
  });
});

describe("submitNativeTx — F3: an admission reject carries the local hash", () => {
  it("throws a SubmitRejectedError bearing the canonical hash + the cause message", async () => {
    submitSpy.mockRejectedValueOnce(new Error("insufficient funds"));
    let thrown: unknown;
    try {
      await submitNativeTx({ seed: SEED, to: TO, valueLythoshi: 5n });
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toBeInstanceOf(SubmitRejectedError);
    expect(rejectedSubmitTxHash(thrown)).toBe(LOCAL_TX_HASH);
    // The message mirrors the cause so the send-error classifier still works.
    expect((thrown as Error).message).toContain("insufficient funds");
  });

  it("does NOT advance the local nonce on a reject (so a retry reuses it)", async () => {
    submitSpy.mockRejectedValueOnce(new Error("rejected"));
    await submitNativeTx({ seed: SEED, to: TO, valueLythoshi: 5n }).catch(() => {});
    // Next submit reuses the committed nonce (3), not 4 — the failed one didn't
    // consume it.
    await submitNativeTx({ seed: SEED, to: TO, valueLythoshi: 5n });
    expect(buildSpy.mock.calls[1]![0].tx.nonce).toBe(3n);
  });

  it("rejectedSubmitTxHash is undefined for an ordinary error", () => {
    expect(rejectedSubmitTxHash(new Error("nope"))).toBeUndefined();
    expect(rejectedSubmitTxHash("plain string")).toBeUndefined();
    expect(rejectedSubmitTxHash(null)).toBeUndefined();
  });
});
