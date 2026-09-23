// Activity pagination.
//
// The load-bearing distinction: a transient page error is NOT "no more pages".
// Hiding the footer on a failure would look identical to reaching the end of
// history, and the user would never learn rows were missing.

import { beforeEach, describe, expect, it, vi } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import { renderWithProviders } from "../../test/renderWithProviders";

const backing = vi.hoisted(() => new Map<string, unknown>());
vi.mock("../../sdk/wallet-store", () => ({
  WalletStore: {
    load: vi.fn(async () => ({
      get: vi.fn(async (k: string) => backing.get(k)),
      set: vi.fn(async (k: string, v: unknown) => backing.set(k, JSON.parse(JSON.stringify(v)))),
      save: vi.fn(async () => {}),
    })),
  },
}));

vi.mock("../../sdk/active-wallet", () => ({
  useActiveWallet: () => ({ status: "ready", address: "mono1test", name: "W" }),
}));

const rig = vi.hoisted(() => ({
  page1: { ok: true, value: { rows: [] as unknown[], nextCursor: null as string | null } } as {
    ok: boolean;
    value?: { rows: unknown[]; nextCursor: string | null };
    error?: string;
  },
  page1Calls: 0,
  older: [] as { ok: boolean; value?: { rows: unknown[]; nextCursor: string | null }; error?: string }[],
  olderCalls: [] as string[],
  detect: [] as unknown[][],
  coverage: "not_found" as string,
  fallback: { ok: true, value: [] as unknown[] } as { ok: boolean; value?: unknown[]; error?: string },
  fallbackCalls: 0,
  cacheWrites: [] as unknown[][],
  tracked: [] as unknown[],
  removed: [] as string[][],
}));

vi.mock("../../sdk/live", async (orig) => ({
  ...(await orig<typeof import("../../sdk/live")>()),
  loadLiveActivityPage: vi.fn(async () => {
    rig.page1Calls += 1;
    return rig.page1;
  }),
  loadOlderActivityPage: vi.fn(async (_w: string, cursor: string) => {
    rig.olderCalls.push(cursor);
    return rig.older.shift() ?? { ok: true, value: { rows: [], nextCursor: null } };
  }),
  loadAddressActivityKind: vi.fn(async () => ({
    kind: rig.coverage,
    earliestRetained: null,
  })),
}));

vi.mock("../../sdk/tx-feed", async (orig) => ({
  ...(await orig<typeof import("../../sdk/tx-feed")>()),
  loadTxFeedFallback: vi.fn(async () => {
    rig.fallbackCalls += 1;
    return rig.fallback;
  }),
}));

vi.mock("../../sdk/activity-cache-store", async (orig) => ({
  ...(await orig<typeof import("../../sdk/activity-cache-store")>()),
  writeConfirmedCache: vi.fn(async (_k: string, rows: unknown[]) => {
    rig.cacheWrites.push(rows);
  }),
}));

vi.mock("../../sdk/incoming-detect", () => ({
  detectAndNotifyIncoming: vi.fn(async (_a: string, _c: string, rows: unknown[]) => {
    rig.detect.push(rows);
  }),
}));

vi.mock("../../sdk/notifications-store", async (orig) => ({
  ...(await orig<typeof import("../../sdk/notifications-store")>()),
  listForScope: vi.fn(async () => []),
}));
vi.mock("../../sdk/token-metadata", () => ({ loadTokenMetaMap: vi.fn(async () => new Map()) }));
vi.mock("../../sdk/use-pending-tx", () => ({ usePendingTxs: () => rig.tracked }));
vi.mock("../../sdk/pending-tx-store", async (orig) => ({
  ...(await orig<typeof import("../../sdk/pending-tx-store")>()),
  removePendingTx: vi.fn(async (chain: string, hash: string) => {
    rig.removed.push([chain, hash]);
  }),
}));
vi.mock("../../sdk/addressbook", async (orig) => ({
  ...(await orig<typeof import("../../sdk/addressbook")>()),
  addressbookLookup: vi.fn(async () => []),
}));

import { Activity } from "../Activity";
import { __resetActivityCacheStoreForTests } from "../../sdk/activity-cache-store";

/** A minimal indexed row at a distinct anchor. */
function row(block: number, txIndex = 0, logIndex = 0) {
  return {
    blockHeight: BigInt(block),
    txIndex,
    logIndex,
    kind: "transfer",
    subKind: null,
    direction: "out",
    counterparty: "mono1peer",
    tokenId: null,
    amount: "1000000000000000000",
    cluster: null,
    weightBps: null,
    blockTimestampSeconds: null,
    txHash: null,
    clusterName: null,
  };
}

const footer = () => screen.queryByTestId("load-more");

beforeEach(() => {
  backing.clear();
  localStorage.clear();
  __resetActivityCacheStoreForTests();
  rig.page1 = { ok: true, value: { rows: [row(100)], nextCursor: "0xcursor1" } };
  rig.page1Calls = 0;
  rig.older = [];
  rig.olderCalls = [];
  rig.detect = [];
  rig.coverage = "not_found";
  rig.fallback = { ok: true, value: [] };
  rig.fallbackCalls = 0;
  rig.cacheWrites = [];
  rig.tracked = [];
  rig.removed = [];
});

