// The confirm-surface fiat sibling (Phase 07 slot 5).
//
// The additive-sibling law is bound at the TYPE level here: `OperationDiffLine`
// carries an optional `fiat`, and the drawer renders it as a separate span so
// the canonical `v` string stays byte-identical either way. Receipts (the done
// pane) stay fiat-free by design.

import { beforeEach, describe, expect, it, vi } from "vitest";
import { screen } from "@testing-library/react";
import { renderWithProviders } from "../../test/renderWithProviders";
import type { OperationDescriptor, OperationResult } from "../types";

const kc = vi.hoisted(() => ({
  fetchAndUnlockVault: vi.fn(),
  getActiveAccount: vi.fn(() => "slot-1"),
}));
vi.mock("../../sdk/keychain", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../sdk/keychain")>()),
  fetchAndUnlockVault: kc.fetchAndUnlockVault,
  getActiveAccount: kc.getActiveAccount,
}));
vi.mock("../../sdk/vaultCatalog", () => ({ captureAddressOnUnlock: vi.fn(() => Promise.resolve()) }));

const lockout = vi.hoisted(() => ({
  readLockoutState: vi.fn(() => ({ failCount: 0, lockoutUntil: 0 })),
  recordWrongUnlockAttempt: vi.fn(() => ({ failCount: 1, lockoutUntil: 0 })),
  clearUnlockLockout: vi.fn(),
  lockoutRemainingMs: vi.fn((until: number, now: number) => Math.max(0, until - now)),
}));
vi.mock("../../sdk/unlock-lockout", () => lockout);

import { OperationsDrawer } from "../OperationsDrawer";

/** Every fiat symbol glyph the shipped currency set can produce. */
const FIAT_GLYPHS = /[$€£¥₹₩₺₫¢]/;

function op(diff: OperationDescriptor["diff"]): OperationDescriptor {
  return {
    title: "Send 1 LYTH",
    commitment: { subject: "mono1recipient", amount: "1 LYTH" },
    diff,
    effects: [],
    auth: "none",
    execute: async (): Promise<OperationResult> => ({
      headline: "Broadcast 1 LYTH",
      detail: "0xabc · from mono1test",
      txHash: "0xabc",
    }),
  };
}

function valueSpan(): Element {
  return document.querySelector(".w-kv .v")!;
}

beforeEach(() => {
  kc.fetchAndUnlockVault.mockReset();
  lockout.readLockoutState.mockReturnValue({ failCount: 0, lockoutUntil: 0 });
});

describe("OperationsDrawer — the diff fiat sibling", () => {
  it("renders the canonical v span and a SEPARATE sibling", () => {
    renderWithProviders(
      <OperationsDrawer descriptor={op([{ k: "Amount", v: "1 LYTH", fiat: "$—" }])} onClose={vi.fn()} />,
    );
    // The canonical node's text is exactly the LYTH string — not a byte more.
    expect(valueSpan().textContent).toBe("1 LYTH");
    expect(valueSpan().textContent).not.toMatch(FIAT_GLYPHS);

    const sibling = screen.getByTestId("diff-fiat");
    expect(sibling.textContent).toBe("($—)");
    // Sibling, not a child of the value span.
    expect(valueSpan().contains(sibling)).toBe(false);
    expect(sibling.previousElementSibling).toBe(valueSpan());
  });

  it("renders NO sibling when the row carries no fiat", () => {
    renderWithProviders(
      <OperationsDrawer descriptor={op([{ k: "Amount", v: "1 LYTH" }])} onClose={vi.fn()} />,
    );
    expect(valueSpan().textContent).toBe("1 LYTH");
    expect(screen.queryByTestId("diff-fiat")).toBeNull();
  });

  it("the v string is byte-identical with and without the fiat field", () => {
    const { unmount } = renderWithProviders(
      <OperationsDrawer descriptor={op([{ k: "Amount", v: "1.5 LYTH" }])} onClose={vi.fn()} />,
    );
    const without = valueSpan().textContent;
    const withoutClass = valueSpan().className;
    unmount();

    renderWithProviders(
      <OperationsDrawer descriptor={op([{ k: "Amount", v: "1.5 LYTH", fiat: "€—" }])} onClose={vi.fn()} />,
    );
    expect(valueSpan().textContent).toBe(without);
    expect(valueSpan().className).toBe(withoutClass);
  });

  it("preserves the fee row's mono class and the warn colour alongside a sibling", () => {
    renderWithProviders(
      <OperationsDrawer
        descriptor={op([
          { k: "Fee (Normal)", v: "0.000042 LYTH", kind: "fee", fiat: "$—" },
          { k: "Heads up", v: "careful", kind: "warn" },
        ])}
        onClose={vi.fn()}
      />,
    );
    const spans = document.querySelectorAll(".w-kv .v");
    expect(spans[0]!.className).toContain("mono");
    expect((spans[1] as HTMLElement).style.color).toBe("var(--warn)");
  });

  it("only the rows given a fiat field get a sibling", () => {
    renderWithProviders(
      <OperationsDrawer
        descriptor={op([
          { k: "From", v: "mono1aaa" },
          { k: "Amount", v: "1 LYTH", fiat: "$—" },
          { k: "Fee (Normal)", v: "0.000042 LYTH", kind: "fee", fiat: "$—" },
          { k: "Finality", v: "anchor-level", kind: "value" },
        ])}
        onClose={vi.fn()}
      />,
    );
    expect(screen.getAllByTestId("diff-fiat")).toHaveLength(2);
  });
});

describe("OperationsDrawer — the receipt carries no fiat", () => {
  it("the done pane shows no fiat symbol and no ≈", async () => {
    const { user, container } = renderWithProviders(
      <OperationsDrawer
        descriptor={op([{ k: "Amount", v: "1 LYTH", fiat: "$—" }])}
        onClose={vi.fn()}
      />,
    );
    // auth: "none" runs straight from the preview.
    await user.click(screen.getByRole("button", { name: "Run" }));

    await screen.findByText("Broadcast 1 LYTH");
    // The preview (with its sibling) is gone; what remains is the receipt.
    expect(screen.queryByTestId("diff-fiat")).toBeNull();
    const text = container.textContent ?? "";
    expect(text).not.toMatch(FIAT_GLYPHS);
    expect(text).not.toContain("≈");
  });
});
