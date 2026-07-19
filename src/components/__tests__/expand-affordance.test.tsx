// Law 1.2 — truncation is permitted ONLY as an expand affordance.
//
// The rule that actually protects the user is (b): every copy action copies
// the FULL string. A truncated address is a display convenience; a truncated
// address in the clipboard is a value that is not an address, and the user
// will not notice until a send fails — or worse, until it doesn't.

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, screen } from "@testing-library/react";
import { addressToTypedBech32 } from "@monolythium/core-sdk";
import { renderWithProviders } from "../../test/renderWithProviders";
import { truncMiddle } from "../../sdk/truncate";

const ADDR = addressToTypedBech32("user", "0x000000000000000000000000000000000000beef");

vi.mock("../../sdk/reverse-name", () => ({ loadReverseName: vi.fn(async () => null) }));
vi.mock("../../sdk/addressbook", () => ({
  addressbookGetByAddress: vi.fn(async () => null),
  addressbookLookup: vi.fn(async () => []),
}));

import { CopyableAddress } from "../_detailModalParts";

afterEach(cleanup);

describe("CopyableAddress — the detail-modal address", () => {
  it("renders the address IN FULL (no expand needed)", () => {
    // Stronger than the law requires: this surface has vertical room, so it
    // wraps the whole string rather than truncating and offering an expand.
    renderWithProviders(<CopyableAddress addr={ADDR} />);
    expect(screen.getByText(ADDR)).toBeInTheDocument();
  });

  it("shows no head…tail form of the address", () => {
    const { container } = renderWithProviders(<CopyableAddress addr={ADDR} />);
    expect(container.textContent ?? "").not.toContain(truncMiddle(ADDR));
  });

  it("wraps rather than ellipsizing", () => {
    renderWithProviders(<CopyableAddress addr={ADDR} />);
    // The text sits in ExternalLink's `display: contents` wrapper; the styled
    // box is the anchor around it.
    const anchor = (screen.getByText(ADDR) as HTMLElement).closest("a")!;
    expect(anchor.style.wordBreak).toBe("break-all");
    expect(anchor.style.textOverflow).not.toBe("ellipsis");
  });

  it("copy writes the FULL address", async () => {
    // `navigator.clipboard` is getter-only in jsdom, and userEvent installs its
    // own stub at render time — so ours is redefined after the render.
    const { user } = renderWithProviders(<CopyableAddress addr={ADDR} />);
    const writeText = vi.fn(async (_text: string) => {});
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText },
      configurable: true,
      writable: true,
    });

    await user.click(screen.getByRole("button", { name: "Copy address" }));

    expect(writeText).toHaveBeenCalledWith(ADDR);
    expect(writeText.mock.calls[0]![0]).not.toContain("…");
  });

  it("a name annotates — it never replaces the address", () => {
    // The label is the user's or the chain's claim about the address; the
    // address is the fact. Both render.
    renderWithProviders(<CopyableAddress addr={ADDR} name="alice.mono" registered />);
    expect(screen.getByText("alice.mono")).toBeInTheDocument();
    expect(screen.getByText(ADDR)).toBeInTheDocument();
  });
});
