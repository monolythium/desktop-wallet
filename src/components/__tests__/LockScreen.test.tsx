// LockScreen — password entry + active-vault summary + multi-vault
// switcher.

import { describe, expect, it, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { LockScreen } from "../LockScreen";

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

const ACTIVE_ONLY = [
  { id: "1", label: "Personal", address: "0xaaaa", created_at: 100, is_active: true },
];

const TWO_VAULTS = [
  { id: "1", label: "Personal", address: "0xaaaa", created_at: 100, is_active: true },
  { id: "2", label: "Work", address: "0xbbbb", created_at: 200, is_active: false },
];

describe("LockScreen · rendering", () => {
  it("shows the active vault label + summary", async () => {
    invokeMock.mockResolvedValueOnce(ACTIVE_ONLY);
    render(<LockScreen />);
    await waitFor(() => {
      expect(screen.getByText(/Wallet locked/i)).toBeInTheDocument();
    });
    expect(screen.getByText(/Personal/)).toBeInTheDocument();
    expect(screen.getByText(/Active vault/i)).toBeInTheDocument();
  });

  it("hides the choose-different-vault link with only 1 vault", async () => {
    invokeMock.mockResolvedValueOnce(ACTIVE_ONLY);
    render(<LockScreen />);
    await waitFor(() => {
      expect(screen.getByText(/Wallet locked/i)).toBeInTheDocument();
    });
    expect(screen.queryByText(/different vault/i)).toBeNull();
  });

  it("shows the choose-different-vault link with >1 vault", async () => {
    invokeMock.mockResolvedValueOnce(TWO_VAULTS);
    render(<LockScreen />);
    await waitFor(() => {
      expect(screen.getByText(/Wallet locked/i)).toBeInTheDocument();
    });
    expect(screen.getByText(/different vault/i)).toBeInTheDocument();
  });
});

describe("LockScreen · unlock", () => {
  it("calls vault_unlock_multi on Unlock click", async () => {
    invokeMock.mockResolvedValueOnce(ACTIVE_ONLY); // listVaults
    invokeMock.mockResolvedValueOnce(ACTIVE_ONLY[0]); // vault_unlock_multi
    invokeMock.mockResolvedValueOnce(ACTIVE_ONLY); // refresh
    render(<LockScreen />);
    await waitFor(() => {
      expect(screen.getByLabelText(/Master password/i)).toBeInTheDocument();
    });
    fireEvent.change(screen.getByLabelText(/Master password/i), {
      target: { value: "hunter2" },
    });
    fireEvent.click(screen.getByText("Unlock"));
    await waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith("vault_unlock_multi", {
        password: "hunter2",
      });
    });
  });

  it("displays the error returned by Rust on wrong password", async () => {
    invokeMock.mockResolvedValueOnce(ACTIVE_ONLY);
    invokeMock.mockRejectedValueOnce({ code: "wrong_password" });
    render(<LockScreen />);
    await waitFor(() => {
      expect(screen.getByLabelText(/Master password/i)).toBeInTheDocument();
    });
    fireEvent.change(screen.getByLabelText(/Master password/i), {
      target: { value: "wrong" },
    });
    fireEvent.click(screen.getByText("Unlock"));
    await waitFor(() => {
      expect(screen.getByText(/Wrong password/i)).toBeInTheDocument();
    });
  });

  it("submits on Enter keypress in the password field", async () => {
    invokeMock.mockResolvedValueOnce(ACTIVE_ONLY);
    invokeMock.mockResolvedValueOnce(ACTIVE_ONLY[0]);
    invokeMock.mockResolvedValueOnce(ACTIVE_ONLY);
    render(<LockScreen />);
    await waitFor(() => {
      expect(screen.getByLabelText(/Master password/i)).toBeInTheDocument();
    });
    const input = screen.getByLabelText(/Master password/i);
    fireEvent.change(input, { target: { value: "hunter2" } });
    fireEvent.keyDown(input, { key: "Enter" });
    await waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith("vault_unlock_multi", {
        password: "hunter2",
      });
    });
  });
});
