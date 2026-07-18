// The feature-discovery hint and its coordinator.
//
// The coordinator's PRECEDENCE is the durable part: recovery-critical beats
// convenience beats discoverability, so a future security hint can never be
// crowded out by feature marketing. The desktop has one member today, and the
// "at most one" rule is what makes adding more safe.

import { beforeEach, describe, expect, it, vi } from "vitest";
import { screen } from "@testing-library/react";
import { renderWithProviders } from "../../test/renderWithProviders";

const flags = vi.hoisted(() => ({ stele: false, experimental: false, developer: false }));
vi.mock("../../sdk/feature-flags", async (orig) => ({
  ...(await orig<typeof import("../../sdk/feature-flags")>()),
  readSteleEnabled: () => flags.stele,
  readExperimentalEnabled: () => flags.experimental,
  readDeveloperMode: () => flags.developer,
}));

import { FeaturesHintBar } from "../FeaturesHintBar";
import {
  FEATURES_HINT_STORAGE_KEY,
  isFeaturesHintDismissed,
  pickHint,
} from "../../sdk/hint-coordinator";

const ADDR = "mono1aaa";

function bar(): HTMLElement | null {
  return screen.queryByTestId("features-hint-bar");
}

beforeEach(() => {
  localStorage.clear();
  flags.stele = false;
  flags.experimental = false;
  flags.developer = false;
});

describe("pickHint — at most one, in class order", () => {
  it("returns the features hint when something is undiscovered", () => {
    expect(pickHint({ anyFlagOff: true, featuresDismissed: false })).toBe("features");
  });

  it("returns nothing when every flag is on", () => {
    expect(pickHint({ anyFlagOff: false, featuresDismissed: false })).toBeNull();
  });

  it("returns nothing once dismissed", () => {
    expect(pickHint({ anyFlagOff: true, featuresDismissed: true })).toBeNull();
  });

  it("never returns more than one hint (the signature enforces it)", () => {
    const result = pickHint({ anyFlagOff: true, featuresDismissed: false });
    expect(Array.isArray(result)).toBe(false);
  });
});

describe("the hint bar", () => {
  it("shows while any flag is off, with copy naming only real surfaces", () => {
    renderWithProviders(<FeaturesHintBar address={ADDR} goto={vi.fn()} />);
    expect(bar()).not.toBeNull();
    expect(screen.getByText("Discover more features")).toBeInTheDocument();
    expect(
      screen.getByText(
        "Stele marketplace, agent wallets, the autovote planner, Mono Studio — opt in to the surfaces you want in Settings.",
      ),
    ).toBeInTheDocument();
  });

  it("is HIDDEN when all three flags are on — nothing left to discover", () => {
    flags.stele = true;
    flags.experimental = true;
    flags.developer = true;
    renderWithProviders(<FeaturesHintBar address={ADDR} goto={vi.fn()} />);
    expect(bar()).toBeNull();
  });

  it("promises nothing unbuilt", () => {
    renderWithProviders(<FeaturesHintBar address={ADDR} goto={vi.fn()} />);
    expect(bar()!.textContent).not.toMatch(/coming soon/i);
    expect(bar()!.textContent).not.toMatch(/\bphase\s*\d/i);
  });

  it("Open routes to Settings", async () => {
    const goto = vi.fn();
    const { user } = renderWithProviders(<FeaturesHintBar address={ADDR} goto={goto} />);
    await user.click(screen.getByRole("button", { name: "Open" }));
    expect(goto).toHaveBeenCalledWith("settings");
  });
});

describe("dismissal is per-wallet", () => {
  it("Dismiss hides it and records THIS wallet only", async () => {
    const { user } = renderWithProviders(<FeaturesHintBar address={ADDR} goto={vi.fn()} />);
    await user.click(screen.getByRole("button", { name: "Dismiss" }));

    expect(bar()).toBeNull();
    expect(isFeaturesHintDismissed(ADDR)).toBe(true);
    expect(isFeaturesHintDismissed("mono1bbb")).toBe(false);
  });

  it("stays hidden on remount", async () => {
    const { user, unmount } = renderWithProviders(
      <FeaturesHintBar address={ADDR} goto={vi.fn()} />,
    );
    await user.click(screen.getByRole("button", { name: "Dismiss" }));
    unmount();

    renderWithProviders(<FeaturesHintBar address={ADDR} goto={vi.fn()} />);
    expect(bar()).toBeNull();
  });

  it("another wallet still sees it", async () => {
    const { user, unmount } = renderWithProviders(
      <FeaturesHintBar address={ADDR} goto={vi.fn()} />,
    );
    await user.click(screen.getByRole("button", { name: "Dismiss" }));
    unmount();

    renderWithProviders(<FeaturesHintBar address="mono1bbb" goto={vi.fn()} />);
    expect(bar()).not.toBeNull();
  });

  it("hides even when persistence is blocked (optimistic)", async () => {
    const original = Storage.prototype.setItem;
    const { user } = renderWithProviders(<FeaturesHintBar address={ADDR} goto={vi.fn()} />);
    Storage.prototype.setItem = () => {
      throw new Error("blocked");
    };
    try {
      await user.click(screen.getByRole("button", { name: "Dismiss" }));
      expect(bar()).toBeNull();
    } finally {
      Storage.prototype.setItem = original;
    }
  });
});

describe("storage tolerance", () => {
  it("corrupt JSON defaults to NOT dismissed", () => {
    localStorage.setItem(FEATURES_HINT_STORAGE_KEY, "{not json");
    expect(isFeaturesHintDismissed(ADDR)).toBe(false);
  });

  it("a non-object payload defaults to NOT dismissed", () => {
    localStorage.setItem(FEATURES_HINT_STORAGE_KEY, JSON.stringify(["x"]));
    expect(isFeaturesHintDismissed(ADDR)).toBe(false);
  });

  it("a non-true entry is ignored", () => {
    localStorage.setItem(FEATURES_HINT_STORAGE_KEY, JSON.stringify({ [ADDR]: "yes" }));
    expect(isFeaturesHintDismissed(ADDR)).toBe(false);
  });
});
