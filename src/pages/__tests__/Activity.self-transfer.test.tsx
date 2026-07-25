// The two legs of a self-transfer must survive as two rows.
//
// The chain's `address_activity` view has separate inbound and outbound arms
// over one `transfers` table, so a transfer whose sender and recipient are the
// same account matches BOTH arms and is served as two rows sharing the whole
// (block, txIndex, logIndex) anchor — native transfers all carry the same
// log-index sentinel, so the anchor alone cannot tell them apart.
//
// This is a BEHAVIOURAL guard, not a source scan: it renders the page and
// asserts on what React actually does with the keys. A source scan for the key
// expression has failed to catch drift here three times before.

import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { screen } from "@testing-library/react";
import { renderWithProviders } from "../../test/renderWithProviders";
import type { LiveAddressActivityRow } from "../../sdk/live";

const WALLET = "mono1activevaultb";
vi.mock("../../sdk/active-wallet", () => ({
  useActiveWallet: () => ({ status: "ready", slot: "b", name: "B", addressHex: "0x0b", address: WALLET }),
}));
vi.mock("../../sdk/use-pending-tx", () => ({ usePendingTxs: vi.fn(() => []) }));

const live = vi.hoisted(() => ({ loadLiveActivityPage: vi.fn(), loadAddressActivityKind: vi.fn() }));
vi.mock("../../sdk/live", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../sdk/live")>()),
  loadLiveActivityPage: live.loadLiveActivityPage,
  loadAddressActivityKind: live.loadAddressActivityKind,
}));
vi.mock("../../sdk/activity-cache-store", () => ({
  readConfirmedCache: vi.fn(() => Promise.resolve(null)),
  writeConfirmedCache: vi.fn(() => Promise.resolve()),
}));
vi.mock("../../sdk/notifications-store", () => ({ listForScope: vi.fn(() => Promise.resolve([])) }));
vi.mock("../../sdk/incoming-detect", () => ({
  detectAndNotifyIncoming: vi.fn(() => Promise.resolve({ recorded: 0 })),
}));
vi.mock("../../sdk/token-metadata", () => ({ loadTokenMetaMap: vi.fn(() => Promise.resolve(new Map())) }));

import { Activity } from "../Activity";

/** The exact pair the chain serves for one self-transfer: same anchor, opposite
 *  direction, and the wallet's OWN address on both sides. */
function selfTransferLegs(): LiveAddressActivityRow[] {
  const base = {
    blockHeight: 4242n,
    txIndex: 1,
    // Native transfers all carry this sentinel, so the anchor collides.
    logIndex: 4_294_967_295,
    kind: "transfer",
    counterparty: WALLET,
    tokenId: null,
    amount: "2000000000000000000", // 2 LYTH
    cluster: null,
    weightBps: null,
    subKind: null,
    blockTimestampSeconds: null,
    txHash: null,
    clusterName: null,
  };
  return [
    { ...base, direction: "out" } as LiveAddressActivityRow,
    { ...base, direction: "in" } as LiveAddressActivityRow,
  ];
}

let errorSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  vi.clearAllMocks();
  live.loadLiveActivityPage.mockResolvedValue({
    ok: true,
    value: { rows: selfTransferLegs(), nextCursor: null },
  });
  live.loadAddressActivityKind.mockResolvedValue({ ok: false, error: "n/a" });
  errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  errorSpy.mockRestore();
});

describe("Activity — a self-transfer's two legs", () => {
  it("renders BOTH legs — the outgoing one and the incoming one", async () => {
    renderWithProviders(<Activity />);
    // Neither leg is dropped: the sign is direction-driven, so the pair reads
    // as one debit and one credit of the same amount.
    expect(await screen.findByText("-2")).toBeInTheDocument();
    expect(await screen.findByText("+2")).toBeInTheDocument();
  });

  it("does not give the two legs the same React key", async () => {
    renderWithProviders(<Activity />);
    await screen.findByText("-2");
    // React warns (and its reconciliation becomes ambiguous) when siblings share
    // a key. These two rows are precisely the ones that must stay distinct, so
    // the warning is the defect, not noise to filter out.
    const duplicateKeyWarning = errorSpy.mock.calls.some((args: unknown[]) =>
      args.some((a: unknown) => typeof a === "string" && a.includes("same key")),
    );
    expect(duplicateKeyWarning).toBe(false);
  });

  it("keeps both legs, in the same order, across a re-render", async () => {
    const { container, rerender } = renderWithProviders(<Activity />);
    await screen.findByText("-2");
    const before = [...container.querySelectorAll(".w-tx__amt")].map((n) => n.textContent);
    rerender(<Activity />);
    await screen.findByText("-2");
    const after = [...container.querySelectorAll(".w-tx__amt")].map((n) => n.textContent);
    // Two rows, both still present, and the pair does not swap position — an
    // identity that renumbered per render would reorder them here.
    expect(before).toEqual(["-2LYTH", "+2LYTH"]);
    expect(after).toEqual(before);
  });
});
