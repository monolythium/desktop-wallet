// Trade page — the two signing paths and the empty-market refusal.
//
// Trade is the wallet's only ungated surface that signs and broadcasts on the
// user's behalf without a market being listed, so the assertions here are
// funds-critical rather than cosmetic:
//
//  - the unit-conversion REFUSALS are the centrepiece. Silently rounding a
//    limit price changes what the user pays; `humanPriceToAtoms` returns null
//    rather than truncating, and the page must surface that as a refusal and
//    hold the submit. A test that only checked the boolean would not catch a
//    regression that kept the flag but dropped the message.
//  - the empty-market barriers are asserted directly. The chain currently
//    lists zero markets, and the reason a user cannot sign into a market that
//    does not exist is that `baseTokenIdHex`/`quoteTokenIdHex` come ONLY from
//    the native market record. That is load-bearing and must not regress.
//  - the disclosure the user approves is compared against the calldata that is
//    actually signed, by re-encoding from the drawer's own diff lines. If those
//    two can drift, the drawer is theatre.
//
// The NETWORK SEAM is `../../sdk/submit`. Mocking there (rather than at
// `clob-trade`) keeps `clob-trade` REAL, so the precompile address, the
// execution-unit limits and the SDK encoders are all genuinely exercised while
// nothing leaves the process.

import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import {
  PRECOMPILE_ADDRESSES,
  deriveClobMarketId,
  encodeCancelOrderCalldata,
  encodePlaceLimitOrderCalldata,
} from "@monolythium/core-sdk";
import type {
  NativeMarketStateResponse,
  NativeSpotMarketStateRecord,
} from "@monolythium/core-sdk";
import { renderWithProviders } from "../../test/renderWithProviders";
import type { OperationDescriptor } from "../../operations/types";
import type { LiveTradeStatus } from "../../sdk/live";

// Capture the descriptor the page opens, exactly like the other page tests.
const cap = vi.hoisted(() => ({ descriptor: undefined as OperationDescriptor | undefined }));
vi.mock("../../operations/context", () => ({
  OperationsProvider: ({ children }: { children: ReactNode }) => children,
  useOperations: () => ({
    open: (d: OperationDescriptor) => {
      cap.descriptor = d;
    },
    close: () => {},
  }),
}));

// THE NETWORK SEAM. Nothing below this line may reach a socket.
const sub = vi.hoisted(() => ({ submitNativeTx: vi.fn() }));
vi.mock("../../sdk/submit", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../sdk/submit")>()),
  submitNativeTx: sub.submitNativeTx,
}));

// Chain reads. `formatOutcome` and every pure helper stay REAL.
const live = vi.hoisted(() => ({ loadLiveTradeStatus: vi.fn() }));
vi.mock("../../sdk/live", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../sdk/live")>()),
  loadLiveTradeStatus: live.loadLiveTradeStatus,
}));

import { Trade } from "../Trade";

// ── fixtures ────────────────────────────────────────────────────────────────

const BASE = "0x" + "11".repeat(32);
const QUOTE = "0x" + "22".repeat(32);
const ORDER_ID = "0x" + "ab".repeat(32);
const HEAD = 136_056n;

function marketRecord(): NativeSpotMarketStateRecord {
  return {
    marketId: deriveClobMarketId(BASE, QUOTE),
    owner: "mono1owner",
    baseAssetId: BASE,
    quoteAssetId: QUOTE,
    tickSize: "1",
    lotSize: "1",
    minQuantity: "1",
    minNotional: "1",
    tradeCount: "0",
    totalVolumeBase: "0",
    lastPrice: null,
    lastBlockHeight: null,
    createdAtBlock: 0,
    updatedAtBlock: 0,
  };
}

function nativeState(markets: NativeSpotMarketStateRecord[]): NativeMarketStateResponse {
  return {
    schemaVersion: 1,
    limit: 50,
    filters: {},
    spotMarkets: markets,
    spotOrders: [],
    nftListings: [],
    collectionRoyalties: [],
    source: "native_state_storage",
  } as unknown as NativeMarketStateResponse;
}

