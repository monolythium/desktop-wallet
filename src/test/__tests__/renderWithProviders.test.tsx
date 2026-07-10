import { describe, it, expect } from "vitest";
import { screen } from "@testing-library/react";
import {
  err,
  installTauri,
  makeLockedWallet,
  makeReadyWallet,
  ok,
  renderWithProviders,
  resetTauri,
  TEST_WALLET_ADDRESS,
} from "../renderWithProviders";

describe("renderWithProviders harness (self-check)", () => {
  it("renders a component inside the provider tree; jest-dom matchers work", () => {
    renderWithProviders(<div>hello harness</div>);
    expect(screen.getByText("hello harness")).toBeInTheDocument();
  });

  it("wires user-event for real interaction", async () => {
    let clicks = 0;
    const { user } = renderWithProviders(<button onClick={() => (clicks += 1)}>go</button>);
    await user.click(screen.getByRole("button", { name: "go" }));
    expect(clicks).toBe(1);
  });

  it("installs the Tauri-present flag so guarded paths run", () => {
    resetTauri();
    renderWithProviders(<div />);
    expect((window as unknown as Record<string, unknown>).__TAURI_INTERNALS__).toBeDefined();
    installTauri(); // idempotent
  });
});

describe("harness fixtures", () => {
  it("ok/err build the RpcOutcome shapes", () => {
    expect(ok(5)).toEqual({ ok: true, value: 5 });
    expect(err("boom")).toEqual({ ok: false, error: "boom" });
  });

  it("makeReadyWallet is a ready wallet with a real corresponding bech32m/hex", () => {
    const w = makeReadyWallet();
    expect(w.status).toBe("ready");
    expect(w.address).toBe(TEST_WALLET_ADDRESS);
    expect(w.address?.startsWith("mono1")).toBe(true);
    // overrides apply
    expect(makeReadyWallet({ name: "Alice" }).name).toBe("Alice");
  });

  it("makeLockedWallet hides the address", () => {
    const w = makeLockedWallet();
    expect(w.status).toBe("locked");
    expect(w.address).toBeNull();
  });
});
