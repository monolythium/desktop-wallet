// Send compose fiat slots (Phase 07 slots 2–4).
//
// The load-bearing properties:
//   • ADDITIVE ONLY — no canonical LYTH string gains a byte, and no fiat string
//     reaches the ADR-0039 fee-conformance inputs or a fee row's value node.
//   • TOKEN AMOUNTS GET NOTHING — not even the empty form. Only the
//     LYTH-denominated figures (including the token path's LYTH fee) qualify.
//   • AMOUNT-ABSENT ≠ RATE-ABSENT — a slot whose amount is unknown renders no
//     fiat at all, rather than a symbol paired with a dash.

import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, screen, waitFor } from "@testing-library/react";
import { addressToTypedBech32 } from "@monolythium/core-sdk";
import { renderWithProviders, TEST_WALLET_ADDRESS } from "../../test/renderWithProviders";
import { computeNativeFeeQuote, NATIVE_TRANSFER_EXECUTION_UNIT_LIMIT } from "../../sdk/fee-model";
import { PRIMARY_ACCOUNT, setActiveAccount } from "../../sdk/keychain";
import { saveDisplayCurrency } from "../../sdk/display-prefs";
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
const sentLog = vi.hoisted(() => ({ isSentRecipientVerified: vi.fn(), recordSentRecipient: vi.fn() }));
vi.mock("../../sdk/sent-recipients-store", () => ({
  isSentRecipientVerified: sentLog.isSentRecipientVerified,
  recordSentRecipient: sentLog.recordSentRecipient,
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
const TOKEN_ID = "0x" + "cd".repeat(32);
const TOKEN = { tokenId: TOKEN_ID, symbol: "USDC", decimals: 6, balanceBaseUnits: "2000000" };
const RESOLVED = addressToTypedBech32("user", "0x000000000000000000000000000000000000cafe");

/** Every fiat symbol glyph the shipped currency set can produce. */
const FIAT_GLYPHS = /[$€£¥₹₩₺₫¢]/;

/** Walk every text node so we can prove no single node mixes the two. */
function textNodes(root: Element): string[] {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const out: string[] = [];
  let n = walker.nextNode();
  while (n !== null) {
    const t = n.textContent ?? "";
    if (t.trim() !== "") out.push(t);
    n = walker.nextNode();
  }
  return out;
}

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  cap.descriptor = undefined;
  live.loadLiveWalletBalance.mockResolvedValue({ balanceLyth: "5", balanceLythoshi: "5000000000000000000" });
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
      quote: { baseLythoshi: 1_000_000_000n, suggestedTipLythoshi: 1_000_000_000n, source: "latest_block" },
      perTier: {
        normal: computeNativeFeeQuote(1_000_000_000n, 1_000_000_000n, "normal", limit),
        fast: computeNativeFeeQuote(1_000_000_000n, 1_000_000_000n, "fast", limit),
      },
    });
  });
  nameResolve.resolveNameQuorum.mockResolvedValue({ ok: true, address: RESOLVED });
});

describe("Send compose — the entered-amount hint (slot 2)", () => {
  it("appears for a valid native amount and carries no digit", async () => {
    const { user } = renderWithProviders(<SendComposeModal fromBech32m={FROM} onClose={vi.fn()} />);
    expect(screen.queryByTestId("fiat-amount")).toBeNull();

    await user.type(screen.getByLabelText("Amount in LYTH"), "2.5");
    const hint = await screen.findByTestId("fiat-amount");
    expect(hint.textContent).toBe("$—");
    expect(hint.textContent).not.toMatch(/[0-9]/);
  });

  it("disappears when the entry is cleared or invalid", async () => {
    const { user } = renderWithProviders(<SendComposeModal fromBech32m={FROM} onClose={vi.fn()} />);
    const input = screen.getByLabelText("Amount in LYTH");

    await user.type(input, "2.5");
    expect(await screen.findByTestId("fiat-amount")).toBeInTheDocument();

    await user.clear(input);
    await waitFor(() => expect(screen.queryByTestId("fiat-amount")).toBeNull());

    await user.type(input, "abc");
    expect(screen.queryByTestId("fiat-amount")).toBeNull();
  });

  it("is ABSENT on the token path (token amounts get no fiat at all)", async () => {
    const { user } = renderWithProviders(
      <SendComposeModal fromBech32m={FROM} token={TOKEN} onClose={vi.fn()} />,
    );
    await user.type(screen.getByLabelText("Amount in USDC"), "1.5");
    // Not "$—" — nothing. An empty slot would promise a token price that will
    // never exist behind this seam.
    expect(screen.queryByTestId("fiat-amount")).toBeNull();
  });
});

