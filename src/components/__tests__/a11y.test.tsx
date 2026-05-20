// Phase 3 a11y — keyboard interaction smoke tests for the most
// load-bearing surfaces:
//
//   1. OwnedNamesDashboard row — Enter toggles the Manage menu
//   2. NameLookup status region uses aria-live=polite
//   3. RecipientInput sets aria-invalid + aria-describedby on error

import { describe, expect, it, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { OwnedNamesDashboard } from "../OwnedNamesDashboard";
import { NameLookup } from "../NameLookup";
import { RecipientInput } from "../RecipientInput";
import type { NameDetail } from "../../sdk/naming";

const rowsTable: Record<string, NameDetail[]> = {};

vi.mock("../../sdk/naming", async () => {
  const actual = await vi.importActual<typeof import("../../sdk/naming")>("../../sdk/naming");
  return {
    ...actual,
    listOwnedNames: vi.fn(async (addr: string) => ({
      ok: true,
      value: rowsTable[addr.toLowerCase()] ?? [],
    })),
    isNameAvailable: vi.fn(async () => ({
      ok: true,
      value: { available: true },
    })),
    resolveName: vi.fn(async () => ({ ok: true, value: null })),
  };
});

beforeEach(() => {
  for (const k of Object.keys(rowsTable)) delete rowsTable[k];
});

const ADDR = "0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266";

describe("a11y · OwnedNamesDashboard keyboard", () => {
  it("row is focusable and Enter opens the Manage menu", async () => {
    rowsTable[ADDR] = [
      {
        name: "alice.mono",
        category: "human",
        owner: ADDR,
        registeredAtHeight: null,
        feePaidLyth: null,
        transferState: { kind: "active" },
        chainGap: null,
      },
    ];
    render(<OwnedNamesDashboard address={ADDR} />);
    const row = await screen.findByRole("listitem", { name: /alice.mono/i });
    expect(row.getAttribute("tabindex")).toBe("0");
    expect(row.getAttribute("aria-label")).toMatch(/alice.mono/);
    row.focus();
    expect(document.activeElement).toBe(row);
    fireEvent.keyDown(row, { key: "Enter" });
    // Menu opens (Cancel pending appears only for outgoing; for active
    // rows Propose transfer is rendered).
    expect(screen.getByText(/Propose transfer/i)).toBeInTheDocument();
  });
});

describe("a11y · NameLookup", () => {
  it("status region uses aria-live polite", () => {
    const onChange = vi.fn();
    const { container } = render(
      <NameLookup value="" onChange={onChange} />,
    );
    const status = container.querySelector('[aria-live="polite"]');
    expect(status).not.toBeNull();
  });
});

describe("a11y · RecipientInput", () => {
  it("sets aria-invalid + aria-describedby in error state", async () => {
    function Wrapper() {
      const [v, setV] = (require("react") as typeof import("react")).useState("");
      return (
        <RecipientInput
          value={v}
          onChange={setV}
          onResolved={() => undefined}
          nameResolveDebounceMs={10}
        />
      );
    }
    render(<Wrapper />);
    const input = screen.getByRole("textbox");
    fireEvent.change(input, { target: { value: "garbage" } });
    await waitFor(() => {
      expect(input.getAttribute("aria-invalid")).toBe("true");
    });
    const describedBy = input.getAttribute("aria-describedby");
    expect(describedBy).not.toBeNull();
    const errEl = document.getElementById(describedBy ?? "");
    expect(errEl?.getAttribute("aria-live")).toBe("polite");
  });
});
