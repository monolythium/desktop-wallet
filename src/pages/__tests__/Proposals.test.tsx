// Proposals page — list rendering + co-sign + cancel + mark-submitted.

import { describe, expect, it, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { Proposals } from "../Proposals";

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

vi.mock("../../sdk/naming", async () => {
  const actual =
    await vi.importActual<typeof import("../../sdk/naming")>("../../sdk/naming");
  return {
    ...actual,
    lookupAddress: vi.fn(async () => ({ ok: true, value: null })),
  };
});

const SIGNER_ME = "0xaaaa00000000000000000000000000000000aaaa";
const SIGNER_B = "0xcccc00000000000000000000000000000000cccc";
const SIGNER_C = "0xdddd00000000000000000000000000000000dddd";

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
      address: SIGNER_ME,
      kind: "local" as const,
      vault_id: "v-active",
      created_at: 100,
    },
    {
      id: "s-2",
      label: "Cofounder",
      pubkey: "0x" + "22".repeat(1952),
      address: SIGNER_B,
      kind: "external" as const,
      created_at: 100,
    },
    {
      id: "s-3",
      label: "Backup",
      pubkey: "0x" + "33".repeat(1952),
      address: SIGNER_C,
      kind: "external" as const,
      created_at: 100,
    },
  ],
  is_active: true,
  pending_proposal_count: 1,
};

const PROPOSAL_DRAFT = {
  id: "prop-1",
  multisig_vault_id: "ms-1",
  operation: { kind: "send" as const },
  payload_hex: "0xdeadbeef",
  payload_hash:
    "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  created_at: 100,
  expires_at: Math.floor(Date.now() / 1000) + 3600,
  signatures: [],
  state: "draft" as const,
  created_by: SIGNER_ME,
  tx_hash: null,
};

beforeEach(() => {
  invokeMock.mockReset();
  fetchAndUnlockVaultMock.mockReset();
  signPrehashMock.mockReset();
  getAddressMock.mockReset();
  fetchAndUnlockVaultMock.mockResolvedValue(new Uint8Array(32).fill(0x42));
  getAddressMock.mockReturnValue(SIGNER_ME);
  signPrehashMock.mockReturnValue(new Uint8Array(3309).fill(0xee));
});

describe("Proposals · empty + active states", () => {
  it("renders an empty-state when no proposals exist", async () => {
    invokeMock.mockImplementation(async (cmd: string) => {
      if (cmd === "vaults_list") return [];
      if (cmd === "multisigs_list") return [MULTISIG_WIRE];
      if (cmd === "proposals_list") return [];
      return undefined;
    });
    render(<Proposals />);
    await waitFor(() => {
      expect(screen.getByText(/Treasury/)).toBeInTheDocument();
    });
    expect(screen.getByText(/No proposals yet/i)).toBeInTheDocument();
  });

  it("renders a switch-to-multisig hint when none is active", async () => {
    invokeMock.mockImplementation(async (cmd: string) => {
      if (cmd === "vaults_list") return [];
      if (cmd === "multisigs_list") return [];
      return undefined;
    });
    render(<Proposals />);
    await waitFor(() => {
      expect(
        screen.getByText(/No multisig vault is active/i),
      ).toBeInTheDocument();
    });
  });

  it("lists proposals with their state + signature count", async () => {
    invokeMock.mockImplementation(async (cmd: string) => {
      if (cmd === "vaults_list") return [];
      if (cmd === "multisigs_list") return [MULTISIG_WIRE];
      if (cmd === "proposals_list") return [PROPOSAL_DRAFT];
      return undefined;
    });
    render(<Proposals />);
    await waitFor(() => {
      expect(screen.getByText("send")).toBeInTheDocument();
    });
    expect(screen.getByText("draft")).toBeInTheDocument();
    expect(screen.getByText(/0 \/ 2 signatures/i)).toBeInTheDocument();
  });
});