describe("Send compose — the Available sibling (slot 3)", () => {
  it("renders only once a real balance figure is shown", async () => {
    renderWithProviders(<SendComposeModal fromBech32m={FROM} onClose={vi.fn()} />);
    const sib = await screen.findByTestId("fiat-available");
    expect(sib.textContent).toBe("($—)");
  });

  it("is ABSENT while the balance is still loading (the '…' state)", async () => {
    live.loadLiveWalletBalance.mockReturnValue(new Promise(() => {})); // never settles
    renderWithProviders(<SendComposeModal fromBech32m={FROM} onClose={vi.fn()} />);
    expect(await screen.findByText("…")).toBeInTheDocument();
    expect(screen.queryByTestId("fiat-available")).toBeNull();
  });

  it("is ABSENT when the balance read failed (the '—' state)", async () => {
    live.loadLiveWalletBalance.mockRejectedValue(new Error("operator down"));
    renderWithProviders(<SendComposeModal fromBech32m={FROM} onClose={vi.fn()} />);
    await waitFor(() => expect(screen.queryByTestId("fiat-available")).toBeNull());
  });

  it("is ABSENT on the token path (that figure is token-denominated)", async () => {
    renderWithProviders(<SendComposeModal fromBech32m={FROM} token={TOKEN} onClose={vi.fn()} />);
    await screen.findByLabelText("Amount in USDC");
    expect(screen.queryByTestId("fiat-available")).toBeNull();
  });
});

describe("Send compose — the fee card siblings (slot 4)", () => {
  it("the native fee and Total rows both carry the sibling once resolved", async () => {
    const { user } = renderWithProviders(<SendComposeModal fromBech32m={FROM} onClose={vi.fn()} />);
    await user.type(screen.getByLabelText("Amount in LYTH"), "1");

    expect((await screen.findByTestId("fiat-fee")).textContent).toBe("($—)");
    expect((await screen.findByTestId("fiat-total")).textContent).toBe("($—)");
  });

  it("the Total sibling is ABSENT while no amount is entered", async () => {
    renderWithProviders(<SendComposeModal fromBech32m={FROM} onClose={vi.fn()} />);
    await screen.findByTestId("fiat-fee"); // the fee resolved…
    expect(screen.queryByTestId("fiat-total")).toBeNull(); // …but Total has no amount
  });

  it("no fee sibling while the fee is unresolved — the canonical text renders alone", async () => {
    fee.previewNativeSendFee.mockReturnValue(new Promise(() => {}));
    renderWithProviders(<SendComposeModal fromBech32m={FROM} onClose={vi.fn()} />);
    expect(await screen.findByText("Loading fee…")).toBeInTheDocument();
    expect(screen.queryByTestId("fiat-fee")).toBeNull();
  });

  it("no fee sibling when the fee errored — the canonical error renders alone", async () => {
    fee.previewNativeSendFee.mockRejectedValue(new Error("operator refused"));
    renderWithProviders(<SendComposeModal fromBech32m={FROM} onClose={vi.fn()} />);
    expect(await screen.findByText(/Could not fetch fee/)).toBeInTheDocument();
    expect(screen.queryByTestId("fiat-fee")).toBeNull();
  });

  it("token path: the LYTH fee row carries a sibling, 'Fee paid in' carries none", async () => {
    renderWithProviders(<SendComposeModal fromBech32m={FROM} token={TOKEN} onClose={vi.fn()} />);
    // "Network fee (max)" is LYTH-denominated, so it qualifies.
    expect((await screen.findByTestId("fiat-fee")).textContent).toBe("($—)");

    const paidIn = screen.getByText("Fee paid in").parentElement!;
    expect(paidIn.textContent).toContain("LYTH (not USDC)");
    expect(paidIn.textContent).not.toMatch(FIAT_GLYPHS);
    expect(paidIn.textContent).not.toContain("≈");
  });
});

