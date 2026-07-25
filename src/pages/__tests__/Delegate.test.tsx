import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import { renderWithProviders } from "../../test/renderWithProviders";
import type { OperationDescriptor } from "../../operations/types";
import type { LiveDelegationStatus } from "../../sdk/live";

// Controllable active wallet (a hook, not a context — must be mocked).
const walletMock = vi.hoisted(() => ({ value: undefined as unknown }));
vi.mock("../../sdk/active-wallet", () => ({ useActiveWallet: () => walletMock.value }));

// Capture the descriptor the page opens.
const cap = vi.hoisted(() => ({ descriptor: undefined as OperationDescriptor | undefined }));
vi.mock("../../operations/context", () => ({
  OperationsProvider: ({ children }: { children: ReactNode }) => children,
  useOperations: () => ({ open: (d: OperationDescriptor) => { cap.descriptor = d; }, close: () => {} }),
}));

// Chain reads (keep capture + pure helpers real via importOriginal).
const live = vi.hoisted(() => ({
  loadLiveDelegationStatus: vi.fn(),
  loadNativeBalanceLythoshi: vi.fn(),
  empty: vi.fn(),
}));
vi.mock("../../sdk/live", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../sdk/live")>()),
  loadLiveDelegationStatus: live.loadLiveDelegationStatus,
  loadNativeBalanceLythoshi: live.loadNativeBalanceLythoshi,
  loadLiveClusterAprBpsMap: live.empty,
  loadLiveClusterDelegatorCount: live.empty,
  loadLiveClusterEntities: live.empty,
  loadLiveClusterNames: live.empty,
  loadLiveClusterStatus: live.empty,
}));
// Directory / rewards / submit stubbed; buildDelegateCalldata stays REAL.
const del = vi.hoisted(() => ({
  fetchClusterDirectory: vi.fn(),
  fetchPendingRewards: vi.fn(),
  fetchRedemptionQueue: vi.fn(),
  submitDelegationTx: vi.fn(),
}));
vi.mock("../../sdk/delegation", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../sdk/delegation")>()),
  fetchClusterDirectory: del.fetchClusterDirectory,
  fetchPendingRewards: del.fetchPendingRewards,
  fetchRedemptionQueue: del.fetchRedemptionQueue,
  submitDelegationTx: del.submitDelegationTx,
}));
// The cap guard — mock the VERDICT so the test proves the UI runs it + respects
// it (wiring). Its math is unit-tested separately.
const caps = vi.hoisted(() => ({ preflightDelegationVerdict: vi.fn() }));
vi.mock("../../sdk/delegation-caps", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../sdk/delegation-caps")>()),
  preflightDelegationVerdict: caps.preflightDelegationVerdict,
}));
vi.mock("../../sdk/autovote", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../sdk/autovote")>()),
  fetchClusterDiversities: vi.fn(() => Promise.resolve([])),
  submitAutovotePlan: vi.fn(),
}));

import { buildDelegateCalldata } from "../../sdk/delegation";
import { Delegate } from "../Delegate";

const READY = { status: "ready", slot: "s1", name: "W", addressHex: "0x00dead", address: "mono1delegatetest" };
const NONE = { status: "none", slot: null, name: null, addressHex: null, address: null };
const CLUSTER = 5;

function statusWithRow(weightBps: number): LiveDelegationStatus {
  const okEmpty = { ok: true, value: [] };
  return {
    endpoint: "test",
    clusters: okEmpty,
    activeClusters: okEmpty,
    healthyClusters: okEmpty,
    delegationCap: { ok: true, value: { capBps: 5000 } },
    delegations: {
      ok: true,
      value: { wallet: READY.address, rows: [{ cluster: CLUSTER, weightBps }], totalBps: weightBps, block: 0 },
    },
    delegationHistory: { ok: true, value: [] },
  } as unknown as LiveDelegationStatus;
}

beforeEach(() => {
  vi.clearAllMocks();
  cap.descriptor = undefined;
  walletMock.value = READY;
  live.loadLiveDelegationStatus.mockResolvedValue(statusWithRow(3000)); // 30% already
  // loadNativeBalanceLythoshi is wrapped in capture() → return the RAW lythoshi.
  //
  // 1000 LYTH, not 1: these tests are about the CAP pre-flight and the weight →
  // calldata encoding, and at a 1 LYTH balance every weight below 100% credits
  // zero whole LYTH and is refused as inert before the cap check is ever
  // reached. The balance has to be large enough that the fixture exercises its
  // actual subject. The inert guard itself is covered separately, below and in
  // sdk/__tests__/delegation-inert.test.ts.
  live.loadNativeBalanceLythoshi.mockResolvedValue("1000000000000000000000");
  live.empty.mockResolvedValue(new Map());
  del.fetchClusterDirectory.mockResolvedValue(null);
  del.fetchPendingRewards.mockRejectedValue(new Error("n/a")); // capture → { ok: false }
  del.fetchRedemptionQueue.mockRejectedValue(new Error("n/a"));
  del.submitDelegationTx.mockResolvedValue({ txHash: "0xabc", nonce: 1 });
  caps.preflightDelegationVerdict.mockReturnValue({ ok: true });
});