describe("Proposals · expand + co-sign", () => {
  it("expands a row and shows signer checkmarks", async () => {
    invokeMock.mockImplementation(async (cmd: string) => {
      if (cmd === "vaults_list") return [];
      if (cmd === "multisigs_list") return [MULTISIG_WIRE];
      if (cmd === "proposals_list")
        return [
          {
            ...PROPOSAL_DRAFT,
            signatures: [
              {
                signer_address: SIGNER_B,
                signature: "0x" + "ee".repeat(3309),
                signed_at: 101,
              },
            ],
            state: "collecting" as const,
          },
        ];
      return undefined;
    });
    render(<Proposals />);
    await waitFor(() => {
      expect(screen.getByText("send")).toBeInTheDocument();
    });
    fireEvent.click(screen.getByText("send"));
    await waitFor(() => {
      expect(screen.getByText(/Payload hash/i)).toBeInTheDocument();
    });
    // Three signer rows visible.
    expect(screen.getByText("Me")).toBeInTheDocument();
    expect(screen.getByText("Cofounder")).toBeInTheDocument();
    expect(screen.getByText("Backup")).toBeInTheDocument();
  });

  it("co-signs and calls proposal_attach_signature", async () => {
    invokeMock.mockImplementation(async (cmd: string) => {
      if (cmd === "vaults_list") return [];
      if (cmd === "multisigs_list") return [MULTISIG_WIRE];
      if (cmd === "proposals_list") return [PROPOSAL_DRAFT];
      if (cmd === "proposal_attach_signature") {
        return {
          ...PROPOSAL_DRAFT,
          signatures: [
            {
              signer_address: SIGNER_ME,
              signature: "0x" + "ee".repeat(3309),
              signed_at: 102,
            },
          ],
          state: "collecting" as const,
        };
      }
      return undefined;
    });
    render(<Proposals />);
    await waitFor(() => {
      expect(screen.getByText("send")).toBeInTheDocument();
    });
    fireEvent.click(screen.getByText("send"));
    fireEvent.click(
      await screen.findByRole("button", { name: /Sign as this wallet/i }),
    );
    fireEvent.change(
      document.querySelector('input[type="password"]') as HTMLInputElement,
      { target: { value: "pw" } },
    );
    fireEvent.click(screen.getByRole("button", { name: /Sign and attach/i }));
    await waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith(
        "proposal_attach_signature",
        expect.objectContaining({
          proposalId: "prop-1",
          signerAddress: SIGNER_ME,
        }),
      );
    });
  });

  it("blocks signing when active wallet is not a member", async () => {
    getAddressMock.mockReturnValue("0x9999999999999999999999999999999999999999");
    invokeMock.mockImplementation(async (cmd: string) => {
      if (cmd === "vaults_list") return [];
      if (cmd === "multisigs_list") return [MULTISIG_WIRE];
      if (cmd === "proposals_list") return [PROPOSAL_DRAFT];
      return undefined;
    });
    render(<Proposals />);
    await waitFor(() => {
      expect(screen.getByText("send")).toBeInTheDocument();
    });
    fireEvent.click(screen.getByText("send"));
    fireEvent.click(
      await screen.findByRole("button", { name: /Sign as this wallet/i }),
    );
    fireEvent.change(
      document.querySelector('input[type="password"]') as HTMLInputElement,
      { target: { value: "pw" } },
    );
    fireEvent.click(screen.getByRole("button", { name: /Sign and attach/i }));
    await waitFor(() => {
      expect(
        screen.getByText(/not a signer of this multisig/i),
      ).toBeInTheDocument();
    });
    expect(invokeMock).not.toHaveBeenCalledWith(
      "proposal_attach_signature",
      expect.anything(),
    );
  });
});

describe("Proposals · cancel + mark-submitted", () => {
  it("cancel invokes proposal_cancel with caller address", async () => {
    invokeMock.mockImplementation(async (cmd: string) => {
      if (cmd === "vaults_list") return [];
      if (cmd === "multisigs_list") return [MULTISIG_WIRE];
      if (cmd === "proposals_list") return [PROPOSAL_DRAFT];
      if (cmd === "proposal_cancel") return undefined;
      return undefined;
    });
    render(<Proposals />);
    await waitFor(() => {
      expect(screen.getByText("send")).toBeInTheDocument();
    });
    fireEvent.click(screen.getByText("send"));
    fireEvent.click(
      await screen.findByRole("button", { name: /Cancel proposal/i }),
    );
    // Modal opened — there are two "Cancel proposal" buttons now (the
    // inline trigger and the modal CTA). Find the modal-specific one.
    fireEvent.change(
      document.querySelector('input[type="password"]') as HTMLInputElement,
      { target: { value: "pw" } },
    );
    const buttons = screen.getAllByRole("button", { name: /Cancel proposal/i });
    fireEvent.click(buttons[buttons.length - 1]!);
    await waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith("proposal_cancel", {
        proposalId: "prop-1",
        byAddress: SIGNER_ME,
      });
    });
  });

  it("mark submitted requires a 0x + 64 hex tx hash", async () => {
    invokeMock.mockImplementation(async (cmd: string) => {
      if (cmd === "vaults_list") return [];
      if (cmd === "multisigs_list") return [MULTISIG_WIRE];
      if (cmd === "proposals_list")
        return [
          {
            ...PROPOSAL_DRAFT,
            state: "ready_to_submit" as const,
            signatures: [
              {
                signer_address: SIGNER_ME,
                signature: "0x" + "ee".repeat(3309),
                signed_at: 102,
              },
              {
                signer_address: SIGNER_B,
                signature: "0x" + "ee".repeat(3309),
                signed_at: 103,
              },
            ],
          },
        ];
      if (cmd === "proposal_mark_submitted") {
        return {
          ...PROPOSAL_DRAFT,
          state: "submitted" as const,
          tx_hash: "0x" + "11".repeat(32),
        };
      }
      return undefined;
    });
    render(<Proposals />);
    await waitFor(() => {
      expect(screen.getByText("send")).toBeInTheDocument();
    });
    fireEvent.click(screen.getByText("send"));
    fireEvent.click(
      await screen.findByRole("button", { name: /Mark submitted/i }),
    );
    const recordBtn = await screen.findByRole("button", {
      name: /Record submission/i,
    });
    expect((recordBtn as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(screen.getByPlaceholderText(/0x…/), {
      target: { value: "0xnotvalid" },
    });
    expect((recordBtn as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(screen.getByPlaceholderText(/0x…/), {
      target: { value: "0x" + "11".repeat(32) },
    });
    expect((recordBtn as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(recordBtn);
    await waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith("proposal_mark_submitted", {
        proposalId: "prop-1",
        txHash: "0x" + "11".repeat(32),
      });
    });
  });
});
