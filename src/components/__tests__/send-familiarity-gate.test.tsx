// SA-07-003 + SA-08-004 — what is allowed to make a recipient look familiar.
//
// The first-time-recipient warning is the wallet's last defence against paying
// the wrong party, and it could be switched off by a file write through three
// independent inputs that were OR'd together:
//
//   1. the address book — a contact short-circuited familiarity to "known"
//      before any evidence was read, AND separately headed a render chain in
//      which the green box outranked the amber warning. TWO mechanisms from one
//      value, which is why the fix has to sit at the value, not at a consumer.
//   2. the confirmed-activity cache — one planted row `{direction:"out",
//      counterparty:<attacker>}` satisfied `hasPriorConfirmedSend`.
//   3. pending-tx — a planted row satisfied `hasPendingSend`.
//
// These are driven through the compose surface a user actually types into.
// Nothing here calls `classifyRecipient`: the short-circuit bypassed that
// function entirely, so a test that called it could never have seen mechanism 1.

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import { screen, waitFor } from "@testing-library/react";
import { renderWithProviders } from "../../test/renderWithProviders";
import type { OperationDescriptor } from "../../operations/types";

const FROM = "mono1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq";
/** The address the attacker wants paid. */
const TO = "mono1zg69v7yszg69v7yszg69v7yszg69v7ysqcld0s";

vi.mock("../../operations/context", () => ({
  OperationsProvider: ({ children }: { children: ReactNode }) => children,
  useOperations: () => ({ open: (_d: OperationDescriptor) => {}, close: () => {} }),
}));

const live = vi.hoisted(() => ({
  loadLiveWalletBalance: vi.fn(),
  loadLiveAddressActivity: vi.fn(),
}));
vi.mock("../../sdk/live", async (orig) => ({
  ...(await orig<typeof import("../../sdk/live")>()),
  loadLiveWalletBalance: live.loadLiveWalletBalance,
  loadLiveAddressActivity: live.loadLiveAddressActivity,
}));
const addressbook = vi.hoisted(() => ({ addressbookLookup: vi.fn() }));
vi.mock("../../sdk/addressbook", () => ({ addressbookLookup: addressbook.addressbookLookup }));
const pending = vi.hoisted(() => ({ pendingTxsSnapshot: vi.fn(() => [] as unknown[]) }));
vi.mock("../../sdk/pending-tx-store", async (orig) => ({
  ...(await orig<typeof import("../../sdk/pending-tx-store")>()),
  pendingTxsSnapshot: pending.pendingTxsSnapshot,
}));
const sentLog = vi.hoisted(() => ({
  isSentRecipientVerified: vi.fn(),
  recordSentRecipient: vi.fn(),
}));
vi.mock("../../sdk/sent-recipients-store", () => ({
  isSentRecipientVerified: sentLog.isSentRecipientVerified,
  recordSentRecipient: sentLog.recordSentRecipient,
}));
/** The planted store. If the compose surface reads it as evidence, the guard
 *  below fails — which is the point. */
const activityCache = vi.hoisted(() => ({ readConfirmedCache: vi.fn() }));
vi.mock("../../sdk/activity-cache-store", async (orig) => ({
  ...(await orig<typeof import("../../sdk/activity-cache-store")>()),
  readConfirmedCache: activityCache.readConfirmedCache,
}));
const fee = vi.hoisted(() => ({ previewNativeSendFee: vi.fn() }));
vi.mock("../../sdk/fee-preview", async (orig) => ({
  ...(await orig<typeof import("../../sdk/fee-preview")>()),
  previewNativeSendFee: fee.previewNativeSendFee,
}));
vi.mock("../../sdk/spend-guard", () => ({ loadSpendGuardLythoshi: vi.fn(async () => null) }));
const nameResolve = vi.hoisted(() => ({ resolveNameQuorum: vi.fn() }));
vi.mock("../../sdk/name-resolve", async (orig) => ({
  ...(await orig<typeof import("../../sdk/name-resolve")>()),
  resolveNameQuorum: nameResolve.resolveNameQuorum,
}));
vi.mock("../../sdk/reverse-name", async (orig) => ({
  ...(await orig<typeof import("../../sdk/reverse-name")>()),
  loadReverseName: vi.fn(async () => null),
}));

import { SendComposeModal } from "../SendComposeModal";

beforeEach(() => {
  vi.clearAllMocks();
  live.loadLiveWalletBalance.mockResolvedValue({
    balanceLyth: "100",
    balanceLythoshi: "100000000000000000000",
  });
  // Readable and empty: the chain says this recipient has never been paid.
  live.loadLiveAddressActivity.mockResolvedValue({ ok: true, value: [] });
  addressbook.addressbookLookup.mockResolvedValue([]);
  pending.pendingTxsSnapshot.mockReturnValue([]);
  sentLog.isSentRecipientVerified.mockResolvedValue(false);
  activityCache.readConfirmedCache.mockResolvedValue(null);
  fee.previewNativeSendFee.mockResolvedValue(null);
  nameResolve.resolveNameQuorum.mockResolvedValue({ ok: false });
});

async function typeRecipient() {
  const r = renderWithProviders(<SendComposeModal fromBech32m={FROM} onClose={vi.fn()} />);
  await r.user.type(screen.getByLabelText("Recipient typed bech32m address"), TO);
  return r;
}

