// Operator management editor render tests (§7 list-editing; the adoption flow is
// covered separately). peers + build-mode + client are mocked so the draft is a
// small deterministic fleet and Save has no real RpcClient side effect.

import { afterEach, describe, expect, it, vi } from "vitest";
import { screen } from "@testing-library/react";
import { renderWithProviders } from "../../test/renderWithProviders";
import { DeveloperModeProvider } from "../../sdk/developer-mode";
import { HARDENED_REJECT_REASON, OPERATOR_OVERRIDE_KEY } from "../../sdk/operator-override";
import { OperatorManagement } from "../OperatorManagement";

const hardenedMock = vi.hoisted(() => ({ value: false }));
vi.mock("../../sdk/build-mode", () => ({ isHardenedBuild: () => hardenedMock.value }));

const setEndpointSpy = vi.hoisted(() => vi.fn());
vi.mock("../../sdk/client", async (orig) => ({
  ...(await orig<typeof import("../../sdk/client")>()),
  currentEndpoint: () => "https://rpc.monolythium.com",
  setEndpoint: (u: string) => setEndpointSpy(u),
}));

const OP_A = "http://5.6.7.8:8545";
vi.mock("../../sdk/peers", async (orig) => ({
  ...(await orig<typeof import("../../sdk/peers")>()),
  listPeers: () => [
    { url: "https://rpc.monolythium.com", label: "Public gateway", region: null, tier: "gateway" },
    { url: OP_A, label: "op-a", region: "fsn1", tier: "official" },
  ],
}));

const probeMock = vi.hoisted(() => ({ trusted: true }));
vi.mock("../../sdk/chain-trust", async (orig) => {
  const real = await orig<typeof import("../../sdk/chain-trust")>();
  return {
    ...real,
    probeOperator: vi.fn(async (url: string) =>
      probeMock.trusted
        ? { ...real.unreachableVerdict(url), trusted: true, height: 1, headId: "0xh" }
        : real.unreachableVerdict(url),
    ),
  };
});
import { probeOperator } from "../../sdk/chain-trust";

function renderMgmt(devMode: boolean, goto: (r: string) => void = () => {}) {
  const control = { enabled: devMode, setEnabled: async () => true };
  return renderWithProviders(
    <DeveloperModeProvider value={control}>
      <OperatorManagement goto={goto as never} />
    </DeveloperModeProvider>,
  );
}

afterEach(() => {
  hardenedMock.value = false;
  probeMock.trusted = true;
  localStorage.clear();
  vi.clearAllMocks();
});