describe("the Load more footer", () => {
  it("appears when a cursor exists and rows rendered", async () => {
    renderWithProviders(<Activity />);
    await waitFor(() => expect(footer()).not.toBeNull());
    expect(footer()!.textContent).toBe("Load more");
  });

  it("is HIDDEN when the first page reports no more pages", async () => {
    rig.page1 = { ok: true, value: { rows: [row(100)], nextCursor: null } };
    renderWithProviders(<Activity />);
    await screen.findByText(/mono1peer|To mono1peer/);
    expect(footer()).toBeNull();
  });

  it("is HIDDEN on an empty feed (the empty state owns that)", async () => {
    rig.page1 = { ok: true, value: { rows: [], nextCursor: "0xcursor1" } };
    renderWithProviders(<Activity />);
    await screen.findByText("No activity yet");
    expect(footer()).toBeNull();
  });

  it("appends older rows and advances the cursor", async () => {
    rig.older = [{ ok: true, value: { rows: [row(90), row(89)], nextCursor: "0xcursor2" } }];
    const { user } = renderWithProviders(<Activity />);
    await waitFor(() => expect(footer()).not.toBeNull());

    await user.click(footer()!);
    await waitFor(() => expect(rig.olderCalls).toEqual(["0xcursor1"]));

    // A second page uses the ADVANCED cursor.
    rig.older = [{ ok: true, value: { rows: [row(80)], nextCursor: null } }];
    await user.click(footer()!);
    await waitFor(() => expect(rig.olderCalls).toEqual(["0xcursor1", "0xcursor2"]));

    // Null cursor → the footer hides.
    await waitFor(() => expect(footer()).toBeNull());
  });

  it("drops cursor-overlap duplicates rather than double-rendering", async () => {
    // The older page repeats page 1's row.
    rig.older = [{ ok: true, value: { rows: [row(100), row(90)], nextCursor: null } }];
    const { user, container } = renderWithProviders(<Activity />);
    await waitFor(() => expect(footer()).not.toBeNull());

    await user.click(footer()!);
    await waitFor(() => expect(rig.olderCalls).toHaveLength(1));

    // Block 100 appears once, not twice.
    const rows = container.querySelectorAll(".w-tx");
    expect(rows.length).toBe(2);
  });
});

describe("a page error is not 'no more pages'", () => {
  it("shows the retry copy and KEEPS the cursor", async () => {
    rig.older = [{ ok: false, error: "operator down" }];
    const { user } = renderWithProviders(<Activity />);
    await waitFor(() => expect(footer()).not.toBeNull());

    await user.click(footer()!);
    await waitFor(() =>
      expect(footer()!.textContent).toBe("Couldn't load more. Tap to retry."),
    );

    // Retry re-uses the SAME cursor — the failure did not advance it.
    rig.older = [{ ok: true, value: { rows: [row(90)], nextCursor: null } }];
    await user.click(footer()!);
    await waitFor(() => expect(rig.olderCalls).toEqual(["0xcursor1", "0xcursor1"]));
  });

  it("stays visible after an error even though no cursor advanced", async () => {
    rig.older = [{ ok: false, error: "boom" }];
    const { user } = renderWithProviders(<Activity />);
    await waitFor(() => expect(footer()).not.toBeNull());
    await user.click(footer()!);
    await waitFor(() => expect(footer()).not.toBeNull());
  });
});

describe("older pages never contaminate the newest-window state", () => {
  it("older rows are NEVER passed to incoming detection", async () => {
    rig.older = [{ ok: true, value: { rows: [row(90)], nextCursor: null } }];
    const { user } = renderWithProviders(<Activity />);
    await waitFor(() => expect(footer()).not.toBeNull());
    const detectionsBefore = rig.detect.length;

    await user.click(footer()!);
    await waitFor(() => expect(rig.olderCalls).toHaveLength(1));

    // No new detection call fired for the older page.
    expect(rig.detect).toHaveLength(detectionsBefore);
    // And every prior call only ever saw page-1 rows.
    for (const rows of rig.detect) {
      expect(rows).toHaveLength(1);
    }
  });
});

