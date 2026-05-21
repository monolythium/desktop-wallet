// MultisigCreateFlow — wizard step traversal + signer/threshold
// handling + create submission.

import { describe, expect, it, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MultisigCreateFlow } from "../MultisigCreateFlow";

const { invokeMock, fetchAndUnlockVaultMock, publicKeyMock, keccakMock } =
  vi.hoisted(() => ({
    invokeMock: vi.fn(),
    fetchAndUnlockVaultMock: vi.fn(),
    publicKeyMock: vi.fn(),
    // Default to a benign 32-byte hash so module-load callers like
    // `naming.ts:selectorOf` don't crash on undefined.
    keccakMock: vi.fn().mockReturnValue("0x" + "00".repeat(32)),
  }));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
}));

vi.mock("../../sdk/keychain", () => ({
  PRIMARY_ACCOUNT: "kc:lyth:primary:v1",
  fetchAndUnlockVault: (...args: unknown[]) => fetchAndUnlockVaultMock(...args),
}));

vi.mock("@monolythium/core-sdk/crypto", () => ({
  MlDsa65Backend: {
    fromSeed: (_seed: Uint8Array) => ({
      publicKey: () => publicKeyMock(),
    }),
  },
}));

vi.mock("ethers", async (importOriginal) => {
  const actual = await importOriginal<typeof import("ethers")>();
  return {
    ...actual,
    keccak256: (...args: unknown[]) => keccakMock(...args),
  };
});

vi.mock("../../sdk/naming", async () => {
  const actual =
    await vi.importActual<typeof import("../../sdk/naming")>("../../sdk/naming");
  return {
    ...actual,
    lookupAddress: vi.fn(async () => ({ ok: true, value: null })),
  };
});

const ACTIVE_VAULT = {
  id: "v-active",
  label: "Personal",
  address: "0x1111111111111111111111111111111111111aaaa",
  created_at: 100,
  is_active: true,
};

const EXTERNAL_PUBKEY_HEX = "0x" + "ab".repeat(1952);
const EXTERNAL_ADDRESS = "0x" + "cd".repeat(20);

beforeEach(() => {
  invokeMock.mockReset();
  fetchAndUnlockVaultMock.mockReset();
  publicKeyMock.mockReset();
  keccakMock.mockReset();
  // Reinstate the benign default after reset.
  keccakMock.mockReturnValue("0x" + "00".repeat(12) + EXTERNAL_ADDRESS.slice(2));
  invokeMock.mockImplementation(async (cmd: string) => {
    switch (cmd) {
      case "vaults_list":
        return [ACTIVE_VAULT];
      case "multisigs_list":
        return [];
      default:
        return undefined;
    }
  });
  publicKeyMock.mockReturnValue(new Uint8Array(1952).fill(0xab));
});

// ─── Helpers ────────────────────────────────────────────────────────

function getTriggerAddButton(): HTMLButtonElement {
  // The trigger uses the literal "+ Add signer" label; the in-form submit
  // button is just "Add signer".
  return screen.getByRole("button", { name: /^\+ Add signer$/ }) as HTMLButtonElement;
}

function getFormSubmitButton(): HTMLButtonElement {
  return screen.getByRole("button", { name: /^Add signer$/ }) as HTMLButtonElement;
}

function getMasterPasswordInput(): HTMLInputElement {
  // The only `input[type="password"]` rendered while AddSignerForm is in
  // local mode is the master-password field. On the review step, ditto.
  const inputs = document.querySelectorAll('input[type="password"]');
  if (inputs.length === 0) throw new Error("no password input found");
  return inputs[0] as HTMLInputElement;
}

async function advanceToSigners(label = "Treasury") {
  const labelInput = await screen.findByPlaceholderText(/Treasury/i);
  fireEvent.change(labelInput, { target: { value: label } });
  fireEvent.click(screen.getByRole("button", { name: "Continue" }));
  await waitFor(() => {
    expect(screen.getByText(/Step 2 of 4/i)).toBeInTheDocument();
  });
}

async function addLocalSigner(password = "hunter2hunter2") {
  fetchAndUnlockVaultMock.mockResolvedValueOnce(new Uint8Array(32));
  fireEvent.click(getTriggerAddButton());
  // Local mode is the default when an active vault is available — the
  // master password field appears.
  await waitFor(() => {
    expect(document.querySelector('input[type="password"]')).not.toBeNull();
  });
  fireEvent.change(getMasterPasswordInput(), { target: { value: password } });
  fireEvent.click(getFormSubmitButton());
  await waitFor(() => {
    expect(fetchAndUnlockVaultMock).toHaveBeenCalled();
  });
  // Form closes after success — trigger button is back.
  await waitFor(() => {
    expect(
      screen.queryByRole("button", { name: /^\+ Add signer$/ }),
    ).toBeInTheDocument();
  });
}

