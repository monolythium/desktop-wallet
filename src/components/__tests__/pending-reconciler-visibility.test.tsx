// The reconcile poller was the one poller still dispatching while hidden.
//
// It reads through the gated provider, and the trust verdict that gate consults
// is — by design — not being re-proven while the window is hidden. So this was
// the single place where reads continued against a flag that had deliberately
// stopped being refreshed.
//
// The risk in closing it is the opposite of the one it closes: this poller
// exists to NOTICE that a transaction settled. A gate that made it MISS a
// settlement would be worse than the window it shuts. It cannot, because
// reconcilePendingOnce asks the CHAIN what happened rather than watching a
// stream — the answer is the same whenever it is asked — and it probes for a
// terminal verdict BEFORE any retention removal, so even a row that aged out
// while the window was hidden is still recorded on the catch-up tick. These
// tests pin deferral, and pin that the catch-up actually happens.

import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { render, act } from "@testing-library/react";

const reconcilePendingOnce = vi.hoisted(() =>
  vi.fn(async () => ({ remaining: 1, recorded: 0, expired: 0 })),
);
const hasPendingTxs = vi.hoisted(() => vi.fn(async () => true));
const subscribePendingTxs = vi.hoisted(() => vi.fn(() => () => {}));
const subscribeActiveChain = vi.hoisted(() => vi.fn(() => () => {}));
const health = vi.hoisted(() => ({ kind: "live" as "live" | "loading" | "offline" }));

vi.mock("../../sdk/reconcile", () => ({ reconcilePendingOnce }));
vi.mock("../../sdk/pending-tx-store", () => ({ hasPendingTxs, subscribePendingTxs }));
vi.mock("../../sdk/chains", () => ({ subscribeActiveChain }));
vi.mock("../../sdk/ChainHealthProvider", () => ({
  useChainHealthView: () => ({
    health: { kind: health.kind },
    chainId: health.kind === "live" ? 69420 : null,
    endpoint: health.kind === "live" ? "https://rpc.monolythium.com" : null,
  }),
}));

import { PendingTxReconciler, RECONCILE_BASE_MS } from "../PendingTxReconciler";

let visibility: DocumentVisibilityState = "visible";

function setVisibility(next: DocumentVisibilityState) {
  visibility = next;
  document.dispatchEvent(new Event("visibilitychange"));
}

async function advance(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

async function settle() {
  await act(async () => {
    for (let i = 0; i < 8; i++) await Promise.resolve();
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  visibility = "visible";
  health.kind = "live";
  vi.spyOn(document, "visibilityState", "get").mockImplementation(() => visibility);
  reconcilePendingOnce.mockClear();
  hasPendingTxs.mockClear();
  hasPendingTxs.mockResolvedValue(true);
  reconcilePendingOnce.mockResolvedValue({ remaining: 1, recorded: 0, expired: 0 });
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("the reconcile poller does not dispatch while the window is hidden", () => {
  it("stays idle until chain identity is verified, then resumes on the live transition", async () => {
    health.kind = "loading";
    const view = render(<PendingTxReconciler />);
    await settle();
    await advance(RECONCILE_BASE_MS * 2);
    expect(hasPendingTxs).not.toHaveBeenCalled();
    expect(reconcilePendingOnce).not.toHaveBeenCalled();

    health.kind = "live";
    view.rerender(<PendingTxReconciler />);
    await settle();
    await advance(RECONCILE_BASE_MS);

    expect(hasPendingTxs).toHaveBeenCalled();
    expect(reconcilePendingOnce).toHaveBeenCalled();
  });

  it("skips its reads while hidden", async () => {
    render(<PendingTxReconciler />);
    await settle();
    await advance(RECONCILE_BASE_MS);
    const whileVisible = reconcilePendingOnce.mock.calls.length;
    expect(whileVisible).toBeGreaterThan(0); // the loop is genuinely running

    setVisibility("hidden");
    await advance(RECONCILE_BASE_MS * 6);
    expect(reconcilePendingOnce.mock.calls.length).toBe(whileVisible); // nothing dispatched
  });

  it("catches up the moment the window is visible again — deferred, never skipped", async () => {
    render(<PendingTxReconciler />);
    await settle();
    setVisibility("hidden");
    await advance(RECONCILE_BASE_MS * 4);
    const whileHidden = reconcilePendingOnce.mock.calls.length;

    setVisibility("visible");
    await settle();

    // Immediately, not on the next timer: a settlement that landed while away is
    // noticed as soon as the user can see it.
    expect(reconcilePendingOnce.mock.calls.length).toBeGreaterThan(whileHidden);
  });

  it("keeps the loop armed across a hidden stretch, so work outstanding is still followed", async () => {
    render(<PendingTxReconciler />);
    await settle();
    setVisibility("hidden");
    await advance(RECONCILE_BASE_MS * 3);
    setVisibility("visible");
    await settle();
    const afterCatchUp = reconcilePendingOnce.mock.calls.length;

    // The timer survived being hidden: the next tick arrives on cadence rather
    // than the loop having idled itself out while nothing was reconciling.
    await advance(RECONCILE_BASE_MS * 2);
    expect(reconcilePendingOnce.mock.calls.length).toBeGreaterThan(afterCatchUp);
  });

  it("a hidden stretch leaves the back-off ladder where it found it", async () => {
    // The ladder exists to stop hammering a STUCK tx. A skipped tick made no
    // progress because it did no work, so it must not climb the ladder — eight
    // hidden ticks would otherwise carry the cadence to its ceiling and leave a
    // returning user waiting half a minute for the first probe.
    render(<PendingTxReconciler />);
    await settle();
    setVisibility("hidden");
    await advance(RECONCILE_BASE_MS * 8);

    // The catch-up tick makes progress, so the ladder resets to base — isolating
    // "the hidden stretch didn't climb it" from "the ladder works", which is a
    // different property.
    reconcilePendingOnce.mockResolvedValue({ remaining: 1, recorded: 1, expired: 0 });
    setVisibility("visible");
    await settle();
    const afterCatchUp = reconcilePendingOnce.mock.calls.length;

    await advance(RECONCILE_BASE_MS);
    expect(reconcilePendingOnce.mock.calls.length).toBeGreaterThan(afterCatchUp);
  });
});
