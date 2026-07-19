// Law 5 — the agent-wallet delete confirm is an IN-APP surface.
//
// A native `window.prompt` carries no wallet chrome and no theming, which makes
// it the one dialog a look-alike can imitate convincingly — at the exact moment
// the user is authorising destruction. That is why the law bans it.
//
// G1's requirement is that replacing it does not weaken it. A native prompt is
// a hard stop; an in-app confirm is only as strong as its enabled-condition, so
// that condition is what these tests interrogate.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, screen, waitFor } from "@testing-library/react";
import { renderWithProviders } from "../../test/renderWithProviders";

const agentWalletDelete = vi.hoisted(() => vi.fn(async (_n: string, _c: string) => {}));
const agentWalletList = vi.hoisted(() =>
  vi.fn(async () => ({ wallets: [{ name: "bot-one", agent: { purpose: "testing" } }] })),
);

vi.mock("../../sdk/agent-wallet", async (orig) => ({
  ...(await orig<typeof import("../../sdk/agent-wallet")>()),
  agentWalletDelete,
  agentWalletList,
  agentWalletPause: vi.fn(async () => {}),
  agentWalletCreate: vi.fn(async () => {}),
}));

import { Provider } from "../Provider";

beforeEach(() => {
  vi.clearAllMocks();
  agentWalletList.mockResolvedValue({
    wallets: [{ name: "bot-one", agent: { purpose: "testing" } }],
  });
});

afterEach(cleanup);

async function openDeleteFor(name: string) {
  const utils = renderWithProviders(<Provider />);
  await screen.findByText(name);
  await utils.user.click(screen.getByRole("button", { name: "Delete" }));
  return utils;
}

describe("no native dialog is involved", () => {
  it("clicking Delete opens an in-app field, not a prompt", async () => {
    const promptSpy = vi.spyOn(window, "prompt");
    await openDeleteFor("bot-one");

    expect(promptSpy).not.toHaveBeenCalled();
    expect(
      screen.getByRole("textbox", { name: /Type bot-one to confirm delete/ }),
    ).toBeInTheDocument();
    promptSpy.mockRestore();
  });
});

describe("the exact-match gate", () => {
  it("Confirm delete is DISABLED before anything is typed", async () => {
    await openDeleteFor("bot-one");
    expect(screen.getByRole("button", { name: "Confirm delete" })).toBeDisabled();
  });

  it("stays disabled for a near-miss", async () => {
    // Case, whitespace and prefixes must all fail. Trimming would be a quiet
    // loosening of a destructive gate.
    const { user } = await openDeleteFor("bot-one");
    const field = screen.getByRole("textbox", { name: /confirm delete/i });
    for (const typed of ["bot", "Bot-one", "bot-one "]) {
      await user.clear(field);
      await user.type(field, typed);
      expect(
        screen.getByRole("button", { name: "Confirm delete" }),
        typed,
      ).toBeDisabled();
    }
  });

  it("enables ONLY on the exact name", async () => {
    const { user } = await openDeleteFor("bot-one");
    await user.type(screen.getByRole("textbox", { name: /confirm delete/i }), "bot-one");
    expect(screen.getByRole("button", { name: "Confirm delete" })).toBeEnabled();
  });

  it("deletes with the typed value, as the API expects", async () => {
    const { user } = await openDeleteFor("bot-one");
    await user.type(screen.getByRole("textbox", { name: /confirm delete/i }), "bot-one");
    await user.click(screen.getByRole("button", { name: "Confirm delete" }));

    await waitFor(() => expect(agentWalletDelete).toHaveBeenCalledTimes(1));
    // The API takes the confirmation string as its second argument — the native
    // path passed the prompt's return value, and so does this.
    expect(agentWalletDelete).toHaveBeenCalledWith("bot-one", "bot-one");
  });
});

describe("cancel performs nothing", () => {
  it("no delete is issued and no partial state survives", async () => {
    const { user } = await openDeleteFor("bot-one");
    await user.type(screen.getByRole("textbox", { name: /confirm delete/i }), "bot-one");
    await user.click(screen.getByRole("button", { name: "Cancel" }));

    expect(agentWalletDelete).not.toHaveBeenCalled();
    // The row returns to its normal actions…
    expect(screen.getByRole("button", { name: "Delete" })).toBeInTheDocument();

    // …and re-opening starts EMPTY, so a previously-typed name cannot authorise
    // a later delete the user did not intend.
    await user.click(screen.getByRole("button", { name: "Delete" }));
    expect(screen.getByRole("textbox", { name: /confirm delete/i })).toHaveValue("");
    expect(screen.getByRole("button", { name: "Confirm delete" })).toBeDisabled();
  });
});
