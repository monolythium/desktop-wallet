// The contacts picker.
//
// A picker is exactly where a truncated address could let the wrong recipient
// look right, so the full string renders — and the row order must be the
// store's MRU order, not a component-side re-sort.

import { beforeEach, describe, expect, it, vi } from "vitest";
import { screen } from "@testing-library/react";
import { addressToTypedBech32 } from "@monolythium/core-sdk";
import { renderWithProviders } from "../../test/renderWithProviders";

const lookup = vi.hoisted(() => vi.fn());
vi.mock("../../sdk/addressbook", async (orig) => ({
  ...(await orig<typeof import("../../sdk/addressbook")>()),
  addressbookLookup: lookup,
}));

import { ContactsPickerModal } from "../ContactsPickerModal";

const A = addressToTypedBech32("user", "0x" + "aa".repeat(20));
const B = addressToTypedBech32("user", "0x" + "bb".repeat(20));

function contact(name: string, address: string, addedAt: number) {
  return { name, address, note: null, tags: null, addedAt };
}

beforeEach(() => {
  lookup.mockReset();
  lookup.mockResolvedValue([]);
});

describe("the no-truncation law", () => {
  it("renders the FULL address, wrapped", async () => {
    lookup.mockResolvedValue([contact("Alice", A, 1)]);
    renderWithProviders(<ContactsPickerModal onSelect={vi.fn()} onClose={vi.fn()} />);

    const node = await screen.findByTitle(A);
    expect(node.textContent).toBe(A);
    expect(node.textContent).toHaveLength(A.length);
    expect((node as HTMLElement).style.wordBreak).toBe("break-all");
    expect((node as HTMLElement).style.textOverflow).toBe("");
  });

  it("shows no ellipsis anywhere in the list", async () => {
    lookup.mockResolvedValue([contact("Alice", A, 1)]);
    const { container } = renderWithProviders(
      <ContactsPickerModal onSelect={vi.fn()} onClose={vi.fn()} />,
    );
    await screen.findByTitle(A);
    expect(container.textContent).not.toContain("…");
  });
});

describe("ordering", () => {
  it("renders in STORE order — no component-side re-sort", async () => {
    // Deliberately NOT alphabetical: the store already ordered these MRU-first.
    lookup.mockResolvedValue([contact("Zoe", B, 2), contact("Alice", A, 1)]);
    const { container } = renderWithProviders(
      <ContactsPickerModal onSelect={vi.fn()} onClose={vi.fn()} />,
    );
    await screen.findByTitle(B);

    const text = container.textContent ?? "";
    expect(text.indexOf("Zoe")).toBeLessThan(text.indexOf("Alice"));
  });

  it("calls the store with no query on mount (store decides the order)", async () => {
    renderWithProviders(<ContactsPickerModal onSelect={vi.fn()} onClose={vi.fn()} />);
    await screen.findByText("No saved contacts yet. Add one from Contacts.");
    expect(lookup).toHaveBeenCalledWith();
  });
});

describe("copy", () => {
  it("keeps its empty states verbatim", async () => {
    renderWithProviders(<ContactsPickerModal onSelect={vi.fn()} onClose={vi.fn()} />);
    expect(
      await screen.findByText("No saved contacts yet. Add one from Contacts."),
    ).toBeInTheDocument();
  });

  it("shows the query-specific empty state", async () => {
    lookup.mockResolvedValue([contact("Alice", A, 1)]);
    const { user } = renderWithProviders(
      <ContactsPickerModal onSelect={vi.fn()} onClose={vi.fn()} />,
    );
    await screen.findByTitle(A);
    await user.type(screen.getByPlaceholderText("Search by name or address"), "zzz");
    expect(await screen.findByText('No contact matches "zzz".')).toBeInTheDocument();
  });
});

describe("selection", () => {
  it("hands the whole record back", async () => {
    const onSelect = vi.fn();
    const entry = contact("Alice", A, 1);
    lookup.mockResolvedValue([entry]);
    const { user } = renderWithProviders(
      <ContactsPickerModal onSelect={onSelect} onClose={vi.fn()} />,
    );
    await screen.findByTitle(A);

    await user.click(screen.getByText("Alice"));
    expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ address: A, name: "Alice" }));
  });
});
