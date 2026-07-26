// Law 1.1 — addresses render IN FULL on every money surface.
//
// A money surface is any place the user verifies who funds are moving between.
// A head/tail form is precisely what an attacker grinds a lookalike address to
// match — same first ten characters, same last six — so a truncated address on
// the surface where the user checks their counterparty is not a cosmetic
// shortcut, it is the attack surface.
//
// G3: this task is DISPLAY-ONLY. The last describe block proves the signed
// payload is byte-identical to what it was, because a "make it render fully"
// change has no business touching what gets signed.

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import { screen, waitFor } from "@testing-library/react";
import { addressToTypedBech32 } from "@monolythium/core-sdk";
import { renderWithProviders, TEST_WALLET_ADDRESS } from "../../test/renderWithProviders";
import { computeNativeFeeQuote, NATIVE_TRANSFER_EXECUTION_UNIT_LIMIT } from "../../sdk/fee-model";
import { PRIMARY_ACCOUNT, setActiveAccount } from "../../sdk/keychain";
import type { OperationDescriptor } from "../../operations/types";

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

const live = vi.hoisted(() => ({ loadLiveWalletBalance: vi.fn(), loadLiveAddressActivity: vi.fn() }));
vi.mock("../../sdk/live", async (o) => ({
  ...(await o<typeof import("../../sdk/live")>()),
  loadLiveWalletBalance: live.loadLiveWalletBalance,
  loadLiveAddressActivity: live.loadLiveAddressActivity,
}));
const fee = vi.hoisted(() => ({ previewNativeSendFee: vi.fn() }));
vi.mock("../../sdk/fee-preview", async (o) => ({
  ...(await o<typeof import("../../sdk/fee-preview")>()),
  previewNativeSendFee: fee.previewNativeSendFee,
}));
const guard = vi.hoisted(() => ({ loadSpendGuardLythoshi: vi.fn() }));
vi.mock("../../sdk/spend-guard", () => ({ loadSpendGuardLythoshi: guard.loadSpendGuardLythoshi }));
const sentLog = vi.hoisted(() => ({ isSentRecipientVerified: vi.fn(), recordSentRecipient: vi.fn() }));
vi.mock("../../sdk/sent-recipients-store", () => ({
  isSentRecipientVerified: sentLog.isSentRecipientVerified,
  recordSentRecipient: sentLog.recordSentRecipient,
}));
const send = vi.hoisted(() => ({ sendNativeLyth: vi.fn() }));
vi.mock("../../sdk/native-send", () => ({ sendNativeLyth: send.sendNativeLyth }));
const reverse = vi.hoisted(() => ({ loadReverseName: vi.fn() }));
vi.mock("../../sdk/reverse-name", () => ({ loadReverseName: reverse.loadReverseName }));
const addressbook = vi.hoisted(() => ({ addressbookLookup: vi.fn() }));
vi.mock("../../sdk/addressbook", () => ({ addressbookLookup: addressbook.addressbookLookup }));
vi.mock("../../sdk/finality", () => ({
  fetchFinalityPosture: vi.fn(() => Promise.resolve({ label: "anchor-level", height: null })),
}));
vi.mock("../../sdk/activity-cache-store", () => ({ readConfirmedCache: vi.fn(() => Promise.resolve(null)) }));
vi.mock("../../sdk/pending-tx-store", () => ({ pendingTxsSnapshot: vi.fn(() => []) }));

import { SendComposeModal } from "../SendComposeModal";

const FROM = TEST_WALLET_ADDRESS;
const TO = addressToTypedBech32("user", "0x000000000000000000000000000000000000beef");

beforeEach(() => {
  vi.clearAllMocks();
  cap.descriptor = undefined;
  live.loadLiveWalletBalance.mockResolvedValue({
    balanceLyth: "5",
    balanceLythoshi: "5000000000000000000",
  });
  live.loadLiveAddressActivity.mockResolvedValue({ ok: false, error: "n/a" });
  guard.loadSpendGuardLythoshi.mockResolvedValue(null);
  reverse.loadReverseName.mockResolvedValue(null);
  addressbook.addressbookLookup.mockResolvedValue([]);
  sentLog.isSentRecipientVerified.mockResolvedValue(false);
  sentLog.recordSentRecipient.mockResolvedValue(undefined);
  setActiveAccount(PRIMARY_ACCOUNT);
  fee.previewNativeSendFee.mockImplementation((_c: unknown, opts?: { tokenTransfer?: boolean }) => {
    const limit = opts?.tokenTransfer ? 250_000n : NATIVE_TRANSFER_EXECUTION_UNIT_LIMIT;
    return Promise.resolve({
      quote: {
        baseLythoshi: 1_000_000_000n,
        suggestedTipLythoshi: 1_000_000_000n,
        source: "latest_block",
      },
      perTier: {
        normal: computeNativeFeeQuote({ baseLythoshi: 1_000_000_000n, suggestedTipLythoshi: 1_000_000_000n, tier: "normal", executionUnitLimit: limit }),
        fast: computeNativeFeeQuote({ baseLythoshi: 1_000_000_000n, suggestedTipLythoshi: 1_000_000_000n, tier: "fast", executionUnitLimit: limit }),
      },
    });
  });
  send.sendNativeLyth.mockResolvedValue({
    txHash: "0xabc",
    from: FROM,
    amountLythoshi: "0",
    amountDisplay: "0",
    nonce: 1,
  });
});

