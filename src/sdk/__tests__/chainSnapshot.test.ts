// `loadChainSnapshot` — the SDK round-trip that backs Home's hero
// balance.
//
// The Home page's `PublicHeroAmount` component renders one of three
// states: loading, ready (real LYTH balance), error (offline). The
// React rendering itself isn't unit-tested here — `@testing-library/
// react` isn't part of the desktop wallet's Phase 1 test stack (see
// docs/phases/phase-01-baseline.md GAP #D1) — but the data path that
// drives those states IS testable, and the assertions below cover
// the three branches at the source.

import { describe, expect, it, beforeEach } from "vitest";
import { MonolythiumProvider, RpcClient } from "@monolythium/core-sdk";
import { loadChainSnapshot, resetProviderForTest, setProviderForTest } from "../client";
import { buildMockFetch, type MockState } from "../../__tests__/helpers/mockFetch";
import {
  BURN_ADDRESS,
  MONOLYTHIUM_TESTNET_CHAIN_ID,
  TEST_ADDRESS,
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

function installProvider(state: MockState): void {
  const provider = new MonolythiumProvider(
    new RpcClient("http://test.invalid", { fetch: buildMockFetch(state) }),
  );
  setProviderForTest(provider);
}

describe("loadChainSnapshot — the data path Home's hero binds to", () => {
  beforeEach(() => {
    resetProviderForTest();
  });

  it("returns a populated snapshot with the real LYTH balance on the happy path", async () => {
    const state = baseState();
    // 12.5 LYTH = 12.5 * 1e18 wei = 12_500_000_000_000_000_000 wei.
    state.balanceWei = 12_500_000_000_000_000_000n;
    state.blockNumber = 9999n;
    installProvider(state);

    const snap = await loadChainSnapshot(TEST_ADDRESS);

    expect(snap.error).toBeNull();
    expect(snap.chainId).toBe(MONOLYTHIUM_TESTNET_CHAIN_ID);
    expect(snap.blockHeight).toBe(9999n);
    expect(snap.balanceWei).toBe(`0x${(12_500_000_000_000_000_000n).toString(16)}`);
    // Display-side derivation: the hero uses `balanceLyth` directly.
    // 12.5 LYTH passes through `weiToLyth` without precision loss for
    // any value under ~9e15 LYTH.
    expect(snap.balanceLyth).toBe(12.5);

    const methods = state.observed.map((c) => c.method);
    expect(methods).toContain("eth_chainId");
    expect(methods).toContain("eth_blockNumber");
    expect(methods).toContain("eth_getBalance");
  });

  it("returns a zero balance cleanly when the address has no funds", async () => {
    const state = baseState();
    state.balanceWei = 0n;
    installProvider(state);

    const snap = await loadChainSnapshot(BURN_ADDRESS);

    expect(snap.error).toBeNull();
    expect(snap.balanceLyth).toBe(0);
    // `weiToLyth` short-circuits "0x0" to 0; verify the wire shape too.
    expect(snap.balanceWei).toBe("0x0");
  });

  it("surfaces a typed error envelope when the node is unreachable", async () => {
    // Build a transport that always rejects — the snapshot helper must
    // catch and return an error envelope rather than unwinding the
    // caller. Home's `PublicHeroAmount` renders the "offline" state on
    // this branch.
    const failingFetch: typeof fetch = () =>
      Promise.reject(new Error("network unreachable"));
    const provider = new MonolythiumProvider(
      new RpcClient("http://test.invalid", { fetch: failingFetch }),
    );
    setProviderForTest(provider);

    const snap = await loadChainSnapshot(TEST_ADDRESS);

    expect(snap.error).not.toBeNull();
    expect(snap.error?.message).toContain("network unreachable");
    // Defaults on the error branch — Home renders "—" for the amount.
    expect(snap.chainId).toBe(0n);
    expect(snap.blockHeight).toBeNull();
    expect(snap.balanceLyth).toBe(0);
  });
});
