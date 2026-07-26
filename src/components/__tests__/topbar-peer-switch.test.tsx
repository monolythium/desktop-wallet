// The sync-chip peer popover must not point the read path at an operator it has
// not verified.
//
// The seam already fails closed on a switch (setEndpoint drops the trust
// verdict), so these tests are about HONESTY rather than safety: the user gets
// the verdict before the endpoint moves, instead of a switch that silently
// reverts on the next health tick. Both switch affordances are covered — picking
// a peer by hand, and "switch to fastest", which selects on latency alone.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { OperatorVerdict } from "../../sdk/chain-trust";

const ctl = vi.hoisted(() => ({
  endpoint: "http://a",
  switched: [] as string[],
  probed: [] as string[],
  /** url → whether it proves the pin */
  trusted: {} as Record<string, boolean>,
}));

vi.mock("../../sdk/active-wallet", () => ({
  useActiveWallet: () => ({ status: "ready", address: "lyth1test" }),
}));
vi.mock("../../sdk/ChainHealthProvider", () => ({
  useChainHealthView: () => ({ health: { kind: "live", height: 1 }, chainId: 69420, endpoint: ctl.endpoint }),
}));
vi.mock("../../sdk/notifications-store", () => ({
  getUnread: async () => 0,
  subscribeNotifications: () => () => {},
}));
vi.mock("../../sdk/client", () => ({
  currentEndpoint: () => ctl.endpoint,
  setEndpoint: (url: string) => {
    ctl.switched.push(url);
    ctl.endpoint = url;
  },
  subscribeEndpoint: () => () => {},
}));
vi.mock("../../sdk/fleet", () => ({
  activeFleet: () => [
    { url: "http://a", label: "Alpha", region: "eu", tier: "official" },
    { url: "http://b", label: "Bravo", region: "eu", tier: "official" },
  ],
}));
vi.mock("../../sdk/peers", () => ({
  probePeer: async (url: string) => ({ url, reachable: true, chainIdOk: true, latencyMs: url === "http://b" ? 10 : 90, blockHeight: 5 }),
  pickFastest: (rs: Array<{ url: string; latencyMs: number }>) => rs.reduce((m, r) => (r.latencyMs < m.latencyMs ? r : m)),
  latencyBucket: () => "ok",
}));
vi.mock("../../sdk/chain-trust", () => ({
  probeActiveChainOperator: async (url: string): Promise<OperatorVerdict> => {
    ctl.probed.push(url);
    const ok = ctl.trusted[url] === true;
    return {
      url,
      wrongChainId: false,
      genesisMismatch: !ok,
      quarantined: false,
      trusted: ok,
      height: ok ? 5 : null,
      headId: ok ? "0xh" : null,
      observedGenesis: ok ? "0xpin" : "0xfork",
      observedChainId: 69420,
    };
  },
}));

import { Topbar } from "../Topbar";

function openPopover() {
  render(<Topbar route="home" setRoute={() => {}} />);
  fireEvent.click(screen.getByRole("button", { expanded: false }));
}

/** The peer row is itself the switch affordance (role="button" on the row), so
 *  it is addressed by the peer's label rather than by a control name. */
async function clickPeerRow(label: string) {
  const row = await screen.findByRole("button", { name: new RegExp(label, "i") });
  fireEvent.click(row);
}

beforeEach(() => {
  ctl.endpoint = "http://a";
  ctl.switched = [];
  ctl.probed = [];
  ctl.trusted = {};
});
afterEach(() => cleanup());

describe("the peer popover verifies an operator before pointing the read path at it", () => {
  it("refuses a peer that fails the pin, and leaves the endpoint unchanged", async () => {
    ctl.trusted["http://b"] = false; // Bravo is on a fork
    openPopover();

    await clickPeerRow("Bravo");

    await waitFor(() => expect(ctl.probed).toContain("http://b"));
    expect(ctl.switched).toEqual([]); // never pointed at the fork
    expect(await screen.findByText(/couldn't switch/i)).toBeInTheDocument();
  });

  it("switches once the peer proves the pin", async () => {
    ctl.trusted["http://b"] = true;
    openPopover();

    await clickPeerRow("Bravo");

    await waitFor(() => expect(ctl.switched).toEqual(["http://b"]));
    expect(ctl.probed).toEqual(["http://b"]);
  });

  it("'switch to fastest' verifies its winner too — latency alone never selects an operator", async () => {
    ctl.trusted["http://b"] = false; // fastest by latency, but on a fork
    openPopover();

    fireEvent.click(screen.getByRole("button", { name: /switch to fastest/i }));

    await waitFor(() => expect(ctl.probed).toContain("http://b"));
    expect(ctl.switched).toEqual([]);
    expect(await screen.findByText(/couldn't switch/i)).toBeInTheDocument();
  });
});
