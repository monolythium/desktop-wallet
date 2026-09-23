// SA-07-007 — the cluster label annotates the counterparty, it does not replace it.
//
// This modal used an if/ELSE: when a record carried a cluster name it rendered a
// "Cluster" row INSTEAD of the From/To address row, so the detail view showed no
// address at all for exactly those records. That matters more than it looks,
// because the notifications LIST cites this modal to justify truncating its own
// row — "the row's detail modal renders it in full" — which was false for the
// rows carrying a cluster name.
//
// `clusterName` reaches here from a plaintext store with no format check, so it
// can be made address-shaped. This file also had NO tests at all before now.

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { NotificationDetail } from "../NotificationDetail";
import type { NotificationRecord } from "../../sdk/notifications";

const COUNTERPARTY = "mono1zg69v7yszg69v7yszg69v7yszg69v7ysqcld0s";

function record(over: Partial<NotificationRecord> = {}): NotificationRecord {
  return {
    id: "0x10f2c:0xabc",
    txHash: "0xabc",
    status: "confirmed",
    blockNumber: 42,
    kind: "delegate",
    amountDecimal: "1",
    counterparty: COUNTERPARTY,
    ts: 1_700_000_000_000,
    ...over,
  } as NotificationRecord;
}

afterEach(() => cleanup());

describe("a record carrying a cluster name", () => {
  it("renders the cluster label AND the counterparty address", () => {
    render(
      <NotificationDetail
        record={record({ clusterName: "atlas.cluster.mono" })}
        onClose={vi.fn()}
      />,
    );
    expect(screen.getByText("Cluster")).toBeInTheDocument();
    expect(screen.getByText("atlas.cluster.mono")).toBeInTheDocument();
    // The row that used to disappear.
    expect(document.body.textContent ?? "").toContain(COUNTERPARTY);
  });

  it("renders the address even when the cluster name is ADDRESS-SHAPED", () => {
    // The sharp case: the name is never format-checked, so a planted record can
    // name itself with an address. Without the counterparty row beside it, that
    // string is the only address-looking thing on screen.
    const decoy = "mono1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq";
    render(
      <NotificationDetail
        record={record({ clusterName: decoy })}
        onClose={vi.fn()}
      />,
    );
    expect(document.body.textContent ?? "").toContain(COUNTERPARTY);
  });
});

describe("anti-vacuity — a record with no cluster name is unchanged", () => {
  it("renders the counterparty row and no cluster row", () => {
    render(<NotificationDetail record={record({ kind: "receive" })} onClose={vi.fn()} />);
    expect(screen.queryByText("Cluster")).toBeNull();
    expect(document.body.textContent ?? "").toContain(COUNTERPARTY);
  });

  it("omits the counterparty row entirely when the record has no counterparty", () => {
    // Honest absence, the file's own rule — never a placeholder.
    render(
      <NotificationDetail
        record={record({ kind: "receive", counterparty: "" })}
        onClose={vi.fn()}
      />,
    );
    expect(screen.queryByText("From")).toBeNull();
  });
});
