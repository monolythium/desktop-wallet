// VaultPicker — rendering + interaction + select wiring.

import { describe, expect, it, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { VaultPicker } from "../VaultPicker";

const invokeMock = vi.fn();

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
}));

vi.mock("../../sdk/naming", async () => {
  const actual = await vi.importActual<typeof import("../../sdk/naming")>("../../sdk/naming");
  return {
    ...actual,
    lookupAddress: vi.fn(async () => ({ ok: true, value: null })),
  };
});

beforeEach(() => {
  invokeMock.mockReset();
});

const VAULTS_WIRE = [
  { id: "1", label: "Personal", address: "0x1111111111111111111111111111111111111111", created_at: 100, is_active: true },
  { id: "2", label: "Work", address: "0x2222222222222222222222222222222222222222", created_at: 200, is_active: false },
];

describe("VaultPicker", () => {
  it("renders the active vault label on the trigger", async () => {
    invokeMock.mockResolvedValueOnce(VAULTS_WIRE);
    render(<VaultPicker />);
    await waitFor(() => {
      expect(screen.getByText("Personal")).toBeInTheDocument();
    });
  });

  it("renders 'Add vault' CTA when no vaults exist", async () => {
    invokeMock.mockResolvedValueOnce([]);
    render(<VaultPicker />);
    await waitFor(() => {
      expect(screen.getByText(/\+ Add vault/i)).toBeInTheDocument();
    });
  });

  it("opens the menu when the trigger is clicked", async () => {
    invokeMock.mockResolvedValueOnce(VAULTS_WIRE);
    render(<VaultPicker />);
    await waitFor(() => {
      expect(screen.getByText("Personal")).toBeInTheDocument();
    });
    fireEvent.click(screen.getByText("Personal"));
    // Both vault labels visible in the open menu (Personal appears in
    // both the trigger and the row; we just check for the second one).
    expect(screen.getByText("Work")).toBeInTheDocument();
  });

  it("calls vault_select when a non-active row is clicked", async () => {
    // First call: listVaults
    invokeMock.mockResolvedValueOnce(VAULTS_WIRE);
    // Second call: vault_select
    invokeMock.mockResolvedValueOnce(VAULTS_WIRE[1]);
    // Third call: post-select refresh listVaults (Work now active)
    invokeMock.mockResolvedValueOnce([
      { ...VAULTS_WIRE[0]!, is_active: false },
      { ...VAULTS_WIRE[1]!, is_active: true },
    ]);
    render(<VaultPicker />);
    await waitFor(() => {
      expect(screen.getByText("Personal")).toBeInTheDocument();
    });
    fireEvent.click(screen.getByText("Personal"));
    fireEvent.click(screen.getByText("Work"));
    await waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith("vault_select", { vaultId: "2" });
    });
  });

  it("invokes onAddVault from the menu CTA", async () => {
    invokeMock.mockResolvedValueOnce(VAULTS_WIRE);
    const onAddVault = vi.fn();
    render(<VaultPicker onAddVault={onAddVault} />);
    await waitFor(() => {
      expect(screen.getByText("Personal")).toBeInTheDocument();
    });
    fireEvent.click(screen.getByText("Personal"));
    fireEvent.click(screen.getByText(/\+ Add vault/i));
    expect(onAddVault).toHaveBeenCalled();
  });

  it("routes to settings from the Manage link", async () => {
    invokeMock.mockResolvedValueOnce(VAULTS_WIRE);
    const goto = vi.fn();
    render(<VaultPicker goto={goto} />);
    await waitFor(() => {
      expect(screen.getByText("Personal")).toBeInTheDocument();
    });
    fireEvent.click(screen.getByText("Personal"));
    fireEvent.click(screen.getByText(/Manage vaults/i));
    expect(goto).toHaveBeenCalledWith("settings");
  });

  it("closes on ESC", async () => {
    invokeMock.mockResolvedValueOnce(VAULTS_WIRE);
    render(<VaultPicker />);
    await waitFor(() => {
      expect(screen.getByText("Personal")).toBeInTheDocument();
    });
    fireEvent.click(screen.getByText("Personal"));
    expect(screen.getByText("Work")).toBeInTheDocument();
    fireEvent.keyDown(window, { key: "Escape" });
    await waitFor(() => {
      expect(screen.queryByText("Work")).toBeNull();
    });
  });
});

