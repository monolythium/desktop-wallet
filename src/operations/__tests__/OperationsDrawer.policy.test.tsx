// Phase 8 — OperationsDrawer integration test: two-tier policy gate
// wiring. Covers:
//   - below threshold: no challenge, executes normally
//   - above threshold + policy off: no challenge
//   - above threshold + policy on + no passkey enrolled: no challenge
//   - above threshold + policy on + ≥1 passkey: challenge fires + executes
//   - above threshold + policy on + ≥1 passkey + assertion fails:
//     blocks at auth pane

import { describe, expect, it, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { OperationsDrawer } from "../OperationsDrawer";
import type { OperationDescriptor } from "../types";
import { resetPolicy, setPolicy } from "../../sdk/policy";

const {
  invokeMock,
  fetchAndUnlockVaultMock,
} = vi.hoisted(() => ({
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

function fixturePasskey() {
  return {
    id: "c1",
    backend: "software" as const,
    public_key: "p",
    label: "Test",
    device_name: null,
    counter: 0,
    created_at: 100,
    last_used: 100,
  };
}

function makeDescriptor(args: {
  valueLyth: number;
  payloadHashB64?: string;
  executeFn?: () => Promise<{ headline: string }>;
}): OperationDescriptor {
  return {
    title: "Send LYTH",
    auth: "keychain",
    diff: [{ k: "Amount", v: `${args.valueLyth} LYTH` }],
    effects: [],
    policy: {
      valueLyth: args.valueLyth,
      payloadHashB64: args.payloadHashB64 ?? "p".repeat(43),
    },
    execute:
      args.executeFn ??
      vi.fn(async () => ({ headline: "Sent" })),
  };
}

function defaultInvoke(extra: Record<string, unknown> = {}): (
  cmd: string,
) => Promise<unknown> {
  return async (cmd: string) => {
    if (cmd in extra) return extra[cmd];
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
        return [];
      default:
        return undefined;
    }
  };
}

beforeEach(() => {
  invokeMock.mockReset();
  fetchAndUnlockVaultMock.mockReset();
  resetPolicy();
  fetchAndUnlockVaultMock.mockResolvedValue(new Uint8Array(32).fill(0x11));
});

describe("OperationsDrawer · policy gate · skip paths", () => {
  it("does NOT fire the passkey challenge below threshold", async () => {
    invokeMock.mockImplementation(defaultInvoke());
    setPolicy({
      triggerThresholdLyth: 100,
      passkeyRequired: true,
      enrolledForHighValue: true,
    });
    const exec = vi.fn(async () => ({ headline: "Sent" }));
    const descriptor = makeDescriptor({ valueLyth: 10, executeFn: exec });
    render(
      <OperationsDrawer descriptor={descriptor} onClose={() => undefined} />,
    );
    await waitFor(() =>
      expect(screen.getByText(/Send LYTH/i)).toBeInTheDocument(),
    );
    fireEvent.click(screen.getByRole("button", { name: /Continue/i }));
    fireEvent.change(screen.getByLabelText(/Password/i), {
      target: { value: "pw" },
    });
    fireEvent.click(screen.getByRole("button", { name: /Authorize/i }));
    await waitFor(() => expect(exec).toHaveBeenCalled());
    // The drawer should NOT have called passkey_challenge_create or
    // passkey_attest in the skip path.
    const calls = invokeMock.mock.calls.map((c) => c[0]);
    expect(calls).not.toContain("passkey_challenge_create");
    expect(calls).not.toContain("passkey_attest");
  });

  it("does NOT fire the challenge when policy is off, even above threshold", async () => {
    invokeMock.mockImplementation(defaultInvoke());
    setPolicy({
      triggerThresholdLyth: 100,
      passkeyRequired: false,
      enrolledForHighValue: true,
    });
    const exec = vi.fn(async () => ({ headline: "Sent" }));
    const descriptor = makeDescriptor({ valueLyth: 500, executeFn: exec });
    render(
      <OperationsDrawer descriptor={descriptor} onClose={() => undefined} />,
    );
    fireEvent.click(screen.getByRole("button", { name: /Continue/i }));
    fireEvent.change(screen.getByLabelText(/Password/i), {
      target: { value: "pw" },
    });
    fireEvent.click(screen.getByRole("button", { name: /Authorize/i }));
    await waitFor(() => expect(exec).toHaveBeenCalled());
    const calls = invokeMock.mock.calls.map((c) => c[0]);
    expect(calls).not.toContain("passkey_challenge_create");
  });

  it("does NOT fire the challenge when no passkey is enrolled", async () => {
    invokeMock.mockImplementation(
      defaultInvoke({ passkey_list: [] }),
    );
    setPolicy({
      triggerThresholdLyth: 100,
      passkeyRequired: true,
      enrolledForHighValue: true,
    });
    const exec = vi.fn(async () => ({ headline: "Sent" }));
    const descriptor = makeDescriptor({ valueLyth: 500, executeFn: exec });
    render(
      <OperationsDrawer descriptor={descriptor} onClose={() => undefined} />,
    );
    fireEvent.click(screen.getByRole("button", { name: /Continue/i }));
    fireEvent.change(screen.getByLabelText(/Password/i), {
      target: { value: "pw" },
    });
    fireEvent.click(screen.getByRole("button", { name: /Authorize/i }));
    await waitFor(() => expect(exec).toHaveBeenCalled());
    const calls = invokeMock.mock.calls.map((c) => c[0]);
    expect(calls).not.toContain("passkey_challenge_create");
  });
});

describe("OperationsDrawer · policy gate · challenge fires", () => {
  it("requests challenge + attest above threshold, then executes", async () => {
    invokeMock.mockImplementation(
      defaultInvoke({
        passkey_list: [fixturePasskey()],
        passkey_challenge_create: {
          nonce: "n",
          payload_hash: "p".repeat(43),
          created_at: 100,
          expires_at: 160,
        },
        passkey_attest: {
          credential_id: "c1",
          signature: "s",
          challenge: {
            nonce: "n",
            payload_hash: "p".repeat(43),
            created_at: 100,
            expires_at: 160,
          },
          new_counter: 1,
        },
      }),
    );
    setPolicy({
      triggerThresholdLyth: 100,
      passkeyRequired: true,
      enrolledForHighValue: true,
    });
    const exec = vi.fn(async () => ({ headline: "Sent" }));
    const descriptor = makeDescriptor({ valueLyth: 500, executeFn: exec });
    render(
      <OperationsDrawer descriptor={descriptor} onClose={() => undefined} />,
    );
    fireEvent.click(screen.getByRole("button", { name: /Continue/i }));
    fireEvent.change(screen.getByLabelText(/Password/i), {
      target: { value: "pw" },
    });
    fireEvent.click(screen.getByRole("button", { name: /Authorize/i }));
    await waitFor(() => expect(exec).toHaveBeenCalled());
    const calls = invokeMock.mock.calls.map((c) => c[0]);
    expect(calls).toContain("passkey_challenge_create");
    expect(calls).toContain("passkey_attest");
  });

  it("surfaces a passkey error and blocks execute on assertion failure", async () => {
    invokeMock.mockImplementation(async (cmd: string) => {
      if (cmd === "passkey_attest") {
        return Promise.reject({ code: "auth_failed" });
      }
      return defaultInvoke({
        passkey_list: [fixturePasskey()],
        passkey_challenge_create: {
          nonce: "n",
          payload_hash: "p".repeat(43),
          created_at: 100,
          expires_at: 160,
        },
      })(cmd);
    });
    setPolicy({
      triggerThresholdLyth: 100,
      passkeyRequired: true,
      enrolledForHighValue: true,
    });
    const exec = vi.fn(async () => ({ headline: "Sent" }));
    const descriptor = makeDescriptor({ valueLyth: 500, executeFn: exec });
    render(
      <OperationsDrawer descriptor={descriptor} onClose={() => undefined} />,
    );
    fireEvent.click(screen.getByRole("button", { name: /Continue/i }));
    fireEvent.change(screen.getByLabelText(/Password/i), {
      target: { value: "pw" },
    });
    fireEvent.click(screen.getByRole("button", { name: /Authorize/i }));
    await waitFor(() =>
      expect(
        screen.getByText(/Passkey authentication failed/i),
      ).toBeInTheDocument(),
    );
    expect(exec).not.toHaveBeenCalled();
  });
});
