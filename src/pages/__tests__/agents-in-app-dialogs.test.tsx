// Law 5 — the Agents page's flows run on in-app surfaces.
//
// Twenty native dialogs lived here, including a seven-prompt chain. G1's bar
// is that the conversion did not weaken anything: a native `confirm()` is a
// hard stop, while an in-app confirm is only as strong as its enabled
// condition, and a chain of prompts enforced ordering that a form does not.
//
// The pure validators are pinned separately in `sdk/__tests__/agent-forms`.
// This file tests what the PAGE does: that no native dialog is reachable, that
// the checks still fire through the UI, and that cancel performs nothing.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, screen, waitFor } from "@testing-library/react";
import { renderWithProviders } from "../../test/renderWithProviders";

const AGENT = {
  slot: "kc:agent:1",
  label: "buyer-bot",
  addressHex: "0xa9e1f0000000000000000000000000000000a9e1",
  bech32m: "mono148slqqqqqqqqqqqqqqqqqqqqqqqqp20prg6jyj",
};

const loadAgents = vi.hoisted(() => vi.fn(async () => [] as unknown[]));
const removeAgent = vi.hoisted(() => vi.fn(async () => {}));
const fetchSpendingPolicy = vi.hoisted(() => vi.fn(async () => ({ exists: false })));
const loadLiveWalletBalance = vi.hoisted(() =>
  vi.fn(async () => ({ balanceLyth: "100", balanceLythoshi: "100000000000000000000" })),
);
const opsOpen = vi.hoisted(() => vi.fn());

vi.mock("../../sdk/agent-registry", async (orig) => ({
  ...(await orig<typeof import("../../sdk/agent-registry")>()),
  loadAgents,
  removeAgent,
  registerAgent: vi.fn(async () => {}),
}));
vi.mock("../../sdk/spending-policy", async (orig) => ({
  ...(await orig<typeof import("../../sdk/spending-policy")>()),
  fetchSpendingPolicy,
}));
vi.mock("../../sdk/live", async (orig) => ({
  ...(await orig<typeof import("../../sdk/live")>()),
  loadLiveWalletBalance,
}));
vi.mock("../../sdk/vaultCatalog", async (orig) => ({
  ...(await orig<typeof import("../../sdk/vaultCatalog")>()),
  getActiveVault: vi.fn(async () => ({
    addressHex: "0x000000000000000000000000000000000000beef",
  })),
}));
vi.mock("../../operations/context", async (orig) => ({
  ...(await orig<typeof import("../../operations/context")>()),
  useOperations: () => ({ open: opsOpen, close: vi.fn() }),
}));

import { Agents } from "../Agents";
import { clearDerivedAddresses, markAddressDerived } from "../../sdk/address-provenance";

let promptSpy: ReturnType<typeof vi.spyOn>;
let confirmSpy: ReturnType<typeof vi.spyOn>;
let alertSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  vi.clearAllMocks();
  // Funding now requires the agent's address to have been PROVED this session
  // (SA-08-002 — the registry is a plaintext file, so its funding target is a
  // claim). These tests are about amounts, balance reads and the diff, so the
  // proof is granted up front; the gate itself is driven through the UI in
  // `Agents.funding-target.test.tsx`.
  clearDerivedAddresses();
  markAddressDerived(AGENT.addressHex);
  loadAgents.mockResolvedValue([AGENT]);
  fetchSpendingPolicy.mockResolvedValue({ exists: false });
  loadLiveWalletBalance.mockResolvedValue({
    balanceLyth: "100",
    balanceLythoshi: "100000000000000000000",
  });
  // Spies, not stubs: if any flow still reaches for a native dialog, the
  // assertions below name it rather than the test silently passing.
  promptSpy = vi.spyOn(window, "prompt").mockReturnValue(null);
  confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(false);
  alertSpy = vi.spyOn(window, "alert").mockImplementation(() => {});
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function expectNoNativeDialog() {
  expect(promptSpy).not.toHaveBeenCalled();
  expect(confirmSpy).not.toHaveBeenCalled();
  expect(alertSpy).not.toHaveBeenCalled();
}

