import { beforeEach, describe, expect, it, vi } from "vitest";
import { screen } from "@testing-library/react";
import { renderWithProviders } from "../../test/renderWithProviders";
import type { PendingTx } from "../../sdk/pending-tx";

// The tracked-pending store is shared across every vault; usePendingTxs returns
// ALL of it, and the page scopes it via scopePendingTxs (KEPT REAL — it's the
// guard under test) to the active wallet.
const pending = vi.hoisted(() => ({ usePendingTxs: vi.fn(() => [] as ReadonlyArray<PendingTx>) }));
vi.mock("../../sdk/use-pending-tx", () => ({ usePendingTxs: pending.usePendingTxs }));

// Active wallet (a hook — must be mocked). Vault B is the active one.
const WALLET_B = "mono1activevaultb";
vi.mock("../../sdk/active-wallet", () => ({
  useActiveWallet: () => ({ status: "ready", slot: "b", name: "B", addressHex: "0x0b", address: WALLET_B }),
}));

// Feed data sources — return empty/failed so the feed is exactly the scoped
// pending rows; keep the pure adapters/scoping real.
const live = vi.hoisted(() => ({ loadLiveAddressActivity: vi.fn(), loadAddressActivityKind: vi.fn() }));
vi.mock("../../sdk/live", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../sdk/live")>()),
  loadLiveAddressActivity: live.loadLiveAddressActivity,
  loadAddressActivityKind: live.loadAddressActivityKind,
}));
vi.mock("../../sdk/activity-cache-store", () => ({
  readConfirmedCache: vi.fn(() => Promise.resolve(null)),
  writeConfirmedCache: vi.fn(() => Promise.resolve()),
}));
vi.mock("../../sdk/notifications-store", () => ({ listForScope: vi.fn(() => Promise.resolve([])) }));
vi.mock("../../sdk/incoming-detect", () => ({ detectAndNotifyIncoming: vi.fn(() => Promise.resolve({ recorded: 0 })) }));
vi.mock("../../sdk/token-metadata", () => ({ loadTokenMetaMap: vi.fn(() => Promise.resolve(new Map())) }));

import { Activity } from "../Activity";

function pendingTx(over: Partial<PendingTx>): PendingTx {
  return {
    txHash: "0xtx",
    chainIdHex: "0x10f2c",
    addressLower: WALLET_B,
    opKind: "send",
    amountDecimal: "0",
    counterparty: "mono1cp",
    submittedAt: 1_700_000_000_000,
    ...over,
  } as PendingTx;
}

beforeEach(() => {
  vi.clearAllMocks();
  pending.usePendingTxs.mockReturnValue([]);
  live.loadLiveAddressActivity.mockResolvedValue({ ok: true, value: [] });
  live.loadAddressActivityKind.mockResolvedValue({ ok: false, error: "n/a" });
});

describe("Activity — vault-scope no-leak (regression guard)", () => {
  it("a foreign vault's pending tx never renders in this wallet's feed", async () => {
    const ownTx = pendingTx({ txHash: "0xown", addressLower: WALLET_B, amountDecimal: "7.77" });
    const foreignTx = pendingTx({ txHash: "0xforeign", addressLower: "mono1foreignvaulta", amountDecimal: "9.99" });
    pending.usePendingTxs.mockReturnValue([foreignTx, ownTx]);

    renderWithProviders(<Activity />);

    // The active vault's own in-flight tx shows…
    expect(await screen.findByText("7.77")).toBeInTheDocument();
    // …and the OTHER vault's is scoped out — never leaks into this feed.
    expect(screen.queryByText("9.99")).not.toBeInTheDocument();
  });
});

describe("Activity — robust feed build (entries.map class)", () => {
  it("renders without throwing when every feed source is empty", async () => {
    pending.usePendingTxs.mockReturnValue([]);
    renderWithProviders(<Activity />);
    expect(await screen.findByText("Activity")).toBeInTheDocument();
  });

  it("renders without throwing on a failed live read and a null cache", async () => {
    live.loadLiveAddressActivity.mockResolvedValue({ ok: false, error: "indexer down" });
    renderWithProviders(<Activity />);
    // No crash on the merge/coverage path; the page still paints its header.
    expect(await screen.findByText("Activity")).toBeInTheDocument();
  });

  it("tolerates an ok outcome with an undefined value (no rows)", async () => {
    live.loadLiveAddressActivity.mockResolvedValue({ ok: true, value: undefined });
    renderWithProviders(<Activity />);
    expect(await screen.findByText("Activity")).toBeInTheDocument();
  });
});