async function addExternalSigner(label: string, pubkey = EXTERNAL_PUBKEY_HEX) {
  fireEvent.click(getTriggerAddButton());
  fireEvent.click(screen.getByRole("button", { name: /External \(pubkey\)/i }));
  fireEvent.change(screen.getByPlaceholderText(/Cofounder/i), {
    target: { value: label },
  });
  fireEvent.change(screen.getByPlaceholderText(/3904 hex chars/i), {
    target: { value: pubkey },
  });
  fireEvent.click(getFormSubmitButton());
  await waitFor(() => {
    expect(screen.queryByPlaceholderText(/3904 hex chars/i)).not.toBeInTheDocument();
  });
}

// ─── Tests ─────────────────────────────────────────────────────────

describe("MultisigCreateFlow · step traversal", () => {
  it("renders Step 1 of 4 initially with a disabled Continue button", async () => {
    render(<MultisigCreateFlow onClose={() => undefined} />);
    expect(screen.getByText(/Step 1 of 4/i)).toBeInTheDocument();
    const cont = screen.getByRole("button", {
      name: "Continue",
    }) as HTMLButtonElement;
    expect(cont.disabled).toBe(true);
  });

  it("Cancel calls onClose at any step", async () => {
    const onClose = vi.fn();
    render(<MultisigCreateFlow onClose={onClose} />);
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onClose).toHaveBeenCalled();
  });

  it("walks label → signers → threshold → review", async () => {
    render(<MultisigCreateFlow onClose={() => undefined} />);
    await advanceToSigners("Treasury");
    // useVaults populates the active vault from the mocked invoke.
    await waitFor(() => {
      expect(getTriggerAddButton()).toBeInTheDocument();
    });

    await addLocalSigner();
    await addExternalSigner("Cofounder A");

    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    await waitFor(() => {
      expect(screen.getByText(/Step 3 of 4/i)).toBeInTheDocument();
    });
    // 2 signers ⇒ default threshold = ⌊2/2⌋+1 = 2
    expect(screen.getByText(/2 of 2/i)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    await waitFor(() => {
      expect(screen.getByText(/Step 4 of 4/i)).toBeInTheDocument();
    });
  });
});

