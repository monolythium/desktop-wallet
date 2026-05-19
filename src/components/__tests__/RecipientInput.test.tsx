// RecipientInput — accepts the three address formats + reports
// resolved hex via onResolved.

import { describe, expect, it, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { RecipientInput } from "../RecipientInput";
import { TEST_ADDRESS, TEST_BECH32M } from "../../__tests__/helpers/fixtures";

const resolveTable: Record<string, string | null | "method-not-found"> = {};

vi.mock("../../sdk/naming", async () => {
  const actual = await vi.importActual<typeof import("../../sdk/naming")>("../../sdk/naming");
  return {
    ...actual,
    resolveName: vi.fn(async (name: string) => {
      const v = resolveTable[name];
      if (v === "method-not-found") return { ok: true, value: null };
      if (v === undefined || v === null) return { ok: true, value: null };
      return { ok: true, value: v };
    }),
  };
});

beforeEach(() => {
  for (const k of Object.keys(resolveTable)) delete resolveTable[k];
});

function Wrapper(props: { onResolved: (h: string | null) => void }) {
  const [v, setV] = (require("react") as typeof import("react")).useState("");
  return (
    <RecipientInput
      value={v}
      onChange={setV}
      onResolved={props.onResolved}
      nameResolveDebounceMs={10}
    />
  );
}

describe("RecipientInput", () => {
  it("resolves a 0x hex address synchronously", async () => {
    const onResolved = vi.fn();
    render(<Wrapper onResolved={onResolved} />);
    fireEvent.change(screen.getByRole("textbox"), { target: { value: TEST_ADDRESS } });
    await waitFor(() => {
      expect(onResolved).toHaveBeenCalledWith(TEST_ADDRESS.toLowerCase());
    });
    expect(screen.getByText(/✓ Resolves to/i)).toBeInTheDocument();
  });

  it("resolves a bech32m address synchronously", async () => {
    const onResolved = vi.fn();
    render(<Wrapper onResolved={onResolved} />);
    fireEvent.change(screen.getByRole("textbox"), {
      target: { value: TEST_BECH32M.anvil0.bech32 },
    });
    await waitFor(() => {
      expect(onResolved).toHaveBeenCalledWith(TEST_BECH32M.anvil0.hex.toLowerCase());
    });
  });

  it("resolves a .mono name via the SDK", async () => {
    resolveTable["alice.mono"] = TEST_ADDRESS;
    const onResolved = vi.fn();
    render(<Wrapper onResolved={onResolved} />);
    fireEvent.change(screen.getByRole("textbox"), {
      target: { value: "alice.mono" },
    });
    // resolving … → ok. The mock returns the EIP-55 form verbatim
    // (real resolveName normalizes via normalizeAddressHex, but our
    // hermetic mock returns the table entry as-is, matching the SDK
    // shape closely enough for the test).
    await waitFor(() => {
      expect(onResolved).toHaveBeenLastCalledWith(TEST_ADDRESS);
    });
  });

  it("surfaces a name-not-found error for unresolvable .mono names", async () => {
    const onResolved = vi.fn();
    render(<Wrapper onResolved={onResolved} />);
    fireEvent.change(screen.getByRole("textbox"), {
      target: { value: "ghost.mono" },
    });
    await waitFor(() => {
      expect(screen.getByText(/didn't resolve/i)).toBeInTheDocument();
    });
    expect(onResolved).toHaveBeenLastCalledWith(null);
  });

  it("rejects malformed input with an inline error + onResolved(null)", async () => {
    const onResolved = vi.fn();
    render(<Wrapper onResolved={onResolved} />);
    fireEvent.change(screen.getByRole("textbox"), {
      target: { value: "definitely-not-an-address" },
    });
    await waitFor(() => {
      expect(screen.getByText(/✗/)).toBeInTheDocument();
    });
    expect(onResolved).toHaveBeenLastCalledWith(null);
  });

  it("sets aria-invalid when in error state", async () => {
    render(<Wrapper onResolved={() => undefined} />);
    fireEvent.change(screen.getByRole("textbox"), {
      target: { value: "BADBADBAD" },
    });
    await waitFor(() => {
      expect(screen.getByRole("textbox").getAttribute("aria-invalid")).toBe("true");
    });
  });
});
