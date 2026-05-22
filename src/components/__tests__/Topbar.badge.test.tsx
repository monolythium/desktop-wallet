// Topbar · unlock-mode badge — posture rendering + click routing.

import { describe, expect, it, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { Topbar } from "../Topbar";
import { resetPolicy, setPolicy } from "../../sdk/policy";

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

vi.mock("../../sdk/useChainSnapshot", () => ({
  useChainSnapshot: () => ({
    status: "ready" as const,
    snapshot: {
      chainId: 69420,
      blockHeight: 100,
      endpoint: "rpc",
    },
  }),
}));

beforeEach(() => {
  invokeMock.mockReset();
  resetPolicy();
  // No multisigs by default.
  invokeMock.mockImplementation(async (cmd: string) => {
    if (cmd === "multisigs_list") return [];
    return undefined;
  });
});

describe("Topbar · unlock-mode badge", () => {
  it("shows 'Single-factor' when no passkey enrolled and no multisig", async () => {
    render(<Topbar route="home" />);
    await waitFor(() => {
      expect(screen.getByText(/Single-factor/i)).toBeInTheDocument();
    });
  });

  it("shows 'Two-factor available' once a passkey is enrolled", async () => {
    setPolicy({ enrolledForHighValue: true, passkeyRequired: false });
    render(<Topbar route="home" />);
    await waitFor(() => {
      expect(screen.getByText(/Two-factor available/i)).toBeInTheDocument();
    });
  });

  it("shows 'Two-factor active' when policy + enrollment both on", async () => {
    setPolicy({ enrolledForHighValue: true, passkeyRequired: true });
    render(<Topbar route="home" />);
    await waitFor(() => {
      expect(screen.getByText(/Two-factor active/i)).toBeInTheDocument();
    });
  });

  it("shows 'Multisig M-of-N' when an active multisig is in the picker", async () => {
    invokeMock.mockImplementation(async (cmd: string) => {
      if (cmd === "multisigs_list") {
        return [
          {
            id: "ms-1",
            label: "Treasury",
            address: "0xaaaa00000000000000000000000000000000aaaa",
            created_at: 1,
            threshold: 2,
            signer_count: 3,
            signers: [],
            is_active: true,
            pending_proposal_count: 0,
          },
        ];
      }
      return undefined;
    });
    render(<Topbar route="home" />);
    await waitFor(() => {
      expect(screen.getByText(/Multisig 2-of-3/i)).toBeInTheDocument();
    });
  });

  it("click routes through onBadgeClick", async () => {
    const onBadgeClick = vi.fn();
    render(<Topbar route="home" onBadgeClick={onBadgeClick} />);
    await waitFor(() => {
      expect(screen.getByText(/Single-factor/i)).toBeInTheDocument();
    });
    fireEvent.click(screen.getByText(/Single-factor/i));
    expect(onBadgeClick).toHaveBeenCalled();
  });
});
