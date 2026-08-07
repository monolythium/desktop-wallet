// The MRC-20 confirm row shows the fee the token path actually signs (SA-03-001).
//
// THE PROPERTY: the value rendered in the token review's "Network fee (max)" row
// is the ceiling the signed fee permits — `maxFeePerGas × gasLimit` of the fee
// handed to `sendMrc20Token`. Shown max == signed max.
//
// WHY IT NEEDED A GUARD. The token call site used to pass no `resolvedFee`, so
// `submit.ts` fell through to the live resolver: the row rendered
// `reservationLythoshi` from the compose preview's quote while the signature
// carried a fee derived by a DIFFERENT formula from a SECOND, later read of a
// quote that alternates between `mempool_floor` and `latest_block`. Two formulas
// over two samples. The measured gap on a pinned quote was 3.00× at the normal
// tier and 2.00× at fast — always understating, the direction that costs the user.
// The sibling "shown == signed" file asserts Amount/Token/To for this same path
// and never looked at the fee, which is how the divergence survived.
//
// ANTI-VACUITY. Every assertion below is paired with one that fails if its
// subject disappears: the fee row must be found before its value is judged, the
// seam must be shown to have been called before its argument is read, and the
// fee must be present and non-zero before the equality is asserted — so a
// removed row, an unexecuted descriptor or an absent `resolvedFee` turns this
// RED rather than silently green.

import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import { addressToTypedBech32, formatLyth } from "@monolythium/core-sdk";
import type { ResolvedExecutionFee } from "@monolythium/core-sdk";
import { renderWithProviders, TEST_WALLET_ADDRESS } from "../../test/renderWithProviders";
import { computeNativeFeeQuote, NATIVE_TRANSFER_EXECUTION_UNIT_LIMIT } from "../../sdk/fee-model";
import { TOKEN_TRANSFER_EXECUTION_UNIT_LIMIT } from "../../sdk/token-send";
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
// The submit seam is mocked, so nothing here can reach the network.
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
const TO = addressToTypedBech32("user", "0x000000000000000000000000000000000000dead");
const RESOLVED = addressToTypedBech32("user", "0x000000000000000000000000000000000000cafe");

/** The pinned quote. Fixed values, so the arithmetic below is deterministic. */
const BASE = 1_000_000_000n;
const TIP = 1_000_000_000n;

const FEE_ROW = "Network fee (max)";

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
    const limit = opts?.tokenTransfer ? TOKEN_TRANSFER_EXECUTION_UNIT_LIMIT : NATIVE_TRANSFER_EXECUTION_UNIT_LIMIT;
    return Promise.resolve({
      quote: { baseLythoshi: BASE, suggestedTipLythoshi: TIP, source: "latest_block" },
      perTier: {
        normal: computeNativeFeeQuote({ baseLythoshi: BASE, suggestedTipLythoshi: TIP, tier: "normal", executionUnitLimit: limit }),
        fast: computeNativeFeeQuote({ baseLythoshi: BASE, suggestedTipLythoshi: TIP, tier: "fast", executionUnitLimit: limit }),
      },
    });
  });
  send.sendMrc20Token.mockResolvedValue({
    txHash: "0xdef", from: FROM, tokenId: TOKEN_ID, amountBase: "0", amountDisplay: "0", nonce: 1,
  });
  nameResolve.resolveNameQuorum.mockResolvedValue({ ok: true, address: RESOLVED });
});

/** Drive the token compose to Review and run the descriptor's execute(). */
async function reviewAndExecuteToken() {
  const { user } = renderWithProviders(
    <SendComposeModal fromBech32m={FROM} token={TOKEN} onClose={vi.fn()} />,
  );
  await user.type(screen.getByLabelText("Recipient typed bech32m address"), TO);
  await user.type(screen.getByLabelText("Amount in USDC"), "1.5");
  await user.click(screen.getByRole("button", { name: "Review" }));
  await waitFor(() => expect(cap.descriptor).toBeDefined());
  const d = cap.descriptor!;
  await d.execute({ vaultSeed: new Uint8Array(32) });
  return d;
}

/** The fee the seam was actually handed. Asserts the seam ran first, so this
 *  cannot read `undefined` from a call that never happened. */
function signedFee(): ResolvedExecutionFee {
  expect(send.sendMrc20Token, "sendMrc20Token was never called — the descriptor did not execute").
    toHaveBeenCalledTimes(1);
  const args = send.sendMrc20Token.mock.calls[0]![0] as { resolvedFee?: ResolvedExecutionFee };
  expect(
    args.resolvedFee,
    "the token call site passed no `resolvedFee`, so the signature is re-derived from a second " +
      "quote read and the shown maximum is not the signed maximum (SA-03-001)",
  ).toBeDefined();
  return args.resolvedFee!;
}

describe("MRC-20 review — the shown maximum is the signed maximum (SA-03-001)", () => {
  it("the fee row equals maxFeePerGas × gasLimit of the fee that is signed", async () => {
    const d = await reviewAndExecuteToken();

    // Anti-vacuity: the row must exist before its value means anything.
    const row = d.diff.find((l) => l.k === FEE_ROW);
    expect(row, `no "${FEE_ROW}" row in the token review descriptor`).toBeDefined();

    const f = signedFee();
    const signedCeiling = f.maxFeePerGas * f.gasLimit;
    // Anti-vacuity: a zero ceiling would make the equality trivially satisfiable.
    expect(signedCeiling).toBeGreaterThan(0n);

    expect(row!.v).toBe(`${formatLyth(signedCeiling.toString(), { includeUnit: false })} LYTH`);
  });

  it("signs the gas limit the preview was quoted at, so only the price fields move", async () => {
    await reviewAndExecuteToken();
    // The preview quotes the token bundle at TOKEN_TRANSFER_EXECUTION_UNIT_LIMIT
    // and `submit.ts` lets a supplied fee's gasLimit win, so supplying the quote
    // must NOT move the signed limit.
    expect(signedFee().gasLimit).toBe(TOKEN_TRANSFER_EXECUTION_UNIT_LIMIT);
  });

  it("signs the previewed quote itself, not a re-derived one", async () => {
    await reviewAndExecuteToken();
    const expected = computeNativeFeeQuote({
      baseLythoshi: BASE,
      suggestedTipLythoshi: TIP,
      tier: "normal",
      executionUnitLimit: TOKEN_TRANSFER_EXECUTION_UNIT_LIMIT,
    }).signedFee;
    expect(signedFee()).toEqual(expected);
  });

  it("the native path is untouched by this change", async () => {
    // The sibling path already passed its quote; this pins that the token fix did
    // not disturb it, and that a token send never fires a native send.
    await reviewAndExecuteToken();
    expect(send.sendNativeLyth).not.toHaveBeenCalled();
  });
});
