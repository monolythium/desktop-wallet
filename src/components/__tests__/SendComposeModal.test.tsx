import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import { addressToTypedBech32 } from "@monolythium/core-sdk";
import { renderWithProviders, TEST_WALLET_ADDRESS } from "../../test/renderWithProviders";
import type { OperationDescriptor } from "../../operations/types";

// Capture the descriptor the modal hands to the drawer, so we can assert that
// what the review SHOWS is exactly what `execute()` SIGNS.
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

// Mount + action data sources (keep the pure helpers real via importOriginal).
const live = vi.hoisted(() => ({ loadLiveWalletBalance: vi.fn(), loadLiveAddressActivity: vi.fn() }));
vi.mock("../../sdk/live", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../sdk/live")>()),
  loadLiveWalletBalance: live.loadLiveWalletBalance,
  loadLiveAddressActivity: live.loadLiveAddressActivity,
}));
const fee = vi.hoisted(() => ({ previewTransferFee: vi.fn() }));
vi.mock("../../sdk/fee-preview", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../sdk/fee-preview")>()),
  previewTransferFee: fee.previewTransferFee,
}));
const send = vi.hoisted(() => ({ sendNativeLyth: vi.fn(), sendMrc20Token: vi.fn() }));
vi.mock("../../sdk/native-send", () => ({ sendNativeLyth: send.sendNativeLyth }));
vi.mock("../../sdk/token-send", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../sdk/token-send")>()),
  sendMrc20Token: send.sendMrc20Token,
}));
const nameResolve = vi.hoisted(() => ({ resolveNameQuorum: vi.fn() }));
vi.mock("../../sdk/name-resolve", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../sdk/name-resolve")>()),
  resolveNameQuorum: nameResolve.resolveNameQuorum,
}));
vi.mock("../../sdk/reverse-name", () => ({ loadReverseName: vi.fn(() => Promise.resolve(null)) }));
vi.mock("../../sdk/addressbook", () => ({ addressbookLookup: vi.fn(() => Promise.resolve([])) }));
vi.mock("../../sdk/finality", () => ({
  fetchFinalityPosture: vi.fn(() => Promise.resolve({ label: "anchor-level", height: null })),
}));
vi.mock("../../sdk/activity-cache-store", () => ({ readConfirmedCache: vi.fn(() => Promise.resolve(null)) }));
vi.mock("../../sdk/pending-tx-store", () => ({ pendingTxsSnapshot: vi.fn(() => []) }));

import { SendComposeModal } from "../SendComposeModal";

const FROM = TEST_WALLET_ADDRESS;
const TO = addressToTypedBech32("user", "0x000000000000000000000000000000000000beef");
const RESOLVED = addressToTypedBech32("user", "0x000000000000000000000000000000000000cafe");
const TOKEN_ID = "0x" + "cd".repeat(32);

function amountLine(d: OperationDescriptor) {
  return d.diff.find((l) => l.k === "Amount")?.v;
}
function toLine(d: OperationDescriptor) {
  return d.diff.find((l) => l.k === "To")?.v;
}

beforeEach(() => {
  vi.clearAllMocks(); // reset call history between cases (implementations survive)
  cap.descriptor = undefined;
  live.loadLiveWalletBalance.mockResolvedValue({ balanceLyth: "5", balanceLythoshi: "5000000000000000000" });
  live.loadLiveAddressActivity.mockResolvedValue({ ok: false, error: "n/a" });
  // 1e12 per-unit × 100k units = 1e17 lythoshi = 0.1 LYTH worst-case max fee.
  fee.previewTransferFee.mockResolvedValue({
    fee: { maxFeePerGas: 1_000_000_000_000n, maxPriorityFeePerGas: 1_000_000_000_000n, gasLimit: 100_000n },
    maxFeeLythoshi: 100_000_000_000_000_000n,
    maxFeeLyth: "0.1",
  });
  send.sendNativeLyth.mockResolvedValue({ txHash: "0xabc", from: FROM, amountLythoshi: "0", amountDisplay: "0", nonce: 1 });
  send.sendMrc20Token.mockResolvedValue({ txHash: "0xdef", from: FROM, tokenId: TOKEN_ID, amountBase: "0", amountDisplay: "0", nonce: 1 });
  nameResolve.resolveNameQuorum.mockResolvedValue({ ok: true, address: RESOLVED });
});