describe("MultisigCreateFlow · signer handling", () => {
  it("rejects continue when zero signers", async () => {
    render(<MultisigCreateFlow onClose={() => undefined} />);
    await advanceToSigners();
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    expect(await screen.findByText(/at least one signer/i)).toBeInTheDocument();
  });

  it("rejects external pubkey of wrong length", async () => {
    render(<MultisigCreateFlow onClose={() => undefined} />);
    await advanceToSigners();
    fireEvent.click(getTriggerAddButton());
    fireEvent.click(screen.getByRole("button", { name: /External \(pubkey\)/i }));
    fireEvent.change(screen.getByPlaceholderText(/Cofounder/i), {
      target: { value: "A" },
    });
    fireEvent.change(screen.getByPlaceholderText(/3904 hex chars/i), {
      target: { value: "0xdeadbeef" },
    });
    fireEvent.click(getFormSubmitButton());
    expect(
      await screen.findByText(/Pubkey must be 0x \+ 3904 hex chars/i),
    ).toBeInTheDocument();
  });

  it("rejects external signer without a label", async () => {
    render(<MultisigCreateFlow onClose={() => undefined} />);
    await advanceToSigners();
    fireEvent.click(getTriggerAddButton());
    fireEvent.click(screen.getByRole("button", { name: /External \(pubkey\)/i }));
    fireEvent.change(screen.getByPlaceholderText(/3904 hex chars/i), {
      target: { value: EXTERNAL_PUBKEY_HEX },
    });
    fireEvent.click(getFormSubmitButton());
    expect(await screen.findByText(/Label is required/i)).toBeInTheDocument();
  });

  it("removes a signer from the list", async () => {
    render(<MultisigCreateFlow onClose={() => undefined} />);
    await advanceToSigners();
    await addExternalSigner("Cofounder A");
    expect(screen.getByText("Cofounder A")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Remove" }));
    expect(screen.queryByText("Cofounder A")).not.toBeInTheDocument();
  });

  it("wipes the seed buffer after local-signer derivation", async () => {
    const seedBuf = new Uint8Array(32).fill(0x42);
    fetchAndUnlockVaultMock.mockResolvedValueOnce(seedBuf);

    render(<MultisigCreateFlow onClose={() => undefined} />);
    await advanceToSigners();
    await waitFor(() => {
      expect(getTriggerAddButton()).toBeInTheDocument();
    });
    fireEvent.click(getTriggerAddButton());
    await waitFor(() => {
      expect(document.querySelector('input[type="password"]')).not.toBeNull();
    });
    fireEvent.change(getMasterPasswordInput(), { target: { value: "pw" } });
    fireEvent.click(getFormSubmitButton());
    await waitFor(() => {
      expect(fetchAndUnlockVaultMock).toHaveBeenCalled();
    });
    // The component's `finally { seed.fill(0) }` should have zeroed it.
    expect(seedBuf.every((b) => b === 0)).toBe(true);
  });
});

describe("MultisigCreateFlow · threshold defaults", () => {
  it("defaults to simple-majority across various M/N", async () => {
    const cases: Array<{ n: number; expected: number }> = [
      { n: 1, expected: 1 },
      { n: 2, expected: 2 },
      { n: 3, expected: 2 },
      { n: 4, expected: 3 },
      { n: 5, expected: 3 },
    ];
    for (const { n, expected } of cases) {
      const { unmount } = render(
        <MultisigCreateFlow onClose={() => undefined} />,
      );
      await advanceToSigners(`M${n}`);
      for (let i = 0; i < n; i += 1) {
        await addExternalSigner(`Signer ${i}`);
      }
      fireEvent.click(screen.getByRole("button", { name: "Continue" }));
      await waitFor(() => {
        expect(screen.getByText(/Step 3 of 4/i)).toBeInTheDocument();
      });
      // The slider preview lives inside a `.mono` span next to the input;
      // the matching is constrained to that span so it doesn't collide
      // with the "Step 3 of 4" step indicator when n === 4.
      const slider = screen.getByRole("slider") as HTMLInputElement;
      expect(slider.value).toBe(String(expected));
      expect(slider.max).toBe(String(n));
      unmount();
    }
  });

  it("respects manual threshold override via the slider", async () => {
    render(<MultisigCreateFlow onClose={() => undefined} />);
    await advanceToSigners();
    await addExternalSigner("A");
    await addExternalSigner("B");
    await addExternalSigner("C");
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    await waitFor(() => {
      expect(screen.getByText(/Step 3 of 4/i)).toBeInTheDocument();
    });
    // Default for N=3 is 2; bump to 3 (unanimous).
    const slider = screen.getByRole("slider") as HTMLInputElement;
    fireEvent.change(slider, { target: { value: "3" } });
    expect(screen.getByText(/3 of 3/i)).toBeInTheDocument();
  });
});

describe("MultisigCreateFlow · submission", () => {
  it("submits with the expected payload and calls onCreated", async () => {
    const onClose = vi.fn();
    const onCreated = vi.fn();
    render(<MultisigCreateFlow onClose={onClose} onCreated={onCreated} />);
    await advanceToSigners("Treasury");
    await addExternalSigner("Cofounder A");
    await addExternalSigner("Cofounder B");
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    await waitFor(() => {
      expect(screen.getByText(/Step 3 of 4/i)).toBeInTheDocument();
    });
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    await waitFor(() => {
      expect(screen.getByText(/Step 4 of 4/i)).toBeInTheDocument();
    });

    fireEvent.change(getMasterPasswordInput(), {
      target: { value: "hunter2hunter2" },
    });

    invokeMock.mockImplementationOnce(async (cmd: string, args: unknown) => {
      expect(cmd).toBe("multisig_create");
      const a = args as {
        label: string;
        threshold: number;
        password: string;
        signers: { kind: string; label: string }[];
      };
      expect(a.label).toBe("Treasury");
      expect(a.threshold).toBe(2);
      expect(a.password).toBe("hunter2hunter2");
      expect(a.signers).toHaveLength(2);
      expect(a.signers[0]!.kind).toBe("external");
      return {
        id: "ms-new",
        label: "Treasury",
        address: "0x" + "ff".repeat(20),
        created_at: 999,
        threshold: 2,
        signer_count: 2,
        signers: [],
        is_active: false,
        pending_proposal_count: 0,
      };
    });

    fireEvent.click(
      screen.getByRole("button", { name: /Create multisig vault/i }),
    );
    await waitFor(() => {
      expect(onCreated).toHaveBeenCalledWith("ms-new");
    });
    expect(onClose).toHaveBeenCalled();
  });

  it("surfaces backend errors without closing the flow", async () => {
    const onClose = vi.fn();
    render(<MultisigCreateFlow onClose={onClose} />);
    await advanceToSigners();
    await addExternalSigner("A");
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    await waitFor(() => {
      expect(screen.getByText(/Step 3 of 4/i)).toBeInTheDocument();
    });
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    await waitFor(() => {
      expect(screen.getByText(/Step 4 of 4/i)).toBeInTheDocument();
    });
    fireEvent.change(getMasterPasswordInput(), { target: { value: "pw" } });

    invokeMock.mockRejectedValueOnce({
      code: "vault",
      "0": { code: "wrong_password", message: "wrong password" },
    });

    fireEvent.click(
      screen.getByRole("button", { name: /Create multisig vault/i }),
    );
    await waitFor(() => {
      const banner = document.querySelector(".w-banner.error");
      expect(banner).not.toBeNull();
      expect(within(banner as HTMLElement).getByText(/wrong password/i))
        .toBeInTheDocument();
    });
    expect(onClose).not.toHaveBeenCalled();
  });
});
