// The ceremony half of chain 6: what is on screen at the moment the key is
// released.
//
// The preimage map measured that at stage `auth` — where the password is typed
// and the seed is handed to `execute` — EVERY transaction fact was off-screen.
// The pane rendered a banner and a password field. The facts existed and were
// frozen (the provider holds the descriptor in `useState`, and `setActive` is
// called only by `open`/`close`), so this was never a substitution window; it
// was a user reading on one screen and committing on another.
//
// WHAT THIS FILE DOES NOT CLAIM. The nonce (all 20 surfaces) and the fee (18 of
// 20) are resolved INSIDE `execute`, after the password. They are not off-screen
// at `auth`; they do not yet exist. Carrying facts forward cannot reach them,
// and nothing here pretends otherwise.
//
// Driven through the drawer's own preview → auth transition, never by rendering
// `AuthPane` directly: the property is "a user who clicks Continue sees this",
// and a component rendered out of its flow cannot establish that.

import { beforeEach, describe, expect, it, vi } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithProviders } from "../../test/renderWithProviders";
import type { OperationDescriptor, OperationResult } from "../types";

const kc = vi.hoisted(() => ({
  fetchAndUnlockVault: vi.fn(),
  getActiveAccount: vi.fn(() => "slot-1"),
}));
vi.mock("../../sdk/keychain", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../sdk/keychain")>()),
  fetchAndUnlockVault: kc.fetchAndUnlockVault,
  getActiveAccount: kc.getActiveAccount,
}));

vi.mock("../../sdk/unlock-lockout", () => ({
  readLockoutState: vi.fn(() => ({ failCount: 0, lockoutUntil: 0 })),
  recordWrongUnlockAttempt: vi.fn(() => ({ failCount: 1, lockoutUntil: 0 })),
  clearUnlockLockout: vi.fn(),
  lockoutRemainingMs: vi.fn((until: number, now: number) => Math.max(0, until - now)),
}));

import { OperationsDrawer } from "../OperationsDrawer";

const RECIPIENT = "atlas.mono · mono1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq";

function op(overrides: Partial<OperationDescriptor> = {}): OperationDescriptor {
  return {
    title: "Send 1 LYTH",
    commitment: { subject: RECIPIENT, amount: "1 LYTH" },
    diff: [
      { k: "To", v: RECIPIENT },
      { k: "Amount", v: "1 LYTH" },
    ],
    effects: [],
    auth: "keychain",
    execute: async (): Promise<OperationResult> => ({ headline: "Broadcast" }),
    ...overrides,
  };
}

/** Click through preview → auth the way a user does. */
async function reachAuth(descriptor: OperationDescriptor) {
  const user = userEvent.setup();
  renderWithProviders(<OperationsDrawer descriptor={descriptor} onClose={() => {}} />);
  await user.click(screen.getByRole("button", { name: "Continue" }));
  // The stage really is `auth` — asserted BEFORE anything about the commitment,
  // so a failure to advance is distinguishable from a missing summary.
  await waitFor(() => expect(screen.getByLabelText("Password")).toBeInTheDocument());
  return user;
}

beforeEach(() => {
  vi.clearAllMocks();
  kc.fetchAndUnlockVault.mockResolvedValue(new Uint8Array(32));
});

describe("the auth pane states who is paid and how much", () => {
  it("renders the payee and the amount where the password is typed", async () => {
    await reachAuth(op());
    const panel = screen.getByTestId("auth-commitment");
    expect(panel).toHaveTextContent(RECIPIENT);
    expect(panel).toHaveTextContent("1 LYTH");
  });

  it("says so in words when no funds leave the wallet", async () => {
    // Every delegation, policy and CLOB surface signs value = 0. An empty slot
    // would read as "unknown"; the sentence is the fact.
    await reachAuth(op({ commitment: { subject: "Cluster Atlas", amount: null } }));
    const panel = screen.getByTestId("auth-commitment");
    expect(panel).toHaveTextContent("No funds leave this wallet");
    expect(panel).toHaveTextContent("Cluster Atlas");
  });

  it("the commitment and the diff are ONE fact, not two copies", async () => {
    // The trap this design creates if the commitment is authored beside the
    // To/Amount rows instead of being their source: two statements of who is
    // paid, on two screens, free to drift. A wallet showing a user two answers
    // is worse than one showing a single answer once.
    const d = op();
    const user = userEvent.setup();
    renderWithProviders(<OperationsDrawer descriptor={d} onClose={() => {}} />);

    const previewTo = screen.getByText(RECIPIENT);
    expect(previewTo).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Continue" }));
    await waitFor(() => expect(screen.getByLabelText("Password")).toBeInTheDocument());

    const panel = screen.getByTestId("auth-commitment");
    expect(panel).toHaveTextContent(d.commitment.subject);
    expect(d.diff.find((r) => r.k === "To")?.v).toBe(d.commitment.subject);
    expect(d.diff.find((r) => r.k === "Amount")?.v).toBe(d.commitment.amount);
  });

  it("survives a wrong password — the facts do not vanish on the retry", async () => {
    // The auth pane is re-rendered with an error banner after a refusal. A user
    // retyping their password must still be looking at the transaction.
    const { VaultCallError } = await import("../../sdk/vault");
    kc.fetchAndUnlockVault.mockRejectedValueOnce(
      new VaultCallError({ code: "wrong_password" }),
    );
    const user = await reachAuth(op());
    await user.type(screen.getByLabelText("Password"), "wrong");
    await user.click(screen.getByRole("button", { name: "Authorize" }));
    await waitFor(() => expect(screen.getByText("Wrong password")).toBeInTheDocument());
    expect(screen.getByTestId("auth-commitment")).toHaveTextContent(RECIPIENT);
  });

  it("survives Back → Continue — a re-entered auth stage still carries them", async () => {
    const user = await reachAuth(op());
    await user.click(screen.getByRole("button", { name: "Back" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Continue" })).toBeInTheDocument());
    await user.click(screen.getByRole("button", { name: "Continue" }));
    await waitFor(() => expect(screen.getByTestId("auth-commitment")).toHaveTextContent(RECIPIENT));
  });

  it("is NOT on the preview stage — the diff owns that screen", async () => {
    // Anti-vacuity in the other direction: if the panel rendered at every stage
    // the assertions above would hold without the auth wiring existing at all.
    renderWithProviders(<OperationsDrawer descriptor={op()} onClose={() => {}} />);
    expect(screen.queryByTestId("auth-commitment")).toBeNull();
    expect(screen.getByText(RECIPIENT)).toBeInTheDocument();
  });
});
