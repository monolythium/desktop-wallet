// Wiring a chain rejection through to the confirm surface.
//
// The half that is easy to get wrong is the unmapped one. Translating a known
// revert into plain copy is obviously good; quietly replacing an UNKNOWN one
// with a generic sentence is the failure mode — the user reports "it said the
// transaction failed", and the actual node reason, the only thing that would
// identify the bug, is gone. So an unrecognised error is re-thrown exactly as
// it arrived, identity included.

import { describe, expect, it, vi } from "vitest";
import {
  INACTIVE_CLUSTER_MESSAGE,
  NO_CLAIMABLE_REWARDS_MESSAGE,
  PER_WALLET_CAP_REVERT_MESSAGE,
  REVERT_INACTIVE_CLUSTER,
  classifyDelegationFailure,
  withDelegationRevertCopy,
} from "../delegation-reverts";

/** A node rejection as it actually reaches the wallet: flattened into a
 *  -32047 message, sometimes with a numeric code, sometimes nested in a cause. */
function nodeError(message: string, code?: number): Error {
  const e = new Error(message) as Error & { code?: number };
  if (code !== undefined) e.code = code;
  return e;
}

describe("classifyDelegationFailure — reading a thrown error", () => {
  it("reads the flattened mempool message", () => {
    expect(
      classifyDelegationFailure(
        nodeError("upstream unavailable: mempool: execution reverted: InactiveCluster"),
      ),
    ).toBe(INACTIVE_CLUSTER_MESSAGE);
  });

  it("reads a numeric code off the error", () => {
    expect(classifyDelegationFailure(nodeError("reverted", REVERT_INACTIVE_CLUSTER))).toBe(
      INACTIVE_CLUSTER_MESSAGE,
    );
  });

  it("walks a nested cause chain", () => {
    const inner = nodeError("execution reverted: NoClaimableRewards");
    const outer = new Error("submit failed", { cause: inner });
    expect(classifyDelegationFailure(outer)).toBe(NO_CLAIMABLE_REWARDS_MESSAGE);
  });

  it("returns null for anything unrecognised", () => {
    expect(classifyDelegationFailure(nodeError("socket hang up"))).toBeNull();
    expect(classifyDelegationFailure(nodeError("WeightOutOfRange"))).toBeNull();
    expect(classifyDelegationFailure("a bare string")).toBeNull();
    expect(classifyDelegationFailure(undefined)).toBeNull();
  });
});

describe("withDelegationRevertCopy", () => {
  it("passes a success straight through", async () => {
    const out = await withDelegationRevertCopy(async () => ({ txHash: "0xabc" }));
    expect(out).toEqual({ txHash: "0xabc" });
  });

  it("re-throws a MAPPED failure carrying the plain copy", async () => {
    await expect(
      withDelegationRevertCopy(async () => {
        throw nodeError("execution reverted: PerWalletCapExceeded");
      }),
    ).rejects.toThrow(PER_WALLET_CAP_REVERT_MESSAGE);
  });

  it("keeps the original error as the cause, so nothing is lost", async () => {
    const original = nodeError("execution reverted: PerWalletCapExceeded (0x0213)");
    try {
      await withDelegationRevertCopy(async () => {
        throw original;
      });
      expect.unreachable("should have thrown");
    } catch (e) {
      expect((e as Error).message).toBe(PER_WALLET_CAP_REVERT_MESSAGE);
      expect((e as Error).cause).toBe(original);
    }
  });

  it("notifies onMapped exactly once, with the same copy", async () => {
    const onMapped = vi.fn();
    await expect(
      withDelegationRevertCopy(async () => {
        throw nodeError("execution reverted: InactiveCluster");
      }, onMapped),
    ).rejects.toThrow(INACTIVE_CLUSTER_MESSAGE);
    expect(onMapped).toHaveBeenCalledTimes(1);
    expect(onMapped).toHaveBeenCalledWith(INACTIVE_CLUSTER_MESSAGE);
  });

  it("P6 — re-throws an UNMAPPED failure completely untouched", async () => {
    // Identity, not just message equality: nothing wrapped, nothing replaced.
    const original = nodeError("upstream unavailable: mempool: something novel");
    const onMapped = vi.fn();
    try {
      await withDelegationRevertCopy(async () => {
        throw original;
      }, onMapped);
      expect.unreachable("should have thrown");
    } catch (e) {
      expect(e).toBe(original);
      expect((e as Error).message).toBe(
        "upstream unavailable: mempool: something novel",
      );
    }
    expect(onMapped).not.toHaveBeenCalled();
  });

  it("P6 — a deliberately unmapped revert keeps its raw reason", async () => {
    // 0x0204 WeightOutOfRange is unmapped on purpose: the wallet's own inputs
    // prevent it, so seeing it raw is the signal that something is wrong.
    const original = nodeError("execution reverted: WeightOutOfRange");
    await expect(
      withDelegationRevertCopy(async () => {
        throw original;
      }),
    ).rejects.toBe(original);
  });

  it("never invents a message for a non-Error throw", async () => {
    const thrown = { weird: true };
    await expect(
      withDelegationRevertCopy(async () => {
        throw thrown;
      }),
    ).rejects.toBe(thrown);
  });

  it("does not call onMapped on success", async () => {
    const onMapped = vi.fn();
    await withDelegationRevertCopy(async () => "ok", onMapped);
    expect(onMapped).not.toHaveBeenCalled();
  });
});
