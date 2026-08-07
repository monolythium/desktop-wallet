// SA-08-002 — the funding target is proved, not read.
//
// `agents.v1.json` is plaintext JSON anything running as this OS user can
// write, and `bech32m` becomes the transaction `to`. The only check on the path
// was `requireTypedUserAddressHex`, which asks whether the string is an address
// — a valid attacker address passes it. The finding's own fix direction is
// explicit that parsing does not close this: "validation rejects corruption, not
// substitution".
//
// So these are driven through the FUND FLOW a user actually walks — render the
// page, click Fund, fill the form, click through — and they assert on what
// reaches `ops.open`, which is the only way to the drawer and therefore to a
// signature. Nothing here calls the validator or the prover directly; a guard
// that does cannot see a caller who forgot to call them.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, screen, waitFor } from "@testing-library/react";
import { renderWithProviders } from "../../test/renderWithProviders";

/** A real pair — the bech32m IS what addressToTypedBech32("user", HEX) returns,
 *  so the fixture cannot assert a correspondence the code does not produce. */
const AGENT_HEX = "0xa9e1f0000000000000000000000000000000a9e1";
const AGENT_BECH32 = "mono148slqqqqqqqqqqqqqqqqqqqqqqqqp20prg6jyj";
/** What an attacker put in the registry instead. Also a perfectly valid address
 *  — that is the whole point of the finding. */
const ATTACKER_HEX = "0xbadbadbadbadbadbadbadbadbadbadbadbadbadb";
const ATTACKER_BECH32 = "mono1htd6mwkm4kadhtd6mwkm4kadhtd6mwkmk95hd4";

const agentRow = (over: Record<string, unknown> = {}) => ({
  slot: "kc:lyth:agent01:v1",
  label: "buyer-bot",
  addressHex: AGENT_HEX,
  bech32m: AGENT_BECH32,
  principalBech32m: "",
  createdAt: 1,
  ...over,
});

const stored = vi.hoisted(() => ({ agents: [] as unknown[] }));
const loadAgents = vi.hoisted(() => vi.fn(async () => stored.agents));
const fetchSpendingPolicy = vi.hoisted(() => vi.fn(async () => ({ exists: false })));
const loadLiveWalletBalance = vi.hoisted(() =>
  vi.fn(async () => ({ balanceLyth: "100", balanceLythoshi: "100000000000000000000" })),
);
const opsOpen = vi.hoisted(() => vi.fn());
/** What the agent vault actually derives — the truth the registry is checked
 *  against. Tests move this to simulate a planted record. */
const vaultDerives = vi.hoisted(() => ({ hex: "0xA9E1F0000000000000000000000000000000A9E1" }));
const fetchAndUnlockVault = vi.hoisted(() => vi.fn(async () => new Uint8Array(32)));

vi.mock("../../sdk/agent-registry", async (orig) => ({
  ...(await orig<typeof import("../../sdk/agent-registry")>()),
  loadAgents,
  removeAgent: vi.fn(async () => {}),
  registerAgent: vi.fn(async () => {}),
}));
vi.mock("../../sdk/keychain", async (orig) => ({
  ...(await orig<typeof import("../../sdk/keychain")>()),
  fetchAndUnlockVault,
  getActiveAccount: () => "kc:lyth:principal:v1",
}));
vi.mock("../../sdk/signing-backend", () => ({
  withSigningBackend: (_seed: Uint8Array, use: (b: unknown) => string) =>
    use({ getAddress: () => vaultDerives.hex }),
}));
vi.mock("../../sdk/spending-policy", async (orig) => ({
  ...(await orig<typeof import("../../sdk/spending-policy")>()),
  fetchSpendingPolicy,
}));
vi.mock("../../sdk/live", async (orig) => ({
  ...(await orig<typeof import("../../sdk/live")>()),
  loadLiveWalletBalance,
}));
vi.mock("../../operations/context", async (orig) => ({
  ...(await orig<typeof import("../../operations/context")>()),
  useOperations: () => ({ open: opsOpen, close: vi.fn() }),
}));

import { Agents } from "../Agents";
import { clearDerivedAddresses } from "../../sdk/address-provenance";

beforeEach(() => {
  vi.clearAllMocks();
  clearDerivedAddresses();
  stored.agents = [agentRow()];
  vaultDerives.hex = "0xA9E1F0000000000000000000000000000000A9E1";
  fetchAndUnlockVault.mockResolvedValue(new Uint8Array(32));
});

afterEach(() => cleanup());

/** Render, wait for the list, and open the fund dialog for the first agent. */
async function openFund() {
  const r = renderWithProviders(<Agents />);
  await screen.findByText("buyer-bot");
  const fundButton = await screen.findByRole("button", { name: "Fund" });
  await r.user.click(fundButton);
  await screen.findByRole("dialog", { name: /Fund buyer-bot/i });
  return r;
}