describe("G3 — the indexer-off fallback", () => {
  const disclosure = () => screen.queryByTestId("txfeed-disclosure");

  it("renders fallback rows WITH the disclosure, together", async () => {
    rig.page1 = { ok: true, value: { rows: [], nextCursor: null } };
    rig.coverage = "indexer_disabled";
    rig.fallback = { ok: true, value: [row(90)] };

    const { container } = renderWithProviders(<Activity />);
    await waitFor(() => expect(disclosure()).not.toBeNull());

    expect(disclosure()!.textContent).toBe(
      "Indexer off — showing native LYTH transfers from the public transaction feed. Delegations, claims, and token activity can't be listed here.",
    );
    expect(container.querySelectorAll(".w-tx").length).toBe(1);
  });

  it("the disclosure and the rows DISAPPEAR together when real rows return", async () => {
    rig.page1 = { ok: true, value: { rows: [], nextCursor: null } };
    rig.coverage = "indexer_disabled";
    rig.fallback = { ok: true, value: [row(90)] };

    const { user } = renderWithProviders(<Activity />);
    await waitFor(() => expect(disclosure()).not.toBeNull());

    // A later refresh returns real indexed rows.
    rig.page1 = { ok: true, value: { rows: [row(100)], nextCursor: null } };
    await user.click(screen.getByRole("button", { name: /Refresh/i }));

    await waitFor(() => expect(disclosure()).toBeNull());
    // …and the fallback row is gone with it.
    expect(screen.queryByText(/mono1.*bb/)).toBeNull();
  });

  it("a live-read ERROR wins — no fallback rows, no disclosure", async () => {
    rig.page1 = { ok: false, error: "indexer unreachable" };
    rig.coverage = "indexer_disabled";
    rig.fallback = { ok: true, value: [row(90)] };

    const { container } = renderWithProviders(<Activity />);
    await waitFor(() => expect(rig.fallbackCalls).toBe(0));
    expect(disclosure()).toBeNull();
    expect(container.querySelectorAll(".w-tx").length).toBe(0);
  });

  it("a fallback read failure keeps the honest empty state", async () => {
    rig.page1 = { ok: true, value: { rows: [], nextCursor: null } };
    rig.coverage = "indexer_disabled";
    rig.fallback = { ok: false, error: "not implemented" };

    renderWithProviders(<Activity />);
    await screen.findByText("Activity history is unavailable");
    expect(disclosure()).toBeNull();
  });

  it("does not fire for a pruned feed (that keeps its own empty state)", async () => {
    rig.page1 = { ok: true, value: { rows: [], nextCursor: null } };
    rig.coverage = "pruned";
    rig.fallback = { ok: true, value: [row(90)] };

    renderWithProviders(<Activity />);
    await screen.findByText("Older activity has been pruned");
    expect(rig.fallbackCalls).toBe(0);
    expect(disclosure()).toBeNull();
  });

  it("runs ONCE per scope, not per refresh", async () => {
    rig.page1 = { ok: true, value: { rows: [], nextCursor: null } };
    rig.coverage = "indexer_disabled";
    rig.fallback = { ok: true, value: [row(90)] };

    const { user } = renderWithProviders(<Activity />);
    await waitFor(() => expect(rig.fallbackCalls).toBe(1));

    await user.click(screen.getByRole("button", { name: /Refresh/i }));
    await waitFor(() => expect(rig.page1Calls).toBeGreaterThan(1));
    expect(rig.fallbackCalls).toBe(1);
  });

  it("fallback rows never reach the confirmed cache or incoming detection", async () => {
    rig.page1 = { ok: true, value: { rows: [], nextCursor: null } };
    rig.coverage = "indexer_disabled";
    rig.fallback = { ok: true, value: [row(90)] };

    renderWithProviders(<Activity />);
    await waitFor(() => expect(disclosure()).not.toBeNull());

    // The cache only ever saw the (empty) page-1 rows.
    for (const rows of rig.cacheWrites) expect(rows).toHaveLength(0);
    // Detection likewise.
    for (const rows of rig.detect) expect(rows).toHaveLength(0);
  });
});

describe("G2 — Dismiss in the FEED row", () => {
  const dismiss = () => screen.queryByTestId("dismiss-tracked");
  const trackedTx = (lifecycle: string, over: Record<string, unknown> = {}) => ({
    txHash: "0xabc",
    chainIdHex: "0x10f2c",
    addressLower: "mono1test",
    opKind: "send",
    amountDecimal: "1.5",
    counterparty: "mono1peer",
    submittedAt: Date.now(),
    lifecycle,
    ...over,
  });

  it("appears for each TERMINAL state", async () => {
    for (const lifecycle of ["dropped", "expired"]) {
      rig.tracked = [trackedTx(lifecycle)];
      const { unmount } = renderWithProviders(<Activity />);
      await waitFor(() => expect(dismiss()).not.toBeNull());
      unmount();
    }
  });

  it("is ABSENT for each non-terminal state", async () => {
    for (const lifecycle of ["pending", "awaiting-inclusion", "slow"]) {
      rig.tracked = [trackedTx(lifecycle)];
      const { unmount } = renderWithProviders(<Activity />);
      await screen.findAllByText(/mono1peer|To mono1peer/);
      expect(dismiss()).toBeNull();
      unmount();
    }
  });

  it("is ABSENT for a bridged row (receipt-confirmed, not a failure)", async () => {
    rig.tracked = [trackedTx("dropped", { confirmedBlockHeight: 50, confirmedTxIndex: 0 })];
    renderWithProviders(<Activity />);
    await screen.findAllByText(/mono1peer|To mono1peer/);
    expect(dismiss()).toBeNull();
  });

  it("removes the row through the store, without opening the detail", async () => {
    rig.tracked = [trackedTx("dropped")];
    const { user } = renderWithProviders(<Activity />);
    await waitFor(() => expect(dismiss()).not.toBeNull());

    await user.click(dismiss()!);
    expect(rig.removed).toEqual([["0x10f2c", "0xabc"]]);
    // The row click (open detail) did not fire.
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});
