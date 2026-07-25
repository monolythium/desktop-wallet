// Bridges is gated because the precompile is RETIRED and the route catalogue
// it publishes is still empty — NOT because the chain is holding the slot open.
//
// An earlier revision of this header argued the opposite from the slot's
// `kind: "gateable"`. That reading is unsound: `kind` is derived and `gateable`
// is tested before `retired-rejecting`, so a gateable slot can never report
// itself retired. The slot's own revert says the bridge was removed and it
// cannot be re-activated, and a node refuses at boot any milestone that would
// activate it — so the old reversal condition (`enabled: true`) can never fire.
//
// What survives is the third-party route disclosure catalogue: the removal kept
// `lyth_bridgeRoutes` deliberately, and that is what this page reads. The
// surface therefore stays, gated, with a reversal condition that CAN fire —
// a non-empty route catalogue. An ungated nav entry leading to an empty screen
// is a promise the wallet cannot keep.

import { beforeEach, describe, expect, it, vi } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import { renderWithProviders } from "../../test/renderWithProviders";
import { DeveloperModeProvider } from "../../sdk/developer-mode";

const rig = vi.hoisted(() => ({
  routeCalls: 0,
  providerCalls: 0,
  // The retired-slot reads. These are watched to assert they are NEVER called,
  // not to assert the gate holds — see the retired-slot test below.
  healthCalls: 0,
  drainCalls: 0,
}));

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
  fetchDrainStatus: vi.fn(async () => {
    rig.drainCalls += 1;
    return {};
  }),
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
  rig.drainCalls = 0;
  rig.providerCalls = 0;
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
    // fetches is a gate in appearance only. Watches the two paths that DO
    // fire once ungated — the module read and the raw client call. The
    // retired-slot reads are deliberately not asserted here: nothing calls
    // them any more, so counting them would pass whether the gate held or not.
    render(false);
    await waitFor(() => expect(screen.getByText("Developer mode required")).toBeInTheDocument());
    expect(rig.routeCalls).toBe(0);
    expect(rig.providerCalls).toBe(0);
  });

  it("never reads the retired bridge slot, even ungated with the risk view up", async () => {
    // Guards the removal, not the gate. Both reads key on a `bridgeId` the
    // disclosure shape does not carry, and both address `0x1008` state that is
    // permanently zero — so re-wiring either one is always a mistake, and this
    // is what catches it. Runs with developer mode ON and the risk view mounted,
    // i.e. the exact configuration that used to issue them.
    renderWithProviders(
      <DeveloperModeProvider value={{ enabled: true, setEnabled: async () => true }}>
        <Bridges experimentalEnabled goto={() => {}} />
      </DeveloperModeProvider>,
    );
    await waitFor(() => expect(rig.routeCalls).toBeGreaterThan(0));
    expect(rig.healthCalls).toBe(0);
    expect(rig.drainCalls).toBe(0);
  });

  it("renders its real body in developer mode", async () => {
    render(true);
    await waitFor(() => expect(screen.queryByText("Developer mode required")).toBeNull());
    // And it does reach the chain once ungated — otherwise "no network while
    // gated" would be trivially true because the page never reads at all.
    await waitFor(() => expect(rig.providerCalls).toBeGreaterThan(0));
  });
});