// ─── Multisig support ─────────────────────────────────────────────

const MULTISIG_WIRE = {
  id: "ms-1",
  label: "Treasury",
  address: "0xaaaa00000000000000000000000000000000aaaa",
  created_at: 300,
  threshold: 2,
  signer_count: 3,
  signers: [],
  is_active: false,
  pending_proposal_count: 0,
};

function routedMock(opts: {
  vaults?: unknown[];
  multisigs?: unknown[];
}) {
  return async (cmd: string) => {
    if (cmd === "vaults_list") return opts.vaults ?? [];
    if (cmd === "multisigs_list") return opts.multisigs ?? [];
    return undefined;
  };
}

describe("VaultPicker · multisig", () => {
  it("renders the multisig section with an M-of-N badge", async () => {
    invokeMock.mockImplementation(
      routedMock({ vaults: VAULTS_WIRE, multisigs: [MULTISIG_WIRE] }),
    );
    render(<VaultPicker />);
    await waitFor(() => {
      expect(screen.getByText("Personal")).toBeInTheDocument();
    });
    fireEvent.click(screen.getByText("Personal"));
    await waitFor(() => {
      expect(screen.getByText("Treasury")).toBeInTheDocument();
    });
    // Section header.
    expect(screen.getByText(/^Multisig$/)).toBeInTheDocument();
    // M-of-N badge appears next to the multisig label.
    expect(screen.getByText(/2 of 3/i)).toBeInTheDocument();
  });

  it("renders the compact M/N chip on the trigger when a multisig is active", async () => {
    invokeMock.mockImplementation(
      routedMock({
        // No single vault marked active — multisig holds active_id.
        vaults: [{ ...VAULTS_WIRE[0]!, is_active: false }, { ...VAULTS_WIRE[1]!, is_active: false }],
        multisigs: [{ ...MULTISIG_WIRE, is_active: true }],
      }),
    );
    render(<VaultPicker />);
    await waitFor(() => {
      expect(screen.getByText("Treasury")).toBeInTheDocument();
    });
    expect(screen.getByLabelText(/Multisig 2 of 3/i)).toBeInTheDocument();
  });

  it("calls multisig_select when a non-active multisig row is clicked", async () => {
    invokeMock.mockImplementation(async (cmd: string) => {
      if (cmd === "vaults_list") return VAULTS_WIRE;
      if (cmd === "multisigs_list") return [MULTISIG_WIRE];
      if (cmd === "multisig_select")
        return { ...MULTISIG_WIRE, is_active: true };
      return undefined;
    });
    render(<VaultPicker />);
    await waitFor(() => {
      expect(screen.getByText("Personal")).toBeInTheDocument();
    });
    fireEvent.click(screen.getByText("Personal"));
    await waitFor(() => {
      expect(screen.getByText("Treasury")).toBeInTheDocument();
    });
    fireEvent.click(screen.getByText("Treasury"));
    await waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith("multisig_select", {
        multisigVaultId: "ms-1",
      });
    });
  });

  it("invokes onAddMultisig from the menu CTA", async () => {
    invokeMock.mockImplementation(
      routedMock({ vaults: VAULTS_WIRE, multisigs: [] }),
    );
    const onAddMultisig = vi.fn();
    render(<VaultPicker onAddMultisig={onAddMultisig} />);
    await waitFor(() => {
      expect(screen.getByText("Personal")).toBeInTheDocument();
    });
    fireEvent.click(screen.getByText("Personal"));
    fireEvent.click(screen.getByText(/\+ Create multisig vault/i));
    expect(onAddMultisig).toHaveBeenCalled();
  });
});