describe("OperatorManagement — developer-mode gate", () => {
  it("renders the stub with the verbatim body and fires zero network when off", () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    renderMgmt(false);
    expect(
      screen.getByText(
        "Operator management (custom RPC endpoints and consensus-authority details) is a developer tool. Turn on developer mode to use it.",
      ),
    ).toBeInTheDocument();
    expect(screen.queryByText("Monolythium Testnet operators")).not.toBeInTheDocument();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("renders the editor when developer mode is on", () => {
    renderMgmt(true);
    expect(screen.getByText("Monolythium Testnet operators")).toBeInTheDocument();
  });
});

describe("OperatorManagement — status card + Save/Reset gating", () => {
  it("shows 'Using default operators' with no override; Reset + Save disabled clean", () => {
    renderMgmt(true);
    expect(screen.getByText("Using default operators")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Reset to defaults" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
  });

  it("shows 'Custom operator list active' + Reset enabled when an override is persisted", () => {
    localStorage.setItem(OPERATOR_OVERRIDE_KEY, JSON.stringify([{ name: "mine", region: "", rpc: OP_A }]));
    renderMgmt(true);
    expect(screen.getByText("Custom operator list active")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Reset to defaults" })).toBeEnabled();
  });

  it("enables Save once the draft is dirty AND valid", async () => {
    const { user } = renderMgmt(true);
    const name = screen.getAllByPlaceholderText("operator-1")[0]!;
    await user.type(name, "-edited");
    expect(screen.getByRole("button", { name: "Save" })).toBeEnabled();
  });
});

describe("OperatorManagement — row editing", () => {
  it("shows the verbatim inline errors for a blank name / invalid rpc", async () => {
    const { user } = renderMgmt(true);
    const name = screen.getAllByPlaceholderText("operator-1")[0]!;
    await user.clear(name);
    expect(screen.getByText("Name is required.")).toBeInTheDocument();
    const rpc = screen.getAllByPlaceholderText("http://… or https://…")[0]!;
    await user.clear(rpc);
    expect(screen.getByText("RPC must be a valid URL.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
  });

  it("adds a blank row and deletes down to the empty state", async () => {
    const { user } = renderMgmt(true);
    await user.click(screen.getByRole("button", { name: "+ Add operator" }));
    expect(screen.getAllByPlaceholderText("operator-1")).toHaveLength(3);
    // Delete every row → the empty-state line.
    for (const btn of [...screen.getAllByRole("button", { name: "Delete operator" })]) {
      await user.click(btn);
    }
    expect(screen.getByText("No operators. Add at least one before saving.")).toBeInTheDocument();
  });

  it("moves a row down with the arrow control", async () => {
    const { user } = renderMgmt(true);
    const namesBefore = screen.getAllByPlaceholderText("operator-1").map((i) => (i as HTMLInputElement).value);
    expect(namesBefore).toEqual(["Public gateway", "op-a"]);
    await user.click(screen.getAllByRole("button", { name: "Move down" })[0]!);
    const namesAfter = screen.getAllByPlaceholderText("operator-1").map((i) => (i as HTMLInputElement).value);
    expect(namesAfter).toEqual(["op-a", "Public gateway"]);
  });

  it("reverts an out-of-range position input without moving", async () => {
    const { user } = renderMgmt(true);
    const pos = screen.getAllByLabelText(/Position/)[0]! as HTMLInputElement;
    await user.clear(pos);
    await user.type(pos, "9");
    await user.tab(); // blur → commit
    expect(pos.value).toBe("1"); // reverted
    expect(screen.getAllByPlaceholderText("operator-1").map((i) => (i as HTMLInputElement).value)).toEqual([
      "Public gateway",
      "op-a",
    ]);
  });
});

describe("OperatorManagement — Save side effects", () => {
  it("persists a within-fleet edit and flips the status to active", async () => {
    const { user } = renderMgmt(true);
    const name = screen.getAllByPlaceholderText("operator-1")[1]!;
    await user.type(name, "-renamed");
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(localStorage.getItem(OPERATOR_OVERRIDE_KEY)).not.toBeNull();
    expect(screen.getByText("Custom operator list active")).toBeInTheDocument();
  });

  it("H1: renders + saves a within-fleet reorder in a HARDENED build (not hidden)", async () => {
    hardenedMock.value = true;
    const { user } = renderMgmt(true);
    // The editor renders in a hardened build (developer mode on).
    expect(screen.getByText("Monolythium Testnet operators")).toBeInTheDocument();
    await user.click(screen.getAllByRole("button", { name: "Move down" })[0]!);
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(localStorage.getItem(OPERATOR_OVERRIDE_KEY)).not.toBeNull();
    expect(screen.queryByText(HARDENED_REJECT_REASON)).not.toBeInTheDocument();
  });

  it("H2: a hardened out-of-fleet save is rejected with the verbatim copy, nothing persisted", async () => {
    hardenedMock.value = true;
    const { user } = renderMgmt(true);
    const rpc = screen.getAllByPlaceholderText("http://… or https://…")[1]!;
    await user.clear(rpc);
    await user.type(rpc, "http://9.9.9.9:8545");
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(screen.getByText(HARDENED_REJECT_REASON)).toBeInTheDocument();
    expect(localStorage.getItem(OPERATOR_OVERRIDE_KEY)).toBeNull();
    expect(setEndpointSpy).not.toHaveBeenCalled();
  });
});

describe("OperatorManagement — adoption flow (Use this operator)", () => {
  it("the Connect guard blocks the probe with the client-guard copy when any row is invalid", async () => {
    const { user } = renderMgmt(true);
    // Invalidate row 0 (clear its rpc) so the whole draft is invalid.
    await user.clear(screen.getAllByPlaceholderText("http://… or https://…")[0]!);
    // Row 1 is still usable — open its confirm, then Connect hits the §8 guard.
    await user.click(screen.getAllByRole("button", { name: "Use this operator" })[1]!);
    await user.click(screen.getByRole("button", { name: "Connect" }));
    expect(screen.getByText("Fix the invalid operator rows before using one.")).toBeInTheDocument();
    expect(probeOperator).not.toHaveBeenCalled();
  });

  it("adopts a verified operator: confirm → Connected, front-moved + persisted + switched", async () => {
    probeMock.trusted = true;
    const { user } = renderMgmt(true);
    await user.click(screen.getAllByRole("button", { name: "Use this operator" })[1]!); // op-a
    expect(screen.getByRole("dialog")).toHaveTextContent("Connect to this operator?");
    await user.click(screen.getByRole("button", { name: "Connect" }));
    expect(await screen.findByText("Connected to op-a.")).toBeInTheDocument();
    expect(setEndpointSpy).toHaveBeenCalledWith(OP_A);
    const stored = JSON.parse(localStorage.getItem(OPERATOR_OVERRIDE_KEY)!) as { rpc: string }[];
    expect(stored[0]!.rpc).toBe(OP_A); // moved to the front
  });

  it("a failed probe shows the plural failure copy and changes NOTHING", async () => {
    probeMock.trusted = false;
    const { user } = renderMgmt(true);
    await user.click(screen.getAllByRole("button", { name: "Use this operator" })[1]!);
    await user.click(screen.getByRole("button", { name: "Connect" }));
    const result = await screen.findByText(/Couldn't connect to op-a/);
    expect(result).toHaveTextContent("Your operators were left unchanged.");
    expect(localStorage.getItem(OPERATOR_OVERRIDE_KEY)).toBeNull(); // unchanged
    expect(setEndpointSpy).not.toHaveBeenCalled();
  });

  it("H2: a probe-pass in a HARDENED build still rejects an out-of-fleet host", async () => {
    hardenedMock.value = true;
    probeMock.trusted = true;
    const { user } = renderMgmt(true);
    const rpc = screen.getAllByPlaceholderText("http://… or https://…")[1]!;
    await user.clear(rpc);
    await user.type(rpc, "http://9.9.9.9:8545");
    await user.click(screen.getAllByRole("button", { name: "Use this operator" })[1]!);
    await user.click(screen.getByRole("button", { name: "Connect" }));
    expect(await screen.findByText(HARDENED_REJECT_REASON)).toBeInTheDocument();
    expect(localStorage.getItem(OPERATOR_OVERRIDE_KEY)).toBeNull(); // probe pass does NOT bypass the reject
    expect(setEndpointSpy).not.toHaveBeenCalled();
  });
});
