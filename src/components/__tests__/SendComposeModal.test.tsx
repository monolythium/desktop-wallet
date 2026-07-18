import type { ReactElement, ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, screen, waitFor } from "@testing-library/react";
import { addressToTypedBech32 } from "@monolythium/core-sdk";
import { renderWithProviders, TEST_WALLET_ADDRESS } from "../../test/renderWithProviders";
import { computeNativeFeeQuote, NATIVE_TRANSFER_EXECUTION_UNIT_LIMIT } from "../../sdk/fee-model";
import { DeveloperModeProvider } from "../../sdk/developer-mode";
import type { OperationDescriptor } from "../../operations/types";

/** Wrap a subtree with developer mode forced ON (the Phase 01 gate). */
function devOn(ui: ReactElement): ReactElement {
  return (
    <DeveloperModeProvider value={{ enabled: true, setEnabled: async () => true }}>
      {ui}
    </DeveloperModeProvider>
  );
}

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
const fee = vi.hoisted(() => ({ previewNativeSendFee: vi.fn() }));
vi.mock("../../sdk/fee-preview", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../sdk/fee-preview")>()),
  previewNativeSendFee: fee.previewNativeSendFee,
}));
const guard = vi.hoisted(() => ({ loadSpendGuardLythoshi: vi.fn() }));
vi.mock("../../sdk/spend-guard", () => ({ loadSpendGuardLythoshi: guard.loadSpendGuardLythoshi }));
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
  guard.loadSpendGuardLythoshi.mockResolvedValue(null); // default: no cross-check → basis = display balance
  // Live-floor quote (base 10^9, tip 10^9). Native limit 30_000n / token 250_000n.
  fee.previewNativeSendFee.mockImplementation((_c: unknown, opts?: { tokenTransfer?: boolean }) => {
    const limit = opts?.tokenTransfer ? 250_000n : NATIVE_TRANSFER_EXECUTION_UNIT_LIMIT;
    return Promise.resolve({
      quote: { baseLythoshi: 1_000_000_000n, suggestedTipLythoshi: 1_000_000_000n, source: "latest_block" },
      perTier: {
        normal: computeNativeFeeQuote(1_000_000_000n, 1_000_000_000n, "normal", limit),
        fast: computeNativeFeeQuote(1_000_000_000n, 1_000_000_000n, "fast", limit),
      },
    });
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

describe("SendComposeModal — Max leaves the fee reservation", () => {
  it("Max fills the balance minus the active-tier reservation (never overspends)", async () => {
    const { user } = renderWithProviders(<SendComposeModal fromBech32m={FROM} onClose={vi.fn()} />);
    const maxBtn = screen.getByRole("button", { name: "Max" });
    await waitFor(() => expect(maxBtn).toBeEnabled()); // enabled once balance + fee load
    await user.click(maxBtn);

    const amount = screen.getByLabelText("Amount in LYTH") as HTMLInputElement;
    // 5 LYTH − (2×10^9 × 30_000 = 6×10^13 = 0.00006 LYTH) reservation = 4.99994.
    expect(amount.value).toBe("4.99994");
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

describe("SendComposeModal — fee tiers + the honest charge (T5)", () => {
  it("defaults to Normal and headlines the honest charge + Total (amount + charge)", async () => {
    const { user } = renderWithProviders(<SendComposeModal fromBech32m={FROM} onClose={vi.fn()} />);
    expect(screen.getByRole("button", { name: /Normal/ })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: /Fast/ })).toHaveAttribute("aria-pressed", "false");
    // The honest charge (perUnit 2×10^9 × 21_000 = 0.000042 LYTH), NOT a max.
    expect(await screen.findByText("0.000042 LYTH")).toBeInTheDocument();
    await user.type(screen.getByLabelText("Amount in LYTH"), "1.5");
    expect(await screen.findByText("1.500042 LYTH")).toBeInTheDocument(); // amount + charge
  });

  it("switching to Fast recomputes synchronously with NO second quote", async () => {
    const { user } = renderWithProviders(<SendComposeModal fromBech32m={FROM} onClose={vi.fn()} />);
    await screen.findByText("0.000042 LYTH");
    await user.click(screen.getByRole("button", { name: /Fast/ }));
    expect(await screen.findByText("0.000063 LYTH")).toBeInTheDocument(); // 3×10^9 × 21_000
    expect(fee.previewNativeSendFee).toHaveBeenCalledTimes(1); // one fetch per open
  });

  it("a failed quote shows the honest error and disables Review", async () => {
    fee.previewNativeSendFee.mockRejectedValueOnce(new Error("operator untrusted"));
    const { user } = renderWithProviders(<SendComposeModal fromBech32m={FROM} onClose={vi.fn()} />);
    await user.type(screen.getByLabelText("Recipient typed bech32m address"), TO);
    await user.type(screen.getByLabelText("Amount in LYTH"), "1");
    expect(await screen.findByText(/Could not fetch fee: operator untrusted/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Review" })).toBeDisabled();
  });

  it("the default fee box carries no gas/gwei/wei/lythoshi/execution-unit wording", async () => {
    renderWithProviders(<SendComposeModal fromBech32m={FROM} onClose={vi.fn()} />);
    await screen.findByText("0.000042 LYTH");
    expect(screen.getByRole("dialog").textContent ?? "").not.toMatch(/gas|gwei|wei|lythoshi|execution unit/i);
  });

  it("signs the active tier's fee VERBATIM (resolvedFee == the previewed signedFee)", async () => {
    const { user } = renderWithProviders(<SendComposeModal fromBech32m={FROM} onClose={vi.fn()} />);
    await screen.findByText("0.000042 LYTH");
    await user.type(screen.getByLabelText("Recipient typed bech32m address"), TO);
    await user.type(screen.getByLabelText("Amount in LYTH"), "1.5");
    await user.click(screen.getByRole("button", { name: "Review" }));
    await waitFor(() => expect(cap.descriptor).toBeDefined());
    // The drawer fee row is the honest charge, tier-labelled; no "resolved at submit".
    expect(cap.descriptor!.diff.find((l) => l.k === "Fee (Normal)")?.v).toBe("0.000042 LYTH");
    expect(JSON.stringify(cap.descriptor!.diff)).not.toContain("resolved at submit");
    await cap.descriptor!.execute({ vaultSeed: new Uint8Array(32) });
    expect(send.sendNativeLyth).toHaveBeenCalledWith(
      expect.objectContaining({
        resolvedFee: { maxFeePerGas: 2_000_000_000n, maxPriorityFeePerGas: 1_000_000_000n, gasLimit: 30_000n },
      }),
    );
  });
});

describe("SendComposeModal — developer-mode fee breakdown (T6)", () => {
  it("is hidden by default (developer mode off) and leaks no per-unit wording", async () => {
    renderWithProviders(<SendComposeModal fromBech32m={FROM} onClose={vi.fn()} />);
    await screen.findByText("0.000042 LYTH");
    expect(screen.queryByText("Low-level compatibility fee details")).toBeNull();
    expect(screen.getByRole("dialog").textContent ?? "").not.toMatch(/lythoshi|execution unit/i);
  });

  it("developer mode on: the four verbatim rows, computed from the cached quote", async () => {
    renderWithProviders(devOn(<SendComposeModal fromBech32m={FROM} onClose={vi.fn()} />));
    expect(await screen.findByText("Low-level compatibility fee details")).toBeInTheDocument();
    // Live-floor quote (tip 10^9, base 10^9); Normal tier.
    expect(
      screen.getByText("Priority price: 1000000000 lythoshi / execution unit (Normal · 1×)"),
    ).toBeInTheDocument();
    expect(screen.getByText("Base price: 1000000000 lythoshi / execution unit")).toBeInTheDocument();
    expect(screen.getByText("Execution units (charged): 21000")).toBeInTheDocument();
    expect(screen.getByText("Reserved limit: 30000")).toBeInTheDocument();
  });

  it("recomputes the priority price for Fast and fires ZERO extra reads on expand/switch", async () => {
    const { user } = renderWithProviders(devOn(<SendComposeModal fromBech32m={FROM} onClose={vi.fn()} />));
    await screen.findByText("Low-level compatibility fee details");
    expect(fee.previewNativeSendFee).toHaveBeenCalledTimes(1); // the one mount fetch
    await user.click(screen.getByText("Low-level compatibility fee details")); // expand the <details>
    await user.click(screen.getByRole("button", { name: /Fast/ }));
    // Fast: tieredTip = scaleByBps(10^9, 2×) = 2×10^9.
    expect(
      screen.getByText("Priority price: 2000000000 lythoshi / execution unit (Fast · 2×)"),
    ).toBeInTheDocument();
    expect(fee.previewNativeSendFee).toHaveBeenCalledTimes(1); // network-silent
  });

  it("token mode shows the 250000 reserved limit", async () => {
    const token = { tokenId: TOKEN_ID, symbol: "USDC", decimals: 6, balanceBaseUnits: "2000000" };
    renderWithProviders(devOn(<SendComposeModal fromBech32m={FROM} token={token} onClose={vi.fn()} />));
    expect(await screen.findByText("Reserved limit: 250000")).toBeInTheDocument();
  });
});

describe("SendComposeModal — spend guard + affordability (T7)", () => {
  it("the guard TIGHTENS the basis: Max fills (min(guard,balance) − reservation)", async () => {
    // Balance 5 LYTH; guard cross-checks a lower 2 LYTH → basis = 2 LYTH.
    let resolveGuard!: (v: bigint | null) => void;
    guard.loadSpendGuardLythoshi.mockReturnValue(new Promise((res) => (resolveGuard = res)));
    const { user } = renderWithProviders(<SendComposeModal fromBech32m={FROM} onClose={vi.fn()} />);
    const maxBtn = screen.getByRole("button", { name: "Max" });
    await waitFor(() => expect(maxBtn).toBeEnabled()); // balance + fee loaded
    await act(async () => resolveGuard(2_000_000_000_000_000_000n)); // guard lands → basis 2 LYTH
    await user.click(maxBtn);
    // 2 LYTH − 0.00006 reservation = 1.99994 (NOT the 4.99994 the raw balance gives).
    expect((screen.getByLabelText("Amount in LYTH") as HTMLInputElement).value).toBe("1.99994");
  });

  it("blocks when amount + reservation exceeds the (guard-tightened) basis and disables Review", async () => {
    guard.loadSpendGuardLythoshi.mockResolvedValue(1_000_000_000_000_000_000n); // 1 LYTH floor
    const { user } = renderWithProviders(<SendComposeModal fromBech32m={FROM} onClose={vi.fn()} />);
    await user.type(screen.getByLabelText("Recipient typed bech32m address"), TO);
    await user.type(screen.getByLabelText("Amount in LYTH"), "2"); // 2 LYTH > 1 LYTH basis
    expect(await screen.findByText("Amount + fee exceeds balance.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Review" })).toBeDisabled();
  });

  it("allows exact equality — a Max fill (amount + reservation == basis) is admissible", async () => {
    // guard null (beforeEach) → basis = balance 5 LYTH.
    const { user } = renderWithProviders(<SendComposeModal fromBech32m={FROM} onClose={vi.fn()} />);
    await user.type(screen.getByLabelText("Recipient typed bech32m address"), TO);
    const maxBtn = screen.getByRole("button", { name: "Max" });
    await waitFor(() => expect(maxBtn).toBeEnabled());
    await user.click(maxBtn); // fills 4.99994; 4.99994 + 0.00006 == 5 exactly
    expect(screen.queryByText("Amount + fee exceeds balance.")).toBeNull();
    expect(screen.getByRole("button", { name: "Review" })).toBeEnabled();
  });

  it("re-evaluates reactively when the guard lands AFTER an amount was filled", async () => {
    let resolveGuard!: (v: bigint | null) => void;
    guard.loadSpendGuardLythoshi.mockReturnValue(new Promise((res) => (resolveGuard = res)));
    const { user } = renderWithProviders(<SendComposeModal fromBech32m={FROM} onClose={vi.fn()} />);
    await user.type(screen.getByLabelText("Recipient typed bech32m address"), TO);
    await user.type(screen.getByLabelText("Amount in LYTH"), "3"); // fine vs the 5 LYTH balance
    // Basis is still the balance (guard pending) → no error yet.
    expect(screen.queryByText("Amount + fee exceeds balance.")).toBeNull();
    await act(async () => resolveGuard(1_000_000_000_000_000_000n)); // guard floors basis to 1 LYTH
    expect(await screen.findByText("Amount + fee exceeds balance.")).toBeInTheDocument();
    // The filled amount is NOT silently rewritten — only the gate trips.
    expect((screen.getByLabelText("Amount in LYTH") as HTMLInputElement).value).toBe("3");
  });
});

describe("SendComposeModal — token fee path (T8)", () => {
  const token = { tokenId: TOKEN_ID, symbol: "USDC", decimals: 6, balanceBaseUnits: "2000000" };

  it("headlines 'Network fee (max)' with the 250k reservation and 'Fee paid in LYTH', no Total row", async () => {
    renderWithProviders(<SendComposeModal fromBech32m={FROM} token={token} onClose={vi.fn()} />);
    expect(await screen.findByText("Network fee (max)")).toBeInTheDocument();
    // Normal reservation: 2×10^9 per-unit × 250_000 = 5×10^14 = 0.0005 LYTH.
    expect(screen.getByText("0.0005 LYTH")).toBeInTheDocument();
    expect(screen.getByText("Fee paid in")).toBeInTheDocument();
    expect(screen.getByText("LYTH (not USDC)")).toBeInTheDocument();
    // A token fee is a different unit from the token amount — no Total row.
    expect(screen.queryByText("Total (amount + fee)")).toBeNull();
  });

  it("blocks Review with the verbatim coverage message when the basis can't cover the reservation", async () => {
    // A wallet with tokens but near-zero LYTH: basis (100 lythoshi) < 5×10^14 reservation.
    live.loadLiveWalletBalance.mockResolvedValueOnce({ balanceLyth: "0", balanceLythoshi: "100" });
    const { user } = renderWithProviders(<SendComposeModal fromBech32m={FROM} token={token} onClose={vi.fn()} />);
    await user.type(screen.getByLabelText("Recipient typed bech32m address"), TO);
    await user.type(screen.getByLabelText("Amount in USDC"), "1");
    expect(
      await screen.findByText("Not enough LYTH to cover the network fee for this token transfer."),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Review" })).toBeDisabled();
  });

  it("the guard tightens the token coverage block too (min(guard,balance) < reservation)", async () => {
    // Display balance is a healthy 5 LYTH, but a guard operator floors it below the reservation.
    guard.loadSpendGuardLythoshi.mockResolvedValue(100n);
    renderWithProviders(<SendComposeModal fromBech32m={FROM} token={token} onClose={vi.fn()} />);
    expect(
      await screen.findByText("Not enough LYTH to cover the network fee for this token transfer."),
    ).toBeInTheDocument();
  });

  it("token Max still fills the FULL token holding (fee is separate LYTH)", async () => {
    const { user } = renderWithProviders(<SendComposeModal fromBech32m={FROM} token={token} onClose={vi.fn()} />);
    const maxBtn = screen.getByRole("button", { name: "Max" });
    await waitFor(() => expect(maxBtn).toBeEnabled());
    await user.click(maxBtn);
    expect((screen.getByLabelText("Amount in USDC") as HTMLInputElement).value).toBe("2"); // 2000000 / 10^6
  });

  it("the drawer fee row keeps 'Network fee (max)' with the reservation and no 'resolved at submit'", async () => {
    const { user } = renderWithProviders(<SendComposeModal fromBech32m={FROM} token={token} onClose={vi.fn()} />);
    await user.type(screen.getByLabelText("Recipient typed bech32m address"), TO);
    await user.type(screen.getByLabelText("Amount in USDC"), "1.5");
    await user.click(screen.getByRole("button", { name: "Review" }));
    await waitFor(() => expect(cap.descriptor).toBeDefined());
    const d = cap.descriptor!;
    expect(d.diff.find((l) => l.k === "Network fee (max)")?.v).toBe("0.0005 LYTH");
    expect(d.diff.find((l) => l.k === "Total (amount + fee)")).toBeUndefined(); // no Total for tokens
    expect(JSON.stringify(d.diff)).not.toContain("resolved at submit");
  });
});
