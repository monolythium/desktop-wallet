// Bridges is gated because the chain reserves the capability and has not
// enabled it — NOT because it was abandoned.
//
// Evidence, read from the deployed chain: the bridge slot reports
// `enabled: false, gateable: true, activationHeight: null`. The chain names
// retirement explicitly elsewhere — two other slots carry "retired-" in their
// capability id and are ungateable — and the bridge slot is in neither state.
// It is reserved.
//
// So the surface stays, gated, with the reversal condition written down. An
// ungated nav entry leading to a permanently empty screen is a promise the
// wallet cannot keep; deleting it would discard work for a slot the chain still
// holds open.

import { beforeEach, describe, expect, it, vi } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import { renderWithProviders } from "../../test/renderWithProviders";
import { DeveloperModeProvider } from "../../sdk/developer-mode";

const rig = vi.hoisted(() => ({ routeCalls: 0, healthCalls: 0, providerCalls: 0 }));

// The two views reach the chain by DIFFERENT paths: the risk view goes through
// the bridge module, the stable view calls the RPC client directly. A guard that
// watched only the module would have declared "no network" while the default
// view fetched happily — the guard's model of a violation being narrower than
// the violations available. Both paths are watched here.
vi.mock("../../sdk/client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../sdk/client")>()),
  getProvider: vi.fn(() => {
    rig.providerCalls += 1;
    return { rpcClient: { call: vi.fn(async () => ({ routes: [] })) }, endpoint: "test" };
  }),
}));

vi.mock("../../sdk/bridge", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../sdk/bridge")>()),
  fetchBridgeRoutes: vi.fn(async () => {
    rig.routeCalls += 1;
    return { response: { routes: [] }, routes: [] };
  }),
  fetchBridgeHealth: vi.fn(async () => {
    rig.healthCalls += 1;
    return { records: [], nextCursor: null };
  }),
  fetchDrainStatus: vi.fn(async () => ({})),
}));

import { Bridges } from "../Bridges";

function render(devMode: boolean) {
  return renderWithProviders(
    <DeveloperModeProvider value={{ enabled: devMode, setEnabled: async () => true }}>
      <Bridges experimentalEnabled={false} goto={() => {}} />
    </DeveloperModeProvider>,
  );
}

beforeEach(() => {
  rig.routeCalls = 0;
  rig.healthCalls = 0;
  vi.clearAllMocks();
});

describe("the Bridges surface", () => {
  it("shows the developer-mode stub instead of its body", async () => {
    render(false);
    await waitFor(() =>
      expect(screen.getByText("Developer mode required")).toBeInTheDocument(),
    );
  });

  it("keeps its own heading, so the user still sees where they are", async () => {
    render(false);
    await waitFor(() => expect(screen.getByRole("heading", { name: "Bridges" })).toBeInTheDocument());
  });

  it("issues NO network while gated, by either path", async () => {
    // The zero-network law for a stubbed page: a gated surface that still
    // fetches is a gate in appearance only.
    render(false);
    await waitFor(() => expect(screen.getByText("Developer mode required")).toBeInTheDocument());
    expect(rig.routeCalls).toBe(0);
    expect(rig.healthCalls).toBe(0);
    expect(rig.providerCalls).toBe(0);
  });

  it("renders its real body in developer mode", async () => {
    render(true);
    await waitFor(() => expect(screen.queryByText("Developer mode required")).toBeNull());
    // And it does reach the chain once ungated — otherwise "no network while
    // gated" would be trivially true because the page never reads at all.
    await waitFor(() => expect(rig.providerCalls).toBeGreaterThan(0));
  });
});
