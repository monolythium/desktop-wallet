// SA-07-001 — the label ANNOTATES, it does not replace.
//
// `address-label.ts:8-9` states the binding law: "The label always ANNOTATES:
// the full address renders beside it either way." `TxRow` used to do exactly
// what that forbids — `counterpartyLabel ?? tx.counterparty` substituted the
// name and the row rendered no address at all.
//
// These assert the PROPERTY, not the symbol: every check reads the rendered DOM
// and asks what a user could actually see. A grep for `counterpartyAddress`
// would pass against a row that renders the prop into a `title` attribute
// nobody reads, or into a zero-height node — so nothing here inspects source.

import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { TxRow } from "../TxRow";
import type { Tx } from "../../data/types";
import { REGISTERED_CHIP_TEXT } from "../../sdk/address-label";

const ADDRESS = "mono1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq";
const OTHER_ADDRESS = "mono1zzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz";

function tx(over: Partial<Tx> = {}): Tx {
  return {
    id: "1",
    when: "block 1 · tx 0",
    amountText: "12.5",
    unit: "LYTH",
    signed: true,
    direction: "out",
    counterparty: ADDRESS,
    memo: "",
    kind: "tx_send",
    bucket: "transfer",
    typeLabel: "Outgoing transfer",
    ...over,
  };
}

/** What the row actually puts on screen, as one string. */
function rowText(): string {
  return document.body.textContent ?? "";
}

describe("a labelled row renders the address the label annotates", () => {
  it("renders BOTH the contact label and the full address", () => {
    render(
      <TxRow
        tx={tx()}
        counterpartyLabel={{ kind: "contact", label: "Alice" }}
        counterpartyAddress={ADDRESS}
      />,
    );
    // The law: the label annotates. Both must be present.
    expect(screen.getByText(/Alice/)).toBeInTheDocument();
    expect(screen.getByTestId("txrow-counterparty-address")).toBeInTheDocument();
    expect(rowText()).toContain(ADDRESS);
  });

  it("renders the address IN FULL — no ellipsis, no truncation", () => {
    render(
      <TxRow
        tx={tx()}
        counterpartyLabel={{ kind: "contact", label: "Alice" }}
        counterpartyAddress={ADDRESS}
      />,
    );
    const node = screen.getByTestId("txrow-counterparty-address");
    // Byte-for-byte, not "contains a prefix". A truncated address is exactly
    // what an attacker grinds a lookalike to match, so a shortened render here
    // would hand over the collision the row exists to expose.
    expect(node.textContent).toBe(ADDRESS);
    expect(node.textContent).not.toContain("…");
    expect(node.textContent).not.toContain("...");
  });

  it("renders a registered name WITH the chain-verified chip", () => {
    render(
      <TxRow
        tx={tx()}
        counterpartyLabel={{ kind: "registered", label: "alice.mono" }}
        counterpartyAddress={ADDRESS}
      />,
    );
    expect(screen.getByTestId("txrow-name-chip").textContent).toBe(REGISTERED_CHIP_TEXT);
    // Still annotating — the chip does not excuse the address.
    expect(screen.getByTestId("txrow-counterparty-address").textContent).toBe(ADDRESS);
  });

  it("a CONTACT label never carries the chain-verified chip", () => {
    render(
      <TxRow
        tx={tx()}
        counterpartyLabel={{ kind: "contact", label: "alice.mono" }}
        counterpartyAddress={ADDRESS}
      />,
    );
    // Same STRING as the registered case above, differing only in `kind` — so
    // this fails the moment the discriminant stops reaching the render, which
    // is precisely how `?.label ?? null` broke it.
    //
    // Asserted on the CHIP NODE, not on a body substring: REGISTERED_CHIP_TEXT
    // is the word "name", so a whole-document `not.toContain` would also trip on
    // a memo or a type label containing it, and would read as a property check
    // while actually testing the fixture.
    expect(screen.queryByTestId("txrow-name-chip")).toBeNull();
    expect(document.querySelector(".w-tx__chip")).toBeNull();
  });
});

describe("fail direction — a label without its address is dropped", () => {
  it("renders NO label when there is no address to annotate", () => {
    render(<TxRow tx={tx()} counterpartyLabel={{ kind: "contact", label: "Alice" }} />);
    // The failure that misleads is a name the user cannot check, so that is the
    // one refused. The row falls back to its unlabelled rendering.
    expect(rowText()).not.toContain("Alice");
    expect(screen.queryByTestId("txrow-counterparty-address")).toBeNull();
    expect(rowText()).toContain(ADDRESS);
  });

  it("renders NO label when the address is the empty string", () => {
    render(
      <TxRow
        tx={tx()}
        counterpartyLabel={{ kind: "contact", label: "Alice" }}
        counterpartyAddress=""
      />,
    );
    expect(rowText()).not.toContain("Alice");
  });

  it("the address shown is the one PASSED, not the Tx display string", () => {
    // `activityCounterparty` prefers `row.clusterName`, so `tx.counterparty` is
    // a display string that is not always an address. The row must annotate
    // with the address it was given, never with that field.
    render(
      <TxRow
        tx={tx({ counterparty: "Staking Cluster" })}
        counterpartyLabel={{ kind: "contact", label: "Alice" }}
        counterpartyAddress={OTHER_ADDRESS}
      />,
    );
    expect(screen.getByTestId("txrow-counterparty-address").textContent).toBe(OTHER_ADDRESS);
  });
});

