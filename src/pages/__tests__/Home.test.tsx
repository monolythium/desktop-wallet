// Home — rendering integration tests for the three chainSnapshot
// states (loading, ready, error). Closes Phase 1 GAP #D1.
//
// The data path is unit-tested in
// `src/sdk/__tests__/chainSnapshot.test.ts`; this file exercises the
// React rendering on top of it, asserting that each state renders
// the right user-visible affordance.
//
// We render `<Home>` inside an `<OperationsProvider>` because the
// page uses `useOperations()` (Send / Receive / Probe descriptors).
// The SDK provider is swapped via `setProviderForTest` so each case
// owns its own fetch transport.

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import {
  MonolythiumProvider,
  RpcClient,
} from "@monolythium/core-sdk";
import { Home } from "../Home";
import { OperationsProvider } from "../../operations/context";
import { resetProviderForTest, setProviderForTest } from "../../sdk/client";
import {
  buildMockFetch,
  type MockState,
} from "../../__tests__/helpers/mockFetch";
import {
  MONOLYTHIUM_TESTNET_CHAIN_ID,
} from "../../__tests__/helpers/fixtures";

function baseState(): MockState {
  return {
    chainId: MONOLYTHIUM_TESTNET_CHAIN_ID,
    blockNumber: 1024n,
    baseFee: 1_000_000_000n,
    nonce: 0n,
    balanceWei: 0n,
    acceptedRawTxs: [],
    observed: [],
  };
}

function renderHome() {
  return render(
    <OperationsProvider>
      <Home denom="public" goto={() => undefined} />
    </OperationsProvider>,
  );
}

describe("Home — chainSnapshot rendering", () => {
  beforeEach(() => {
    resetProviderForTest();
  });
  afterEach(() => {
    cleanup();
  });

  it("renders the loading affordance while the snapshot is in flight", async () => {
    // Use a fetch stub that never resolves — locks the hook in its
    // `loading` state for the duration of the assertion.
    const pendingFetch: typeof fetch = () => new Promise(() => undefined);
    const provider = new MonolythiumProvider(
      new RpcClient("http://test.invalid", { fetch: pendingFetch }),
    );
    setProviderForTest(provider);

    renderHome();

    // PublicHeroAmount in the loading branch renders "loading…" copy.
    // (IdentityCard also surfaces "Loading identity…" — both are valid
    // pending affordances, hence findAllByText.)
    const loadings = await screen.findAllByText(/loading/i);
    expect(loadings.length).toBeGreaterThanOrEqual(1);
    // ChainStatusLine also surfaces the loading state, with the SDK
    // attribution in the footer.
    expect(
      await screen.findByText(/querying chain via @monolythium\/core-sdk/i),
    ).toBeInTheDocument();
  });

  it("renders the real LYTH balance + chain id + height in the ready state", async () => {
    const state = baseState();
    // 12.5 LYTH expressed as wei — same magnitude as the
    // chainSnapshot SDK test pins so the two suites move together.
    state.balanceWei = 12_500_000_000_000_000_000n;
    state.blockNumber = 9999n;
    const provider = new MonolythiumProvider(
      new RpcClient("http://test.invalid", { fetch: buildMockFetch(state) }),
    );
    setProviderForTest(provider);

    renderHome();

    // Hero renders the real LYTH balance once the snapshot lands.
    // `toLocaleString(undefined, …)` uses the host locale, so the
    // decimal separator can be `.` (en-US) or `,` (most of Europe).
    // Match either by allowing one literal char between digits.
    await waitFor(() => {
      expect(screen.getByText(/^12.5(000?|0)?$/)).toBeInTheDocument();
    });
    expect(screen.getAllByText(/LYTH/).length).toBeGreaterThan(0);
    // ChainStatusLine surfaces chain id + height in the ready branch.
    expect(
      await screen.findByText(MONOLYTHIUM_TESTNET_CHAIN_ID.toString()),
    ).toBeInTheDocument();
    expect(await screen.findByText("9999")).toBeInTheDocument();
  });

  it("renders the offline state without crashing when the node is unreachable", async () => {
    const failingFetch: typeof fetch = () =>
      Promise.reject(new Error("network unreachable"));
    const provider = new MonolythiumProvider(
      new RpcClient("http://test.invalid", { fetch: failingFetch }),
    );
    setProviderForTest(provider);

    renderHome();

    // The hero AND the chain-status line both surface "offline" in
    // this state. `findAllByText` over the regex captures both.
    await waitFor(() => {
      expect(screen.getAllByText(/offline/i).length).toBeGreaterThanOrEqual(2);
    });
    // ChainStatusLine carries the underlying error message verbatim
    // (IdentityCard's soft-error footnote may carry it too).
    const errs = await screen.findAllByText(/network unreachable/i);
    expect(errs.length).toBeGreaterThanOrEqual(1);
  });
});
