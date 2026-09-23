// The plumbing, asserted rather than assumed.
//
// Before D2 only two seams could accept a fee at all. Every other write left
// `submitNativeTx` to resolve its own after the password — a SECOND read, and
// therefore possibly a second price. The drawer now resolves once and hands the
// value down, but a seam that quietly drops it on the way would restore the old
// behaviour with no visible symptom: the transaction still submits, the fee is
// still valid, and it is simply not the one anybody was shown.
//
// So this asserts the property at the boundary that owns it — the arguments
// `submitNativeTx` actually receives — and it asserts BOTH directions, because
// a pass-through that hard-codes a value would satisfy the first alone.

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ResolvedExecutionFee } from "@monolythium/core-sdk";

const cap = vi.hoisted(() => ({ args: [] as { resolvedFee?: ResolvedExecutionFee }[] }));

vi.mock("../submit", async (orig) => ({
  ...(await orig<typeof import("../submit")>()),
  submitNativeTx: vi.fn(async (args: { resolvedFee?: ResolvedExecutionFee }) => {
    cap.args.push(args);
    return { txHash: `0x${"11".repeat(32)}`, fromHex: `0x${"22".repeat(20)}`, fee: args.resolvedFee, nonce: 1 };
  }),
}));

import { submitDelegationTx } from "../delegation";
import { submitSpendingPolicyTx } from "../spending-policy";
import {
  submitNameAcceptTransfer,
  submitNameProposeTransfer,
  submitNameRegistration,
} from "../name-registry";
import { cancelClobOrder, placeClobLimitOrder } from "../clob-trade";
import { fundAgentSubAccount } from "../agent-subaccount";
import { submitAutovotePlan } from "../autovote";

const SEED = new Uint8Array(32).fill(0x41);
/** A REAL typed address — checksum-valid, the encoding of
 *  `0xa9e1f0000000000000000000000000000000a9e1`. An invented `mono1qqq…` is
 *  rejected by `requireTypedUserAddressHex` before the seam is reached, which
 *  would make every assertion here a statement about address parsing. */
const RECIPIENT = "mono148slqqqqqqqqqqqqqqqqqqqqqqqqp20prg6jyj";
/** A value nothing would produce by accident, so "it arrived" cannot be a
 *  coincidence of defaults. */
const FEE: ResolvedExecutionFee = {
  maxFeePerGas: 123_456_789_012n,
  maxPriorityFeePerGas: 1_000_000_007n,
  gasLimit: 314_159n,
};

/** Every seam D2 had to plumb, driven for real. */
const SEAMS: ReadonlyArray<{
  name: string;
  run: (resolvedFee?: ResolvedExecutionFee) => Promise<unknown>;
}> = [
  { name: "delegation", run: (f) => submitDelegationTx({ seed: SEED, data: "0x01", resolvedFee: f }) },
  { name: "spending policy", run: (f) => submitSpendingPolicyTx({ seed: SEED, data: "0x01", resolvedFee: f }) },
  { name: "name register", run: (f) => submitNameRegistration({ seed: SEED, name: "alice", costLythoshi: 1n, resolvedFee: f }) },
  { name: "name propose", run: (f) => submitNameProposeTransfer({ seed: SEED, name: "alice", recipient: RECIPIENT, resolvedFee: f }) },
  { name: "name accept", run: (f) => submitNameAcceptTransfer({ seed: SEED, name: "alice", costLythoshi: 1n, resolvedFee: f }) },
  {
    name: "CLOB place",
    run: (f) =>
      placeClobLimitOrder({
        seed: SEED,
        baseTokenIdHex: `0x${"aa".repeat(32)}`,
        quoteTokenIdHex: `0x${"bb".repeat(32)}`,
        side: "buy",
        price: "1",
        quantity: "1",
        resolvedFee: f,
      }),
  },
  { name: "CLOB cancel", run: (f) => cancelClobOrder({ seed: SEED, orderIdHex: `0x${"cc".repeat(32)}`, resolvedFee: f }) },
  { name: "fund agent", run: (f) => fundAgentSubAccount({ seed: SEED, toBech32m: RECIPIENT, amountLyth: "1", resolvedFee: f }) },
  {
    name: "autovote batch",
    run: (f) =>
      submitAutovotePlan(
        { allocations: [{ clusterId: 1, weightBps: 100 }], totalWeightBps: 100, warnings: [] } as never,
        SEED,
        undefined,
        undefined,
        f,
      ),
  },
];

beforeEach(() => {
  cap.args = [];
});

describe("every seam forwards the fee the surface displayed", () => {
  it.each(SEAMS)("$name signs the supplied fee, unchanged", async ({ run }) => {
    await run(FEE);
    // Anti-vacuity: the seam really reached the submit boundary.
    expect(cap.args).toHaveLength(1);
    expect(cap.args[0]!.resolvedFee).toEqual(FEE);
  });

  it.each(SEAMS)("$name leaves it ABSENT when none is supplied", async ({ run }) => {
    // The other direction, and it is not decoration: a seam that hard-coded a
    // fee, or defaulted one, would pass the assertion above while ignoring what
    // the surface actually showed.
    await run(undefined);
    expect(cap.args).toHaveLength(1);
    expect(cap.args[0]!.resolvedFee).toBeUndefined();
  });
});

describe("the batch signs ONE price for N submissions", () => {
  it("uses the same fee for every allocation", async () => {
    // One consent, one price. Quoting per step would sign prices for every step
    // after the first that nobody was ever shown.
    await submitAutovotePlan(
      {
        allocations: [
          { clusterId: 1, weightBps: 100 },
          { clusterId: 2, weightBps: 100 },
          { clusterId: 3, weightBps: 100 },
        ],
        totalWeightBps: 300,
        warnings: [],
      } as never,
      SEED,
      undefined,
      undefined,
      FEE,
    );
    expect(cap.args).toHaveLength(3);
    for (const a of cap.args) expect(a.resolvedFee).toEqual(FEE);
  });
});