describe("SendComposeModal — shown == signed", () => {
  it("native: the review Amount/To equal exactly what sendNativeLyth signs", async () => {
    const { user } = renderWithProviders(<SendComposeModal fromBech32m={FROM} onClose={vi.fn()} />);
    await user.type(screen.getByLabelText("Recipient typed bech32m address"), TO);
    await user.type(screen.getByLabelText("Amount in LYTH"), "1.5");
    await user.click(screen.getByRole("button", { name: "Review" }));

    await waitFor(() => expect(cap.descriptor).toBeDefined());
    const d = cap.descriptor!;
    expect(amountLine(d)).toBe("1.5 LYTH");
    expect(toLine(d)).toContain(TO);

    await d.execute({ vaultSeed: new Uint8Array(32) });
    expect(send.sendNativeLyth).toHaveBeenCalledWith(expect.objectContaining({ to: TO, amountLyth: "1.5" }));
  });

  it("MRC-20: the review Amount/Token equal what sendMrc20Token signs, at real decimals", async () => {
    const token = { tokenId: TOKEN_ID, symbol: "USDC", decimals: 6, balanceBaseUnits: "2000000" };
    const { user } = renderWithProviders(<SendComposeModal fromBech32m={FROM} token={token} onClose={vi.fn()} />);
    await user.type(screen.getByLabelText("Recipient typed bech32m address"), TO);
    await user.type(screen.getByLabelText("Amount in USDC"), "1.5");
    await user.click(screen.getByRole("button", { name: "Review" }));

    await waitFor(() => expect(cap.descriptor).toBeDefined());
    const d = cap.descriptor!;
    expect(amountLine(d)).toBe("1.5 USDC");
    expect(d.diff.find((l) => l.k === "Token")?.v).toBe("USDC");

    await d.execute({ vaultSeed: new Uint8Array(32) });
    expect(send.sendMrc20Token).toHaveBeenCalledWith(
      expect.objectContaining({ tokenId: TOKEN_ID, to: TO, amount: "1.5", decimals: 6 }),
    );
    // and no native LYTH send fired
    expect(send.sendNativeLyth).not.toHaveBeenCalled();
  });
});

describe("SendComposeModal — Max leaves the fee", () => {
  it("Max fills the balance minus the worst-case network fee (never overspends)", async () => {
    const { user } = renderWithProviders(<SendComposeModal fromBech32m={FROM} onClose={vi.fn()} />);
    const maxBtn = screen.getByRole("button", { name: "Max" });
    await waitFor(() => expect(maxBtn).toBeEnabled()); // enabled once balance + fee load
    await user.click(maxBtn);

    const amount = screen.getByLabelText("Amount in LYTH") as HTMLInputElement;
    // 5 LYTH − 0.1 LYTH max fee = 4.9, strictly below the 5-LYTH balance.
    expect(amount.value).toBe("4.9");
  });
});

describe("SendComposeModal — .mono resolution is fail-closed", () => {
  it("a resolved name: the shown + signed address is the resolved target (no hidden redirect)", async () => {
    nameResolve.resolveNameQuorum.mockResolvedValue({ ok: true, address: RESOLVED });
    const { user } = renderWithProviders(<SendComposeModal fromBech32m={FROM} onClose={vi.fn()} />);
    await user.type(screen.getByLabelText("Recipient typed bech32m address"), "alice.mono");
    await user.type(screen.getByLabelText("Amount in LYTH"), "1");
    await user.click(screen.getByRole("button", { name: "Review" }));

    await waitFor(() => expect(cap.descriptor).toBeDefined());
    expect(toLine(cap.descriptor!)).toContain(RESOLVED);
    await cap.descriptor!.execute({ vaultSeed: new Uint8Array(32) });
    expect(send.sendNativeLyth).toHaveBeenCalledWith(expect.objectContaining({ to: RESOLVED }));
  });

  it("an unresolved name BLOCKS the send (no operation opened, nothing signed)", async () => {
    nameResolve.resolveNameQuorum.mockResolvedValue({ ok: false, message: "name did not resolve across a quorum" });
    const { user } = renderWithProviders(<SendComposeModal fromBech32m={FROM} onClose={vi.fn()} />);
    await user.type(screen.getByLabelText("Recipient typed bech32m address"), "ghost.mono");
    await user.type(screen.getByLabelText("Amount in LYTH"), "1");
    await user.click(screen.getByRole("button", { name: "Review" }));

    expect(await screen.findByText(/did not resolve/i)).toBeInTheDocument();
    expect(cap.descriptor).toBeUndefined();
    expect(send.sendNativeLyth).not.toHaveBeenCalled();
  });
});
