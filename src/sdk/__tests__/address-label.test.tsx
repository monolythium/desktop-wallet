// The display-precedence law, the category badge, and NamedAddress.
//
// The property that matters: a CONTACT label must never look chain-verified.
// The chip is exclusively the quorum marker — otherwise a user's own
// mislabelled paste would borrow the credibility of a fleet-wide agreement.

import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { addressToTypedBech32 } from "@monolythium/core-sdk";
import {
  preferredAddressLabel,
  REGISTERED_CHIP_TEXT,
  REGISTERED_CHIP_TITLE,
} from "../address-label";

const reverse = vi.hoisted(() => ({ name: null as string | null }));
vi.mock("../reverse-name", async (orig) => ({
  ...(await orig<typeof import("../reverse-name")>()),
  loadReverseName: vi.fn(async () => reverse.name),
}));

const contact = vi.hoisted(() => ({ name: null as string | null }));
vi.mock("../addressbook", async (orig) => ({
  ...(await orig<typeof import("../addressbook")>()),
  addressbookGetByAddress: vi.fn(async () =>
    contact.name === null ? null : { name: contact.name, address: "x", addedAt: 1 },
  ),
}));

import { CategoryBadge, categoryOfName, NAME_CATEGORIES } from "../../components/CategoryBadge";
import { NamedAddress } from "../../components/_detailModalParts";

const ADDR = addressToTypedBech32("user", "0x" + "aa".repeat(20));

beforeEach(() => {
  reverse.name = null;
  contact.name = null;
});

describe("preferredAddressLabel", () => {
  it("a registered name outranks a contact label", () => {
    expect(preferredAddressLabel("alice.mono", "My exchange")).toEqual({
      kind: "registered",
      label: "alice.mono",
    });
  });

  it("falls back to the contact label", () => {
    expect(preferredAddressLabel(null, "My exchange")).toEqual({
      kind: "contact",
      label: "My exchange",
    });
  });

  it("null when neither exists — the address stands alone", () => {
    expect(preferredAddressLabel(null, null)).toBeNull();
    expect(preferredAddressLabel(undefined, undefined)).toBeNull();
  });

  it("treats blank strings as absent", () => {
    expect(preferredAddressLabel("   ", "Contact")).toEqual({ kind: "contact", label: "Contact" });
    expect(preferredAddressLabel("", "")).toBeNull();
  });

  it("trims the label it returns", () => {
    expect(preferredAddressLabel("  alice.mono  ", null)?.label).toBe("alice.mono");
  });
});

describe("CategoryBadge — never guesses", () => {
  it("renders each of the five known categories", () => {
    for (const cat of NAME_CATEGORIES) {
      const { unmount } = render(<CategoryBadge category={cat} />);
      const badge = screen.getByTestId("category-badge");
      expect(badge.textContent).toBe(cat);
      // Colour comes only from tokens.
      expect((badge as HTMLElement).style.background).toBe(`var(--cat-${cat}-bg)`);
      expect((badge as HTMLElement).style.color).toBe(`var(--cat-${cat}-fg)`);
      unmount();
    }
  });

  it("renders NOTHING for an unknown or absent category", () => {
    for (const bad of ["exchange", "foundation", "", null, undefined, 7]) {
      const { container, unmount } = render(
        <CategoryBadge category={bad as string | null | undefined} />,
      );
      expect(container.textContent).toBe("");
      unmount();
    }
  });

  it("derives the category structurally, or null", () => {
    expect(categoryOfName("alice.mono")).toBe("human");
    expect(categoryOfName("ops.cluster.mono")).toBe("cluster");
    expect(categoryOfName("not a name")).toBeNull();
    expect(categoryOfName(null)).toBeNull();
  });
});

describe("NamedAddress — precedence applied", () => {
  it("a registered name renders with the chip, the tooltip and a badge", async () => {
    reverse.name = "alice.mono";
    render(<NamedAddress addr={ADDR} />);

    expect(await screen.findByText("alice.mono")).toBeInTheDocument();
    const chip = screen.getByTestId("name-chip");
    expect(chip.textContent).toBe(REGISTERED_CHIP_TEXT);
    expect(chip.getAttribute("title")).toBe(REGISTERED_CHIP_TITLE);
    expect(screen.getByTestId("category-badge").textContent).toBe("human");
  });

  it("a CONTACT label renders WITHOUT the chip (never looks chain-verified)", async () => {
    contact.name = "My exchange";
    render(<NamedAddress addr={ADDR} />);

    expect(await screen.findByText("My exchange")).toBeInTheDocument();
    expect(screen.queryByTestId("name-chip")).toBeNull();
    expect(screen.queryByTestId("category-badge")).toBeNull();
  });

  it("a registered name wins over a contact label", async () => {
    reverse.name = "alice.mono";
    contact.name = "My exchange";
    render(<NamedAddress addr={ADDR} />);

    expect(await screen.findByText("alice.mono")).toBeInTheDocument();
    expect(screen.queryByText("My exchange")).toBeNull();
    expect(screen.getByTestId("name-chip")).toBeInTheDocument();
  });

  it("no label at all leaves the bare address", async () => {
    const { container } = render(<NamedAddress addr={ADDR} />);
    await Promise.resolve();
    expect(screen.queryByTestId("name-chip")).toBeNull();
    expect(container.textContent).toContain(ADDR);
  });

  it("the FULL address renders in every case — the label only annotates", async () => {
    reverse.name = "alice.mono";
    render(<NamedAddress addr={ADDR} />);
    await screen.findByText("alice.mono");

    const link = screen.getByTitle(ADDR);
    expect(link.textContent).toBe(ADDR);
    expect(link.textContent).toHaveLength(ADDR.length);
    expect(link.textContent).not.toContain("…");
    expect((link as HTMLElement).style.wordBreak).toBe("break-all");
  });
});