describe("Send compose — canonical-node purity (the F1 collision guard)", () => {
  it("the fee row's canonical value node contains no fiat symbol and no ≈", async () => {
    const { user } = renderWithProviders(<SendComposeModal fromBech32m={FROM} onClose={vi.fn()} />);
    await user.type(screen.getByLabelText("Amount in LYTH"), "1");
    await screen.findByTestId("fiat-fee");

    // The canonical span is the fiat sibling's PREVIOUS sibling.
    const canonical = screen.getByTestId("fiat-fee").previousElementSibling!;
    expect(canonical.textContent).toMatch(/LYTH$/);
    expect(canonical.textContent).not.toMatch(FIAT_GLYPHS);
    expect(canonical.textContent).not.toContain("≈");
    expect(canonical.textContent).not.toContain("—");

    const totalCanonical = screen.getByTestId("fiat-total").previousElementSibling!;
    expect(totalCanonical.textContent).toMatch(/LYTH$/);
    expect(totalCanonical.textContent).not.toMatch(FIAT_GLYPHS);
    expect(totalCanonical.textContent).not.toContain("≈");
  });

  it("no single DOM text node contains both 'LYTH' and a fiat symbol", async () => {
    const { user, container } = renderWithProviders(
      <SendComposeModal fromBech32m={FROM} onClose={vi.fn()} />,
    );
    await user.type(screen.getByLabelText("Amount in LYTH"), "1");
    await screen.findByTestId("fiat-fee");

    const mixed = textNodes(container).filter((t) => t.includes("LYTH") && FIAT_GLYPHS.test(t));
    expect(mixed).toEqual([]);
  });

  it("the fee box carries exactly one LYTH-denominated fee string", async () => {
    // Phase 04's law: the fiat sibling must not read as a second fee figure.
    const { user } = renderWithProviders(<SendComposeModal fromBech32m={FROM} onClose={vi.fn()} />);
    await user.type(screen.getByLabelText("Amount in LYTH"), "1");
    const feeSibling = await screen.findByTestId("fiat-fee");
    const canonical = feeSibling.previousElementSibling!;
    expect((canonical.textContent!.match(/LYTH/g) ?? []).length).toBe(1);
    expect(feeSibling.textContent).not.toContain("LYTH");
  });
});

describe("Send compose — currency reactivity", () => {
  it("every mounted slot follows a currency change in-session", async () => {
    const { user } = renderWithProviders(<SendComposeModal fromBech32m={FROM} onClose={vi.fn()} />);
    await user.type(screen.getByLabelText("Amount in LYTH"), "1");
    await screen.findByTestId("fiat-fee");

    expect(screen.getByTestId("fiat-amount").textContent).toBe("$—");
    expect(screen.getByTestId("fiat-available").textContent).toBe("($—)");

    act(() => {
      saveDisplayCurrency("EUR");
    });

    expect(screen.getByTestId("fiat-amount").textContent).toBe("€—");
    expect(screen.getByTestId("fiat-available").textContent).toBe("(€—)");
    expect(screen.getByTestId("fiat-fee").textContent).toBe("(€—)");
    expect(screen.getByTestId("fiat-total").textContent).toBe("(€—)");
  });

  it("a code with no narrow glyph renders code-as-symbol, still digit-free", async () => {
    localStorage.setItem("wallet.displayCurrency", "KWD");
    const { user } = renderWithProviders(<SendComposeModal fromBech32m={FROM} onClose={vi.fn()} />);
    await user.type(screen.getByLabelText("Amount in LYTH"), "1");
    const hint = await screen.findByTestId("fiat-amount");
    expect(hint.textContent).toBe("KWD—");
    expect(hint.textContent).not.toMatch(/[0-9]/);
  });
});
