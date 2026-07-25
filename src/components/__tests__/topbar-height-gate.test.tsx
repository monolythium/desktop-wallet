// The chain-status chip states the CONNECTION; the head height is a developer
// diagnostic and appears only in developer mode.
//
// A block number tells someone debugging where the chain is and tells everyone
// else nothing they can act on. What a normal user needs from this control —
// whether the wallet is talking to an operator, and whether that is healthy —
// is carried by the dot and the state word. Both are asserted below alongside
// the absent number, so a later change cannot take the whole signal away while
// still passing the "no height" half of the gate.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { DeveloperModeProvider } from "../../sdk/developer-mode";
import type { ChainHealth } from "../../sdk/chain-health";

const ctl = vi.hoisted(() => ({ health: { kind: "live", height: 4321 } as ChainHealth }));

vi.mock("../../sdk/active-wallet", () => ({
  useActiveWallet: () => ({ status: "ready", address: "lyth1test", name: "Wallet slot-1" }),
}));
vi.mock("../../sdk/ChainHealthProvider", () => ({
  useChainHealthView: () => ({ health: ctl.health, chainId: 69420, endpoint: "http://a" }),
}));
vi.mock("../../sdk/notifications-store", () => ({
  getUnread: async () => 0,
  subscribeNotifications: () => () => {},
}));
vi.mock("../../sdk/client", () => ({
  currentEndpoint: () => "http://a",
  setEndpoint: () => {},
  subscribeEndpoint: () => () => {},
}));
vi.mock("../../sdk/fleet", () => ({
  activeFleet: () => [{ url: "http://a", label: "Alpha", region: "eu", tier: "official" }],
}));
vi.mock("../../sdk/peers", () => ({
  probePeer: async (url: string) => ({
    url,
    reachable: true,
    chainIdOk: true,
    latencyMs: 10,
    blockHeight: 4321,
  }),
  pickFastest: (rs: Array<{ url: string }>) => rs[0],
  latencyBucket: () => "ok",
}));
vi.mock("../../sdk/chain-trust", () => ({
  probeActiveChainOperator: async (url: string) => ({ url, trusted: true }),
}));

import { Topbar } from "../Topbar";

function renderTopbar(devMode: boolean) {
  return render(
    <DeveloperModeProvider value={{ enabled: devMode, setEnabled: async () => true }}>
      <Topbar route="home" setRoute={() => {}} />
    </DeveloperModeProvider>,
  );
}

/** The status chip — the only topbar control carrying aria-expanded. */
const chip = () => screen.getByRole("button", { expanded: false });

beforeEach(() => {
  ctl.health = { kind: "live", height: 4321 };
});
afterEach(() => cleanup());

describe("the chain-status chip gates the head height behind developer mode", () => {
  it("hides the block number from a normal user", () => {
    renderTopbar(false);
    expect(chip()).toHaveTextContent("LIVE");
    expect(chip()).not.toHaveTextContent("4321");
    expect(chip()).not.toHaveTextContent("#");
  });

  it("shows it in developer mode", () => {
    renderTopbar(true);
    expect(chip()).toHaveTextContent("LIVE · #4321");
  });

  it("hides it for every state that carries one", () => {
    for (const health of [
      { kind: "live", height: 4321 },
      { kind: "stalled", height: 4321 },
      { kind: "reconnecting", height: 4321 },
    ] as ChainHealth[]) {
      ctl.health = health;
      renderTopbar(false);
      expect(chip(), health.kind).not.toHaveTextContent("4321");
      cleanup();
    }
  });

  it("still names the state, so the gate removes the number and nothing else", () => {
    for (const [health, word] of [
      [{ kind: "live", height: 4321 }, "LIVE"],
      [{ kind: "stalled", height: 4321 }, "STALLED"],
      [{ kind: "reconnecting", height: 4321 }, "RECONNECTING"],
      [{ kind: "offline", reason: "x" }, "OFFLINE"],
    ] as Array<[ChainHealth, string]>) {
      ctl.health = health;
      renderTopbar(false);
      expect(chip(), health.kind).toHaveTextContent(word);
      cleanup();
    }
  });

  it("keeps the severity dot, which is what actually carries health", () => {
    // The height was never the liveness signal — this is. If the dot ever stops
    // reflecting the state, gating the number DID cost a normal user something.
    for (const [health, dot] of [
      [{ kind: "live", height: 1 }, ""],
      [{ kind: "stalled", height: 1 }, "is-stale"],
      [{ kind: "offline", reason: "x" }, "is-down"],
      [{ kind: "loading" }, "is-muted"],
    ] as Array<[ChainHealth, string]>) {
      ctl.health = health;
      renderTopbar(false);
      const el = chip().querySelector(".dot")!;
      expect(el, health.kind).toBeTruthy();
      if (dot) expect(el.className, health.kind).toContain(dot);
      cleanup();
    }
  });

  it("leaves the endpoint tooltip alone — it was never height-derived", () => {
    renderTopbar(false);
    expect(chip()).toHaveAttribute("title", "http://a");
  });
});
