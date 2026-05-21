// OperationsDrawer · multisig branch — when the active vault is a
// multisig AND the descriptor advertises proposal routing, the drawer
// must create a proposal + attach the creator's signature in place of
// calling `descriptor.execute()`.

import { describe, expect, it, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { OperationsDrawer } from "../OperationsDrawer";
import type { OperationDescriptor } from "../types";

const {
  invokeMock,
  fetchAndUnlockVaultMock,
  signPrehashMock,
  getAddressMock,
} = vi.hoisted(() => ({
  invokeMock: vi.fn(),
  fetchAndUnlockVaultMock: vi.fn(),
  signPrehashMock: vi.fn(),
  getAddressMock: vi.fn(),
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
    fetchAndUnlockVault: (...args: unknown[]) => fetchAndUnlockVaultMock(...args),
  };
});

vi.mock("@monolythium/core-sdk/crypto", () => ({
  MlDsa65Backend: {
    fromSeed: (_seed: Uint8Array) => ({
      getAddress: () => getAddressMock(),
      signPrehash: (digest: Uint8Array) => signPrehashMock(digest),
    }),
  },
}));

const SIGNER_ADDRESS = "0xaaaa00000000000000000000000000000000aaaa";

const MULTISIG_WIRE = {
  id: "ms-1",
  label: "Treasury",
  address: "0xbbbb00000000000000000000000000000000bbbb",
  created_at: 100,
  threshold: 2,
  signer_count: 3,
  signers: [
    {
      id: "s-1",
      label: "Me",
      pubkey: "0x" + "11".repeat(1952),
      address: SIGNER_ADDRESS,
      kind: "local" as const,
      vault_id: "v-active",
      created_at: 100,
    },
    {
      id: "s-2",
      label: "Cofounder",
      pubkey: "0x" + "22".repeat(1952),
      address: "0xcccc00000000000000000000000000000000cccc",
      kind: "external" as const,
      created_at: 100,
    },
    {
      id: "s-3",
      label: "Backup",
      pubkey: "0x" + "33".repeat(1952),
      address: "0xdddd00000000000000000000000000000000dddd",
      kind: "external" as const,
      created_at: 100,
    },
  ],
  is_active: true,
  pending_proposal_count: 0,
};

const PROPOSAL_WIRE = {
  id: "prop-1",
  multisig_vault_id: "ms-1",
  operation: { kind: "send" as const },
  payload_hex: "0xdeadbeef",
  payload_hash:
    "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  created_at: 100,
  expires_at: 200,
  signatures: [],
  state: "draft" as const,
  created_by: SIGNER_ADDRESS,
  tx_hash: null,
};

const PROPOSAL_WITH_SIG = {
  ...PROPOSAL_WIRE,
  signatures: [
    {
      signer_address: SIGNER_ADDRESS,
      signature: "0x" + "ee".repeat(3309),
      signed_at: 101,
    },
  ],
  state: "collecting" as const,
};

function makeSendDescriptor(): OperationDescriptor {
  return {
    title: "Send 1 LYTH",
    auth: "keychain",
    diff: [{ k: "To", v: "0xabc" }],
    effects: [],
    proposal: {
      operation: "send",
      payload: new Uint8Array([0xde, 0xad, 0xbe, 0xef]),
    },
    execute: vi.fn(async () => ({ headline: "Sent" })),
  };
}

beforeEach(() => {
  invokeMock.mockReset();
  fetchAndUnlockVaultMock.mockReset();
  signPrehashMock.mockReset();
  getAddressMock.mockReset();
  // Default routing for invoke based on command name.
  invokeMock.mockImplementation(async (cmd: string) => {
    switch (cmd) {
      case "vaults_list":
        return [
          {
            id: "v-active",
            label: "Personal",
            address: SIGNER_ADDRESS,
            created_at: 100,
            is_active: false,
          },
        ];
      case "multisigs_list":
        return [MULTISIG_WIRE];
      case "proposal_create":
        return PROPOSAL_WIRE;
      case "proposal_attach_signature":
        return PROPOSAL_WITH_SIG;
      default:
        return undefined;
    }
  });
  fetchAndUnlockVaultMock.mockResolvedValue(new Uint8Array(32).fill(0x42));
  getAddressMock.mockReturnValue(SIGNER_ADDRESS);
  signPrehashMock.mockReturnValue(new Uint8Array(3309).fill(0xee));
});

describe("OperationsDrawer · multisig proposal routing", () => {
  it("shows the multisig banner in preview when active is multisig", async () => {
    const descriptor = makeSendDescriptor();
    render(<OperationsDrawer descriptor={descriptor} onClose={() => undefined} />);
    await waitFor(() => {
      expect(
        screen.getByText(/Multisig: drafting a proposal/i),
      ).toBeInTheDocument();
    });
    expect(screen.getByText(/Treasury/i)).toBeInTheDocument();
    expect(screen.getByText(/2 of 3/i)).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /create proposal/i }),
    ).toBeInTheDocument();
  });

  it("calls proposal_create + proposal_attach_signature, not execute()", async () => {
    const descriptor = makeSendDescriptor();
    render(<OperationsDrawer descriptor={descriptor} onClose={() => undefined} />);
    await waitFor(() => {
      expect(screen.getByText(/Multisig: drafting a proposal/i)).toBeInTheDocument();
    });
    fireEvent.click(screen.getByRole("button", { name: /create proposal/i }));
    // Auth pane appears with password input.
    await waitFor(() => {
      const pw = document.querySelector('input[type="password"]');
      expect(pw).not.toBeNull();
    });
    fireEvent.change(
      document.querySelector('input[type="password"]') as HTMLInputElement,
      { target: { value: "pw" } },
    );
    fireEvent.click(screen.getByRole("button", { name: /Authorize/i }));

    await waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith(
        "proposal_create",
        expect.objectContaining({
          multisigVaultId: "ms-1",
          operation: { kind: "send" },
          createdByAddress: SIGNER_ADDRESS,
        }),
      );
    });
    await waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith(
        "proposal_attach_signature",
        expect.objectContaining({
          proposalId: "prop-1",
          signerAddress: SIGNER_ADDRESS,
        }),
      );
    });
    // The descriptor's execute callback must not have run.
    expect(descriptor.execute).not.toHaveBeenCalled();
    // Done pane.
    await waitFor(() => {
      expect(screen.getByText(/Draft proposal created/i)).toBeInTheDocument();
    });
    expect(screen.getByText(/1 more signature needed/i)).toBeInTheDocument();
  });

  it("blocks the flow when the active vault isn't a signer", async () => {
    getAddressMock.mockReturnValue("0x9999999999999999999999999999999999999999");
    const descriptor = makeSendDescriptor();
    render(<OperationsDrawer descriptor={descriptor} onClose={() => undefined} />);
    await waitFor(() => {
      expect(screen.getByText(/Multisig: drafting a proposal/i)).toBeInTheDocument();
    });
    fireEvent.click(screen.getByRole("button", { name: /create proposal/i }));
    await waitFor(() => {
      const pw = document.querySelector('input[type="password"]');
      expect(pw).not.toBeNull();
    });
    fireEvent.change(
      document.querySelector('input[type="password"]') as HTMLInputElement,
      { target: { value: "pw" } },
    );
    fireEvent.click(screen.getByRole("button", { name: /Authorize/i }));
    await waitFor(() => {
      expect(screen.getByText(/isn't a signer/i)).toBeInTheDocument();
    });
    // Backend was not called.
    expect(invokeMock).not.toHaveBeenCalledWith(
      "proposal_create",
      expect.anything(),
    );
  });

  it("shows the unsupported banner + disables Continue when descriptor has no proposal", async () => {
    const descriptor: OperationDescriptor = {
      ...makeSendDescriptor(),
      proposal: undefined,
    };
    render(<OperationsDrawer descriptor={descriptor} onClose={() => undefined} />);
    await waitFor(() => {
      expect(
        screen.getByText(/Multisig vault active — operation unavailable/i),
      ).toBeInTheDocument();
    });
    const cont = screen.getByRole("button", {
      name: /Continue/i,
    }) as HTMLButtonElement;
    expect(cont.disabled).toBe(true);
  });
});

