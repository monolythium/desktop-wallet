// D2 — the number a user reads is the number their key commits to.
//
// The defect was never that a fee was wrong. It was that the displayed fee and
// the signed fee were two independent computations over two independent READS.
// R1 measured both halves at one site: a row understating the signed ceiling by
// 3x, and a node quote whose `source` moves between reads — a label the wallet
// records and never selects, so the node decides which price a given read gets.
//
// ⇒ THE ASSERTION THAT MAKES THIS PASS VERIFIABLE is not "the formula is right".
// It is: the LYTH figure rendered on screen equals `maxFeePerGas x gasLimit`
// read back out of the fee the seam was actually handed. Two reads of one
// correct function fail that; one object passed to both consumers cannot.
//
// R9's `details-tier` guard is the counter-example this file is written against:
// it asserted a property of the CONSTANTS rather than of the surfaces, so
// re-typing a literal into the row left it green. Everything here reads the
// value out of the object that owns it — the rendered DOM on one side, the
// mocked seam's recorded argument on the other.

import { beforeEach, describe, expect, it, vi } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithProviders } from "../../test/renderWithProviders";
import { formatLyth } from "@monolythium/core-sdk";
import type { OperationDescriptor, OperationResult } from "../types";

const kc = vi.hoisted(() => ({
  fetchAndUnlockVault: vi.fn(async () => new Uint8Array(32)),
  getActiveAccount: vi.fn(() => "slot-1"),
}));
vi.mock("../../sdk/keychain", async (orig) => ({
  ...(await orig<typeof import("../../sdk/keychain")>()),
  fetchAndUnlockVault: kc.fetchAndUnlockVault,
  getActiveAccount: kc.getActiveAccount,
}));
vi.mock("../../sdk/unlock-lockout", () => ({
  readLockoutState: vi.fn(() => ({ failCount: 0, lockoutUntil: 0 })),
  recordWrongUnlockAttempt: vi.fn(() => ({ failCount: 1, lockoutUntil: 0 })),
  clearUnlockLockout: vi.fn(),
  lockoutRemainingMs: vi.fn((until: number, now: number) => Math.max(0, until - now)),
}));

// The node. `calls` counts READS, which is the quantity this whole pass is
// about — a converted surface must read exactly once.
const node = vi.hoisted(() => ({
  reads: 0,
  /** Per-read prices, so a SECOND read can be made to answer differently —
   *  which is what a live node does and what makes two reads unsafe. */
  perRead: [] as bigint[],
  fail: false,
}));
vi.mock("../../sdk/fee-quote", async (orig) => {
  const actual = await orig<typeof import("../../sdk/fee-quote")>();
  return {
    ...actual,
    resolveOperationFee: vi.fn(async (plan: { executionUnitLimit: bigint }) => {
      if (node.fail) throw new Error("execution-unit quote unavailable");
      const price = node.perRead[node.reads] ?? node.perRead[node.perRead.length - 1] ?? 2_000_000_000n;
      node.reads += 1;
      const signed = {
        maxFeePerGas: price,
        maxPriorityFeePerGas: 1_000_000_000n,
        gasLimit: plan.executionUnitLimit,
      };
      return {
        signed,
        displayLyth: formatLyth((signed.maxFeePerGas * signed.gasLimit).toString(), {
          includeUnit: false,
        }),
      };
    }),
  };
});

import { OperationsDrawer } from "../OperationsDrawer";
import type { ResolvedExecutionFee } from "@monolythium/core-sdk";

const LIMIT = 150_000n;

/** What the seam was handed. The `execute` below forwards `ctx.resolvedFee`
 *  exactly as every converted surface does. */
const seam = vi.hoisted(() => ({ signed: null as ResolvedExecutionFee | null }));

function op(overrides: Partial<OperationDescriptor> = {}): OperationDescriptor {
  return {
    title: "Delegate 10.00% to cluster 1",
    commitment: { subject: "Cluster Atlas", amount: null },
    feePlan: { feeClass: "transfer", executionUnitLimit: LIMIT },
    diff: [{ k: "Cluster", v: "1" }],
    effects: [],
    auth: "keychain",
    execute: async (ctx): Promise<OperationResult> => {
      seam.signed = ctx?.resolvedFee ?? null;
      return { headline: "ok" };
    },
    ...overrides,
  };
}

/** The LYTH figure the fee row is showing, unit stripped. */
function shownFeeLyth(testId = "operation-fee"): string {
  return screen.getByTestId(testId).textContent!.replace(/^Network fee \(max\)/, "").replace(" LYTH", "").trim();
}

/** The same quantity, derived from the fee the seam was actually handed. */
function signedFeeLyth(): string {
  const f = seam.signed!;
  return formatLyth((f.maxFeePerGas * f.gasLimit).toString(), { includeUnit: false });
}

beforeEach(() => {
  vi.clearAllMocks();
  node.reads = 0;
  node.perRead = [2_000_000_000n];
  node.fail = false;
  seam.signed = null;
  kc.fetchAndUnlockVault.mockResolvedValue(new Uint8Array(32));
});

