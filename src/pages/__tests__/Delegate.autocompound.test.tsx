// Auto-compound as its own section.
//
// The control is a real write with two effects — it persists the preference AND
// pays out every pending reward in the same transaction — and it used to sit
// inline in the Delegation card as a paragraph of prose competing with the
// primary flow.
//
// Moving it must not change what it does. What matters most here is the
// CONFIRM-TIME disclosure: the claim side effect is disclosed in the operations
// drawer (a `Claims now` diff row and a warn-level effect placed last, directly
// above the confirm action), and the drawer is a separate surface from this
// section. Collapsing the section therefore cannot hide it. These tests pin
// that, because it is the one property a layout change could quietly break.

import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithProviders } from "../../test/renderWithProviders";
import type { OperationDescriptor } from "../../operations/types";
import type { LiveDelegationStatus } from "../../sdk/live";

const walletMock = vi.hoisted(() => ({ value: undefined as unknown }));
vi.mock("../../sdk/active-wallet", () => ({ useActiveWallet: () => walletMock.value }));

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

const del = vi.hoisted(() => ({
  fetchClusterDirectory: vi.fn(),
  fetchPendingRewards: vi.fn(),
  fetchRedemptionQueue: vi.fn(),
}));
vi.mock("../../sdk/delegation", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../sdk/delegation")>()),
  fetchClusterDirectory: del.fetchClusterDirectory,
  fetchPendingRewards: del.fetchPendingRewards,
  fetchRedemptionQueue: del.fetchRedemptionQueue,
}));
vi.mock("../../sdk/autovote", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../sdk/autovote")>()),
  fetchClusterDiversities: vi.fn(() => Promise.resolve(new Map())),
}));

import { Delegate } from "../Delegate";
import {
  DELEGATION_EXECUTION_UNIT_LIMIT,
  DELEGATION_PRECOMPILE,
} from "../../sdk/delegation";

const READY = {
  status: "ready",
  slot: "s1",
  name: "W",
  addressHex: "0x00dead",
  address: "mono1delegatetest",
};
/** 7 LYTH in lythoshi, hex — a pending balance the enable path must disclose. */
const SEVEN_LYTH_HEX = "0x6124fee993bc0000";

function status(): LiveDelegationStatus {
  const okEmpty = { ok: true, value: [] };
  return {
    endpoint: "test",
    clusters: okEmpty,
    activeClusters: okEmpty,
    healthyClusters: okEmpty,
    delegationCap: { ok: true, value: { capBps: 5000 } },
    delegations: {
      ok: true,
      value: { wallet: READY.address, rows: [{ cluster: 2, weightBps: 3000 }], totalBps: 3000, block: 0 },
    },
    delegationHistory: { ok: true, value: [] },
  } as unknown as LiveDelegationStatus;
}

beforeEach(() => {
  vi.clearAllMocks();
  cap.descriptor = undefined;
  walletMock.value = READY;
  live.loadLiveDelegationStatus.mockResolvedValue(status());
  live.loadNativeBalanceLythoshi.mockResolvedValue("1000000000000000000000");
  live.empty.mockResolvedValue(new Map());
  del.fetchRedemptionQueue.mockRejectedValue(new Error("n/a"));
  del.fetchClusterDirectory.mockResolvedValue({
    page: 0,
    limit: 25,
    totalClusters: 0,
    clusters: [],
  });
  del.fetchPendingRewards.mockResolvedValue({
    wallet: READY.address,
    totalAmountLythoshi: SEVEN_LYTH_HEX,
    settledPendingLythoshi: "0x0",
    unsettledAmountLythoshi: SEVEN_LYTH_HEX,
    autoCompound: false,
    rows: [{ cluster: 2, weightBps: 3000, unsettledAmountLythoshi: SEVEN_LYTH_HEX }],
    block: 0,
  });
});

const SECTION = /auto-compound/i;