describe("OperationsDrawer · single-signer fall-through", () => {
  it("calls descriptor.execute when no multisig is active", async () => {
    invokeMock.mockImplementation(async (cmd: string) => {
      if (cmd === "vaults_list")
        return [
          {
            id: "v-active",
            label: "Personal",
            address: SIGNER_ADDRESS,
            created_at: 100,
            is_active: true,
          },
        ];
      if (cmd === "multisigs_list") return [];
      return undefined;
    });
    const execute = vi.fn(async () => ({ headline: "Sent", detail: "tx-1" }));
    const descriptor: OperationDescriptor = {
      title: "Send",
      auth: "keychain",
      diff: [],
      effects: [],
      execute,
    };
    render(<OperationsDrawer descriptor={descriptor} onClose={() => undefined} />);
    // Wait for hooks to settle. Click Continue to advance to auth.
    await waitFor(() => {
      expect(screen.getByText(/Send$/)).toBeInTheDocument();
    });
    fireEvent.click(screen.getByRole("button", { name: /^Continue$/ }));
    await waitFor(() => {
      const pw = document.querySelector('input[type="password"]');
      expect(pw).not.toBeNull();
    });
    fireEvent.change(
      document.querySelector('input[type="password"]') as HTMLInputElement,
      { target: { value: "pw" } },
    );
    fireEvent.click(screen.getByRole("button", { name: /Authorize/i }));
    await waitFor(() => {
      expect(execute).toHaveBeenCalled();
    });
  });
});
