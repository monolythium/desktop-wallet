// The Dismiss affordance for tracked rows.
//
// Dismissing a transaction that might still be moving would remove the user's
// only visibility into money in flight, so the gate is tested in BOTH
// directions and in both surfaces: present for each terminal state, absent for
// each non-terminal one.

import { describe, expect, it, vi } from "vitest";
import { screen } from "@testing-library/react";
import { renderWithProviders } from "../../test/renderWithProviders";
import {
  ActivityDetail,
  isDismissableTracked,
  type DetailRow,
} from "../ActivityDetail";
import type { PendingLifecycle } from "../../sdk/pending-tx";

const NON_TERMINAL: PendingLifecycle[] = ["pending", "awaiting-inclusion", "slow"];
const TERMINAL: PendingLifecycle[] = ["dropped", "expired"];

describe("isDismissableTracked — the gate", () => {
  it("allows each TERMINAL state", () => {
    for (const lifecycle of TERMINAL) {
      expect(isDismissableTracked({ lifecycle })).toBe(true);
    }
  });

  it("refuses each NON-TERMINAL state", () => {
    for (const lifecycle of NON_TERMINAL) {
      expect(isDismissableTracked({ lifecycle })).toBe(false);
    }
  });

  it("refuses a row with no lifecycle yet (a legacy row reads as pending)", () => {
    expect(isDismissableTracked({})).toBe(false);
  });

  it("refuses a BRIDGED row even when its lifecycle looks terminal", () => {
    // Bridged = receipt-confirmed ahead of the indexer; it is not a failure.
    for (const lifecycle of TERMINAL) {
      expect(isDismissableTracked({ lifecycle, bridged: true })).toBe(false);
    }
  });
});

function trackedRow(over: Partial<DetailRow> = {}): DetailRow {
  return {
    kind: "tracked",
    txHash: "0xabc",
    opKind: "send",
    amountDecimal: "1.5",
    counterparty: "mono1peer",
    chainIdHex: "0x10f2c",
    lifecycle: "dropped",
    bridged: false,
    ...over,
  } as DetailRow;
}

describe("the detail modal", () => {
  const dismiss = () => screen.queryByTestId("dismiss-tracked-detail");

  it("offers Dismiss for each terminal state", () => {
    for (const lifecycle of TERMINAL) {
      const { unmount } = renderWithProviders(
        <ActivityDetail
          row={trackedRow({ lifecycle } as Partial<DetailRow>)}
          walletAddr="mono1self"
          onDismiss={vi.fn()}
          onClose={vi.fn()}
        />,
      );
      expect(dismiss()).not.toBeNull();
      unmount();
    }
  });

  it("offers NOTHING for each non-terminal state", () => {
    for (const lifecycle of NON_TERMINAL) {
      const { unmount } = renderWithProviders(
        <ActivityDetail
          row={trackedRow({ lifecycle } as Partial<DetailRow>)}
          walletAddr="mono1self"
          onDismiss={vi.fn()}
          onClose={vi.fn()}
        />,
      );
      expect(dismiss()).toBeNull();
      unmount();
    }
  });

  it("offers nothing for a bridged row", () => {
    renderWithProviders(
      <ActivityDetail
        row={trackedRow({ bridged: true } as Partial<DetailRow>)}
        walletAddr="mono1self"
        onDismiss={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    expect(dismiss()).toBeNull();
  });

  it("dismissing calls back and closes the modal", async () => {
    const onDismiss = vi.fn();
    const onClose = vi.fn();
    const { user } = renderWithProviders(
      <ActivityDetail
        row={trackedRow()}
        walletAddr="mono1self"
        onDismiss={onDismiss}
        onClose={onClose}
      />,
    );

    await user.click(dismiss()!);
    expect(onDismiss).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("offers nothing when the caller supplied no handler", () => {
    renderWithProviders(
      <ActivityDetail row={trackedRow()} walletAddr="mono1self" onClose={vi.fn()} />,
    );
    expect(dismiss()).toBeNull();
  });

  it("offers nothing on a non-tracked row", () => {
    renderWithProviders(
      <ActivityDetail
        row={{
          kind: "pending",
          txHash: "0xabc",
          nonce: 1n,
          txClass: 0,
          wireBytesLen: 10,
          ready: true,
        }}
        walletAddr="mono1self"
        onDismiss={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    expect(dismiss()).toBeNull();
  });
});
