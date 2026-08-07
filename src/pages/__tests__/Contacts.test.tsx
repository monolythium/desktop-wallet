// The Contacts management page.
//
// The regression that matters most here is the no-truncation law: the address
// is what a user verifies, so it renders whole and wraps — never an ellipsis
// hiding exactly the characters being checked.

import { beforeEach, describe, expect, it, vi } from "vitest";
import { screen } from "@testing-library/react";
import { addressToTypedBech32 } from "@monolythium/core-sdk";
import { renderWithProviders } from "../../test/renderWithProviders";

// The harness sets __TAURI_INTERNALS__, so the store takes its Tauri path —
// back it with an in-memory fake rather than letting it read as "offline".
const backing = vi.hoisted(() => new Map<string, unknown>());
vi.mock("../../sdk/wallet-store", () => ({
  WalletStore: {
    load: vi.fn(async () => ({
      get: vi.fn(async (k: string) => backing.get(k)),
      set: vi.fn(async (k: string, v: unknown) => {
        backing.set(k, JSON.parse(JSON.stringify(v)));
      }),
      save: vi.fn(async () => {}),
    })),
  },
}));

vi.mock("../../sdk/active-wallet", () => ({
  useActiveWallet: () => ({ status: "ready", address: "mono1test", name: "W" }),
}));
vi.mock("../../sdk/live", async (orig) => ({
  ...(await orig<typeof import("../../sdk/live")>()),
  loadAccountPolicy: vi.fn(async () => null),
}));

import { Contacts } from "../Contacts";
import { addressbookAdd, __resetAddressBookCacheForTest } from "../../sdk/addressbook";

const A = addressToTypedBech32("user", "0x" + "aa".repeat(20));
const B = addressToTypedBech32("user", "0x" + "bb".repeat(20));

beforeEach(() => {
  localStorage.clear();
  backing.clear();
  __resetAddressBookCacheForTest();
});

describe("copy", () => {
  it("the subtitle claims only what the store can deliver", async () => {
    renderWithProviders(<Contacts />);
    expect(screen.getByText("Saved recipients · most recently used first.")).toBeInTheDocument();
  });

  it("the empty state invites a first contact", async () => {
    renderWithProviders(<Contacts />);
    expect(
      await screen.findByText("No saved recipients yet. Add your first contact below."),
    ).toBeInTheDocument();
  });

  it("the name placeholder does not look like an on-chain name", async () => {
    renderWithProviders(<Contacts />);
    const input = screen.getByPlaceholderText("e.g. Alice, Exchange, Cold storage");
    expect(input).toBeInTheDocument();
    // The old placeholder conflated a local label with a registered name.
    expect(screen.queryByPlaceholderText("alice.mono")).toBeNull();
  });
});

describe("the no-truncation law", () => {
  it("renders the FULL address, wrapped, with no ellipsis", async () => {
    await addressbookAdd({ name: "Alice", address: A });
    const { container } = renderWithProviders(<Contacts />);

    const node = await screen.findByTitle(A);
    expect(node.textContent).toBe(A);
    expect(node.textContent).toHaveLength(A.length);
    expect((node as HTMLElement).style.wordBreak).toBe("break-all");
    expect((node as HTMLElement).style.textOverflow).toBe("");
    expect(container.textContent).not.toContain("…");
  });
});

describe("add", () => {
  it("blocks a duplicate address with the exact message", async () => {
    await addressbookAdd({ name: "Alice", address: A });
    const { user } = renderWithProviders(<Contacts />);
    await screen.findByTitle(A);

    await user.type(screen.getByPlaceholderText("e.g. Alice, Exchange, Cold storage"), "Alice 2");
    await user.type(screen.getByPlaceholderText("mono1… (bech32m only)"), A);
    await user.click(screen.getByRole("button", { name: "Save contact" }));

    expect(
      await screen.findByText("This address is already in your contacts."),
    ).toBeInTheDocument();
  });
});

describe("inline edit", () => {
  it("saves a rename and a note edit", async () => {
    await addressbookAdd({ name: "Alice", address: A });
    const { user } = renderWithProviders(<Contacts />);
    await screen.findByTitle(A);

    await user.click(screen.getByRole("button", { name: "Edit" }));
    const nameInput = screen.getByDisplayValue("Alice");
    await user.clear(nameInput);
    await user.type(nameInput, "Alicia");
    // Two "Note (optional)" fields exist (this row's editor and the add form);
    // the row's comes first in DOM order.
    await user.type(screen.getAllByLabelText(/Note \(optional\)/i)[0]!, "desk");
    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(await screen.findByText("Alicia")).toBeInTheDocument();
    expect(screen.getByText("desk")).toBeInTheDocument();
  });

  it("Cancel discards the draft", async () => {
    await addressbookAdd({ name: "Alice", address: A });
    const { user } = renderWithProviders(<Contacts />);
    await screen.findByTitle(A);

    await user.click(screen.getByRole("button", { name: "Edit" }));
    const nameInput = screen.getByDisplayValue("Alice");
    await user.clear(nameInput);
    await user.type(nameInput, "Wrong");
    await user.click(screen.getByRole("button", { name: "Cancel" }));

    expect(screen.getByText("Alice")).toBeInTheDocument();
    expect(screen.queryByText("Wrong")).toBeNull();
  });

  it("shows the store's validation message inline", async () => {
    await addressbookAdd({ name: "Alice", address: A });
    const { user } = renderWithProviders(<Contacts />);
    await screen.findByTitle(A);

    await user.click(screen.getByRole("button", { name: "Edit" }));
    await user.clear(screen.getByDisplayValue("Alice"));
    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(await screen.findByText("Name is required.")).toBeInTheDocument();
  });

  it("the address is NOT editable from the row", async () => {
    await addressbookAdd({ name: "Alice", address: A });
    const { user } = renderWithProviders(<Contacts />);
    await screen.findByTitle(A);
    await user.click(screen.getByRole("button", { name: "Edit" }));

    // The address shows, but as text — a different address is a different
    // contact, not a rename.
    expect(screen.queryByDisplayValue(A)).toBeNull();
  });
});

describe("remove requires two clicks", () => {
  it("never fires on the first click", async () => {
    await addressbookAdd({ name: "Alice", address: A });
    const { user } = renderWithProviders(<Contacts />);
    await screen.findByTitle(A);

    await user.click(screen.getByRole("button", { name: "Remove" }));
    expect(screen.getByText("Alice")).toBeInTheDocument(); // still there
    expect(screen.getByRole("button", { name: "Confirm remove" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Confirm remove" }));
    expect(
      await screen.findByText("No saved recipients yet. Add your first contact below."),
    ).toBeInTheDocument();
  });

  it("Cancel backs out", async () => {
    await addressbookAdd({ name: "Alice", address: A });
    const { user } = renderWithProviders(<Contacts />);
    await screen.findByTitle(A);

    await user.click(screen.getByRole("button", { name: "Remove" }));
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.getByText("Alice")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Remove" })).toBeInTheDocument();
  });
});

describe("ordering", () => {
  it("renders in store order (MRU) without re-sorting", async () => {
    await addressbookAdd({ name: "Alice", address: A });
    await new Promise((r) => setTimeout(r, 2));
    await addressbookAdd({ name: "Bob", address: B });

    const { container } = renderWithProviders(<Contacts />);
    await screen.findByTitle(A);

    const text = container.textContent ?? "";
    // Bob was added later, so it must come first — an alphabetical re-sort
    // would put Alice first.
    expect(text.indexOf("Bob")).toBeLessThan(text.indexOf("Alice"));
  });
});
