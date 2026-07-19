// The indexed detail modal's two T8 deltas: weight renders as a percent (never
// raw bps), and a network fee renders ONLY for a transaction this wallet paid
// for.
//
// The fee gate is tested by what it FETCHES, not only by what it renders: an
// inbound row must never even ask the chain for a fee, because the fee on that
// transaction is someone else's debit and surfacing it would misattribute a
// charge to the user.

import { describe, expect, it, vi, beforeEach } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import { renderWithProviders } from "../../test/renderWithProviders";

const decodeTxFeeLythoshi = vi.hoisted(() => vi.fn(async () => "147000000000000"));
const loadLiveTxConfirmations = vi.hoisted(() => vi.fn(async () => null));

vi.mock("../../sdk/live", async (orig) => ({
  ...(await orig<typeof import("../../sdk/live")>()),
  decodeTxFeeLythoshi,
  loadLiveTxConfirmations,
}));

import {
  ActivityDetail,
  isSelfPaidIndexedRow,
  type IndexedDetailRow,
} from "../ActivityDetail";

function indexed(over: Partial<IndexedDetailRow> = {}): IndexedDetailRow {
  return {
    kind: "indexed",
    activityKind: "transfer",
    subKind: null,
    direction: "out",
    counterparty: "mono1peer",
    amount: "1000000000000000000",
    tokenId: null,
    cluster: null,
    weightBps: null,
    blockHeight: 1234n,
    txIndex: 2,
    logIndex: 0,
    blockTimestampSeconds: null,
    txHash: "0xfeed",
    clusterName: null,
    ...over,
  };
}

function render(row: IndexedDetailRow) {
  return renderWithProviders(
    <ActivityDetail row={row} walletAddr="mono1self" onClose={vi.fn()} />,
  );
}

beforeEach(() => {
  decodeTxFeeLythoshi.mockClear();
  loadLiveTxConfirmations.mockClear();
});

describe("isSelfPaidIndexedRow — the gate", () => {
  it("refuses every inbound row", () => {
    // Whoever sent it paid for it.
    for (const activityKind of ["transfer", "delegate", "reward", "whatever"]) {
      expect(
        isSelfPaidIndexedRow({ activityKind, subKind: null, direction: "in" }),
      ).toBe(false);
    }
  });

  it("allows an outgoing transfer", () => {
    expect(
      isSelfPaidIndexedRow({
        activityKind: "transfer",
        subKind: null,
        direction: "out",
      }),
    ).toBe(true);
  });

  it("allows the delegation family and claims even with no direction", () => {
    // These are precompile calls the wallet itself signs — self-paid by
    // construction, and the indexer often gives them no direction.
    for (const activityKind of [
      "delegate",
      "undelegate",
      "redelegate",
      "stake",
      "reward",
      "claim",
    ]) {
      expect(
        isSelfPaidIndexedRow({ activityKind, subKind: null, direction: null }),
      ).toBe(true);
    }
  });

  it("refuses an unclassifiable row with no direction", () => {
    expect(
      isSelfPaidIndexedRow({
        activityKind: "something-new",
        subKind: null,
        direction: null,
      }),
    ).toBe(false);
  });
});

describe("the Weight row", () => {
  it("renders a percent, and no 'bps' anywhere in the modal", async () => {
    const { container } = render(indexed({ weightBps: 2550, cluster: 3 }));
    expect(await screen.findByText("25.50%")).toBeTruthy();
    expect(container.textContent).not.toMatch(/bps/i);
    expect(container.textContent).not.toContain("2550");
  });

  it("omits the row entirely when the weight is unknown", () => {
    const { container } = render(indexed({ weightBps: null }));
    expect(container.textContent).not.toContain("Weight");
  });

  it("renders 100 bps as 1.00%", async () => {
    render(indexed({ weightBps: 100 }));
    expect(await screen.findByText("1.00%")).toBeTruthy();
  });
});

describe("the Network fee row", () => {
  it("fetches and renders the charged total for an outgoing transfer", async () => {
    render(indexed({ direction: "out" }));
    expect(await screen.findByText("Network fee")).toBeTruthy();
    // 147000000000000 lythoshi = 0.000147 LYTH, truncated to the wallet's 4 dp
    // display floor — the same treatment the notification detail's fee row uses.
    expect(screen.getByText("0.0001 LYTH")).toBeTruthy();
    expect(decodeTxFeeLythoshi).toHaveBeenCalledWith("0xfeed");
  });

  it("omits the row for a fee below the display floor — never a fabricated 0", async () => {
    // The chain reported a strictly positive charge (decodeTxFeeLythoshi returns
    // null at <= 0), so rendering "0 LYTH" would state a fee the user did not pay.
    decodeTxFeeLythoshi.mockResolvedValueOnce("50000000000000"); // 0.00005 LYTH
    const { container } = render(indexed({ direction: "out" }));
    await waitFor(() => expect(decodeTxFeeLythoshi).toHaveBeenCalled());
    expect(container.textContent).not.toContain("Network fee");
    expect(container.textContent).not.toContain("0 LYTH");
  });

  it("NEVER fetches for an inbound row", async () => {
    const { container } = render(indexed({ direction: "in" }));
    await waitFor(() => expect(container.textContent).toContain("Confirmed"));
    expect(decodeTxFeeLythoshi).not.toHaveBeenCalled();
    expect(container.textContent).not.toContain("Network fee");
  });

  it("fetches for a delegation row", async () => {
    render(indexed({ activityKind: "delegate", direction: null }));
    await waitFor(() => expect(decodeTxFeeLythoshi).toHaveBeenCalledWith("0xfeed"));
  });

  it("fetches for a claim row", async () => {
    render(indexed({ activityKind: "reward", subKind: "claimed", direction: null }));
    await waitFor(() => expect(decodeTxFeeLythoshi).toHaveBeenCalledWith("0xfeed"));
  });

  it("NEVER fetches when enrichment resolved no tx hash", async () => {
    const { container } = render(indexed({ txHash: null, direction: "out" }));
    await waitFor(() => expect(container.textContent).toContain("Confirmed"));
    expect(decodeTxFeeLythoshi).not.toHaveBeenCalled();
    expect(container.textContent).not.toContain("Network fee");
  });

  it("renders NO row when the fee is undecodable — never a fabricated 0", async () => {
    decodeTxFeeLythoshi.mockResolvedValueOnce(null as unknown as string);
    const { container } = render(indexed({ direction: "out" }));
    await waitFor(() => expect(decodeTxFeeLythoshi).toHaveBeenCalled());
    expect(container.textContent).not.toContain("Network fee");
    expect(container.textContent).not.toContain("0 LYTH");
  });

  it("shows nothing at all while the fetch is in flight (no skeleton, no dash)", () => {
    let settle: (v: string | null) => void = () => {};
    decodeTxFeeLythoshi.mockReturnValueOnce(
      new Promise<string | null>((r) => {
        settle = r;
      }) as Promise<string>,
    );
    const { container } = render(indexed({ direction: "out" }));
    expect(container.textContent).not.toContain("Network fee");
    settle(null);
  });
});