/** A status whose reads all SUCCEEDED. `markets` empty models the live chain. */
function status(markets: NativeSpotMarketStateRecord[]): LiveTradeStatus {
  const state = nativeState(markets);
  return {
    endpoint: "test-endpoint",
    apiBaseUrl: "test-api",
    activePrecompiles: {
      ok: true,
      value: {
        blockNumber: HEAD,
        precompiles: [
          { name: "clob", address: PRECOMPILE_ADDRESSES.CLOB, gateable: true, enabled: true },
        ],
      },
    } as unknown as LiveTradeStatus["activePrecompiles"],
    nativeMarketState: { ok: true, value: state },
    clobMarkets: { ok: true, value: { schemaVersion: 1, limit: 50, markets: [], source: "indexed_trades" } },
    clobOrderBook: { ok: false, error: "no market" },
    clobTrades: { ok: false, error: "no market" },
    apiHealth: { ok: false, error: "down" },
    apiCapabilities: { ok: false, error: "down" },
    apiStreams: { ok: false, error: "down" },
    orderBookReplay: { ok: false, error: "down" },
    selectedMarket:
      markets.length > 0
        ? { marketId: markets[0]!.marketId, label: "B/Q", source: "native-state", native: markets[0]! }
        : null,
    blockHeight: HEAD,
  } as unknown as LiveTradeStatus;
}

async function renderTrade(s: LiveTradeStatus) {
  live.loadLiveTradeStatus.mockResolvedValue(s);
  const r = renderWithProviders(<Trade />);
  await waitFor(() => expect(live.loadLiveTradeStatus).toHaveBeenCalled());
  return r;
}

function placeButton(): HTMLButtonElement {
  return screen.getByRole("button", { name: /Place (BUY|SELL) limit/ }) as HTMLButtonElement;
}

function cancelButton(): HTMLButtonElement {
  return screen.getByRole("button", { name: "Cancel order" }) as HTMLButtonElement;
}

beforeEach(() => {
  cap.descriptor = undefined;
  vi.clearAllMocks();
  sub.submitNativeTx.mockResolvedValue({
    txHash: "0x" + "cd".repeat(32),
    fromHex: "0x000000000000000000000000000000000000dead",
    fee: {},
    nonce: 0,
  });
});

// ── the empty-market refusal (the Task 1 barriers, pinned) ──────────────────

describe("Trade with no market listed", () => {
  it("holds the place-order button disabled", async () => {
    await renderTrade(status([]));
    expect(placeButton()).toBeDisabled();
  });

  it("opens no operation even when price and quantity are valid", async () => {
    const { user } = await renderTrade(status([]));
    // Fill both fields with values that would be perfectly valid on a real
    // market — the ONLY thing missing is the market itself.
    await user.type(screen.getByPlaceholderText("e.g. 10"), "10");
    await user.type(screen.getByPlaceholderText("e.g. 2"), "2");
    expect(placeButton()).toBeDisabled();
    expect(cap.descriptor).toBeUndefined();
    expect(sub.submitNativeTx).not.toHaveBeenCalled();
  });

  it("still refuses when a market id exists but carries no native metadata", async () => {
    // The near-miss: `selectNativeSpotMarket` can return a market sourced from
    // the indexed summary, which sets `marketId` but leaves `native` undefined.
    // The token ids come only from the native record, so placing must still be
    // held — this is the branch a future refactor is most likely to break.
    const s = status([]);
    (s as { selectedMarket: unknown }).selectedMarket = {
      marketId: deriveClobMarketId(BASE, QUOTE),
      label: "summary-only",
      source: "clob-summary",
    };
    await renderTrade(s);
    expect(placeButton()).toBeDisabled();
    expect(sub.submitNativeTx).not.toHaveBeenCalled();
  });
});

// ── an empty market list vs an unreadable one ───────────────────────────────

describe("Trade market-list honesty", () => {
  it("states plainly that nothing is listed when both reads succeeded", async () => {
    await renderTrade(status([]));
    expect(await screen.findByText(/no market is listed yet/)).toBeInTheDocument();
    expect(screen.queryByText(/could not be read/)).toBeNull();
  });

  it("does not claim zero markets when the market read failed", async () => {
    // The wallet did not observe an empty chain; it failed to look. Reporting
    // "no market is listed" here would be asserting a fact it does not have.
    const s = status([]);
    (s as { nativeMarketState: unknown }).nativeMarketState = { ok: false, error: "HTTP 502" };
    await renderTrade(s);
    expect(await screen.findByText(/the market list could not be read/)).toBeInTheDocument();
    expect(screen.queryByText(/no market is listed yet/)).toBeNull();
  });

  it("distinguishes the selected-market cell between a known none and an unknown", async () => {
    // Scoped to the cell: "none" also appears as the market-card status pill,
    // so a bare text query would not prove which one changed.
    const cellValue = () => screen.getByText("Selected market").parentElement?.textContent ?? "";

    const { unmount } = await renderTrade(status([]));
    await waitFor(() => expect(cellValue()).toBe("Selected marketnone"));
    unmount();

    const s = status([]);
    (s as { clobMarkets: unknown }).clobMarkets = { ok: false, error: "HTTP 502" };
    await renderTrade(s);
    await waitFor(() => expect(cellValue()).toBe("Selected marketunknown"));
  });
});

