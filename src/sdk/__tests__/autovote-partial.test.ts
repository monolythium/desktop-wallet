// What a mid-batch failure leaves behind.
//
// Before this, a plan that died on its third of five threw, and the two hashes
// already submitted were local to the loop and lost with the throw. The caller
// could not record them, could not name them, and could not even say how far it
// got — so two real delegations existed on chain with no trace anywhere in the
// wallet. That is the same defect class the activity work closed for single
// transactions.

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../delegation", () => ({
  buildDelegateCalldata: ({ clusterId }: { clusterId: number }) => `0xdata${clusterId}`,
  submitDelegationTx: vi.fn(),
}));

import { AutovoteBatchError, submitAutovotePlan } from "../autovote";
import { submitDelegationTx } from "../delegation";

const del = vi.mocked(submitDelegationTx);

const plan = {
  mode: "maxYield" as const,
  allocations: [
    { clusterId: 1, weightBps: 1000 },
    { clusterId: 2, weightBps: 1000 },
    { clusterId: 3, weightBps: 1000 },
  ],
  totalWeightBps: 3000,
  warnings: [],
};

beforeEach(() => {
  del.mockReset();
});

describe("submitAutovotePlan — what lands is reported as it lands", () => {
  it("reports each submission as it happens, not only at the end", async () => {
    del.mockImplementation(async () => ({ txHash: "0xh", nonce: 1 }));
    const landed: Array<{ clusterId: number; txHash: string }> = [];
    await submitAutovotePlan(plan, new Uint8Array(32), undefined, (s) =>
      landed.push({ clusterId: s.clusterId, txHash: s.txHash }),
    );
    expect(landed).toHaveLength(3);
    expect(landed.map((l) => l.clusterId)).toEqual([1, 2, 3]);
  });

  it("carries the nonce and weight through, so each can be tracked like a single delegate", async () => {
    del.mockImplementation(async () => ({ txHash: "0xh", nonce: 7 }));
    const seen: unknown[] = [];
    await submitAutovotePlan(plan, new Uint8Array(32), undefined, (s) => seen.push(s));
    expect(seen[0]).toMatchObject({ clusterId: 1, weightBps: 1000, nonce: 7 });
  });
});

describe("submitAutovotePlan — a mid-batch failure keeps what landed", () => {
  beforeEach(() => {
    let call = 0;
    del.mockImplementation(async () => {
      call += 1;
      if (call === 3) throw new Error("node said no");
      return { txHash: `0xh${call}`, nonce: call };
    });
  });

  it("throws an error that still names what was already submitted", async () => {
    await expect(
      submitAutovotePlan(plan, new Uint8Array(32)),
    ).rejects.toBeInstanceOf(AutovoteBatchError);
  });

  it("reports the boundary — how many landed, out of how many", async () => {
    const err = await submitAutovotePlan(plan, new Uint8Array(32)).catch((e) => e);
    expect(err).toBeInstanceOf(AutovoteBatchError);
    expect((err as AutovoteBatchError).submittedTxHashes).toEqual(["0xh1", "0xh2"]);
    expect((err as AutovoteBatchError).total).toBe(3);
  });

  it("says in its message that the earlier delegations stand", async () => {
    const err = (await submitAutovotePlan(plan, new Uint8Array(32)).catch(
      (e) => e,
    )) as AutovoteBatchError;
    expect(err.message).toContain("2 of 3");
    expect(err.message.toLowerCase()).toContain("stand");
  });

  it("keeps the underlying reason reachable rather than swallowing it", async () => {
    const err = (await submitAutovotePlan(plan, new Uint8Array(32)).catch(
      (e) => e,
    )) as AutovoteBatchError;
    expect((err.cause as Error)?.message).toBe("node said no");
  });

  it("still reports the two that landed through the callback", async () => {
    const landed: string[] = [];
    await submitAutovotePlan(plan, new Uint8Array(32), undefined, (s) =>
      landed.push(s.txHash),
    ).catch(() => undefined);
    expect(landed).toEqual(["0xh1", "0xh2"]);
  });

  it("does not add a word the drawer's error classifier would read as a chain revert", async () => {
    const err = (await submitAutovotePlan(plan, new Uint8Array(32)).catch(
      (e) => e,
    )) as AutovoteBatchError;
    // The inner reason is whatever the node said; the wrapper's own words must
    // not introduce the substring.
    expect(err.message.replace("node said no", "").toLowerCase()).not.toContain("revert");
  });

  it("throws on the FIRST failure without submitting the rest", async () => {
    await submitAutovotePlan(plan, new Uint8Array(32)).catch(() => undefined);
    expect(del).toHaveBeenCalledTimes(3);
  });
});