describe("Delegate — wallet gating", () => {
  it("prompts to select/unlock when there is no active wallet", () => {
    walletMock.value = NONE;
    renderWithProviders(<Delegate />);
    expect(screen.getByText(/select or unlock a wallet/i)).toBeInTheDocument();
  });

  it("renders the page and loads delegation status for a ready wallet", async () => {
    renderWithProviders(<Delegate />);
    expect(await screen.findByText("Active delegations")).toBeInTheDocument();
    expect(live.loadLiveDelegationStatus).toHaveBeenCalledWith(READY.address);
    // the existing delegation row renders (its add-more "Delegate" button exists)
    // — proves no entries.map-style render crash on the row list.
    expect(await screen.findByRole("button", { name: "Delegate" })).toBeInTheDocument();
  });
});

describe("Delegate — add-more cap preflight + weight→calldata", () => {
  async function openAddMoreForm() {
    const { user } = renderWithProviders(<Delegate />);
    await screen.findByText("Active delegations"); // row list loaded
    await user.click(screen.getByRole("button", { name: "Delegate" })); // opens the add-more form
    // The label now leads with the unit that is actually typed.
    await screen.findByText(/additional weight in basis points/i); // form is open
    // the bps input defaults to "1000"; pick it among any number inputs.
    const input =
      screen.getAllByRole("spinbutton").find((el) => (el as HTMLInputElement).value === "1000") ??
      screen.getAllByRole("spinbutton")[0];
    return { user, input: input as HTMLElement };
  }

  it("BLOCKS an add-more the preflight refuses, before signing", async () => {
    // 1000 on top of the fixture's 3000 stays inside the 5000 cap, so the form
    // gate passes and the click reaches the handler — which is what this test is
    // about. The gate's own behaviour is covered separately below.
    caps.preflightDelegationVerdict.mockReturnValue({ ok: false, message: "would exceed the delegation cap" });
    const { user, input } = await openAddMoreForm();
    await user.clear(input);
    await user.type(input, "1000");
    await user.click(screen.getByRole("button", { name: "Review" }));

    expect(caps.preflightDelegationVerdict).toHaveBeenCalled();
    expect(screen.getByText(/would exceed the delegation cap/i)).toBeInTheDocument();
    expect(cap.descriptor).toBeUndefined(); // no operation opened
  });

  it("disables the action on a definite cap breach, and says what to do", async () => {
    // 3000 on top of the fixture's 3000 exceeds the 5000 cap. The user learns
    // this from the control itself rather than from a post-click error.
    caps.preflightDelegationVerdict.mockReturnValue({ ok: true });
    const { user, input } = await openAddMoreForm();
    await user.clear(input);
    await user.type(input, "3000");

    const action = screen.getByRole("button", { name: "Reduce to the cap" });
    expect(action).toBeDisabled();
    await user.click(action);
    expect(caps.preflightDelegationVerdict).not.toHaveBeenCalled();
    expect(cap.descriptor).toBeUndefined();
  });

  it("shows a weight that would credit nothing, and disables the action", async () => {
    // At a 2 LYTH balance a 4999 bps weight credits 0.9998 LYTH, which the chain
    // floors to zero — accepted, earning nothing, costing a fee. The echo says so
    // while it is typed and the control refuses to be pressed, so this never
    // reaches the pre-flight. (The handler's own inert guard remains pinned in
    // sdk/__tests__/delegation-inert.test.ts.)
    live.loadNativeBalanceLythoshi.mockResolvedValue("2000000000000000000");
    caps.preflightDelegationVerdict.mockReturnValue({ ok: true });
    const { user, input } = await openAddMoreForm();
    await user.clear(input);
    await user.type(input, "4999");

    expect(screen.getByText(/credits 0 LYTH/i)).toBeInTheDocument();
    const action = screen.getByRole("button", { name: "Too small to credit" });
    expect(action).toBeDisabled();
    await user.click(action);
    expect(caps.preflightDelegationVerdict).not.toHaveBeenCalled();
    expect(cap.descriptor).toBeUndefined(); // nothing opened, nothing signed
  });

  it("encodes exactly the shown weight when the preflight passes (shown bps == calldata)", async () => {
    caps.preflightDelegationVerdict.mockReturnValue({ ok: true });
    const { user, input } = await openAddMoreForm();
    await user.clear(input);
    await user.type(input, "1500"); // +15%
    await user.click(screen.getByRole("button", { name: "Review" }));

    await waitFor(() => expect(cap.descriptor).toBeDefined());
    const d = cap.descriptor!;
    // shown weight
    expect(d.diff.find((l) => l.k === "Weight")?.v).toBe("15.00% of balance");
    // signed: the calldata encodes cluster 5 at 1500 bps — exactly what was shown
    await d.execute({ vaultSeed: new Uint8Array(32) });
    expect(del.submitDelegationTx).toHaveBeenCalledWith(
      expect.objectContaining({ data: buildDelegateCalldata({ clusterId: CLUSTER, weightBps: 1500 }) }),
    );
  });
});
