// The setup-health chip.
//
// It must be invisible unless there is a real, reachable, incomplete step —
// the failure mode to avoid is a permanent chrome banner nagging toward
// something the user cannot do or has already done.

import { beforeEach, describe, expect, it, vi } from "vitest";
import { screen } from "@testing-library/react";
import { renderWithProviders } from "../../test/renderWithProviders";

const flags = vi.hoisted(() => ({ stele: true }));
vi.mock("../../sdk/feature-flags", async (orig) => ({
  ...(await orig<typeof import("../../sdk/feature-flags")>()),
  readSteleEnabled: () => flags.stele,
}));

const names = vi.hoisted(() => ({ local: [] as string[], reverse: null as string | null, fail: false }));
vi.mock("../../sdk/my-names", async (orig) => ({
  ...(await orig<typeof import("../../sdk/my-names")>()),
  readRegisteredNames: () => names.local,
}));
vi.mock("../../sdk/reverse-name", () => ({
  loadReverseName: vi.fn(() =>
    names.fail ? Promise.reject(new Error("down")) : Promise.resolve(names.reverse),
  ),
}));

import { SetupHealthChip } from "../SetupHealthChip";
import { SETUP_NAG_SNOOZE_MS, readSetupNagState } from "../../sdk/setup-health-nag";

const ADDR = "mono1aaa";

function chip(): HTMLElement | null {
  return screen.queryByTestId("setup-health-chip");
}

beforeEach(() => {
  localStorage.clear();
  flags.stele = true;
  names.local = [];
  names.reverse = null;
  names.fail = false;
});

describe("visibility", () => {
  it("shows when an applicable step is incomplete", async () => {
    renderWithProviders(<SetupHealthChip address={ADDR} goto={vi.fn()} />);
    await vi.waitFor(() => expect(chip()).not.toBeNull());
    expect(screen.getByText(/0 of 1 wallet features configured/)).toBeInTheDocument();
  });

  it("is HIDDEN while Stele is off — no applicable step exists", async () => {
    flags.stele = false;
    renderWithProviders(<SetupHealthChip address={ADDR} goto={vi.fn()} />);
    await Promise.resolve();
    expect(chip()).toBeNull();
  });

  it("is HIDDEN when the user already owns a name locally", async () => {
    names.local = ["alice.mono"];
    renderWithProviders(<SetupHealthChip address={ADDR} goto={vi.fn()} />);
    await Promise.resolve();
    expect(chip()).toBeNull();
  });

  it("is HIDDEN when a reverse name resolves", async () => {
    names.reverse = "alice.mono";
    renderWithProviders(<SetupHealthChip address={ADDR} goto={vi.fn()} />);
    await vi.waitFor(() => expect(chip()).toBeNull());
  });

  it("is HIDDEN when the reverse read fails — unknown never nags", async () => {
    names.fail = true;
    renderWithProviders(<SetupHealthChip address={ADDR} goto={vi.fn()} />);
    await vi.waitFor(() => expect(chip()).toBeNull());
  });

  it("does not flash a nag while the reverse read is still in flight", () => {
    // The read starts unresolved, which completes the step.
    renderWithProviders(<SetupHealthChip address={ADDR} goto={vi.fn()} />);
    expect(chip()).toBeNull();
  });
});

describe("copy and affordances", () => {
  it("carries the remaining-steps tooltip and an accessible percentage", async () => {
    renderWithProviders(<SetupHealthChip address={ADDR} goto={vi.fn()} />);
    await vi.waitFor(() => expect(chip()).not.toBeNull());
    const link = screen.getByRole("button", { name: /Wallet setup 0% complete/ });
    expect(link.getAttribute("title")).toBe("Remaining: .mono name");
  });

  it("routes to Settings", async () => {
    const goto = vi.fn();
    const { user } = renderWithProviders(<SetupHealthChip address={ADDR} goto={goto} />);
    await vi.waitFor(() => expect(chip()).not.toBeNull());
    await user.click(screen.getByRole("button", { name: /Wallet setup/ }));
    expect(goto).toHaveBeenCalledWith("settings");
  });

  it("promises nothing unbuilt", async () => {
    renderWithProviders(<SetupHealthChip address={ADDR} goto={vi.fn()} />);
    await vi.waitFor(() => expect(chip()).not.toBeNull());
    expect(chip()!.textContent).not.toMatch(/coming soon/i);
  });
});

describe("dismissal is per-wallet and optimistic", () => {
  it("'Later' hides it and snoozes THIS wallet only", async () => {
    const { user } = renderWithProviders(<SetupHealthChip address={ADDR} goto={vi.fn()} />);
    await vi.waitFor(() => expect(chip()).not.toBeNull());

    await user.click(screen.getByRole("button", { name: "Later" }));
    expect(chip()).toBeNull(); // hidden immediately

    const state = readSetupNagState(ADDR)!;
    expect(state.dismissedForever).toBe(false);
    expect(state.snoozedUntilMs).toBeGreaterThan(Date.now() + SETUP_NAG_SNOOZE_MS - 10_000);
    expect(readSetupNagState("mono1bbb")).toBeNull();
  });

  it("'Don't ask again' hides it permanently for THIS wallet only", async () => {
    const { user } = renderWithProviders(<SetupHealthChip address={ADDR} goto={vi.fn()} />);
    await vi.waitFor(() => expect(chip()).not.toBeNull());

    await user.click(screen.getByRole("button", { name: "Don't ask again" }));
    expect(chip()).toBeNull();
    expect(readSetupNagState(ADDR)?.dismissedForever).toBe(true);
    expect(readSetupNagState("mono1bbb")).toBeNull();
  });

  it("stays hidden on a remount after a permanent dismissal", async () => {
    const { user, unmount } = renderWithProviders(
      <SetupHealthChip address={ADDR} goto={vi.fn()} />,
    );
    await vi.waitFor(() => expect(chip()).not.toBeNull());
    await user.click(screen.getByRole("button", { name: "Don't ask again" }));
    unmount();

    renderWithProviders(<SetupHealthChip address={ADDR} goto={vi.fn()} />);
    await Promise.resolve();
    expect(chip()).toBeNull();
  });

  it("another wallet still sees it after this one dismissed", async () => {
    const { user, unmount } = renderWithProviders(
      <SetupHealthChip address={ADDR} goto={vi.fn()} />,
    );
    await vi.waitFor(() => expect(chip()).not.toBeNull());
    await user.click(screen.getByRole("button", { name: "Don't ask again" }));
    unmount();

    renderWithProviders(<SetupHealthChip address="mono1bbb" goto={vi.fn()} />);
    await vi.waitFor(() => expect(chip()).not.toBeNull());
  });

  it("hides even when persistence is blocked (optimistic)", async () => {
    const original = Storage.prototype.setItem;
    const { user } = renderWithProviders(<SetupHealthChip address={ADDR} goto={vi.fn()} />);
    await vi.waitFor(() => expect(chip()).not.toBeNull());
    Storage.prototype.setItem = () => {
      throw new Error("blocked");
    };
    try {
      await user.click(screen.getByRole("button", { name: "Later" }));
      expect(chip()).toBeNull();
    } finally {
      Storage.prototype.setItem = original;
    }
  });
});
