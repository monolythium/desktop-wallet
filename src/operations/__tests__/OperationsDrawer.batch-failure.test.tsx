// What a half-applied batch's FAILURE record is allowed to say.
//
// A descriptor is built before execution, so a batch's notify metadata can only
// describe the plan: kind and counterparty, no cluster. The submissions that
// LAND are recorded individually as they land and carry full detail, so the one
// record that could not name its subject was the failure — leaving a reader with
// several precise "delegated to X" rows and one bare "a delegation failed".
//
// The fact is known inside execute's catch and nowhere else, which is why the
// refinement travels from there rather than being guessed by the drawer. It is
// merged over the descriptor's own metadata, never replacing it: the plan-level
// facts stay true, and the allocation-level ones are added.
//
// NO NEW PERSISTED FIELD. `clusterId`, `clusterName` and `delegationWeightBps`
// are exactly the fields the landed submissions already write, so a half-applied
// batch reads in ONE vocabulary and the record schema does not move.

import { describe, expect, it, vi } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import { renderWithProviders } from "../../test/renderWithProviders";
import type { OperationDescriptor, OperationNotifyMeta } from "../types";

const rec = vi.hoisted(() => ({
  recordOperationFailure: vi.fn(
    (_meta: unknown, _txHash?: string, _cause?: unknown) => Promise.resolve(),
  ),
}));
vi.mock("../../sdk/notifications-record", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../sdk/notifications-record")>()),
  recordOperationFailure: rec.recordOperationFailure,
}));

import { OperationsDrawer } from "../OperationsDrawer";

const PLAN_NOTIFY: OperationNotifyMeta = {
  kind: "delegate",
  amountDecimal: "0",
  counterparty: "lyth1delegationprecompile",
};

function batchOp(execute: OperationDescriptor["execute"]): OperationDescriptor {
  return {
    title: "Autovote · Max Diversity",
    diff: [],
    effects: [],
    auth: "none",
    notify: PLAN_NOTIFY,
    execute,
  };
}

/** Drive the no-auth descriptor through preview → executing → error. */
async function run(descriptor: OperationDescriptor): Promise<void> {
  const { user } = renderWithProviders(<OperationsDrawer descriptor={descriptor} onClose={vi.fn()} />);
  await user.click(screen.getByRole("button", { name: "Run" }));
  await waitFor(() => expect(rec.recordOperationFailure).toHaveBeenCalledTimes(1));
}

/** The metadata the drawer recorded the failure with. */
function recordedMeta(): OperationNotifyMeta {
  return rec.recordOperationFailure.mock.calls[0]![0] as OperationNotifyMeta;
}

describe("the failure record names the allocation that failed", () => {
  it("carries the failing cluster, its name and its weight", async () => {
    rec.recordOperationFailure.mockClear();
    await run(
      batchOp(async (ctx) => {
        // The third allocation is the one that died; only execute knows that.
        ctx?.refineNotify?.({ clusterId: 7, clusterName: "Aurora", delegationWeightBps: 2500 });
        throw new Error("cluster inactive");
      }),
    );
    expect(recordedMeta()).toMatchObject({
      clusterId: 7,
      clusterName: "Aurora",
      delegationWeightBps: 2500,
    });
  });

  it("adds to the plan-level metadata rather than replacing it", async () => {
    rec.recordOperationFailure.mockClear();
    await run(
      batchOp(async (ctx) => {
        ctx?.refineNotify?.({ clusterId: 7 });
        throw new Error("cluster inactive");
      }),
    );
    expect(recordedMeta()).toMatchObject({
      kind: "delegate",
      amountDecimal: "0",
      counterparty: "lyth1delegationprecompile",
      clusterId: 7,
    });
  });

  it("leaves an unrefined failure exactly as the descriptor declared it", async () => {
    // Every other operation on this surface is single-subject and already
    // complete at descriptor time; none of them may change shape.
    rec.recordOperationFailure.mockClear();
    await run(
      batchOp(async () => {
        throw new Error("nope");
      }),
    );
    expect(recordedMeta()).toEqual(PLAN_NOTIFY);
  });
});