async function renderAgents() {
  const utils = renderWithProviders(<Agents />);
  await screen.findByText("buyer-bot");
  return utils;
}

describe("the fund flow", () => {
  it("opens an in-app form, not a prompt", async () => {
    const { user } = await renderAgents();
    await user.click(screen.getByRole("button", { name: "Fund" }));

    expect(
      screen.getByRole("textbox", { name: /Amount in LYTH/ }),
    ).toBeInTheDocument();
    expectNoNativeDialog();
  });

  it("pre-fills the amount the prompt proposed", async () => {
    const { user } = await renderAgents();
    await user.click(screen.getByRole("button", { name: "Fund" }));
    expect(screen.getByRole("textbox", { name: /Amount in LYTH/ })).toHaveValue("10");
  });

  it("rejects a malformed amount INLINE and opens no operation", async () => {
    const { user } = await renderAgents();
    await user.click(screen.getByRole("button", { name: "Fund" }));
    const field = screen.getByRole("textbox", { name: /Amount in LYTH/ });
    await user.clear(field);
    await user.type(field, "abc");
    await user.click(screen.getByRole("button", { name: "Review transfer" }));

    expect(await screen.findByText("Enter a valid LYTH amount.")).toBeInTheDocument();
    expect(opsOpen).not.toHaveBeenCalled();
    expectNoNativeDialog();
  });

  it("rejects zero with the POSITIVE wording", async () => {
    const { user } = await renderAgents();
    await user.click(screen.getByRole("button", { name: "Fund" }));
    const field = screen.getByRole("textbox", { name: /Amount in LYTH/ });
    await user.clear(field);
    await user.type(field, "0");
    await user.click(screen.getByRole("button", { name: "Review transfer" }));

    expect(await screen.findByText("Enter a positive LYTH amount.")).toBeInTheDocument();
    expect(opsOpen).not.toHaveBeenCalled();
  });

  it("refuses an amount above the principal's balance, and opens no operation", async () => {
    loadLiveWalletBalance.mockResolvedValue({
      balanceLyth: "3",
      balanceLythoshi: "3000000000000000000",
    });
    const { user } = await renderAgents();
    await user.click(screen.getByRole("button", { name: "Fund" }));
    await user.click(screen.getByRole("button", { name: "Review transfer" }));

    expect(await screen.findByText(/Insufficient balance/)).toBeInTheDocument();
    expect(opsOpen).not.toHaveBeenCalled();
  });

  it("a failed balance read ASKS, and needs a second deliberate click", async () => {
    loadLiveWalletBalance.mockRejectedValue(new Error("connection refused"));
    const { user } = await renderAgents();
    await user.click(screen.getByRole("button", { name: "Fund" }));
    await user.click(screen.getByRole("button", { name: "Review transfer" }));

    // First click surfaces the question and opens NOTHING.
    expect(await screen.findByText(/Could not check the principal's balance/)).toBeInTheDocument();
    expect(opsOpen).not.toHaveBeenCalled();

    // The second click is the explicit continue.
    await user.click(screen.getByRole("button", { name: "Continue anyway" }));
    await waitFor(() => expect(opsOpen).toHaveBeenCalledTimes(1));
  });

  it("a valid amount reaches the drawer with the reviewed figure", async () => {
    const { user } = await renderAgents();
    await user.click(screen.getByRole("button", { name: "Fund" }));
    const field = screen.getByRole("textbox", { name: /Amount in LYTH/ });
    await user.clear(field);
    await user.type(field, "2.5");
    await user.click(screen.getByRole("button", { name: "Review transfer" }));

    await waitFor(() => expect(opsOpen).toHaveBeenCalledTimes(1));
    const d = opsOpen.mock.calls[0]![0] as { diff: { k: string; v: string }[] };
    expect(d.diff.find((l) => l.k === "Amount")?.v).toContain("2.5 LYTH");
  });

  it("cancel performs nothing", async () => {
    const { user } = await renderAgents();
    await user.click(screen.getByRole("button", { name: "Fund" }));
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(opsOpen).not.toHaveBeenCalled();
    expect(screen.queryByRole("textbox", { name: /Amount in LYTH/ })).toBeNull();
  });
});

describe("the policy form", () => {
  it("opens one form, not a chain of prompts", async () => {
    const { user } = await renderAgents();
    await user.click(screen.getByRole("button", { name: "Register policy" }));

    // All six terms visible at once — the point of replacing the chain.
    expect(screen.getByRole("textbox", { name: /Per-transaction cap/ })).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: /Daily cap/ })).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: /Weekly cap/ })).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: /Monthly cap/ })).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: /Time-of-day window/ })).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: /Policy expiry/ })).toBeInTheDocument();
    expectNoNativeDialog();
  });

  it("keeps the defaults the prompts pre-filled", async () => {
    const { user } = await renderAgents();
    await user.click(screen.getByRole("button", { name: "Register policy" }));
    expect(screen.getByRole("textbox", { name: /Per-transaction cap/ })).toHaveValue("1");
    expect(screen.getByRole("textbox", { name: /Daily cap/ })).toHaveValue("10");
  });

  it("a fresh policy REQUIRES the agent password, stating why", async () => {
    const { user } = await renderAgents();
    await user.click(screen.getByRole("button", { name: "Register policy" }));
    await user.click(screen.getByRole("button", { name: "Review policy" }));

    expect(
      await screen.findByText(/The agent vault password is required/),
    ).toBeInTheDocument();
  });

  it("rejects a malformed cap inline", async () => {
    const { user } = await renderAgents();
    await user.click(screen.getByRole("button", { name: "Register policy" }));

    // The password must be supplied first — the ORIGINAL prompt chain collected
    // it (step 7) before parsing the caps (step 8), so the password rejection
    // legitimately outranks the caps one. Preserved rather than reordered.
    await user.type(
      screen.getByLabelText("Agent vault password"),
      "agent-vault-password",
    );
    const perTx = screen.getByRole("textbox", { name: /Per-transaction cap/ });
    await user.clear(perTx);
    await user.type(perTx, "nope");
    await user.click(screen.getByRole("button", { name: "Review policy" }));

    expect(await screen.findByText("Caps must be valid LYTH amounts.")).toBeInTheDocument();
  });

  it("cancel performs nothing", async () => {
    const { user } = await renderAgents();
    await user.click(screen.getByRole("button", { name: "Register policy" }));
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("textbox", { name: /Per-transaction cap/ })).toBeNull();
    expect(opsOpen).not.toHaveBeenCalled();
  });
});

