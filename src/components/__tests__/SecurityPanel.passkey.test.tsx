// SecurityPanel · passkey signers section — enrollment, listing,
// rename, remove, last-passkey policy auto-disable.

import { describe, expect, it, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

const invokeMock = vi.fn();

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
}));

import { SecurityPanel } from "../SecurityPanel";
import { getPolicy, resetPolicy, setPolicy } from "../../sdk/policy";

const VAULT_ID = "v1";

interface PasskeyWire {
  id: string;
  backend: "software";
  public_key: string;
  label: string;
  device_name: string | null;
  counter: number;
  created_at: number;
  last_used: number;
}

function fixturePasskey(overrides: Partial<PasskeyWire> = {}): PasskeyWire {
  return {
    id: "c1",
    backend: "software",
    public_key: "p",
    label: "Test passkey",
    device_name: "test-host",
    counter: 0,
    created_at: 1_700_000_000,
    last_used: 1_700_000_000,
    ...overrides,
  };
}

beforeEach(() => {
  invokeMock.mockReset();
  resetPolicy();
});

describe("SecurityPanel · passkey section · empty state", () => {
  it("renders the empty-state hint when no passkeys are enrolled", async () => {
    invokeMock.mockResolvedValue([]); // passkey_list
    render(<SecurityPanel vaultId={VAULT_ID} />);
    await waitFor(() =>
      expect(
        screen.getByText(/No passkeys enrolled yet/i),
      ).toBeInTheDocument(),
    );
    // The Enroll button is present.
    expect(
      screen.getByRole("button", { name: /Enroll new passkey/i }),
    ).toBeInTheDocument();
  });

  it("does not render the passkey section when vaultId is missing", () => {
    render(<SecurityPanel />);
    expect(
      screen.queryByText(/Passkey signers/i),
    ).not.toBeInTheDocument();
    // No invoke calls at all in this branch.
    expect(invokeMock).not.toHaveBeenCalled();
  });
});

describe("SecurityPanel · passkey section · enrollment flow", () => {
  it("opens the enroll modal, submits, and flips enrolledForHighValue true", async () => {
    invokeMock.mockResolvedValueOnce([]); // initial list
    render(<SecurityPanel vaultId={VAULT_ID} />);
    await waitFor(() =>
      expect(
        screen.getByText(/No passkeys enrolled yet/i),
      ).toBeInTheDocument(),
    );
    expect(getPolicy().enrolledForHighValue).toBe(false);

    fireEvent.click(
      screen.getByRole("button", { name: /Enroll new passkey/i }),
    );
    // Modal visible.
    expect(
      screen.getByRole("dialog", { name: /Enroll a new passkey/i }),
    ).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText(/^Label$/i), {
      target: { value: "My laptop" },
    });
    // enroll → list refresh.
    invokeMock.mockResolvedValueOnce(fixturePasskey({ label: "My laptop" })); // passkey_enroll
    invokeMock.mockResolvedValueOnce([
      fixturePasskey({ label: "My laptop" }),
    ]); // passkey_list refresh
    fireEvent.click(screen.getByRole("button", { name: /^Enroll$/i }));

    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
    );
    // Row visible.
    await waitFor(() => {
      const labels = screen.getAllByText("My laptop");
      expect(labels.length).toBeGreaterThan(0);
    });
    // Policy flag flipped + toggle re-rendered enabled.
    await waitFor(() =>
      expect(getPolicy().enrolledForHighValue).toBe(true),
    );
    await waitFor(() => {
      const toggle = screen.getByRole("checkbox") as HTMLInputElement;
      expect(toggle.disabled).toBe(false);
    });
  });

  it("disables Enroll while the label is empty", async () => {
    invokeMock.mockResolvedValueOnce([]);
    render(<SecurityPanel vaultId={VAULT_ID} />);
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: /Enroll new passkey/i }),
      ).toBeInTheDocument(),
    );
    fireEvent.click(
      screen.getByRole("button", { name: /Enroll new passkey/i }),
    );
    const submit = screen.getByRole("button", { name: /^Enroll$/i });
    expect((submit as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(screen.getByLabelText(/^Label$/i), {
      target: { value: "ok" },
    });
    expect((submit as HTMLButtonElement).disabled).toBe(false);
  });
});

describe("SecurityPanel · passkey section · remove flow", () => {
  it("requires the master password and warns when the last passkey is about to go", async () => {
    invokeMock.mockResolvedValueOnce([
      fixturePasskey({ label: "Only one" }),
    ]); // initial list
    setPolicy({ enrolledForHighValue: true, passkeyRequired: true });
    render(<SecurityPanel vaultId={VAULT_ID} />);
    await waitFor(() => expect(screen.getByText("Only one")).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: /Remove Only one/i }));
    expect(
      screen.getByRole("dialog", { name: /Remove passkey "Only one"/i }),
    ).toBeInTheDocument();
    // Last-passkey warning visible (policy was active).
    expect(
      screen.getByText(/Removing the last passkey will disable/i),
    ).toBeInTheDocument();
    // Submit button disabled while password is empty.
    const submit = screen.getByRole("button", { name: /^Remove$/i });
    expect((submit as HTMLButtonElement).disabled).toBe(true);

    fireEvent.change(screen.getByLabelText(/Confirm with master password/i), {
      target: { value: "pw-12345" },
    });
    expect((submit as HTMLButtonElement).disabled).toBe(false);

    // remove → list refresh (empty).
    invokeMock.mockResolvedValueOnce(undefined); // passkey_remove
    invokeMock.mockResolvedValueOnce([]); // passkey_list refresh
    fireEvent.click(submit);

    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
    );
    await waitFor(() =>
      expect(getPolicy().enrolledForHighValue).toBe(false),
    );
    // Policy toggle auto-cleared too.
    expect(getPolicy().passkeyRequired).toBe(false);
  });

  it("does NOT show the last-passkey warning when the policy toggle is off", async () => {
    invokeMock.mockResolvedValueOnce([
      fixturePasskey({ label: "Only one" }),
    ]);
    // Policy enrolled but NOT requiring passkey → no warning.
    setPolicy({ enrolledForHighValue: true, passkeyRequired: false });
    render(<SecurityPanel vaultId={VAULT_ID} />);
    await waitFor(() =>
      expect(screen.getByText("Only one")).toBeInTheDocument(),
    );
    fireEvent.click(screen.getByRole("button", { name: /Remove Only one/i }));
    expect(
      screen.queryByText(/Removing the last passkey will disable/i),
    ).not.toBeInTheDocument();
  });
});

describe("SecurityPanel · passkey section · rename flow", () => {
  it("updates the visible label after a successful rename", async () => {
    invokeMock.mockResolvedValueOnce([
      fixturePasskey({ label: "Old name" }),
    ]);
    render(<SecurityPanel vaultId={VAULT_ID} />);
    await waitFor(() =>
      expect(screen.getByText("Old name")).toBeInTheDocument(),
    );
    fireEvent.click(screen.getByRole("button", { name: /Rename Old name/i }));
    fireEvent.change(screen.getByLabelText(/^New label$/i), {
      target: { value: "New name" },
    });
    invokeMock.mockResolvedValueOnce(
      fixturePasskey({ label: "New name" }),
    ); // passkey_rename
    invokeMock.mockResolvedValueOnce([
      fixturePasskey({ label: "New name" }),
    ]); // refresh
    fireEvent.click(screen.getByRole("button", { name: /^Save$/i }));
    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
    );
    await waitFor(() =>
      expect(screen.getByText("New name")).toBeInTheDocument(),
    );
  });
});
