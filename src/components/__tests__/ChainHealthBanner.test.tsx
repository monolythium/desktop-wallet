// Render tests for the degraded chain-health banner: hidden for live/transient
// states, and showing the actionable copy for each red hard-trust state. The
// shared health context is mocked so the banner is driven state-by-state.

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import type { ChainHealthView } from "../../sdk/useChainHealth";
import type { ChainHealth } from "../../sdk/chain-health";

const healthMock = vi.hoisted(() => ({
  value: { health: { kind: "live", height: 1 }, chainId: null, endpoint: null } as ChainHealthView,
}));
vi.mock("../../sdk/ChainHealthProvider", () => ({
  useChainHealthView: () => healthMock.value,
}));

import { ChainHealthBanner } from "../ChainHealthBanner";

function setHealth(health: ChainHealth): void {
  healthMock.value = { health, chainId: null, endpoint: null };
}

afterEach(() => cleanup());

describe("ChainHealthBanner", () => {
  it("is hidden for live / transient / stalled states", () => {
    for (const health of [
      { kind: "live", height: 1 },
      { kind: "loading" },
      { kind: "reconnecting", height: 5 },
      { kind: "stalled", height: 5 },
    ] as ChainHealth[]) {
      setHealth(health);
      const { container } = render(<ChainHealthBanner />);
      expect(container.firstChild).toBeNull();
      cleanup();
    }
  });

  it("renders the actionable ALL-UNTRUSTED explanation on regenesis", () => {
    setHealth({ kind: "regenesis" });
    render(<ChainHealthBanner onReview={() => {}} />);
    expect(screen.getByText("ALL OPERATORS UNTRUSTED")).toBeInTheDocument();
    expect(screen.getByText(/re-genesised/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /review operators/i })).toBeInTheDocument();
  });

  it("renders each red hard-trust state's title", () => {
    for (const [health, title] of [
      [{ kind: "untrusted" }, "UNTRUSTED OPERATOR"],
      [{ kind: "quarantined" }, "OPERATOR QUARANTINED"],
      [{ kind: "offline", reason: "x" }, "OFFLINE"],
    ] as Array<[ChainHealth, string]>) {
      setHealth(health);
      render(<ChainHealthBanner />);
      expect(screen.getByText(title)).toBeInTheDocument();
      cleanup();
    }
  });
});
