// Phase 8 — BackupStatusIndicator tone branches.

import { describe, expect, it, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

const invokeMock = vi.fn();

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
}));

import { BackupStatusIndicator } from "../BackupStatusIndicator";

const VAULT_ID = "v1";

beforeEach(() => {
  invokeMock.mockReset();
});

describe("BackupStatusIndicator", () => {
  it("is hidden when no vaultId is provided", () => {
    render(<BackupStatusIndicator vaultId={null} balanceLyth={100} />);
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    expect(invokeMock).not.toHaveBeenCalled();
  });

  it("renders the green OK badge when backup is enrolled", async () => {
    invokeMock.mockResolvedValueOnce({ kind: "enrolled", created_at: 100 });
    render(<BackupStatusIndicator vaultId={VAULT_ID} balanceLyth={100} />);
    await waitFor(() =>
      expect(screen.getByText(/Backup OK/i)).toBeInTheDocument(),
    );
  });

  it("renders the green OK badge when backup is activated", async () => {
    invokeMock.mockResolvedValueOnce({
      kind: "activated",
      created_at: 100,
      activated_at: 200,
    });
    render(<BackupStatusIndicator vaultId={VAULT_ID} balanceLyth={100} />);
    await waitFor(() =>
      expect(screen.getByText(/Backup OK/i)).toBeInTheDocument(),
    );
  });

  it("renders the amber warning when not enrolled + high balance", async () => {
    invokeMock.mockResolvedValueOnce({ kind: "not_enrolled" });
    render(<BackupStatusIndicator vaultId={VAULT_ID} balanceLyth={100} />);
    await waitFor(() =>
      expect(screen.getByText(/No backup/i)).toBeInTheDocument(),
    );
  });

  it("is hidden when not enrolled + low balance", async () => {
    invokeMock.mockResolvedValueOnce({ kind: "not_enrolled" });
    const { container } = render(
      <BackupStatusIndicator vaultId={VAULT_ID} balanceLyth={1} />,
    );
    await waitFor(() => expect(invokeMock).toHaveBeenCalled());
    expect(container.textContent ?? "").not.toMatch(/Backup OK|No backup/i);
  });

  it("click on warning fires wallet:nav toward settings", async () => {
    invokeMock.mockResolvedValueOnce({ kind: "not_enrolled" });
    const handler = vi.fn();
    window.addEventListener("wallet:nav", handler);
    try {
      render(<BackupStatusIndicator vaultId={VAULT_ID} balanceLyth={100} />);
      await waitFor(() =>
        expect(screen.getByText(/No backup/i)).toBeInTheDocument(),
      );
      fireEvent.click(screen.getByText(/No backup/i).closest("button")!);
      expect(handler).toHaveBeenCalled();
    } finally {
      window.removeEventListener("wallet:nav", handler);
    }
  });
});