describe("the compose 'From' line", () => {
  it("renders the FULL bech32m, with no ellipsis", async () => {
    renderWithProviders(<SendComposeModal fromBech32m={FROM} onClose={vi.fn()} />);
    // Queried by the exact full string — the assertion IS the law.
    expect(await screen.findByText(FROM)).toBeInTheDocument();
  });

  it("shows no head…tail form of the sender anywhere", async () => {
    const { container } = renderWithProviders(
      <SendComposeModal fromBech32m={FROM} onClose={vi.fn()} />,
    );
    await screen.findByText(FROM);
    const truncated = `${FROM.slice(0, 10)}…${FROM.slice(-6)}`;
    expect(container.textContent ?? "").not.toContain(truncated);
  });

  it("wraps rather than clipping, at or above the 11px monospace floor", async () => {
    renderWithProviders(<SendComposeModal fromBech32m={FROM} onClose={vi.fn()} />);
    const el = (await screen.findByText(FROM)) as HTMLElement;
    expect(el.style.wordBreak).toBe("break-all");
    expect(Number.parseFloat(el.style.fontSize)).toBeGreaterThanOrEqual(11);
    // A clipped address surfaces a width bug in smoke testing; an ellipsized
    // one hides it. Never ellipsis.
    expect(el.style.textOverflow).not.toBe("ellipsis");
  });
});

describe("the Review diff", () => {
  it("carries the full From and To addresses", async () => {
    const { user } = renderWithProviders(<SendComposeModal fromBech32m={FROM} onClose={vi.fn()} />);
    await user.type(screen.getByLabelText("Recipient typed bech32m address"), TO);
    await user.type(screen.getByLabelText("Amount in LYTH"), "1.5");
    await user.click(screen.getByRole("button", { name: "Review" }));

    await waitFor(() => expect(cap.descriptor).toBeDefined());
    const diff = cap.descriptor!.diff;
    expect(diff.find((l) => l.k === "From")?.v).toBe(FROM);
    expect(diff.find((l) => l.k === "To")?.v).toContain(TO);
  });

  it("neither row is a truncated form", async () => {
    const { user } = renderWithProviders(<SendComposeModal fromBech32m={FROM} onClose={vi.fn()} />);
    await user.type(screen.getByLabelText("Recipient typed bech32m address"), TO);
    await user.type(screen.getByLabelText("Amount in LYTH"), "1.5");
    await user.click(screen.getByRole("button", { name: "Review" }));

    await waitFor(() => expect(cap.descriptor).toBeDefined());
    for (const key of ["From", "To"]) {
      expect(cap.descriptor!.diff.find((l) => l.k === key)?.v).not.toContain("…");
    }
  });
});

describe("G3 — display only: the signed payload is unchanged", () => {
  it("execute() still signs exactly the recipient and amount reviewed", async () => {
    const { user } = renderWithProviders(<SendComposeModal fromBech32m={FROM} onClose={vi.fn()} />);
    await user.type(screen.getByLabelText("Recipient typed bech32m address"), TO);
    await user.type(screen.getByLabelText("Amount in LYTH"), "1.5");
    await user.click(screen.getByRole("button", { name: "Review" }));

    await waitFor(() => expect(cap.descriptor).toBeDefined());
    await cap.descriptor!.execute({ vaultSeed: new Uint8Array(32) });

    // Byte-identical to the pre-change expectation: the full typed bech32m and
    // the exact decimal string. Rendering the sender in full moved no bytes.
    expect(send.sendNativeLyth).toHaveBeenCalledWith(
      expect.objectContaining({ to: TO, amountLyth: "1.5" }),
    );
  });

  it("the signer never receives a truncated address", async () => {
    const { user } = renderWithProviders(<SendComposeModal fromBech32m={FROM} onClose={vi.fn()} />);
    await user.type(screen.getByLabelText("Recipient typed bech32m address"), TO);
    await user.type(screen.getByLabelText("Amount in LYTH"), "1.5");
    await user.click(screen.getByRole("button", { name: "Review" }));
    await waitFor(() => expect(cap.descriptor).toBeDefined());
    await cap.descriptor!.execute({ vaultSeed: new Uint8Array(32) });

    const arg = send.sendNativeLyth.mock.calls[0]![0] as { to: string };
    expect(arg.to).not.toContain("…");
  });
});
