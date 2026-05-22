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

/** Routing mock builder. `listState` is read each time `passkey_list`
 *  is invoked so callers can mutate it between actions to simulate
 *  the refresh-after-mutation cycle. Every command not explicitly
 *  routed returns `undefined`. */
function buildInvoke(args: {
  listState: { current: PasskeyWire[] };
  enrollResponse?: PasskeyWire;
  renameResponse?: PasskeyWire;
  removeResponse?: unknown;
}): (cmd: string, params?: Record<string, unknown>) => Promise<unknown> {
  return async (cmd) => {
    switch (cmd) {
      case "passkey_list":
        return args.listState.current;
      case "passkey_enroll":
        if (args.enrollResponse) {
          args.listState.current = [...args.listState.current, args.enrollResponse];
          return args.enrollResponse;
        }
        return undefined;
      case "passkey_rename":
        if (args.renameResponse) {
          args.listState.current = args.listState.current.map((p) =>
            p.id === args.renameResponse!.id ? args.renameResponse! : p,
          );
          return args.renameResponse;
        }
        return undefined;
      case "passkey_remove":
        args.listState.current = [];
        return args.removeResponse ?? undefined;
      case "slh_get_backup_status":
        return { kind: "not_enrolled" };
      default:
        return undefined;
    }
  };
}

beforeEach(() => {
  invokeMock.mockReset();
  resetPolicy();
});

describe("SecurityPanel · passkey section · empty state", () => {
  it("renders the empty-state hint when no passkeys are enrolled", async () => {
    invokeMock.mockImplementation(
      buildInvoke({ listState: { current: [] } }),
    );
    render(<SecurityPanel vaultId={VAULT_ID} />);
    await waitFor(() =>
      expect(
        screen.getByText(/No passkeys enrolled yet/i),
      ).toBeInTheDocument(),
    );
    expect(
      screen.getByRole("button", { name: /Enroll new passkey/i }),
    ).toBeInTheDocument();
  });

  it("does not render the passkey section when vaultId is missing", () => {
    render(<SecurityPanel />);
    expect(
      screen.queryByText(/Passkey signers/i),
    ).not.toBeInTheDocument();
    expect(invokeMock).not.toHaveBeenCalled();
  });
});

describe("SecurityPanel · passkey section · enrollment flow", () => {
  it("opens the enroll modal, submits, and flips enrolledForHighValue true", async () => {
    const listState = { current: [] as PasskeyWire[] };
    invokeMock.mockImplementation(
      buildInvoke({
        listState,
        enrollResponse: fixturePasskey({ label: "My laptop" }),
      }),
    );
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
    expect(
      screen.getByRole("dialog", { name: /Enroll a new passkey/i }),
    ).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText(/^Label$/i), {
      target: { value: "My laptop" },
    });
    fireEvent.click(screen.getByRole("button", { name: /^Enroll$/i }));

    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
    );
    await waitFor(() => {
      const labels = screen.getAllByText("My laptop");
      expect(labels.length).toBeGreaterThan(0);
    });
    await waitFor(() =>
      expect(getPolicy().enrolledForHighValue).toBe(true),
    );
    await waitFor(() => {
      const toggle = screen.getByRole("checkbox") as HTMLInputElement;
      expect(toggle.disabled).toBe(false);
    });
  });

  it("disables Enroll while the label is empty", async () => {
    invokeMock.mockImplementation(
      buildInvoke({ listState: { current: [] } }),
    );
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
    const listState = {
      current: [fixturePasskey({ label: "Only one" })] as PasskeyWire[],
    };
    invokeMock.mockImplementation(buildInvoke({ listState }));
    setPolicy({ enrolledForHighValue: true, passkeyRequired: true });
    render(<SecurityPanel vaultId={VAULT_ID} />);
    await waitFor(() => expect(screen.getByText("Only one")).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: /Remove Only one/i }));
    expect(
      screen.getByRole("dialog", { name: /Remove passkey "Only one"/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/Removing the last passkey will disable/i),
    ).toBeInTheDocument();
    const submit = screen.getByRole("button", { name: /^Remove$/i });
    expect((submit as HTMLButtonElement).disabled).toBe(true);

    fireEvent.change(screen.getByLabelText(/Confirm with master password/i), {
      target: { value: "pw-12345" },
    });
    expect((submit as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(submit);

    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
    );
    await waitFor(() =>
      expect(getPolicy().enrolledForHighValue).toBe(false),
    );
    expect(getPolicy().passkeyRequired).toBe(false);
  });

  it("does NOT show the last-passkey warning when the policy toggle is off", async () => {
    const listState = {
      current: [fixturePasskey({ label: "Only one" })] as PasskeyWire[],
    };
    invokeMock.mockImplementation(buildInvoke({ listState }));
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
    const listState = {
      current: [fixturePasskey({ label: "Old name" })] as PasskeyWire[],
    };
    invokeMock.mockImplementation(
      buildInvoke({
        listState,
        renameResponse: fixturePasskey({ label: "New name" }),
      }),
    );
    render(<SecurityPanel vaultId={VAULT_ID} />);
    await waitFor(() =>
      expect(screen.getByText("Old name")).toBeInTheDocument(),
    );
    fireEvent.click(screen.getByRole("button", { name: /Rename Old name/i }));
    fireEvent.change(screen.getByLabelText(/^New label$/i), {
      target: { value: "New name" },
    });
    fireEvent.click(screen.getByRole("button", { name: /^Save$/i }));
    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
    );
    await waitFor(() =>
      expect(screen.getByText("New name")).toBeInTheDocument(),
    );
  });
});
