// VaultCreateFlow — step traversal + submission gating.

import { describe, expect, it, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { VaultCreateFlow } from "../VaultCreateFlow";

const invokeMock = vi.fn();

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
}));

vi.mock("@monolythium/core-sdk/crypto", async () => {
  return {
    generatePqm1Mnemonic: vi.fn(
      () => "alpha bravo charlie delta echo foxtrot golf hotel india juliet kilo lima",
    ),
    pqm1MnemonicToAddress: vi.fn(
      () => "0xabcdef0000000000000000000000000000abcdef",
    ),
    pqm1MnemonicToMlDsa65Seed: vi.fn(() => new Uint8Array(32)),
  };
});

vi.mock("../../sdk/naming", async () => {
  const actual = await vi.importActual<typeof import("../../sdk/naming")>("../../sdk/naming");
  return {
    ...actual,
    lookupAddress: vi.fn(async () => ({ ok: true, value: null })),
  };
});

beforeEach(() => {
  invokeMock.mockReset();
  // listVaults returns [] (the useVaults hook calls it on mount).
  invokeMock.mockResolvedValue([]);
});

describe("VaultCreateFlow · first vault", () => {
  it("walks through label → mnemonic → password → confirm", async () => {
    const onClose = vi.fn();
    const onCreated = vi.fn();
    render(
      <VaultCreateFlow
        isFirstVault={true}
        onClose={onClose}
        onCreated={onCreated}
      />,
    );

    // Step 1: label
    expect(screen.getByText(/Step 1 of 4/i)).toBeInTheDocument();
    fireEvent.change(screen.getByPlaceholderText(/Personal/i), {
      target: { value: "Personal" },
    });
    fireEvent.click(screen.getByText("Continue"));

    // Step 2: mnemonic (generate mode is default, fixture mnemonic appears)
    await waitFor(() => {
      expect(screen.getByText(/Step 2 of 4/i)).toBeInTheDocument();
    });
    await waitFor(() => {
      expect(screen.getByText(/alpha bravo/)).toBeInTheDocument();
    });
    // The "written down" checkbox is the gate.
    const cb = screen.getByRole("checkbox");
    fireEvent.click(cb);
    fireEvent.click(screen.getByText("Continue"));

    // Step 3: password (first vault → confirm field present)
    await waitFor(() => {
      expect(screen.getByText(/Step 3 of 4/i)).toBeInTheDocument();
    });
    const passwordInputs = screen.getAllByDisplayValue("");
    // Two password inputs: master + confirm
    fireEvent.change(passwordInputs[0]!, { target: { value: "hunter2hunter2" } });
    fireEvent.change(passwordInputs[1]!, { target: { value: "hunter2hunter2" } });
    fireEvent.click(screen.getByText("Continue"));

    // Step 4: confirm
    await waitFor(() => {
      expect(screen.getByText(/Step 4 of 4/i)).toBeInTheDocument();
    });
    expect(screen.getByText("Personal")).toBeInTheDocument();

    // Submit
    invokeMock.mockResolvedValueOnce({
      id: "new-id",
      label: "Personal",
      address: "0xabcdef0000000000000000000000000000abcdef",
      created_at: 1000,
      is_active: true,
    });
    // Refresh after create (listVaults)
    invokeMock.mockResolvedValueOnce([
      {
        id: "new-id",
        label: "Personal",
        address: "0xabcdef0000000000000000000000000000abcdef",
        created_at: 1000,
        is_active: true,
      },
    ]);
    fireEvent.click(screen.getByText(/Create vault/i));
    await waitFor(() => {
      expect(onCreated).toHaveBeenCalled();
    });
    expect(onClose).toHaveBeenCalled();
  });

  it("rejects mismatched passwords on first vault", async () => {
    render(
      <VaultCreateFlow
        isFirstVault={true}
        onClose={() => undefined}
      />,
    );
    // label
    fireEvent.change(screen.getByPlaceholderText(/Personal/i), {
      target: { value: "P" },
    });
    fireEvent.click(screen.getByText("Continue"));
    // mnemonic
    await waitFor(() => {
      expect(screen.getByRole("checkbox")).toBeInTheDocument();
    });
    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.click(screen.getByText("Continue"));
    // password
    await waitFor(() => {
      expect(screen.getByText(/Step 3 of 4/i)).toBeInTheDocument();
    });
    const inputs = screen.getAllByDisplayValue("");
    fireEvent.change(inputs[0]!, { target: { value: "abc12345" } });
    fireEvent.change(inputs[1]!, { target: { value: "different" } });
    fireEvent.click(screen.getByText("Continue"));
    expect(screen.getByText(/Passwords don't match/i)).toBeInTheDocument();
  });
});

describe("VaultCreateFlow · subsequent vault", () => {
  it("does not show password confirm field for subsequent vault", async () => {
    render(
      <VaultCreateFlow
        isFirstVault={false}
        onClose={() => undefined}
      />,
    );
    fireEvent.change(screen.getByPlaceholderText(/Personal/i), {
      target: { value: "Work" },
    });
    fireEvent.click(screen.getByText("Continue"));
    await waitFor(() => {
      expect(screen.getByRole("checkbox")).toBeInTheDocument();
    });
    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.click(screen.getByText("Continue"));
    await waitFor(() => {
      expect(screen.getByText(/Step 3 of 4/i)).toBeInTheDocument();
    });
    expect(screen.getByText(/Enter your master password/i)).toBeInTheDocument();
    // Only ONE password input (no confirm) for subsequent vault.
    const inputs = screen.getAllByDisplayValue("");
    expect(inputs.length).toBe(1);
  });
});