/** The amber warning — the thing all three planted stores existed to remove. */
function warningVisible(): boolean {
  return screen.queryByText(/First-time recipient\./) !== null;
}

describe("store 1 — the address book", () => {
  it("a planted contact does not suppress the warning (mechanism 1: the short-circuit)", async () => {
    addressbook.addressbookLookup.mockResolvedValue([{ name: "Alice", address: TO }]);
    await typeRecipient();
    // The short-circuit used to set "known" and return before any read. If it
    // still did, the warning would never appear no matter what the chain said.
    await waitFor(() => expect(warningVisible()).toBe(true));
  });

  it("a planted contact does not head the render chain (mechanism 2: green beats amber)", async () => {
    addressbook.addressbookLookup.mockResolvedValue([{ name: "Alice", address: TO }]);
    await typeRecipient();
    await waitFor(() => expect(warningVisible()).toBe(true));
    // Covering only mechanism 1 would leave this box rendered, and the amber
    // branch is mutually exclusive with it — so the warning would still be gone.
    expect(screen.queryByTestId("send-known-contact")).toBeNull();
  });

  it("the contact name is still available once the evidence earns it", async () => {
    // Anti-vacuity, and the feature that must survive: the gate removes the
    // contact's AUTHORITY, not the contact.
    live.loadLiveAddressActivity.mockResolvedValue({
      ok: true,
      value: [{ counterparty: TO, direction: "out" }],
    });
    addressbook.addressbookLookup.mockResolvedValue([{ name: "Alice", address: TO }]);
    await typeRecipient();
    await waitFor(() => expect(screen.queryByTestId("send-known-contact")).not.toBeNull());
    expect(screen.getByText("Alice")).toBeInTheDocument();
    expect(warningVisible()).toBe(false);
  });
});

describe("store 2 — the confirmed-activity cache", () => {
  it("a planted cached row does not suppress the warning", async () => {
    // The exact plant the finding describes: one outgoing row naming the
    // attacker's address, in a plaintext file.
    activityCache.readConfirmedCache.mockResolvedValue({
      rows: [{ counterparty: TO, direction: "out" }],
    });
    await typeRecipient();
    await waitFor(() => expect(warningVisible()).toBe(true));
  });

  it("the same row from the CHAIN does suppress it", async () => {
    // The control that keeps the case above honest: the difference is
    // provenance, not shape. Identical row, different source.
    live.loadLiveAddressActivity.mockResolvedValue({
      ok: true,
      value: [{ counterparty: TO, direction: "out" }],
    });
    // A contact is added ONLY so the settled "known" state has a visible marker
    // to anchor on — the green box needs a name to render. It is not what makes
    // the recipient known; the case above proves that with the same contact.
    addressbook.addressbookLookup.mockResolvedValue([{ name: "Alice", address: TO }]);
    await typeRecipient();
    // Anchored on the SETTLED box, never on a mock call: the classifier writes
    // familiarity AFTER the reads resolve, so a call-count anchor is already
    // true while the state is still "unknown" — during which the warning is
    // also absent, for entirely the wrong reason.
    await waitFor(() => expect(screen.queryByTestId("send-known-contact")).not.toBeNull());
    expect(warningVisible()).toBe(false);
  });
});

describe("store 3 — pending-tx", () => {
  it("REPORTED, NOT FIXED: a planted pending row still suppresses the warning", async () => {
    // Recorded as a passing test stating the CURRENT behaviour, so the residue
    // is visible in the suite rather than only in a report. When this input is
    // bound or dropped, this test flips to the assertion above it and the
    // change is deliberate rather than accidental.
    pending.pendingTxsSnapshot.mockReturnValue([
      { counterparty: TO, addressLower: FROM.toLowerCase() },
    ]);
    addressbook.addressbookLookup.mockResolvedValue([{ name: "Alice", address: TO }]);
    await typeRecipient();
    // Settled-state anchor. When this residue is closed the box stops appearing
    // and this fails LOUDLY, which is the point of recording it as a test at all.
    await waitFor(() => expect(screen.queryByTestId("send-known-contact")).not.toBeNull());
    expect(warningVisible()).toBe(false);
  });
});

describe("the fail direction", () => {
  it("an unreadable history does not claim first-time, and does not claim known", async () => {
    live.loadLiveAddressActivity.mockResolvedValue({ ok: false, error: "offline" });
    addressbook.addressbookLookup.mockResolvedValue([{ name: "Alice", address: TO }]);
    await typeRecipient();
    // Neither a fabricated "first-time" nor a contact-borrowed "known".
    await waitFor(() =>
      expect(screen.queryByText(/Double-check the recipient address/)).not.toBeNull(),
    );
    expect(warningVisible()).toBe(false);
    expect(screen.queryByTestId("send-known-contact")).toBeNull();
  });

  it("the HMAC-bound sent log still suppresses — it is the one authenticated input", async () => {
    sentLog.isSentRecipientVerified.mockResolvedValue(true);
    addressbook.addressbookLookup.mockResolvedValue([{ name: "Alice", address: TO }]);
    await typeRecipient();
    await waitFor(() => expect(screen.queryByTestId("send-known-contact")).not.toBeNull());
    expect(warningVisible()).toBe(false);
  });
});