async function signIt(descriptor = op()) {
  const user = userEvent.setup();
  renderWithProviders(<OperationsDrawer descriptor={descriptor} onClose={() => {}} />);
  await waitFor(() => expect(screen.getByTestId("operation-fee")).toHaveTextContent("LYTH"));
  const shown = shownFeeLyth();
  await user.click(screen.getByRole("button", { name: "Continue" }));
  await screen.findByLabelText("Password");
  await user.type(screen.getByLabelText("Password"), "pw");
  await user.click(screen.getByRole("button", { name: "Authorize" }));
  await waitFor(() => expect(seam.signed).not.toBeNull());
  return { shown, user };
}

describe("the displayed fee IS the signed fee", () => {
  it("the rendered LYTH figure equals the fee handed to the seam", async () => {
    const { shown } = await signIt();
    // Anti-vacuity: a non-zero ceiling, or the equality below is two blanks.
    expect(seam.signed!.maxFeePerGas).toBeGreaterThan(0n);
    expect(seam.signed!.gasLimit).toBe(LIMIT);
    expect(shown).toBe(signedFeeLyth());
  });

  it("reads the node EXACTLY ONCE for the whole operation", async () => {
    // The property the formula alone cannot give: two calls to one correct
    // function still sample twice.
    await signIt();
    expect(node.reads).toBe(1);
  });

  it("a moving price cannot separate them — the second price is never sampled", async () => {
    // The live shape: a second read answers differently. Before D2 the row came
    // from one read and the signature from another, so this is the exact
    // divergence, made observable.
    node.perRead = [2_000_000_000n, 9_000_000_000n];
    const { shown } = await signIt();
    expect(shown).toBe(signedFeeLyth());
    expect(seam.signed!.maxFeePerGas).toBe(2_000_000_000n);
    // Anti-vacuity: the second price really is different, so "never sampled"
    // means something.
    expect(node.perRead[1]).not.toBe(node.perRead[0]);
    expect(node.reads).toBe(1);
  });

  it("the fee is a TOTAL in LYTH, not a per-unit price", async () => {
    // A per-unit price is a number a user cannot act on without doing
    // arithmetic at a consent moment.
    const { shown } = await signIt();
    const perUnit = formatLyth(seam.signed!.maxFeePerGas.toString(), { includeUnit: false });
    expect(shown).not.toBe(perUnit);
    expect(shown).toBe(signedFeeLyth());
  });

  it("shows the same figure at auth, where the key is released", async () => {
    // It EXISTS at this stage only because the read moved ahead of the password.
    const user = userEvent.setup();
    renderWithProviders(<OperationsDrawer descriptor={op()} onClose={() => {}} />);
    await waitFor(() => expect(screen.getByTestId("operation-fee")).toHaveTextContent("LYTH"));
    const preview = shownFeeLyth();
    await user.click(screen.getByRole("button", { name: "Continue" }));
    await screen.findByLabelText("Password");
    expect(shownFeeLyth("auth-fee")).toBe(preview);
  });
});

describe("fail closed — an unpriced operation is not signable", () => {
  it("refuses to leave preview when the quote fails", async () => {
    node.fail = true;
    const user = userEvent.setup();
    renderWithProviders(<OperationsDrawer descriptor={op()} onClose={() => {}} />);
    await waitFor(() =>
      expect(screen.getByTestId("operation-fee")).toHaveTextContent("Fee unavailable"),
    );
    const cont = screen.getByRole("button", { name: "Continue" });
    expect(cont).toBeDisabled();
    // The disabled attribute alone is not the guard — jsdom drops the event on a
    // disabled button, which is how a mutation once survived. Drive the handler
    // and assert the stage did not move.
    await user.click(cont);
    expect(screen.queryByLabelText("Password")).toBeNull();
    expect(seam.signed).toBeNull();
  });

  it("shows no number at all rather than a stale or placeholder one", async () => {
    node.fail = true;
    renderWithProviders(<OperationsDrawer descriptor={op()} onClose={() => {}} />);
    await waitFor(() =>
      expect(screen.getByTestId("operation-fee")).toHaveTextContent("Fee unavailable"),
    );
    expect(screen.getByTestId("operation-fee").textContent).not.toMatch(/\d/);
  });

  it("an UNPRICED surface is unaffected — the gate is not a global block", async () => {
    // Anti-vacuity for the two above: without this they would also pass on a
    // drawer that never advances at all.
    const user = userEvent.setup();
    node.fail = true;
    const d = op();
    delete (d as { feePlan?: unknown }).feePlan;
    renderWithProviders(<OperationsDrawer descriptor={d} onClose={() => {}} />);
    expect(screen.queryByTestId("operation-fee")).toBeNull();
    await user.click(screen.getByRole("button", { name: "Continue" }));
    await screen.findByLabelText("Password");
  });
});
