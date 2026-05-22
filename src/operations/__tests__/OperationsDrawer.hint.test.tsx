// Phase 8 — High-value hint bar: appears when policy descriptor is
// above threshold AND no passkey is enrolled AND not dismissed; hides
// otherwise; dismissal persists through sessionStorage.

import { describe, expect, it, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { OperationsDrawer } from "../OperationsDrawer";
import type { OperationDescriptor } from "../types";
import { resetPolicy, setPolicy } from "../../sdk/policy";

const { invokeMock, fetchAndUnlockVaultMock } = vi.hoisted(() => ({
  invokeMock: vi.fn(),
  fetchAndUnlockVaultMock: vi.fn(),
}));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
}));

vi.mock("../../sdk/keychain", async () => {
  const actual =
    await vi.importActual<typeof import("../../sdk/keychain")>(
      "../../sdk/keychain",
    );
  return {
    ...actual,
    fetchAndUnlockVault: (...args: unknown[]) =>
      fetchAndUnlockVaultMock(...args),
  };
});

const VAULT_ID = "v-active";

const SIGNER_ADDRESS = "0xaaaa00000000000000000000000000000000aaaa";

function makeDescriptor(valueLyth: number): OperationDescriptor {
  return {
    title: "Send LYTH",
    auth: "keychain",
    diff: [{ k: "Amount", v: `${valueLyth} LYTH` }],
    effects: [],
    policy: {
      valueLyth,
      payloadHashB64: "p".repeat(43),
    },
    execute: vi.fn(async () => ({ headline: "Sent" })),
  };
}

function defaultInvoke(passkeyList: unknown[] = []): (
  cmd: string,
) => Promise<unknown> {
  return async (cmd: string) => {
    switch (cmd) {
      case "vaults_list":
        return [
          {
            id: VAULT_ID,
            label: "Personal",
            address: SIGNER_ADDRESS,
            created_at: 100,
            is_active: true,
          },
        ];
      case "multisigs_list":
        return [];
      case "passkey_list":
        return passkeyList;
      default:
        return undefined;
    }
  };
}

beforeEach(() => {
  invokeMock.mockReset();
  resetPolicy();
  sessionStorage.removeItem("wallet.high-value-hint-dismissed");
});

describe("OperationsDrawer · high-value hint bar", () => {
  it("shows the hint above threshold with no passkey enrolled", async () => {
    invokeMock.mockImplementation(defaultInvoke([]));
    setPolicy({ triggerThresholdLyth: 100 });
    render(
      <OperationsDrawer
        descriptor={makeDescriptor(500)}
        onClose={() => undefined}
      />,
    );
    await waitFor(() =>
      expect(
        screen.getByRole("region", { name: /High-value transaction hint/i }),
      ).toBeInTheDocument(),
    );
    expect(screen.getByText(/Enroll a passkey/i)).toBeInTheDocument();
  });

  it("hides the hint below threshold", async () => {
    invokeMock.mockImplementation(defaultInvoke([]));
    setPolicy({ triggerThresholdLyth: 100 });
    render(
      <OperationsDrawer
        descriptor={makeDescriptor(10)}
        onClose={() => undefined}
      />,
    );
    await waitFor(() =>
      expect(screen.getByText(/Send LYTH/i)).toBeInTheDocument(),
    );
    // Hint never appears.
    expect(
      screen.queryByRole("region", { name: /High-value transaction hint/i }),
    ).not.toBeInTheDocument();
  });

  it("hides the hint when a passkey is enrolled", async () => {
    invokeMock.mockImplementation(
      defaultInvoke([
        {
          id: "c1",
          backend: "software",
          public_key: "p",
          label: "L",
          device_name: null,
          counter: 0,
          created_at: 0,
          last_used: 0,
        },
      ]),
    );
    setPolicy({ triggerThresholdLyth: 100 });
    render(
      <OperationsDrawer
        descriptor={makeDescriptor(500)}
        onClose={() => undefined}
      />,
    );
    await waitFor(() =>
      expect(screen.getByText(/Send LYTH/i)).toBeInTheDocument(),
    );
    expect(
      screen.queryByRole("region", { name: /High-value transaction hint/i }),
    ).not.toBeInTheDocument();
  });

  it("dismissal persists across re-renders via sessionStorage", async () => {
    invokeMock.mockImplementation(defaultInvoke([]));
    setPolicy({ triggerThresholdLyth: 100 });
    const { unmount } = render(
      <OperationsDrawer
        descriptor={makeDescriptor(500)}
        onClose={() => undefined}
      />,
    );
    await waitFor(() =>
      expect(
        screen.getByRole("region", { name: /High-value transaction hint/i }),
      ).toBeInTheDocument(),
    );
    fireEvent.click(
      screen.getByRole("button", { name: /Dismiss high-value hint/i }),
    );
    await waitFor(() =>
      expect(
        screen.queryByRole("region", { name: /High-value transaction hint/i }),
      ).not.toBeInTheDocument(),
    );
    unmount();
    // Fresh render — sessionStorage flag suppresses the bar.
    render(
      <OperationsDrawer
        descriptor={makeDescriptor(500)}
        onClose={() => undefined}
      />,
    );
    await waitFor(() =>
      expect(screen.getByText(/Send LYTH/i)).toBeInTheDocument(),
    );
    expect(
      screen.queryByRole("region", { name: /High-value transaction hint/i }),
    ).not.toBeInTheDocument();
  });

  it("Enroll now fires the wallet:nav event toward settings and closes", async () => {
    invokeMock.mockImplementation(defaultInvoke([]));
    setPolicy({ triggerThresholdLyth: 100 });
    const onClose = vi.fn();
    const navHandler = vi.fn();
    window.addEventListener("wallet:nav", navHandler);
    try {
      render(
        <OperationsDrawer
          descriptor={makeDescriptor(500)}
          onClose={onClose}
        />,
      );
      await waitFor(() =>
        expect(
          screen.getByRole("region", { name: /High-value transaction hint/i }),
        ).toBeInTheDocument(),
      );
      fireEvent.click(screen.getByRole("button", { name: /^Enroll now$/i }));
      expect(navHandler).toHaveBeenCalled();
      expect(onClose).toHaveBeenCalled();
    } finally {
      window.removeEventListener("wallet:nav", navHandler);
    }
  });
});