describe("Delegate — auto-compound has its own section", () => {
  it("is a collapsible section, collapsed by default, keeping its state visible", async () => {
    renderWithProviders(<Delegate />);

    const trigger = await screen.findByRole("button", { name: SECTION });
    // Collapsed: the shared section component's contract.
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    // "Collapsed is not gone" — the on/off state rides in the heading.
    expect(trigger).toHaveTextContent(/off/i);
  });

  it("hides the control until expanded, so the copy and the toggle stay together", async () => {
    const user = userEvent.setup();
    renderWithProviders(<Delegate />);

    const trigger = await screen.findByRole("button", { name: SECTION });
    // Collapsed content leaves the accessibility tree.
    expect(screen.queryByTestId("auto-compound-toggle")).not.toBeVisible();

    await user.click(trigger);
    expect(trigger).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByTestId("auto-compound-toggle")).toBeVisible();
    // The unexpected part of this setting, beside the control that causes it.
    expect(
      screen.getByText(/also claims your current pending rewards now/i),
    ).toBeInTheDocument();
  });

  it("still reaches the same confirm path, with the claim disclosed last", async () => {
    const user = userEvent.setup();
    renderWithProviders(<Delegate />);

    await user.click(await screen.findByRole("button", { name: SECTION }));
    await user.click(screen.getByTestId("auto-compound-toggle"));

    await waitFor(() => expect(cap.descriptor).toBeDefined());
    const d = cap.descriptor!;
    expect(d.title).toBe("Enable auto-compound");

    // The fund movement the user did not ask for by name, in the signed diff.
    expect(d.diff.find((l) => l.k === "Claims now")?.v).toContain("7 LYTH");

    // And LAST in the effects list — immediately above the confirm action.
    const last = d.effects[d.effects.length - 1]!;
    expect(last.level).toBe("warn");
    expect(last.text).toMatch(/claims your pending 7 LYTH now/i);
  });

  it("the signed target in the disclosure is DERIVED, not a typed literal", async () => {
    // Seven delegation diffs carried the string `"0x…100a"`. A literal cannot
    // disagree with what is signed, so it cannot detect a change to it — and a
    // guard that only checks the CONSTANT is a full address cannot detect a
    // contributor re-typing the literal into the row. So this reads what the
    // real page actually put in the descriptor, and compares it to the constant
    // `submitDelegationTx` passes as `to`.
    const user = userEvent.setup();
    renderWithProviders(<Delegate />);
    await user.click(await screen.findByRole("button", { name: SECTION }));
    await user.click(screen.getByTestId("auto-compound-toggle"));
    await waitFor(() => expect(cap.descriptor).toBeDefined());

    const rows = cap.descriptor!.details ?? [];
    // Anti-vacuity: an empty details array would satisfy an `every` check.
    expect(rows.length).toBeGreaterThan(0);
    const target = rows.find((r) => /precompile/i.test(r.k));
    expect(target, "the delegation disclosure must carry the signed target").toBeDefined();
    expect(target!.v).toBe(DELEGATION_PRECOMPILE);
    expect(target!.v).toMatch(/^0x[0-9a-fA-F]{40}$/);
  });

  it("declares a fee plan naming the limit the seam signs — the delegation block's row is real now", async () => {
    // Seven surfaces showed no fee figure at all, and the seventh showed the
    // words "applies (paid in LYTH)" with no number — a row that names a charge
    // and refuses to state it, which P03 recorded as reading worse than absence.
    //
    // Asserted on what the REAL page put in the descriptor, not on the module
    // constant: R9's `details-tier` guard checked a property of the constants
    // and stayed green when a literal was typed back into the row.
    const user = userEvent.setup();
    renderWithProviders(<Delegate />);
    await user.click(await screen.findByRole("button", { name: SECTION }));
    await user.click(screen.getByTestId("auto-compound-toggle"));
    await waitFor(() => expect(cap.descriptor).toBeDefined());

    const plan = cap.descriptor!.feePlan;
    expect(plan, "a delegation write must declare a fee plan").toBeDefined();
    expect(plan!.executionUnitLimit).toBe(DELEGATION_EXECUTION_UNIT_LIMIT);
    expect(plan!.feeClass).toBe("transfer");

    // The prose row is gone from the surface's own diff — the drawer owns the
    // fee row now, and it carries a figure.
    const feeRows = cap.descriptor!.diff.filter((r) => /fee/i.test(r.k));
    expect(feeRows).toHaveLength(0);
    // Anti-vacuity: the diff is not simply empty.
    expect(cap.descriptor!.diff.length).toBeGreaterThan(0);
  });

  it("discloses at confirm time even though the section can be collapsed", async () => {
    // The drawer is a separate surface from the section. Collapsing the section
    // must not be able to hide what a signer sees.
    const user = userEvent.setup();
    renderWithProviders(<Delegate />);

    const trigger = await screen.findByRole("button", { name: SECTION });
    await user.click(trigger); // expand
    await user.click(screen.getByTestId("auto-compound-toggle"));
    await waitFor(() => expect(cap.descriptor).toBeDefined());
    await user.click(trigger); // collapse again, descriptor already open

    const d = cap.descriptor!;
    expect(d.effects.some((e) => /claims your pending/i.test(e.text))).toBe(true);
    expect(d.diff.some((l) => l.k === "Claims now")).toBe(true);
  });
});