function agentPasswordBox(): HTMLInputElement {
  return screen.getByLabelText("Agent vault password") as HTMLInputElement;
}

/** Every route to a signature goes through the drawer. */
function fundedTargets(): string[] {
  return opsOpen.mock.calls
    .map(([d]) => (d as { diff?: { k: string; v: string }[] }).diff)
    .flatMap((diff) => diff ?? [])
    .filter((row) => row.k === "To (agent)")
    .map((row) => row.v);
}

describe("a planted funding target never reaches the drawer", () => {
  it("blocks when the slot derives a DIFFERENT address than the record claims", async () => {
    // The attack: the registry says pay the attacker; the agent's own vault says
    // otherwise. Both addresses are well-formed, so parsing cannot tell them
    // apart — only the derivation can.
    stored.agents = [agentRow({ addressHex: ATTACKER_HEX, bech32m: ATTACKER_BECH32 })];
    const r = await openFund();

    await r.user.type(agentPasswordBox(), "correct-agent-password");
    await r.user.click(screen.getByRole("button", { name: "Review transfer" }));

    await screen.findByTestId("fund-tampered");
    expect(opsOpen).not.toHaveBeenCalled();
    expect(fundedTargets()).toEqual([]);
  });

  it("the block is terminal — no continue-anyway", async () => {
    stored.agents = [agentRow({ addressHex: ATTACKER_HEX, bech32m: ATTACKER_BECH32 })];
    const r = await openFund();
    await r.user.type(agentPasswordBox(), "correct-agent-password");
    await r.user.click(screen.getByRole("button", { name: "Review transfer" }));

    await screen.findByTestId("fund-tampered");
    // The balance-read failure earns a second deliberate click because it is an
    // absence of evidence. This is evidence of the wrong kind, so there is no
    // second click to make.
    const blocked = screen.getByRole("button", { name: "Blocked" });
    expect(blocked).toBeDisabled();
    await r.user.click(blocked);
    expect(opsOpen).not.toHaveBeenCalled();
  });

  it("refuses to open the drawer with no proof at all", async () => {
    const r = await openFund();
    // Straight to the button without proving anything.
    await r.user.click(screen.getByRole("button", { name: "Review transfer" }));
    await waitFor(() =>
      expect(screen.getByTestId("fund-error").textContent).toMatch(/agent vault password/i),
    );
    expect(opsOpen).not.toHaveBeenCalled();
  });

  it("a wrong password does not prove ownership", async () => {
    fetchAndUnlockVault.mockRejectedValueOnce(new Error("decrypt failed: bad password"));
    const r = await openFund();
    await r.user.type(agentPasswordBox(), "wrong");
    await r.user.click(screen.getByRole("button", { name: "Review transfer" }));

    await waitFor(() =>
      expect(screen.getByTestId("fund-error").textContent).toMatch(/wrong agent vault password/i),
    );
    expect(opsOpen).not.toHaveBeenCalled();
  });
});

describe("control — a genuine agent funds, and the target is the proved one", () => {
  it("opens the drawer once ownership is proved", async () => {
    const r = await openFund();
    await r.user.type(agentPasswordBox(), "correct-agent-password");
    await r.user.click(screen.getByRole("button", { name: "Review transfer" }));

    // Anti-vacuity: without this every "not.toHaveBeenCalled" above would be
    // satisfied by a page that can never fund anything at all.
    await waitFor(() => expect(opsOpen).toHaveBeenCalledTimes(1));
    expect(fundedTargets()).toEqual([AGENT_BECH32]);
  });

  it("the proof is per-session — a second funding does not re-ask", async () => {
    const r = await openFund();
    await r.user.type(agentPasswordBox(), "correct-agent-password");
    await r.user.click(screen.getByRole("button", { name: "Review transfer" }));
    await waitFor(() => expect(opsOpen).toHaveBeenCalledTimes(1));

    await r.user.click(await screen.findByRole("button", { name: "Fund" }));
    await screen.findByRole("dialog", { name: /Fund buyer-bot/i });
    // The field is gone because the address is already in the provenance set.
    expect(screen.queryByLabelText("Agent vault password")).toBeNull();
    await r.user.click(screen.getByRole("button", { name: "Review transfer" }));
    await waitFor(() => expect(opsOpen).toHaveBeenCalledTimes(2));
  });

  it("the confirm diff still shows the funding target — displayed equals signed", async () => {
    const r = await openFund();
    await r.user.type(agentPasswordBox(), "correct-agent-password");
    await r.user.click(screen.getByRole("button", { name: "Review transfer" }));
    await waitFor(() => expect(opsOpen).toHaveBeenCalledTimes(1));

    // The mitigating fact the finding records. It must survive this change.
    const diff = (opsOpen.mock.calls[0]![0] as { diff: { k: string; v: string }[] }).diff;
    expect(diff.find((row) => row.k === "To (agent)")?.v).toBe(AGENT_BECH32);
  });
});