// ── place-limit-order path ──────────────────────────────────────────────────

describe("Trade place-limit-order", () => {
  it("refuses a price finer than the market's per-atom granularity", async () => {
    const { user } = await renderTrade(status([marketRecord()]));
    // 19 decimal places against an 18-decimal scale — not representable.
    await user.type(screen.getByPlaceholderText("e.g. 10"), "1.0000000000000000001");
    expect(
      await screen.findByText(/Price is finer than this market's per-atom granularity/),
    ).toBeInTheDocument();
    expect(placeButton()).toBeDisabled();
  });

  it("refuses a quantity with more decimal places than the base scale", async () => {
    const { user } = await renderTrade(status([marketRecord()]));
    await user.type(screen.getByPlaceholderText("e.g. 2"), "1.0000000000000000001");
    expect(await screen.findByText(/Quantity has more than 18 decimal places/)).toBeInTheDocument();
    expect(placeButton()).toBeDisabled();
  });

  it("accepts an exactly representable price and shows the atom value it will sign", async () => {
    const { user } = await renderTrade(status([marketRecord()]));
    await user.type(screen.getByPlaceholderText("e.g. 10"), "2");
    // Both legs are 18-decimal, so price_atoms = humanPrice × 10^quote / 10^base
    // collapses to exactly the human price. A whole number lands on a whole atom.
    expect(await screen.findByText("= 2 quote atoms / base atom")).toBeInTheDocument();
    expect(placeButton()).toBeDisabled(); // still needs a quantity
  });

  it("refuses a fractional price, because equal-decimal legs admit only whole atoms", async () => {
    // The boundary that matters in practice. `1.5` looks like an entirely
    // ordinary limit price, but on equal 18-decimal legs it resolves to 1.5
    // quote atoms per base atom — not a whole atom. The seam returns null and
    // the page must refuse rather than round to 1 or 2, either of which would
    // silently change the price the user is about to sign.
    const { user } = await renderTrade(status([marketRecord()]));
    await user.type(screen.getByPlaceholderText("e.g. 10"), "1.5");
    await user.type(screen.getByPlaceholderText("e.g. 2"), "3");
    expect(
      await screen.findByText(/Price is finer than this market's per-atom granularity/),
    ).toBeInTheDocument();
    expect(placeButton()).toBeDisabled();
  });

  it("sends the CLOB precompile address and the place execution-unit limit", async () => {
    const { user } = await renderTrade(status([marketRecord()]));
    await user.type(screen.getByPlaceholderText("e.g. 10"), "2");
    await user.type(screen.getByPlaceholderText("e.g. 2"), "3");
    await user.click(placeButton());
    await waitFor(() => expect(cap.descriptor).toBeDefined());

    await cap.descriptor!.execute!({ vaultSeed: new Uint8Array(32) } as never);

    const args = sub.submitNativeTx.mock.calls[0]![0] as {
      to: string;
      executionUnitLimit: bigint;
      input: string;
    };
    expect(args.to).toBe(PRECOMPILE_ADDRESSES.CLOB);
    expect(args.executionUnitLimit).toBe(250_000n);
    expect(args.input.startsWith("0x")).toBe(true);
  });

  it("resolves a GTC expiry to block zero", async () => {
    const { user } = await renderTrade(status([marketRecord()]));
    await user.type(screen.getByPlaceholderText("e.g. 10"), "2");
    await user.type(screen.getByPlaceholderText("e.g. 2"), "3");
    await user.click(screen.getByRole("button", { name: "GTC" }));
    await user.click(placeButton());
    await waitFor(() => expect(cap.descriptor).toBeDefined());
    const shown = Object.fromEntries(cap.descriptor!.diff.map((d) => [d.k, d.v]));
    expect(shown["Expiry"]).toBe("GTC");
  });

  it("resolves a relative expiry against the live head", async () => {
    const { user } = await renderTrade(status([marketRecord()]));
    await user.type(screen.getByPlaceholderText("e.g. 10"), "2");
    await user.type(screen.getByPlaceholderText("e.g. 2"), "3");
    await user.click(screen.getByRole("button", { name: "1k blocks" }));
    await user.click(placeButton());
    await waitFor(() => expect(cap.descriptor).toBeDefined());
    const shown = Object.fromEntries(cap.descriptor!.diff.map((d) => [d.k, d.v]));
    expect(shown["Expiry"]).toBe(`block ${(HEAD + 1000n).toString()}`);
  });

  it("requires the keychain unlock, and refuses to sign without a seed", async () => {
    const { user } = await renderTrade(status([marketRecord()]));
    await user.type(screen.getByPlaceholderText("e.g. 10"), "2");
    await user.type(screen.getByPlaceholderText("e.g. 2"), "3");
    await user.click(placeButton());
    await waitFor(() => expect(cap.descriptor).toBeDefined());

    expect(cap.descriptor!.auth).toBe("keychain");
    await expect(cap.descriptor!.execute!({} as never)).rejects.toThrow(/vault seed unavailable/);
    expect(sub.submitNativeTx).not.toHaveBeenCalled();
  });

  it("signs exactly the order the approval drawer displayed", async () => {
    // The divergence check. Re-encode the calldata from the drawer's OWN diff
    // lines and compare against what was submitted: if the disclosure and the
    // calldata can drift, the user is approving something other than what is
    // signed, and every other assertion here is worth less.
    const { user } = await renderTrade(status([marketRecord()]));
    await user.type(screen.getByPlaceholderText("e.g. 10"), "7");
    await user.type(screen.getByPlaceholderText("e.g. 2"), "4");
    await user.click(placeButton());
    await waitFor(() => expect(cap.descriptor).toBeDefined());
    await cap.descriptor!.execute!({ vaultSeed: new Uint8Array(32) } as never);

    const shown = Object.fromEntries(cap.descriptor!.diff.map((d) => [d.k, d.v]));
    const expected = encodePlaceLimitOrderCalldata({
      marketId: deriveClobMarketId(shown["Base token"]!, shown["Quote token"]!),
      baseTokenId: shown["Base token"]!,
      quoteTokenId: shown["Quote token"]!,
      side: shown["Side"] === "BUY" ? "buy" : "sell",
      price: shown["Price (atoms)"]!.replace(" quote atoms / base atom", ""),
      quantity: shown["Quantity (atoms)"]!.replace(" base atoms", ""),
      expiryBlock: 0n,
    });

    const args = sub.submitNativeTx.mock.calls[0]![0] as { input: string };
    expect(args.input).toBe(expected);
  });
});

// ── cancel path ─────────────────────────────────────────────────────────────

describe("Trade cancel-order", () => {
  it("refuses an order id that is not 32 bytes of hex", async () => {
    const { user } = await renderTrade(status([]));
    await user.type(screen.getByPlaceholderText("0x…"), "0xdeadbeef");
    expect(cancelButton()).toBeDisabled();
    await user.click(cancelButton());
    expect(cap.descriptor).toBeUndefined();
    expect(sub.submitNativeTx).not.toHaveBeenCalled();
  });

  it("accepts a well-formed order id and sends the cancel execution-unit limit", async () => {
    // Cancel is deliberately reachable with no market listed — it is the
    // recovery path for an order resting on a market that is no longer listed.
    const { user } = await renderTrade(status([]));
    await user.type(screen.getByPlaceholderText("0x…"), ORDER_ID);
    expect(cancelButton()).toBeEnabled();
    await user.click(cancelButton());
    await waitFor(() => expect(cap.descriptor).toBeDefined());
    await cap.descriptor!.execute!({ vaultSeed: new Uint8Array(32) } as never);

    const args = sub.submitNativeTx.mock.calls[0]![0] as {
      to: string;
      executionUnitLimit: bigint;
      input: string;
    };
    expect(args.to).toBe(PRECOMPILE_ADDRESSES.CLOB);
    expect(args.executionUnitLimit).toBe(80_000n);
    expect(args.input).toBe(encodeCancelOrderCalldata({ orderId: ORDER_ID }));
  });

  it("requires the keychain unlock, and refuses to sign without a seed", async () => {
    const { user } = await renderTrade(status([]));
    await user.type(screen.getByPlaceholderText("0x…"), ORDER_ID);
    await user.click(cancelButton());
    await waitFor(() => expect(cap.descriptor).toBeDefined());

    expect(cap.descriptor!.auth).toBe("keychain");
    await expect(cap.descriptor!.execute!({} as never)).rejects.toThrow(/vault seed unavailable/);
    expect(sub.submitNativeTx).not.toHaveBeenCalled();
  });
});
