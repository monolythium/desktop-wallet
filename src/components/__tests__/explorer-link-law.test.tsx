// §A.3 — the own-tx-hash-only law, pinned.
//
// The wallet links a transaction only when it holds that transaction's
// canonical hash. A received or indexer-only row that carries none gets NO
// link — because any target the wallet could synthesize would be a page about
// a DIFFERENT transaction, while the affordance promises theirs.
//
// This was already the behavior. It is pinned here because it is the kind of
// property a well-meaning "the row looks empty, let's link the address page"
// change would quietly break, and nothing else would notice.

import { describe, expect, it, vi } from "vitest";
import { screen } from "@testing-library/react";
import { renderWithProviders } from "../../test/renderWithProviders";
import { ActivityDetail, type IndexedDetailRow } from "../ActivityDetail";
import { MONOSCAN_TX_BASE } from "../../sdk/monoscan";

vi.mock("../../sdk/live", async (orig) => ({
  ...(await orig<typeof import("../../sdk/live")>()),
  decodeTxFeeLythoshi: vi.fn(async () => null),
  loadLiveTxConfirmations: vi.fn(async () => null),
}));

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

describe("a row WITH a canonical hash links out", () => {
  it("renders the Monoscan CTA pointing at that exact hash", () => {
    render(indexed({ txHash: "0xfeed" }));
    const link = screen.getByRole("link", { name: /View on Monoscan/ });
    expect(link).toHaveAttribute("href", `${MONOSCAN_TX_BASE}0xfeed`);
  });
});

describe("a row WITHOUT a canonical hash gets no link at all", () => {
  it("renders no Monoscan CTA", () => {
    render(indexed({ txHash: null, direction: "in" }));
    expect(screen.queryByRole("link", { name: /View on Monoscan/ })).toBeNull();
  });

  it("renders no tx-hash row either — nothing is synthesized", () => {
    render(indexed({ txHash: null, direction: "in" }));
    expect(screen.queryByText("Tx hash")).toBeNull();
  });

  it("renders NO link into the explorer's tx route by any route", () => {
    // The strict form of the law: not "no button", but no anchor anywhere in
    // the rendered detail whose href reaches the tx route. A future change that
    // linked the address page *as* the transaction would fail here.
    const { container } = render(indexed({ txHash: null, direction: "in" }));
    const hrefs = Array.from(container.querySelectorAll("a")).map(
      (a) => a.getAttribute("href") ?? "",
    );
    expect(hrefs.some((h) => h.startsWith(MONOSCAN_TX_BASE))).toBe(false);
  });

  it("the row still renders (absence is honest, not a blank modal)", () => {
    // The link is what's missing — not the information. If this ever went
    // empty, the test above would pass for the wrong reason.
    render(indexed({ txHash: null, direction: "in" }));
    expect(screen.getByText("Block")).toBeInTheDocument();
  });
});
