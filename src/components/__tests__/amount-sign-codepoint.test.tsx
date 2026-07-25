// The amount sign must be ASCII HYPHEN-MINUS (U+002D), never MINUS SIGN (U+2212).
//
// Why this is asserted by CODEPOINT and not by appearance: in almost every UI
// font the two are visually indistinguishable, so a reviewer reading the diff, a
// screenshot check, and a naive editor search all pass while the wrong character
// ships. What does NOT survive is the user — a copied "<U+2212>12.5" is not a
// number any parser, spreadsheet or explorer accepts.
//
// Asserted at DOM level on BOTH surfaces that render a sign, deliberately rather
// than by a source-level sweep. A regex over source cannot tell a rendered
// string from a comment, and this codebase legitimately writes U+2212 in prose
// and in maths notation (`fee-model.ts`, `lyth-display.ts`) — a sweep would
// report those as offenders and look rigorous while being unsound. The same
// reasoning is already recorded in the nav-invariants suite.

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { renderWithProviders } from "../../test/renderWithProviders";
import { TxRow } from "../TxRow";
import { ActivityDetail, type IndexedDetailRow } from "../ActivityDetail";
import type { Tx } from "../../data/types";

const MINUS_SIGN = "−"; // the WRONG one
const HYPHEN_MINUS = "-"; // the required one

function tx(over: Partial<Tx> = {}): Tx {
  return {
    id: "1",
    when: "block 1 · tx 0",
    amountText: "12.5",
    unit: "LYTH",
    signed: true,
    direction: "out",
    counterparty: "mono1abc",
    memo: "",
    kind: "tx_send",
    bucket: "transfer",
    typeLabel: "Outgoing transfer",
    ...over,
  };
}

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

afterEach(cleanup);

describe("the two sign characters are genuinely different", () => {
  it("proves the assertions below are not a no-op", () => {
    expect(MINUS_SIGN.charCodeAt(0)).toBe(0x2212);
    expect(HYPHEN_MINUS.charCodeAt(0)).toBe(0x2d);
    expect(MINUS_SIGN).not.toBe(HYPHEN_MINUS);
  });
});

describe("the feed row's amount sign", () => {
  it("renders the ASCII hyphen-minus on an outgoing row", () => {
    render(<TxRow tx={tx({ direction: "out" })} />);
    const amount = screen.getByText(/12\.5/).textContent ?? "";
    expect(amount).toContain(HYPHEN_MINUS);
    expect(amount).not.toContain(MINUS_SIGN);
    expect(amount.trimStart().charCodeAt(0)).toBe(0x2d);
  });

  it("renders a plus on an incoming row", () => {
    render(<TxRow tx={tx({ direction: "in" })} />);
    expect(screen.getByText(/12\.5/).textContent ?? "").toContain("+");
  });

  it("renders NO sign on a directionless row", () => {
    render(<TxRow tx={tx({ direction: "none", kind: "token_transfer" })} />);
    const amount = screen.getByText(/12\.5/).textContent ?? "";
    expect(amount).not.toContain(HYPHEN_MINUS);
    expect(amount).not.toContain(MINUS_SIGN);
    expect(amount).not.toContain("+");
  });

  it("renders NO sign on an unsigned weight figure, even outgoing", () => {
    render(
      <TxRow
        tx={tx({
          signed: false,
          direction: "out",
          kind: "delegate",
          bucket: "delegate",
          amountText: "50.00",
          unit: "weight",
        })}
      />,
    );
    const amount = screen.getByText(/50\.00/).textContent ?? "";
    expect(amount).not.toContain(HYPHEN_MINUS);
    expect(amount).not.toContain("+");
  });
});

describe("the detail modal's amount sign", () => {
  it("renders the ASCII hyphen-minus on an outgoing row", () => {
    renderWithProviders(
      <ActivityDetail row={indexed({ direction: "out" })} walletAddr="mono1self" onClose={vi.fn()} />,
    );
    const amount = screen.getByText(/1 LYTH/).textContent ?? "";
    expect(amount).toContain(HYPHEN_MINUS);
    expect(amount).not.toContain(MINUS_SIGN);
  });

  it("agrees with the feed row on a claim — both say incoming", () => {
    // A claim reports no direction on the wire but IS incoming. Reading the raw
    // field here used to show an unsigned figure in the detail beside a "+"
    // figure in the row; both now derive from the same classified direction.
    renderWithProviders(
      <ActivityDetail
        row={indexed({ activityKind: "reward", direction: null })}
        walletAddr="mono1self"
        onClose={vi.fn()}
      />,
    );
    expect(screen.getByText(/1 LYTH/).textContent ?? "").toContain("+");
  });

  it("renders NO sign for a movement the chain gave no direction for", () => {
    // A native transfer with no reported direction is neither a send nor a
    // receive; it classifies unclassified and signs nothing. The figure is real,
    // so this exercises the sign branch rather than the "no figure" short-circuit.
    renderWithProviders(
      <ActivityDetail
        row={indexed({ direction: null, tokenId: null })}
        walletAddr="mono1self"
        onClose={vi.fn()}
      />,
    );
    const amount = screen.getByText(/1 LYTH/).textContent ?? "";
    expect(amount).not.toContain(HYPHEN_MINUS);
    expect(amount).not.toContain(MINUS_SIGN);
    expect(amount).not.toContain("+");
  });
});
