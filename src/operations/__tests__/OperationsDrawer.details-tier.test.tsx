// The disclosure tier — and why the rows in it must be DERIVED.
//
// Twelve of the twenty signing surfaces carried a target row that was a typed
// literal: `"0x…100a"` six times in the delegation diffs, `"0x…110E"` three
// times in the name-registry diffs, a truncated `PRECOMPILE_LABEL` three times
// in the policy diffs. Four more carried no target row at all.
//
// A literal that happens to be correct today cannot disagree with what is
// signed, so it cannot detect a change to it. It reads as disclosure while
// disclosing only itself.
//
// It belongs in a disclosure rather than on the primary surface because a user
// cannot tell a correct precompile from an incorrect one — promoting it would
// train them to skip rows, which is the failure the whole surface is written
// against. `<details>` and not the shared collapsible, because that one hides
// with the `hidden` attribute and a signed fact must stay in the accessibility
// tree whether the section is open or shut.

import { describe, expect, it, vi } from "vitest";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithProviders } from "../../test/renderWithProviders";
import { PRECOMPILE_ADDRESSES } from "@monolythium/core-sdk";
import { DELEGATION_PRECOMPILE } from "../../sdk/delegation";
import { SPENDING_POLICY_PRECOMPILE } from "../../sdk/spending-policy";
import type { OperationDescriptor, OperationResult } from "../types";
import { OperationsDrawer } from "../OperationsDrawer";

function op(details?: OperationDescriptor["details"]): OperationDescriptor {
  return {
    title: "Delegate 10.00% to cluster 1",
    commitment: { subject: "Cluster Atlas", amount: null },
    diff: [{ k: "Cluster", v: "1" }],
    ...(details === undefined ? {} : { details }),
    effects: [],
    auth: "keychain",
    execute: async (): Promise<OperationResult> => ({ headline: "ok" }),
  };
}

describe("the disclosure tier", () => {
  it("keeps its content in the accessibility tree while CLOSED", async () => {
    // The whole reason for `<details>` over the shared collapsible. `hidden`
    // removes content from the tree; a closed `<details>` does not, so the row
    // is still findable by name.
    renderWithProviders(
      <OperationsDrawer descriptor={op([{ k: "Precompile", v: DELEGATION_PRECOMPILE }])} onClose={() => {}} />,
    );
    const panel = screen.getByTestId("operation-details");
    expect(panel).not.toHaveAttribute("open");
    // Present and readable despite being collapsed — `getByText` walks the
    // rendered tree, and `hidden` content would still be in the DOM, so the
    // discriminating check is the attribute below.
    expect(screen.getByText(DELEGATION_PRECOMPILE)).toBeInTheDocument();
    expect(panel.querySelector("[hidden]")).toBeNull();
  });

  it("opens on activation and still shows the row", async () => {
    const user = userEvent.setup();
    renderWithProviders(
      <OperationsDrawer descriptor={op([{ k: "Precompile", v: DELEGATION_PRECOMPILE }])} onClose={() => {}} />,
    );
    await user.click(screen.getByText("Transaction details"));
    expect(screen.getByTestId("operation-details")).toHaveAttribute("open");
    expect(screen.getByText(DELEGATION_PRECOMPILE)).toBeInTheDocument();
  });

  it("renders nothing at all when a surface declares no details", () => {
    // Anti-vacuity: the assertions above must be able to fail by absence.
    renderWithProviders(<OperationsDrawer descriptor={op()} onClose={() => {}} />);
    expect(screen.queryByTestId("operation-details")).toBeNull();
  });

  it("is a PREVIEW-stage surface — it does not follow the user to auth", async () => {
    const user = userEvent.setup();
    renderWithProviders(
      <OperationsDrawer descriptor={op([{ k: "Precompile", v: DELEGATION_PRECOMPILE }])} onClose={() => {}} />,
    );
    await user.click(screen.getByRole("button", { name: "Continue" }));
    await screen.findByLabelText("Password");
    expect(screen.queryByTestId("operation-details")).toBeNull();
  });
});