describe("anti-vacuity — the unlabelled row is untouched", () => {
  it("renders the counterparty and no address line when there is no label", () => {
    render(<TxRow tx={tx()} />);
    expect(screen.queryByTestId("txrow-counterparty-address")).toBeNull();
    expect(screen.queryByTestId("txrow-name-chip")).toBeNull();
    // Unlabelled rows still show the counterparty exactly as before, so the
    // "address renders" assertions above cannot be satisfied vacuously by a row
    // that simply prints everything.
    expect(rowText()).toContain(ADDRESS);
    expect(rowText()).toContain("To ");
  });

  it("the direction wording still comes from the label when one is shown", () => {
    render(
      <TxRow
        tx={tx({ direction: "in", kind: "tx_receive" })}
        counterpartyLabel={{ kind: "contact", label: "Alice" }}
        counterpartyAddress={ADDRESS}
      />,
    );
    expect(rowText()).toContain("From Alice");
  });
});

describe("the address is visible, not merely in the DOM", () => {
  it("is rendered as text content in an element that is not hidden", () => {
    render(
      <TxRow
        tx={tx()}
        counterpartyLabel={{ kind: "contact", label: "Alice" }}
        counterpartyAddress={ADDRESS}
      />,
    );
    const node = screen.getByTestId("txrow-counterparty-address");
    // A `title`/`aria-label`-only render would satisfy "contains the address"
    // while showing the user nothing, so pin that it is TEXT and unhidden.
    expect(node.textContent).toBe(ADDRESS);
    expect(node.hidden).toBe(false);
    expect(node.getAttribute("aria-hidden")).toBeNull();
    expect(screen.getByText(ADDRESS)).toBe(node);
  });
});

// SA-07-006 — the same law, reached by a different route.
//
// `activityCounterparty` returned `row.clusterName` in preference to the
// address, so a delegation row rendered the name with NO address anywhere — and
// that row carries no `counterpartyLabel`, so the assertions above could not see
// it. Home and TokenDetail pass no label props at all, which is why the cluster
// label travels ON the row: it is the only way the annotation reaches all three
// pages rather than the one page that resolves labels.
//
// Extended here rather than in a second file because it is the same property:
// the label annotates, the address renders beside it.
describe("a cluster name annotates, it does not replace", () => {
  it("renders the address for a row whose only label is a cluster name", () => {
    render(
      <TxRow
        tx={tx({
          counterparty: ADDRESS,
          clusterLabel: { kind: "cluster", label: "Aurora Cluster" },
          counterpartyAddress: ADDRESS,
        })}
      />,
    );
    // No `counterpartyLabel` prop — this is the Home/TokenDetail shape.
    expect(screen.getByText(/Aurora Cluster/)).toBeInTheDocument();
    expect(screen.getByTestId("txrow-counterparty-address").textContent).toBe(ADDRESS);
  });

  it("a cluster name NEVER carries the chain-verified chip", () => {
    // It resolves from a SINGLE operator, while an address reverse-name needs a
    // quorum of two. Same string as a registered name would be, differing only
    // in `kind`.
    render(
      <TxRow
        tx={tx({
          clusterLabel: { kind: "cluster", label: "alice.mono" },
          counterpartyAddress: ADDRESS,
        })}
      />,
    );
    expect(screen.queryByTestId("txrow-name-chip")).toBeNull();
    expect(document.querySelector(".w-tx__chip")).toBeNull();
  });

  it("an ADDRESS-SHAPED cluster name still renders the real address beside it", () => {
    // The sharp case: `clusterName` is never format-checked, so a planted row
    // can name itself with the victim's own address. Before, the row showed
    // that string and nothing else.
    render(
      <TxRow
        tx={tx({
          clusterLabel: { kind: "cluster", label: OTHER_ADDRESS },
          counterpartyAddress: ADDRESS,
        })}
      />,
    );
    expect(screen.getByTestId("txrow-counterparty-address").textContent).toBe(ADDRESS);
  });

  it("a call-site label still wins over the row's cluster label", () => {
    render(
      <TxRow
        tx={tx({ clusterLabel: { kind: "cluster", label: "Aurora Cluster" } })}
        counterpartyLabel={{ kind: "contact", label: "Alice" }}
        counterpartyAddress={ADDRESS}
      />,
    );
    expect(screen.getByText(/Alice/)).toBeInTheDocument();
    expect(document.body.textContent ?? "").not.toContain("Aurora Cluster");
  });

  it("the drop rule holds for a cluster label too", () => {
    // Fail direction, unchanged: a label with no address to annotate is
    // dropped rather than shown alone.
    render(<TxRow tx={tx({ counterparty: "Cluster #3", clusterLabel: { kind: "cluster", label: "Aurora Cluster" } })} />);
    expect(document.body.textContent ?? "").not.toContain("Aurora Cluster");
    expect(screen.queryByTestId("txrow-counterparty-address")).toBeNull();
  });
});

// NOTE on what is deliberately NOT tested here. A caller that passes a label and
// forgets the address is not defended by a source scan — it is defended by the
// drop rule above: such a row loses its label and renders unlabelled. The
// failure is visible and safe, so there is nothing left for a grep to add.

afterEach(() => cleanup());
