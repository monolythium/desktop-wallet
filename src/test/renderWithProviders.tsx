// Shared render harness for component tests.
//
// Wraps a component in the wallet's real provider tree (LockProvider >
// OperationsProvider) and installs the Tauri-present flag so isTauri()-guarded
// paths (keychain / os-toast / active-wallet) run. Returns the RTL result plus a
// ready `userEvent` instance and a few generic fixtures.
//
// The per-file mocks a test needs (vi.mock of `../sdk/*` readers, of
// `../sdk/active-wallet`, or of `../operations/context` to capture opens) are
// declared IN each test file — vi.mock is hoisted per file, so it can't live
// here. This module only wires the providers + the common fixtures, and is the
// single obvious entry point for a component test.
//
// Test-layer mocks are legitimate here: they shadow real SDK modules only under
// vitest, not in shipped code (distinct from the product's no-mock data rule).

import type { ReactElement, ReactNode } from "react";
import { render, type RenderResult } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { addressToTypedBech32 } from "@monolythium/core-sdk";
import { LockProvider } from "../sdk/auto-lock";
import { OperationsProvider } from "../operations/context";
import type { RpcOutcome } from "../sdk/live";
import type { ActiveWallet } from "../sdk/active-wallet";

const TAURI_KEY = "__TAURI_INTERNALS__";

/** Make isTauri()-guarded code paths run (keychain / os-toast / active-wallet
 *  all short-circuit to a browser no-op unless this flag is present). */
export function installTauri(): void {
  (window as unknown as Record<string, unknown>)[TAURI_KEY] = {};
}

/** Remove the Tauri flag (the browser-preview path). */
export function resetTauri(): void {
  delete (window as unknown as Record<string, unknown>)[TAURI_KEY];
}

export interface HarnessResult extends RenderResult {
  user: ReturnType<typeof userEvent.setup>;
}

/**
 * Render `ui` inside the real provider tree with the Tauri flag installed.
 * `LockProvider` defaults unlocked; `OperationsProvider` renders the shared
 * `OperationsDrawer` when a component calls `useOperations().open(...)` — so a
 * flow test can drive Review → the drawer, and a test that mocks
 * `../operations/context` gets its passthrough here instead.
 */
export function renderWithProviders(ui: ReactElement): HarnessResult {
  installTauri();
  const user = userEvent.setup();
  const wrapped: ReactNode = (
    <LockProvider>
      <OperationsProvider>{ui}</OperationsProvider>
    </LockProvider>
  );
  const result = render(wrapped);
  return { user, ...result };
}

// ---- generic fixtures ----

/** A successful `RpcOutcome<T>`. */
export function ok<T>(value: T): RpcOutcome<T> {
  return { ok: true, value };
}

/** A failed `RpcOutcome`. */
export function err<T = never>(error: string): RpcOutcome<T> {
  return { ok: false, error };
}

/** A fixed test address whose bech32m + hex correspond (built from the hex via
 *  the SDK so the pair is real — the self-send guard compares them). */
export const TEST_WALLET_HEX = "0x000000000000000000000000000000000000dead";
export const TEST_WALLET_ADDRESS = addressToTypedBech32("user", TEST_WALLET_HEX);

type ReadyWallet = Extract<ActiveWallet, { status: "ready" }>;

/** A ready (unlocked) active-wallet fixture. Override any field per case. */
export function makeReadyWallet(over: Partial<ReadyWallet> = {}): ActiveWallet {
  return {
    status: "ready",
    slot: "slot-1",
    name: "Test Wallet",
    addressHex: TEST_WALLET_HEX,
    address: TEST_WALLET_ADDRESS,
    ...over,
  };
}

/** A locked active-wallet fixture (address hidden while locked). */
export function makeLockedWallet(): ActiveWallet {
  return { status: "locked", slot: "slot-1", name: "Test Wallet", addressHex: null, address: null };
}

/** The "no active wallet" fixture (the jsdom / no-Tauri default). */
export function makeNoneWallet(): ActiveWallet {
  return { status: "none", slot: null, name: null, addressHex: null, address: null };
}