describe("the target rows are DERIVED, not typed", () => {
  // The literals that used to be in the diffs. If a contributor re-types one,
  // the surface renders a truncated placeholder rather than an address, and
  // these say so by name.
  const RETIRED_LITERALS = ["0x…100a", "0x…110E", "0x…110c"];

  it.each([
    ["delegation", DELEGATION_PRECOMPILE],
    ["spending policy", SPENDING_POLICY_PRECOMPILE],
    ["CLOB", PRECOMPILE_ADDRESSES.CLOB],
  ])("the %s constant is a full 20-byte address, not a truncation", (_label, value) => {
    // The property the literals failed: a value that can be COMPARED to what is
    // signed. `0x…100a` cannot be compared to anything.
    expect(value).toMatch(/^0x[0-9a-fA-F]{40}$/);
    for (const literal of RETIRED_LITERALS) {
      expect(value).not.toBe(literal);
    }
  });

  it("the retired literals really were untypable as addresses — the control", () => {
    // Anti-vacuity for the assertion above: it only means something if the old
    // values would in fact have failed it.
    for (const literal of RETIRED_LITERALS) {
      expect(literal).not.toMatch(/^0x[0-9a-fA-F]{40}$/);
    }
  });
});

describe("not-shown components stay off the primary surface", () => {
  // The recorded decisions, asserted rather than trusted: the tip (bounded by
  // and inside the fee total), the nonce (no decision a user can act on — its
  // failure mode lives in the reconciler), the chain id on the submit seam (a
  // constant behind a symmetric operator check), and the access list (no such
  // field exists on the signed type).
  //
  // ⚠ WRITTEN SO IT CANNOT PASS VACUOUSLY. A test that only asserts absence
  // passes on an empty screen. So it first requires the components that ARE
  // shown to be present, and only then that the omitted ones are not.
  const OMITTED = [/priority tip/i, /\bnonce\b/i, /chain id/i, /access list/i];

  it("shows the payee and the amount, and none of the four omitted components", async () => {
    const user = userEvent.setup();
    const d: OperationDescriptor = {
      title: "Send 1 LYTH",
      commitment: { subject: "mono1payee", amount: "1 LYTH" },
      diff: [
        { k: "To", v: "mono1payee" },
        { k: "Amount", v: "1 LYTH" },
        { k: "Fee (Normal)", v: "0.000021 LYTH", kind: "fee" },
      ],
      details: [{ k: "Precompile", v: DELEGATION_PRECOMPILE }],
      effects: [],
      auth: "keychain",
      execute: async (): Promise<OperationResult> => ({ headline: "ok" }),
    };
    renderWithProviders(<OperationsDrawer descriptor={d} onClose={() => {}} />);

    // PRESENT FIRST — without these three the absences below are worthless.
    expect(screen.getByText("mono1payee")).toBeInTheDocument();
    expect(screen.getByText("1 LYTH")).toBeInTheDocument();
    expect(screen.getByText("0.000021 LYTH")).toBeInTheDocument();

    for (const omitted of OMITTED) {
      expect(screen.queryByText(omitted)).toBeNull();
    }

    // And they are absent at the auth stage too, where the summary is at its
    // most compressed and a stray row would cost the most.
    await user.click(screen.getByRole("button", { name: "Continue" }));
    await screen.findByLabelText("Password");
    expect(screen.getByTestId("auth-commitment")).toHaveTextContent("mono1payee");
    for (const omitted of OMITTED) {
      expect(screen.queryByText(omitted)).toBeNull();
    }
  });
});

vi.mock("../../sdk/unlock-lockout", () => ({
  readLockoutState: vi.fn(() => ({ failCount: 0, lockoutUntil: 0 })),
  recordWrongUnlockAttempt: vi.fn(() => ({ failCount: 1, lockoutUntil: 0 })),
  clearUnlockLockout: vi.fn(),
  lockoutRemainingMs: vi.fn((until: number, now: number) => Math.max(0, until - now)),
}));
