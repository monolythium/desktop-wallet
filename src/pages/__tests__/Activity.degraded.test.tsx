// What the feed shows when the wallet cannot reach or cannot trust the chain.
//
// PROVENANCE, established before choosing this treatment: every live read the
// feed makes goes through the gated `getProvider()` — page one and pagination
// (`loadLiveActivityPage`), the coverage probe (`loadAddressActivityKind`) and
// the tx-feed fallback (`loadTxFeedFallback`). That gate throws while the active
// operator is untrusted, so a degraded chain produces a FAILED read, not rows
// from an unverifiable operator. And the confirmed cache is written only inside
// the success branch, so everything it holds was verified when it was fetched.
//
// So the rows on screen in a degraded state are the user's own previously
// verified history. Blanking them would be an over-correction — a wallet that
// erases your past because it cannot see the present is less useful and no more
// honest. What was missing was not the hiding; it was the LABEL. These
// assertions are about what the surface renders, not about which function ran.

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
  cached: [] as unknown[],
  cacheWrites: [] as unknown[][],
}));

vi.mock("../../sdk/live", async (orig) => ({
  ...(await orig<typeof import("../../sdk/live")>()),
  loadLiveActivityPage: vi.fn(async () => rig.page1),
  loadOlderActivityPage: vi.fn(async () => ({ ok: true, value: { rows: [], nextCursor: null } })),
  loadAddressActivityKind: vi.fn(async () => ({ kind: "not_found", earliestRetained: null })),
}));

vi.mock("../../sdk/tx-feed", async (orig) => ({
  ...(await orig<typeof import("../../sdk/tx-feed")>()),
  loadTxFeedFallback: vi.fn(async () => ({ ok: true, value: [] })),
}));

vi.mock("../../sdk/activity-cache-store", async (orig) => ({
  ...(await orig<typeof import("../../sdk/activity-cache-store")>()),
  readConfirmedCache: vi.fn(async () => ({ rows: rig.cached, lastFetchedAtMs: 1, nextCursor: null })),
  writeConfirmedCache: vi.fn(async (_k: string, rows: unknown[]) => {
    rig.cacheWrites.push(rows);
  }),
}));

vi.mock("../../sdk/incoming-detect", () => ({ detectAndNotifyIncoming: vi.fn(async () => 0) }));
vi.mock("../../sdk/notifications-store", async (orig) => ({
  ...(await orig<typeof import("../../sdk/notifications-store")>()),
  listForScope: vi.fn(async () => []),
}));
vi.mock("../../sdk/token-metadata", () => ({ loadTokenMetaMap: vi.fn(async () => new Map()) }));
vi.mock("../../sdk/use-pending-tx", () => ({ usePendingTxs: () => [] }));
vi.mock("../../sdk/addressbook", async (orig) => ({
  ...(await orig<typeof import("../../sdk/addressbook")>()),
  addressbookLookup: vi.fn(async () => []),
}));

import { Activity } from "../Activity";
import { __resetActivityCacheStoreForTests } from "../../sdk/activity-cache-store";

function row(block: number) {
  return {
    blockHeight: BigInt(block),
    txIndex: 0,
    logIndex: 0,
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

const notice = () => screen.queryByTestId("activity-saved-history");

beforeEach(() => {
  backing.clear();
  localStorage.clear();
  __resetActivityCacheStoreForTests();
  rig.page1 = { ok: true, value: { rows: [row(100)], nextCursor: null } };
  rig.cached = [];
  rig.cacheWrites = [];
});

describe("the feed when the live read does not land", () => {
  it("keeps the user's saved history on screen rather than blanking", async () => {
    // The over-correction this guards against: a feed that empties whenever
    // connectivity wobbles trains users to distrust an empty screen.
    rig.cached = [row(100)];
    rig.page1 = { ok: false, error: "refusing to use an untrusted operator (chain regenesis)" };
    renderWithProviders(<Activity />);
    await waitFor(() => expect(notice()).not.toBeNull());
    expect(screen.getByText(/mono1peer/)).toBeInTheDocument();
  });

  it("labels those rows as saved, and says newer ones may be missing", async () => {
    rig.cached = [row(100)];
    rig.page1 = { ok: false, error: "offline" };
    renderWithProviders(<Activity />);
    await waitFor(() => expect(notice()).not.toBeNull());
    const text = notice()!.textContent ?? "";
    expect(text).toMatch(/saved history/i);
    expect(text).toMatch(/couldn't refresh/i);
    // The consequence is the actionable part — without it "saved" is just a
    // label, and the user has no reason to care.
    expect(text).toMatch(/newer transactions may be missing/i);
  });

  it("says nothing about the reason — the degraded banner already owns that", () => {
    // G2: one vocabulary for a condition. The chain-health banner names
    // untrusted / re-genesised / quarantined / offline and what to do about
    // each; the feed states only what its OWN rows are.
    rig.cached = [row(100)];
    rig.page1 = { ok: false, error: "refusing to use an untrusted operator" };
    renderWithProviders(<Activity />);
    return waitFor(() => {
      const text = notice()?.textContent ?? "";
      expect(text).not.toMatch(/genesis|untrusted|quarantin|operator/i);
    });
  });

  it("does not label a healthy feed", async () => {
    rig.cached = [];
    rig.page1 = { ok: true, value: { rows: [row(100)], nextCursor: null } };
    renderWithProviders(<Activity />);
    await screen.findByText(/mono1peer/);
    expect(notice()).toBeNull();
  });

  it("does not label an empty feed — there is no saved history to describe", async () => {
    rig.cached = [];
    rig.page1 = { ok: false, error: "offline" };
    renderWithProviders(<Activity />);
    await waitFor(() => expect(screen.queryByText(/mono1peer/)).toBeNull());
    expect(notice()).toBeNull();
  });
});

describe("the provenance invariant that makes the label true", () => {
  it("never writes the cache from a failed read", async () => {
    // This is WHY saved rows can be trusted as previously verified: nothing
    // sourced from a chain the wallet could not verify ever reaches the cache.
    rig.cached = [row(100)];
    rig.page1 = { ok: false, error: "refusing to use an untrusted operator" };
    renderWithProviders(<Activity />);
    await waitFor(() => expect(notice()).not.toBeNull());
    expect(rig.cacheWrites).toEqual([]);
  });

  it("writes the cache on a successful read", async () => {
    // Non-vacuity: the assertion above must be about the failure, not about the
    // cache never being written at all.
    rig.cached = [];
    rig.page1 = { ok: true, value: { rows: [row(100)], nextCursor: null } };
    renderWithProviders(<Activity />);
    await waitFor(() => expect(rig.cacheWrites.length).toBeGreaterThan(0));
  });
});