describe("the forget confirm", () => {
  it("is a two-step in-app confirm, not a native one", async () => {
    const { user } = await renderAgents();
    await user.click(screen.getByRole("button", { name: "Forget" }));

    expect(screen.getByRole("button", { name: "Confirm forget" })).toBeInTheDocument();
    expect(removeAgent).not.toHaveBeenCalled();
    expectNoNativeDialog();
  });

  it("keeps the consequence copy visible while pending", async () => {
    // The confirm's entire content was this sentence. A user who forgets
    // without revoking leaves a live on-chain spend allowance behind.
    const { user } = await renderAgents();
    await user.click(screen.getByRole("button", { name: "Forget" }));
    expect(screen.getByText(/The on-chain policy is\s+NOT revoked/)).toBeInTheDocument();
  });

  it("only the confirm step removes", async () => {
    const { user } = await renderAgents();
    await user.click(screen.getByRole("button", { name: "Forget" }));
    await user.click(screen.getByRole("button", { name: "Confirm forget" }));
    await waitFor(() => expect(removeAgent).toHaveBeenCalledWith(AGENT.slot));
  });

  it("cancel performs nothing", async () => {
    const { user } = await renderAgents();
    await user.click(screen.getByRole("button", { name: "Forget" }));
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(removeAgent).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Forget" })).toBeInTheDocument();
  });
});
