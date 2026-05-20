// VaultsPanel — rename inline edit + delete confirm modal + last-vault
// protection.

import { describe, expect, it, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { VaultsPanel } from "../VaultsPanel";

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

const TWO_VAULTS = [
  {
    id: "1",
    label: "Personal",
    address: "0x1111111111111111111111111111111111111aaaa",
    created_at: 100,
    is_active: true,
  },
  {
    id: "2",
    label: "Work",
    address: "0x2222222222222222222222222222222222222bbbb",
    created_at: 200,
    is_active: false,
  },
];

describe("VaultsPanel · rendering", () => {
  it("lists every vault with its label and active marker", async () => {
    invokeMock.mockResolvedValueOnce(TWO_VAULTS);
    render(<VaultsPanel />);
    await waitFor(() => {
      expect(screen.getByText("Personal")).toBeInTheDocument();
    });
    expect(screen.getByText("Work")).toBeInTheDocument();
    expect(screen.getByText("active")).toBeInTheDocument();
  });

  it("shows the empty state when no vaults exist", async () => {
    invokeMock.mockResolvedValueOnce([]);
    render(<VaultsPanel />);
    await waitFor(() => {
      expect(screen.getByText(/No vaults yet/i)).toBeInTheDocument();
    });
  });
});

describe("VaultsPanel · rename", () => {
  it("calls vault_rename with the trimmed new label", async () => {
    invokeMock.mockResolvedValueOnce(TWO_VAULTS);
    invokeMock.mockResolvedValueOnce(undefined); // vault_rename
    invokeMock.mockResolvedValueOnce(TWO_VAULTS); // refresh
    render(<VaultsPanel />);
    await waitFor(() => {
      expect(screen.getByText("Personal")).toBeInTheDocument();
    });
    // Click the Rename button on the first row.
    const renames = screen.getAllByText("Rename");
    fireEvent.click(renames[0]!);
    // Edit the label.
    const input = screen.getByDisplayValue("Personal") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "  Renamed  " } });
    fireEvent.click(screen.getByText("Save"));
    await waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith("vault_rename", {
        vaultId: "1",
        newLabel: "Renamed",
      });
    });
  });

  it("rejects empty label", async () => {
    invokeMock.mockResolvedValueOnce(TWO_VAULTS);
    render(<VaultsPanel />);
    await waitFor(() => {
      expect(screen.getByText("Personal")).toBeInTheDocument();
    });
    const renames = screen.getAllByText("Rename");
    fireEvent.click(renames[0]!);
    fireEvent.change(screen.getByDisplayValue("Personal"), {
      target: { value: "" },
    });
    fireEvent.click(screen.getByText("Save"));
    expect(await screen.findByText(/cannot be empty/i)).toBeInTheDocument();
  });
});

describe("VaultsPanel · delete", () => {
  it("requires the last-4-chars token to unlock the delete button", async () => {
    invokeMock.mockResolvedValueOnce(TWO_VAULTS);
    render(<VaultsPanel />);
    await waitFor(() => {
      expect(screen.getByText("Work")).toBeInTheDocument();
    });
    // Click Delete on Work (the non-only vault).
    const deletes = screen.getAllByText("Delete");
    fireEvent.click(deletes[1]!);
    // Modal opens — confirm button is disabled until token matches.
    const confirm = screen.getByText(/Delete this vault/i) as HTMLButtonElement;
    expect(confirm.disabled).toBe(true);
    // Type the wrong token.
    fireEvent.change(screen.getByPlaceholderText(/bbbb/i), {
      target: { value: "abcd" },
    });
    expect(confirm.disabled).toBe(true);
    // Type the right token (last 4 chars).
    fireEvent.change(screen.getByPlaceholderText(/bbbb/i), {
      target: { value: "bbbb" },
    });
    expect(confirm.disabled).toBe(false);
  });

  it("invokes vault_delete with the right args on confirm", async () => {
    invokeMock.mockResolvedValueOnce(TWO_VAULTS);
    invokeMock.mockResolvedValueOnce(undefined); // vault_delete
    invokeMock.mockResolvedValueOnce([TWO_VAULTS[0]]); // refresh
    render(<VaultsPanel />);
    await waitFor(() => {
      expect(screen.getByText("Work")).toBeInTheDocument();
    });
    const deletes = screen.getAllByText("Delete");
    fireEvent.click(deletes[1]!);
    fireEvent.change(screen.getByPlaceholderText(/bbbb/i), {
      target: { value: "bbbb" },
    });
    fireEvent.click(screen.getByText(/Delete this vault/i));
    await waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith("vault_delete", {
        vaultId: "2",
        confirmToken: "bbbb",
      });
    });
  });

  it("disables Delete on the only remaining vault", async () => {
    invokeMock.mockResolvedValueOnce([TWO_VAULTS[0]]);
    render(<VaultsPanel />);
    await waitFor(() => {
      expect(screen.getByText("Personal")).toBeInTheDocument();
    });
    const deleteBtn = screen.getByText("Delete") as HTMLButtonElement;
    expect(deleteBtn.disabled).toBe(true);
  });
});
